/**
 * routes/proxy-split.js — Split payment mode handler (95/5 native on-chain)
 *
 * Called when a client sends X-Payment-TxHash-Provider (and optionally
 * X-Payment-TxHash-Platform) for a service that has an owner_address.
 * Verifies both payments on-chain, records deferred claiming, then delegates
 * to executeProxyCall for the actual upstream fetch.
 */
"use strict";

const logger = require("../lib/logger");
const { TX_HASH_REGEX } = require("../lib/payment");
const { getChainConfig } = require("../lib/chains");
const { executeProxyCall } = require("./proxy-execute");

// Minimum price (micro-USDC) for split payment to ensure both split amounts are non-zero
const MIN_SPLIT_AMOUNT_RAW = 100; // 0.0001 USDC

/**
 * Handle split payment mode.
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} opts
 * @param {object} opts.supabase
 * @param {object} opts.service
 * @param {number} opts.price
 * @param {number} opts.minAmountRaw
 * @param {string} opts.chainKey
 * @param {string} opts.txHashProvider
 * @param {string|null} opts.txHashPlatform
 * @param {object} opts.paymentSystem
 * @param {object} opts.payoutManager
 * @param {Function} opts.logActivity
 */
async function handleSplitMode(
  req,
  res,
  {
    supabase,
    service,
    price,
    minAmountRaw,
    chainKey,
    txHashProvider,
    txHashPlatform,
    paymentSystem,
    payoutManager,
    logActivity,
  },
) {
  // 0. Guard: Polygon facilitator mode uses a FeeSplitter contract — single-hash flow only.
  //    The FeeSplitter handles the 95/5 revenue split automatically on-chain.
  //    Clients must send a single X-Payment-TxHash (not X-Payment-TxHash-Provider/Platform).
  const _splitChainCfg = getChainConfig(chainKey);
  if (
    _splitChainCfg &&
    _splitChainCfg.facilitator &&
    _splitChainCfg.feeSplitterContract
  ) {
    return res.status(400).json({
      error: "SPLIT_MODE_NOT_SUPPORTED",
      message:
        "Polygon facilitator mode uses a FeeSplitter contract — send a single X-Payment-TxHash.",
      hint: "The FeeSplitter handles the 95/5 revenue split automatically on-chain. Use X-Payment-TxHash instead of X-Payment-TxHash-Provider.",
      fee_splitter_contract: _splitChainCfg.feeSplitterContract,
    });
  }

  // 1. Guard: minimum price to ensure non-zero split amounts
  if (minAmountRaw < MIN_SPLIT_AMOUNT_RAW) {
    return res.status(400).json({
      error: "Price too low for split payment",
      message: "Minimum price for split payment is 0.0001 USDC",
    });
  }

  // 2. Validate tx hash formats
  if (!TX_HASH_REGEX.test(txHashProvider)) {
    return res.status(400).json({
      error: "Invalid transaction hash format",
      field: "X-Payment-TxHash-Provider",
    });
  }
  if (txHashPlatform && !TX_HASH_REGEX.test(txHashPlatform)) {
    return res.status(400).json({
      error: "Invalid transaction hash format",
      field: "X-Payment-TxHash-Platform",
    });
  }

  // 3. Guard: provider and platform hashes must be different
  if (txHashPlatform && txHashPlatform === txHashProvider) {
    return res.status(400).json({
      error: "Invalid payment",
      message: "Provider and platform transaction hashes must be different",
    });
  }

  // 4. Anti-replay check
  const providerReplayKey = `${chainKey}:split_provider:${txHashProvider}`;
  const platformReplayKey = txHashPlatform
    ? `${chainKey}:split_platform:${txHashPlatform}`
    : null;

  try {
    const keysToCheck = [txHashProvider, providerReplayKey];
    if (txHashPlatform) {
      keysToCheck.push(txHashPlatform, platformReplayKey);
    }

    const { data: usedRows } = await supabase
      .from("used_transactions")
      .select("tx_hash")
      .in("tx_hash", keysToCheck)
      .limit(1);

    if (usedRows && usedRows.length > 0) {
      const usedHash = usedRows[0].tx_hash;
      const isProviderHash =
        usedHash === txHashProvider || usedHash === providerReplayKey;
      return res.status(409).json({
        error: "TX_ALREADY_USED",
        code: "TX_REPLAY",
        message: isProviderHash
          ? "This provider transaction hash has already been used for a previous payment. Please send a new transaction."
          : "This platform transaction hash has already been used for a previous payment. Please send a new transaction.",
      });
    }
  } catch (err) {
    logger.error("Proxy:split", "Anti-replay check error:", err.message);
    return res.status(503).json({
      error: "Service temporarily unavailable",
      message: "Payment verification system error. Please retry.",
    });
  }

  // 5. On-chain split verification
  let splitResult;
  try {
    splitResult = await paymentSystem.verifySplitPayment(
      txHashProvider,
      txHashPlatform || null,
      minAmountRaw,
      chainKey,
      service.owner_address,
    );
  } catch (err) {
    logger.error(
      "Proxy:split",
      `verifySplitPayment error for "${service.name}":`,
      err.message,
    );
    const isNetworkError =
      err.message === "RPC timeout" ||
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT");
    if (isNetworkError) {
      return res.status(503).json({
        error: "Service Unavailable",
        message:
          "RPC node unreachable. Payment could not be verified. Please retry in a few seconds.",
      });
    }
    return res.status(402).json({
      error: "Payment Required",
      message: "Payment verification failed.",
    });
  }

  // 6. Provider payment is mandatory
  if (!splitResult.providerValid) {
    return res.status(402).json({
      error: "Payment Required",
      message:
        "Provider payment invalid or insufficient. Please send the correct amount to the provider wallet.",
    });
  }

  // 7. Compute split amounts (needed by onSuccess and splitMeta)
  const providerAmountRaw = Math.floor((minAmountRaw * 95) / 100);
  const platformAmountRaw = minAmountRaw - providerAmountRaw;

  // 8. Deferred claiming: INSERT tx hashes + record payout ONLY after successful upstream call.
  //    This prevents users from losing USDC when the upstream API fails.
  const onSuccess = async () => {
    // Atomically claim provider tx hash
    const { error: claimProviderErr } = await supabase
      .from("used_transactions")
      .insert([
        {
          tx_hash: providerReplayKey,
          action: `split_provider:${service.name}`,
        },
      ]);

    if (claimProviderErr) {
      if (
        claimProviderErr.code === "23505" ||
        (claimProviderErr.message &&
          claimProviderErr.message.includes("duplicate"))
      ) {
        logger.warn(
          "Proxy:split",
          `Race condition on provider tx ${txHashProvider.slice(0, 18)}...`,
        );
        return { ok: false };
      }
      logger.error(
        "Proxy:split",
        "Failed to claim provider tx:",
        claimProviderErr.message,
      );
      return { ok: false };
    }

    // Determine split mode and optionally claim platform tx
    let splitMode = "provider_only";
    if (txHashPlatform && splitResult.platformValid) {
      const { error: claimPlatformErr } = await supabase
        .from("used_transactions")
        .insert([
          {
            tx_hash: platformReplayKey,
            action: `split_platform:${service.name}`,
          },
        ]);

      if (
        claimPlatformErr &&
        (claimPlatformErr.code === "23505" ||
          (claimPlatformErr.message &&
            claimPlatformErr.message.includes("duplicate")))
      ) {
        logger.warn(
          "Proxy:split",
          `Race on platform tx ${txHashPlatform.slice(0, 18)}... — continuing as provider_only`,
        );
      } else if (!claimPlatformErr) {
        splitMode = "split_complete";
      }
    }

    // Record split payout
    if (payoutManager) {
      payoutManager
        .recordSplitPayout({
          serviceId: service.id,
          serviceName: service.name,
          providerWallet: service.owner_address,
          grossAmount: price,
          txHashProvider,
          txHashPlatform: txHashPlatform || null,
          chain: chainKey,
          splitMode,
        })
        .catch((err) => {
          logger.error(
            "Proxy:split",
            `Failed to record split payout for "${service.name}": ${err.message}`,
          );
        });
    }

    logActivity(
      "proxy_call_split",
      `Proxied split call to "${service.name}" (${price} USDC, mode: ${splitMode})`,
      price,
      txHashProvider,
    );
    return { ok: true, splitMode };
  };

  // 9. Execute the proxy call with deferred claiming
  return executeProxyCall(req, res, {
    service,
    price,
    txHash: txHashProvider,
    chain: chainKey,
    payoutManager: null, // handled inside onSuccess
    logActivity: () => {}, // handled inside onSuccess
    splitMode: "split",
    splitMeta: {
      provider_amount: (providerAmountRaw / 1e6).toFixed(6),
      platform_amount: (platformAmountRaw / 1e6).toFixed(6),
      tx_hash_provider: txHashProvider,
      tx_hash_platform: txHashPlatform || null,
      platform_split_status:
        txHashPlatform && splitResult.platformValid
          ? "on_chain"
          : "fallback_pending",
    },
    onSuccess,
    supabase,
  });
}

module.exports = { handleSplitMode };
