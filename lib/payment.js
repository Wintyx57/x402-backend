// lib/payment.js — Payment verification + middleware

const crypto = require("crypto");
const logger = require("./logger");
const {
  CHAINS,
  DEFAULT_CHAIN_KEY,
  DEFAULT_CHAIN,
  getChainConfig,
  NETWORK,
} = require("./chains");
const { discoveryMap } = require("./bazaar-discovery");

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Internal proxy bypass: one-time tokens that allow the proxy to call internal
// services without double-payment. Each token is 256-bit random, single-use,
// and auto-expires after 30 seconds. Cannot be forged or replayed.
// Map<token, { timer: NodeJS.Timeout, expiresAt: number }>
const _internalBypassTokens = new Map();

function createInternalBypassToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 30_000;
  const timer = setTimeout(() => _internalBypassTokens.delete(token), 30_000);
  if (timer.unref) timer.unref();
  _internalBypassTokens.set(token, { timer, expiresAt });
  return token;
}

function consumeInternalBypassToken(token) {
  const entry = _internalBypassTokens.get(token);
  if (entry && Date.now() < entry.expiresAt) {
    clearTimeout(entry.timer);
    _internalBypassTokens.delete(token);
    return true;
  }
  if (entry) _internalBypassTokens.delete(token); // expired, cleanup
  return false;
}
const RPC_TIMEOUT = 10000; // 10s

// --- Per-wallet rate limiting (in-memory with TTL) ---
const WALLET_RATE_LIMIT = parseInt(process.env.WALLET_RATE_LIMIT, 10) || 60; // req/min per wallet
const WALLET_RATE_WINDOW_MS = 60 * 1000; // 1 minute window
// Cap to prevent unbounded memory growth (each entry ~200 bytes → 50K entries ≈ 10MB)
const MAX_WALLET_STORE_SIZE = 50000;

// Map<walletAddress, { count: number, resetAt: number }>
const walletRateLimitStore = new Map();

// Cleanup expired entries every 60 seconds
const _walletRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [wallet, entry] of walletRateLimitStore) {
    if (now >= entry.resetAt) {
      walletRateLimitStore.delete(wallet);
    }
  }
}, 60 * 1000);
// Allow Node process to exit cleanly without waiting for this interval
if (_walletRateLimitCleanupInterval.unref) {
  _walletRateLimitCleanupInterval.unref();
}

/**
 * Check and increment rate limit for a wallet address.
 * Returns { allowed: boolean, remaining: number, resetAt: number }
 */
function checkWalletRateLimit(walletAddress) {
  const now = Date.now();
  const key = walletAddress.toLowerCase();
  let entry = walletRateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    // Evict the oldest entry when store is at capacity to prevent unbounded growth
    if (walletRateLimitStore.size >= MAX_WALLET_STORE_SIZE) {
      const firstKey = walletRateLimitStore.keys().next().value;
      walletRateLimitStore.delete(firstKey);
    }
    // New window
    entry = { count: 1, resetAt: now + WALLET_RATE_WINDOW_MS };
    walletRateLimitStore.set(key, entry);
    return {
      allowed: true,
      remaining: WALLET_RATE_LIMIT - 1,
      resetAt: entry.resetAt,
    };
  }

  entry.count += 1;
  if (entry.count > WALLET_RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    allowed: true,
    remaining: WALLET_RATE_LIMIT - entry.count,
    resetAt: entry.resetAt,
  };
}

// Chain-specific retry delays (ms) — tuned to finality characteristics
const CHAIN_RETRY_DELAYS = {
  skale: 500, // quasi-instantaneous finality
  polygon: 3000, // ~2s block time, need multiple confirmations
  base: 2000, // L2 Optimism stack, ~2s block time
};

// Chain-specific max retry attempts — Polygon needs more time for confirmations
const CHAIN_MAX_RETRIES = {
  skale: 4, // instant finality, 4 is plenty
  polygon: 8, // 5 confirmations × ~2s = ~10s, 8 retries × 3s = 24s headroom
  base: 4, // 2 confirmations, fast
};

function getRetryDelay(chainKey) {
  return CHAIN_RETRY_DELAYS[chainKey] || 3000;
}

// Re-export the shared helper so existing callers (`require('./payment').fetchWithTimeout`)
// keep working. The shared version uses AbortController and actually cancels
// the in-flight request, whereas the old Promise.race version left a dangling
// request running in the background after the timeout fired.
const { fetchWithTimeout: _sharedFetchWithTimeout } = require("./http-client");

function fetchWithTimeout(url, options, timeout = RPC_TIMEOUT, signal) {
  return _sharedFetchWithTimeout(url, options, timeout, signal);
}

async function fetchWithFallback(chain, body, timeout, signal) {
  const urls = chain.rpcUrls || [chain.rpcUrl];
  let lastError;
  for (const url of urls) {
    try {
      return await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        timeout,
        signal,
      );
    } catch (err) {
      lastError = err;
      continue;
    }
  }
  throw lastError;
}

// --- Cache des paiements verifies (memoire + Supabase persiste) ---
class BoundedSet {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.set = new Set();
  }
  has(key) {
    return this.set.has(key);
  }
  add(key) {
    if (this.set.size >= this.maxSize) {
      const first = this.set.values().next().value;
      this.set.delete(first);
    }
    this.set.add(key);
  }
  get size() {
    return this.set.size;
  }
}

const verifiedPayments = new BoundedSet(10000);

// In-memory lock set: prevents concurrent requests with the same replayKey
// from both passing the isTxAlreadyUsed check before either claims the tx in DB.
// Each entry is removed in a finally block after the request completes.
const _pendingClaims = new Set();

function createPaymentSystem(supabase, logActivity, budgetManager) {
  async function isTxAlreadyUsed(...keys) {
    // Check memory cache first
    for (const key of keys) {
      if (verifiedPayments.has(key)) return true;
    }
    // Check Supabase (single query for all keys)
    const { data } = await supabase
      .from("used_transactions")
      .select("tx_hash")
      .in("tx_hash", keys)
      .limit(1);
    if (data && data.length > 0) {
      data.forEach((d) => verifiedPayments.add(d.tx_hash));
      return true;
    }
    return false;
  }

  async function markTxUsed(txHash, action) {
    // SECURITY: Use INSERT (not upsert) to atomically claim the tx hash.
    // If another request already claimed it, INSERT fails with duplicate key → race detected.
    const { error } = await supabase
      .from("used_transactions")
      .insert([{ tx_hash: txHash, action }]);
    if (error) {
      if (
        error.code === "23505" ||
        (error.message && error.message.includes("duplicate"))
      ) {
        logger.warn(
          "Anti-replay",
          `Race condition detected for tx ${txHash.slice(0, 18)}...`,
        );
        return false; // Another request won the race
      }
      logger.error("Anti-replay", "markTxUsed error:", error.message);
      return false; // Fail closed
    }
    verifiedPayments.add(txHash);
    return true;
  }

  async function verifyPayment(
    txHash,
    minAmount,
    chainKey = DEFAULT_CHAIN_KEY,
    recipientAddress = null,
  ) {
    // Guard: minAmount must be a non-negative integer (micro-USDC)
    if (
      typeof minAmount !== "number" ||
      !Number.isFinite(minAmount) ||
      minAmount < 0
    ) {
      throw new Error(`Invalid minAmount: ${minAmount}`);
    }

    const chain = getChainConfig(chainKey);
    // Normalize tx hash
    const normalizedTxHash = txHash.toLowerCase().trim();
    if (normalizedTxHash.length !== 66) {
      throw new Error("Invalid transaction hash length");
    }

    // recipientAddress: if null → use WALLET_ADDRESS (backward compat); otherwise verify transfer to this address
    const serverAddress = recipientAddress
      ? recipientAddress.toLowerCase()
      : process.env.WALLET_ADDRESS.toLowerCase();

    // Global timeout: abort all RPC calls after 30s to prevent indefinite hangs
    const VERIFY_TIMEOUT_MS = 30_000;
    const abortController = new AbortController();
    const globalTimer = setTimeout(
      () => abortController.abort(),
      VERIFY_TIMEOUT_MS,
    );
    try {
      // SKALE: instant finality (0 confirmations).
      // Polygon PoS: 5 confirmations (~10s) — safe for Polygon's consensus.
      // Base: 2 confirmations — L2 Optimism with sequencer finality.
      const requiredConfirmations =
        chainKey === "skale" ? 0 : chainKey === "polygon" ? 5 : 2;

      // 1. Fetch receipt + wait for confirmations (retry up to configured delay for fresh txs)
      const retryDelayMs = getRetryDelay(chainKey);
      const maxRetries = CHAIN_MAX_RETRIES[chainKey] || 4;
      let receipt = null;
      let confirmations = 0;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Fetch receipt
        if (!receipt) {
          const receiptRes = await fetchWithFallback(
            chain,
            {
              jsonrpc: "2.0",
              method: "eth_getTransactionReceipt",
              params: [normalizedTxHash],
              id: 1,
            },
            RPC_TIMEOUT,
            abortController.signal,
          );
          const receiptData = await receiptRes.json();
          receipt = receiptData.result;
        }

        // SKALE returns status as integer 1, Base as hex string '0x1'
        const statusOk =
          receipt &&
          (receipt.status === "0x1" ||
            receipt.status === 1 ||
            receipt.status === true);
        if (!statusOk) {
          if (attempt < maxRetries - 1) {
            logger.info(
              "x402",
              `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: not found yet, waiting ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
            );
            receipt = null; // Reset for re-fetch
            await new Promise((r) => setTimeout(r, retryDelayMs));
            continue;
          }
          logger.info(
            "x402",
            `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: failed or not found after ${attempt + 1} attempts`,
          );
          return false;
        }

        // SKALE: instant finality — receipt.status OK is sufficient
        if (requiredConfirmations === 0) {
          confirmations = 1; // mark as confirmed
          break;
        }

        // Check confirmations (Base/Base Sepolia)
        const blockNumberRes = await fetchWithFallback(
          chain,
          {
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 2,
          },
          RPC_TIMEOUT,
          abortController.signal,
        );
        const { result: currentBlockHex } = await blockNumberRes.json();
        const currentBlock = parseInt(currentBlockHex, 16);
        const txBlock = parseInt(receipt.blockNumber, 16);
        confirmations = currentBlock - txBlock;

        if (confirmations >= requiredConfirmations) break;

        if (attempt < maxRetries - 1) {
          logger.info(
            "x402",
            `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: ${confirmations} confirmation(s), waiting ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
      if (confirmations < requiredConfirmations) {
        logger.info(
          "x402",
          `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: only ${confirmations} confirmation(s) after retries`,
        );
        return false;
      }

      // 2. Verifier les Transfer ERC20 (USDC) vers notre wallet
      const TRANSFER_TOPIC =
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

      if (!receipt.logs || !Array.isArray(receipt.logs)) {
        logger.info(
          "x402",
          `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: no logs in receipt`,
        );
        return false;
      }

      for (const log of receipt.logs) {
        if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
          // SECURITY: Verify the log is from the correct USDC contract
          if (log.address.toLowerCase() !== chain.usdcContract.toLowerCase()) {
            continue; // Skip transfers from other tokens
          }
          if (!log.topics[1] || !log.topics[2]) continue; // Skip malformed logs
          const fromAddress = "0x" + log.topics[1].slice(26).toLowerCase();
          const toAddress = "0x" + log.topics[2].slice(26).toLowerCase();
          if (toAddress === serverAddress) {
            const amount = BigInt(log.data);
            // All chains use 6 decimal USDC. minAmount is in 6-decimal units.
            // Legacy: if a chain ever uses different decimals, normalize here.
            const chainDecimals = chain.usdcDecimals || 6;
            const usdcDivisor = 10 ** chainDecimals;
            const normalizedMin =
              chainDecimals > 6
                ? BigInt(minAmount) * BigInt(10 ** (chainDecimals - 6))
                : BigInt(minAmount);
            if (amount >= normalizedMin) {
              logger.info(
                "x402",
                `USDC payment verified on ${chain.label}: ${Number(amount) / usdcDivisor} USDC from ${fromAddress.slice(0, 10)}...`,
              );
              return { valid: true, from: fromAddress };
            } else {
              logger.info(
                "x402",
                `Insufficient amount on ${chain.label}: ${Number(amount) / usdcDivisor} USDC (min: ${Number(normalizedMin) / usdcDivisor})`,
              );
            }
          }
        }
      }

      logger.info(
        "x402",
        `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: payment not recognized or insufficient`,
      );
      return false;
    } finally {
      clearTimeout(globalTimer);
    }
  }

  /**
   * Verify a Polygon payment via the facilitator HTTP API (Phase 2).
   * Called instead of verifyPayment() when chainKey==='polygon' and chain.facilitator is set.
   *
   * The facilitator confirms the transaction and returns verification data — we do NOT
   * need to read the blockchain directly.
   *
   * @param {string} txHash - The transaction hash returned by the facilitator after settlement
   * @param {number} minAmount - Minimum required amount in micro-USDC (6 decimals)
   * @param {string} chainKey - Must be 'polygon' when this function is called
   * @returns {{ valid: true, from: string } | false}
   */
  async function verifyViaFacilitator(txHash, minAmount, chainKey) {
    const chain = getChainConfig(chainKey);
    if (!chain.facilitator || !chain.feeSplitterContract) {
      logger.error(
        "x402",
        "verifyViaFacilitator called but facilitator not configured",
      );
      return false;
    }

    const verifyUrl = `${chain.facilitator}/verify?txHash=${encodeURIComponent(txHash)}`;
    logger.info("x402", `Facilitator verify: GET ${verifyUrl.slice(0, 80)}...`);

    let result;
    try {
      const response = await fetchWithTimeout(verifyUrl, {}, 15000);
      result = await response.json();
    } catch (err) {
      logger.error(
        "x402",
        `Facilitator verify error for tx ${txHash.slice(0, 18)}...: ${err.message}`,
      );
      return false;
    }

    if (!result || result.valid !== true) {
      logger.info(
        "x402",
        `Facilitator: tx ${txHash.slice(0, 18)}... not valid (valid=${result && result.valid})`,
      );
      return false;
    }

    // Verify the recipient is the FeeSplitter contract (not WALLET_ADDRESS)
    if (
      !result.to ||
      result.to.toLowerCase() !== chain.feeSplitterContract.toLowerCase()
    ) {
      logger.info(
        "x402",
        `Facilitator: tx ${txHash.slice(0, 18)}... recipient mismatch (got ${result.to}, expected ${chain.feeSplitterContract})`,
      );
      return false;
    }

    // Verify the transferred amount is sufficient
    let resultAmount;
    try {
      resultAmount = BigInt(result.amount);
    } catch {
      logger.info(
        "x402",
        `Facilitator: tx ${txHash.slice(0, 18)}... invalid amount field: ${result.amount}`,
      );
      return false;
    }

    if (resultAmount < BigInt(minAmount)) {
      logger.info(
        "x402",
        `Facilitator: tx ${txHash.slice(0, 18)}... insufficient amount (${result.amount} < ${minAmount})`,
      );
      return false;
    }

    logger.info(
      "x402",
      `Facilitator: USDC payment verified via facilitator: ${Number(resultAmount) / 1e6} USDC from ${String(result.from || "unknown").slice(0, 10)}...`,
    );
    return { valid: true, from: String(result.from || "").toLowerCase() };
  }

  function paymentMiddleware(
    minAmountRaw,
    displayAmount,
    displayLabel,
    options = {},
  ) {
    const { deferClaim = false } = options;
    return async (req, res, next) => {
      // Internal proxy bypass: one-time token from the proxy, already verified
      // payment on-chain. Token is consumed (single-use) to prevent replay.
      const bypassToken = req.headers["x-internal-proxy"];
      if (bypassToken && consumeInternalBypassToken(bypassToken)) {
        return next();
      }

      const txHash = req.headers["x-payment-txhash"];
      const chainKey = req.headers["x-payment-chain"] || DEFAULT_CHAIN_KEY;

      // Validate chain key
      if (!CHAINS[chainKey]) {
        return res.status(400).json({
          error: "Invalid chain",
          message: `Unsupported chain: ${chainKey}. Accepted: ${Object.keys(CHAINS).join(", ")}`,
        });
      }

      // --- Per-wallet rate limiting ---
      const rawAgentWallet = req.headers["x-agent-wallet"];
      const agentWallet = /^0x[a-fA-F0-9]{40}$/.test(rawAgentWallet)
        ? rawAgentWallet
        : null;
      if (agentWallet) {
        const rlCheck = checkWalletRateLimit(agentWallet);
        res.setHeader("X-RateLimit-Remaining", rlCheck.remaining);
        res.setHeader("X-RateLimit-Limit", WALLET_RATE_LIMIT);
        res.setHeader("X-RateLimit-Reset", Math.ceil(rlCheck.resetAt / 1000));
        if (!rlCheck.allowed) {
          const retryAfter = Math.ceil((rlCheck.resetAt - Date.now()) / 1000);
          res.setHeader("Retry-After", retryAfter);
          logger.warn(
            "x402",
            `Wallet rate limit exceeded for ${agentWallet.slice(0, 10)}... (${WALLET_RATE_LIMIT} req/min)`,
          );
          return res.status(429).json({
            error: "Too Many Requests",
            message: `Wallet rate limit exceeded. Max ${WALLET_RATE_LIMIT} requests per minute. Retry after ${retryAfter}s.`,
            wallet: agentWallet,
            limit: WALLET_RATE_LIMIT,
            retry_after: retryAfter,
          });
        }
      }

      // Budget Guardian: atomic check+record — prevents race condition where
      // two concurrent requests both pass the check before either records spending.
      // checkAndRecord() mutates the in-memory Map synchronously, so a second
      // concurrent request will see the updated total and be blocked if over limit.
      // DB persistence is fire-and-forget (acceptable — Map is the source of truth).
      if (agentWallet && budgetManager) {
        const check = budgetManager.checkAndRecord(agentWallet, displayAmount);
        if (!check.allowed) {
          return res.status(403).json({
            error: "Budget Exceeded",
            message: check.reason,
            budget: check.budget
              ? {
                  max_usdc: check.budget.maxUsdc,
                  spent_usdc: check.budget.spentUsdc,
                  remaining_usdc: check.budget.remainingUsdc,
                }
              : null,
          });
        }
        // Store check result so post-verification can set response headers without
        // a second recordSpending call (which would double-count the amount).
        req._budgetResult = check;
      }

      if (!txHash) {
        logger.info(
          "x402",
          `402 -> ${req.method} ${req.path} (${displayLabel})`,
        );
        logActivity("402", `${displayLabel} - payment requested`);

        // Build available networks list based on environment
        const availableNetworks = Object.entries(CHAINS)
          .filter(([key]) =>
            NETWORK === "testnet"
              ? key === "base-sepolia"
              : key !== "base-sepolia",
          )
          .map(([key, cfg]) => ({
            network: key,
            chainId: cfg.chainId,
            label: cfg.label,
            usdc_contract: cfg.usdcContract,
            explorer: cfg.explorer,
            // Per-network recipient: FeeSplitter for facilitator chains, WALLET_ADDRESS otherwise
            recipient: cfg.feeSplitterContract || process.env.WALLET_ADDRESS,
            gas:
              key === "skale"
                ? "~$0.0007 (CREDITS)"
                : key === "polygon"
                  ? "~$0.001 (POL)"
                  : "~$0.001",
            // Phase 2: expose facilitator URL so agents know to use HTTP flow instead of on-chain
            ...(cfg.facilitator ? { facilitator: cfg.facilitator } : {}),
          }));

        // x402 Bazaar Discovery: include endpoint metadata for AI agent discovery
        const endpointPath = req.path;
        const extensions = discoveryMap[endpointPath] || null;

        const responseBody = {
          error: "Payment Required",
          message: `This action costs ${displayAmount} USDC. Send payment then provide the transaction hash in the X-Payment-TxHash header.`,
          payment_details: {
            amount: displayAmount,
            currency: "USDC",
            // Backward compat: default network fields
            network: DEFAULT_CHAIN_KEY,
            chainId: DEFAULT_CHAIN.chainId,
            // Multi-chain: all accepted networks
            networks: availableNetworks,
            // Polygon facilitator: recipient is the FeeSplitter contract (gas-free flow).
            // For all other chains: recipient is the platform wallet.
            recipient: (() => {
              const chain = getChainConfig(chainKey);
              return chain && chain.feeSplitterContract
                ? chain.feeSplitterContract
                : process.env.WALLET_ADDRESS;
            })(),
            accepted: ["USDC"],
            action: displayLabel,
          },
        };

        // Include x402 Bazaar extensions if available
        if (extensions) {
          responseBody.extensions = extensions;
        }

        // Enrich 402 with free tier info when quota is exhausted
        if (req._freeTierExhausted) {
          const { FREE_TIER_DAILY_LIMIT } = require("../lib/free-tier");
          const tomorrow = new Date();
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          tomorrow.setUTCHours(0, 0, 0, 0);
          responseBody.free_tier = {
            exhausted: true,
            reason: "daily_limit_reached",
            limit: FREE_TIER_DAILY_LIMIT,
            resets_at: tomorrow.toISOString(),
          };
        }

        return res.status(402).json(responseBody);
      }

      // Validate tx hash format
      if (!TX_HASH_REGEX.test(txHash)) {
        return res
          .status(400)
          .json({ error: "Invalid transaction hash format" });
      }

      // Anti-replay: check if tx already used (prefix with chain for disambiguation)
      const replayKey = `${chainKey}:${txHash}`;

      // In-memory lock: reject concurrent requests with the same replayKey
      // before the DB INSERT can protect them. Removed in finally block below.
      if (_pendingClaims.has(replayKey)) {
        logger.info(
          "x402",
          `Concurrent claim blocked for tx ${txHash.slice(0, 10)}... on ${chainKey}`,
        );
        return res.status(409).json({
          error: "TX_ALREADY_USED",
          code: "TX_REPLAY",
          message:
            "This transaction hash is already being processed. Please wait and retry.",
        });
      }
      _pendingClaims.add(replayKey);

      try {
        // Check both prefixed and unprefixed forms in a single query
        const alreadyUsed = await isTxAlreadyUsed(txHash, replayKey);
        if (alreadyUsed) {
          logger.info(
            "x402",
            `Replay blocked for tx ${txHash.slice(0, 10)}... on ${chainKey}`,
          );
          return res.status(409).json({
            error: "TX_ALREADY_USED",
            code: "TX_REPLAY",
            message:
              "This transaction hash has already been used for a previous payment. Please send a new transaction.",
          });
        }
      } catch (err) {
        logger.error("x402", "Anti-replay check error:", err.message);
        // SECURITY: Fail closed - reject request if anti-replay check fails
        return res.status(503).json({
          error: "Service temporarily unavailable",
          message: "Payment verification system error. Please retry.",
        });
      } finally {
        // For deferClaim paths, keep the lock until the proxy's onSuccess/onError releases it.
        // This prevents a race window where two concurrent requests with the same txHash
        // could both pass verification before either claims the tx in DB.
        if (!deferClaim) {
          _pendingClaims.delete(replayKey);
        } else {
          // Expose cleanup function for proxy to call after upstream completes.
          // Safety: auto-release after 60s to prevent permanent lock if proxy crashes.
          const lockTimer = setTimeout(() => {
            _pendingClaims.delete(replayKey);
            logger.warn(
              "x402",
              `Auto-released stale lock for ${replayKey.slice(0, 20)}... (60s timeout)`,
            );
          }, 60_000);
          if (lockTimer.unref) lockTimer.unref();
          req._releasePaymentLock = () => {
            clearTimeout(lockTimer);
            _pendingClaims.delete(replayKey);
          };
        }
      }

      // Verification: always verify on-chain via RPC (all chains including Polygon).
      // When Polygon facilitator is configured, try FeeSplitter first, then
      // fallback to WALLET_ADDRESS. This handles the case where a client saw
      // the 402 response without X-Payment-Chain (recipient = WALLET_ADDRESS)
      // but paid on Polygon and retried with X-Payment-Chain: polygon.
      const _verifyChain = getChainConfig(chainKey);
      const _facilitatorRecipient =
        _verifyChain &&
        _verifyChain.facilitator &&
        _verifyChain.feeSplitterContract
          ? _verifyChain.feeSplitterContract
          : null;
      try {
        let result = await verifyPayment(
          txHash,
          minAmountRaw,
          chainKey,
          _facilitatorRecipient,
        );
        // Fallback: if Polygon facilitator is configured but verification failed,
        // retry with WALLET_ADDRESS as recipient. The user may have sent USDC
        // directly to the platform wallet (e.g. saw 402 without X-Payment-Chain).
        if (
          !result &&
          _facilitatorRecipient &&
          _facilitatorRecipient.toLowerCase() !==
            process.env.WALLET_ADDRESS.toLowerCase()
        ) {
          logger.info(
            "x402",
            `Polygon facilitator recipient miss — retrying verification with WALLET_ADDRESS`,
          );
          result = await verifyPayment(txHash, minAmountRaw, chainKey, null);
        }
        if (result && result.valid) {
          // Budget Guardian: set response headers using the result already
          // recorded atomically by checkAndRecord() before payment verification.
          // No second recordSpending() call — that would double-count the amount.
          if (agentWallet && budgetManager && req._budgetResult) {
            const budgetResult = req._budgetResult;
            if (typeof budgetResult.remaining === "number") {
              res.setHeader(
                "X-Budget-Remaining",
                budgetResult.remaining.toFixed(4),
              );
            }
            if (typeof budgetResult.pct === "number") {
              res.setHeader(
                "X-Budget-Used-Percent",
                budgetResult.pct.toFixed(1),
              );
            }
            if (
              Array.isArray(budgetResult.alerts) &&
              budgetResult.alerts.length > 0
            ) {
              res.setHeader(
                "X-Budget-Alert",
                `${budgetResult.alerts[0]}% of budget used`,
              );
            }
          }

          // Deferred claiming mode: proxy will claim the tx AFTER successful upstream call.
          // This prevents users from losing USDC when the upstream API fails.
          if (deferClaim) {
            req._markTxUsed = markTxUsed;
            req._paymentVerified = true;
            req._paymentReplayKey = replayKey;
            req._paymentChainKey = chainKey;
            return next();
          }

          // SECURITY: Atomically claim the tx — if another request won the race, block
          const claimed = await markTxUsed(replayKey, displayLabel);
          if (!claimed) {
            logger.info(
              "x402",
              `Replay blocked (race) for tx ${txHash.slice(0, 10)}... on ${chainKey}`,
            );
            return res.status(409).json({
              error: "TX_ALREADY_USED",
              code: "TX_REPLAY",
              message:
                "This transaction hash has already been used for a previous payment. Please send a new transaction.",
            });
          }
          const chainLabel = getChainConfig(chainKey).label;
          logActivity(
            "payment",
            `${displayLabel} - ${displayAmount} USDC verified on ${chainLabel}`,
            displayAmount,
            txHash,
          );

          // Polygon facilitator: trigger distribute() on FeeSplitter contract.
          // For native wrappers (no owner), distribute(WALLET_ADDRESS) sends
          // 95%+5% to the same wallet = 100% to platform.
          if (_facilitatorRecipient) {
            try {
              const feeSplitter = require("../lib/fee-splitter");
              const distributeAddr = process.env.WALLET_ADDRESS;
              feeSplitter
                .callDistribute(distributeAddr, minAmountRaw)
                .catch(() => {});
            } catch {
              /* fee-splitter not available */
            }
          }

          return next();
        }
      } catch (err) {
        logger.error("x402", `Verification error on ${chainKey}:`, err.message);
        const isNetworkError =
          err.message === "RPC timeout" ||
          err.message.includes("fetch") ||
          err.message.includes("network") ||
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("ETIMEDOUT") ||
          err.message.includes("database") ||
          err.message.includes("connection") ||
          err.message.includes("ECONNRESET") ||
          err.message.includes("socket");
        if (isNetworkError) {
          const errorSource = "RPC node";
          return res.status(503).json({
            error: "Service Unavailable",
            message: `${errorSource} unreachable. Payment could not be verified. Please retry in a few seconds.`,
          });
        }
        return res.status(402).json({
          error: "Payment Required",
          message: "Invalid transaction or insufficient payment.",
        });
      }

      // verifyPayment returned false: payment not found or insufficient amount
      return res.status(402).json({
        error: "Payment Required",
        message: "Invalid transaction or insufficient payment.",
      });
    };
  }

  /**
   * Verify a split payment (native 95/5 mode).
   *
   * @param {string} txHashProvider - Hash of the provider tx (95% of total)
   * @param {string|null} txHashPlatform - Hash of the platform tx (5% of total), may be null/undefined
   * @param {number} totalAmountRaw - Total amount in micro-USDC (6 decimals)
   * @param {string} chainKey - 'base' | 'skale' | 'base-sepolia'
   * @param {string} providerWallet - Provider's wallet address (recipient of 95%)
   * @returns {{ providerValid: boolean, platformValid: boolean, fromAddress: string|null }}
   */
  async function verifySplitPayment(
    txHashProvider,
    txHashPlatform,
    totalAmountRaw,
    chainKey,
    providerWallet,
  ) {
    const providerAmountRaw = Math.floor((totalAmountRaw * 95) / 100);
    const platformAmountRaw = totalAmountRaw - providerAmountRaw; // avoids double rounding

    // Parallelize both verifications to avoid up to 104s sequential wait
    const [providerResult, platformResult] = await Promise.all([
      verifyPayment(
        txHashProvider,
        providerAmountRaw,
        chainKey,
        providerWallet,
      ),
      txHashPlatform
        ? verifyPayment(txHashPlatform, platformAmountRaw, chainKey, null)
        : Promise.resolve(null),
    ]);

    return {
      providerValid: !!(providerResult && providerResult.valid),
      platformValid: !!(platformResult && platformResult.valid),
      fromAddress:
        providerResult && providerResult.from ? providerResult.from : null,
    };
  }

  return {
    paymentMiddleware,
    verifyPayment,
    verifySplitPayment,
    verifyViaFacilitator,
    fetchWithTimeout,
    markTxUsed,
  };
}

module.exports = {
  createPaymentSystem,
  createInternalBypassToken,
  BoundedSet,
  TX_HASH_REGEX,
  UUID_REGEX,
  checkWalletRateLimit,
  walletRateLimitStore,
  WALLET_RATE_LIMIT,
  fetchWithTimeout,
};
