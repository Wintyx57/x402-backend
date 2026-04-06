// routes/proxy.js — API Gateway proxy for 95/5 revenue split
// POST /api/call/:serviceId — Proxies API calls through the platform

const express = require("express");
const logger = require("../lib/logger");
const { safeUrl } = require("../lib/safe-url");
const {
  TX_HASH_REGEX,
  UUID_REGEX,
  createInternalBypassToken,
  checkWalletRateLimit,
  WALLET_RATE_LIMIT,
} = require("../lib/payment");
const {
  getInputSchemaForUrl,
  getMethodForUrl,
} = require("../lib/bazaar-discovery");
const { DEFAULT_CHAIN_KEY, getChainConfig } = require("../lib/chains");
const {
  getExpectedFieldsForUrl,
  validateResponseSchema,
  scoreContentQuality,
  buildValidationMeta,
} = require("../lib/response-validator");
const feeSplitter = require("../lib/fee-splitter");
const { decryptCredentials, injectCredentials } = require("../lib/credentials");
const { hashIp, checkFreeTier, recordFreeUsage } = require("../lib/free-tier");
const {
  normalize402,
  buildUniversalProofHeaders,
} = require("../lib/protocolAdapter");
const {
  isRelayConfigured,
  canPayUpstream,
  payUpstream,
  getRelayAddress,
  shouldUseEIP3009,
  signEIP3009ForUpstream,
} = require("../lib/upstreamPayer");

// Hostname of this server — used to detect internal service URLs
const SELF_HOSTNAME = (() => {
  try {
    return new URL(
      process.env.SERVER_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        "https://x402-api.onrender.com",
    ).hostname;
  } catch {
    return "x402-api.onrender.com";
  }
})();

// Minimum price (micro-USDC) for split payment to ensure both split amounts are non-zero
const MIN_SPLIT_AMOUNT_RAW = 100; // 0.0001 USDC

// Maximum upstream response size (10 MB) to prevent OOM
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// Protocol classification sets (module scope — avoid per-request allocation)
const UNPAYABLE_PROTOCOLS = new Set(["l402", "l402-protocol", "stripe402"]);
const RELAY_PAYABLE_PROTOCOLS = new Set([
  "x402-v2",
  "x402-v1",
  "x402-bazaar",
  "x402-variant",
  "flat",
  "header-based",
  "mpp",
]);

/**
 * @param {object} supabase
 * @param {Function} logActivity
 * @param {Function} paymentMiddleware - factory from createPaymentSystem
 * @param {object} paidEndpointLimiter - express-rate-limit middleware
 * @param {object} payoutManager - from createPayoutManager
 * @param {object} paymentSystem  - { verifySplitPayment } from createPaymentSystem
 */
function createProxyRouter(
  supabase,
  logActivity,
  paymentMiddleware,
  paidEndpointLimiter,
  payoutManager,
  paymentSystem,
  budgetManager,
) {
  const router = express.Router();

  // POST /api/call/:serviceId — Call an external service through the Bazaar proxy
  // Supports two payment modes:
  //   Split mode  : X-Payment-TxHash-Provider (+ optional X-Payment-TxHash-Platform)
  //   Legacy mode : X-Payment-TxHash (100% to platform wallet, pending payout for provider)
  router.post("/api/call/:serviceId", paidEndpointLimiter, async (req, res) => {
    const { serviceId } = req.params;

    // 1. Validate serviceId (UUID format)
    if (!UUID_REGEX.test(serviceId)) {
      return res.status(400).json({ error: "Invalid service ID format" });
    }

    // 2. Fetch service from DB
    const { data: service, error: fetchErr } = await supabase
      .from("services")
      .select(
        "id, name, url, price_usdc, owner_address, tags, description, required_parameters, encrypted_credentials, payment_protocol",
      )
      .eq("id", serviceId)
      .single();

    if (fetchErr || !service) {
      logger.warn("Proxy", `Service not found: ${serviceId}`, {
        correlationId: req.correlationId,
      });
      return res.status(404).json({ error: "Service not found" });
    }

    // --- GATEKEEPER: validate required parameters BEFORE payment ---
    // Priority: DB required_parameters (external services) > discoveryMap (internal wrappers)
    const inputSchema =
      service.required_parameters || getInputSchemaForUrl(service.url);
    if (
      inputSchema &&
      inputSchema.required &&
      inputSchema.required.length > 0
    ) {
      const params = {};
      if (req.body && typeof req.body === "object")
        Object.assign(params, req.body);
      if (req.query && Object.keys(req.query).length > 0)
        Object.assign(params, req.query);

      const DANGEROUS_PROPS = ["__proto__", "constructor", "prototype"];
      const missing = inputSchema.required
        .filter((p) => typeof p === "string" && !DANGEROUS_PROPS.includes(p))
        .filter(
          (p) =>
            params[p] === undefined || params[p] === null || params[p] === "",
        );

      if (missing.length > 0) {
        return res.status(400).json({
          error: "Missing required parameters",
          missing,
          required_parameters: inputSchema,
          message: `This service requires: ${missing.join(", ")}. No payment was made.`,
          _payment_status: "not_charged",
        });
      }
    }

    // --- PROTOCOL SNIFFER: handle upstream payment protocols BEFORE payment ---
    const isRelayEligible =
      service.payment_protocol &&
      RELAY_PAYABLE_PROTOCOLS.has(service.payment_protocol) &&
      isRelayConfigured();

    // Block truly unpayable protocols
    if (
      service.payment_protocol &&
      UNPAYABLE_PROTOCOLS.has(service.payment_protocol)
    ) {
      logger.warn(
        "Proxy",
        `Blocked call to "${service.name}" — upstream uses unpayable protocol: ${service.payment_protocol}`,
        { correlationId: req.correlationId },
      );
      return res.status(502).json({
        error: "UPSTREAM_PROTOCOL_UNSUPPORTED",
        message: `Service "${service.name}" uses the ${service.payment_protocol} payment protocol upstream, which x402 Bazaar cannot pay automatically. Contact the provider to resolve this.`,
        upstream_protocol: service.payment_protocol,
        _payment_status: "not_charged",
      });
    }

    // Block relay-payable protocols when relay is not configured
    if (
      service.payment_protocol &&
      RELAY_PAYABLE_PROTOCOLS.has(service.payment_protocol) &&
      !isRelayConfigured()
    ) {
      return res.status(502).json({
        error: "UPSTREAM_PAYMENT_REQUIRED",
        message: `Service "${service.name}" requires upstream payment (${service.payment_protocol}), but the payment relay is not configured.`,
        upstream_protocol: service.payment_protocol,
        _payment_status: "not_charged",
      });
    }

    // --- FREE TIER CHECK (before payment) ---
    const hasPaymentHeaders = !!(
      req.headers["x-payment-txhash"] ||
      req.headers["x-payment-txhash-provider"]
    );
    if (!hasPaymentHeaders) {
      const ipHash = hashIp(req.ip);
      const freeTierResult = await checkFreeTier(supabase, ipHash, service);
      if (freeTierResult.eligible) {
        logger.info(
          "Proxy:free-tier",
          `Free tier call for "${service.name}" (remaining: ${freeTierResult.remaining - 1})`,
          { correlationId: req.correlationId },
        );

        const freeOnSuccess = async () => {
          recordFreeUsage(supabase, ipHash).catch(() => {});
          logActivity("free_tier", `Free call: ${service.name}`, 0, null);
          return { ok: true };
        };

        res.setHeader("X-Free-Tier", "true");
        res.setHeader(
          "X-Free-Tier-Remaining",
          String(Math.max(0, freeTierResult.remaining - 1)),
        );

        return executeProxyCall(req, res, {
          service,
          price: 0,
          txHash: null,
          chain: DEFAULT_CHAIN_KEY,
          payoutManager: null,
          logActivity,
          splitMode: "free_tier",
          splitMeta: null,
          onSuccess: freeOnSuccess,
          supabase,
        });
      }
      // Not eligible — store reason for enriching the 402 response below
      req._freeTierExhausted = freeTierResult.reason;
    }

    // 3. Determine the price (from service or override)
    const price = Number(service.price_usdc) || 0.01;
    const minAmountRaw = Math.round(price * 1e6); // USDC has 6 decimals

    // 4. Detect payment mode
    const txHashProvider = req.headers["x-payment-txhash-provider"];
    const txHashPlatform = req.headers["x-payment-txhash-platform"]; // optional
    const chainKey = req.headers["x-payment-chain"] || DEFAULT_CHAIN_KEY;

    // A service without owner_address falls back to legacy mode automatically
    // (the 69 native wrappers — platform is both provider and operator)
    const isSplitMode = !!service.owner_address && !!txHashProvider;

    // --- Wallet rate limit + budget checks ---
    // For split mode: check here (paymentMiddleware is not used).
    // For legacy mode: paymentMiddleware already calls checkWalletRateLimit — skip here
    // to avoid double-counting the wallet's rate limit window.
    const rawAgentWallet = req.headers["x-agent-wallet"];
    const agentWallet = /^0x[a-fA-F0-9]{40}$/.test(rawAgentWallet)
      ? rawAgentWallet
      : null;

    if (agentWallet && isSplitMode) {
      const rlCheck = checkWalletRateLimit(agentWallet);
      res.setHeader("X-RateLimit-Remaining", rlCheck.remaining);
      res.setHeader("X-RateLimit-Limit", WALLET_RATE_LIMIT);
      if (!rlCheck.allowed) {
        const retryAfter = Math.ceil((rlCheck.resetAt - Date.now()) / 1000);
        res.setHeader("Retry-After", retryAfter);
        return res
          .status(429)
          .json({ error: "Too Many Requests", retry_after: retryAfter });
      }
    }
    if (agentWallet && budgetManager) {
      const check = budgetManager.checkAndRecord(agentWallet, price);
      if (!check.allowed) {
        // Return structured budget info so agents can display remaining quota and reset time
        const budgetInfo = check.budget || {};
        const periodMs = {
          daily: 86400000,
          weekly: 604800000,
          monthly: 2592000000,
        };
        const periodDuration =
          periodMs[budgetInfo.period || "daily"] || 86400000;
        const periodStart = budgetInfo.periodStart
          ? new Date(budgetInfo.periodStart).getTime()
          : Date.now();
        const resetAt = new Date(periodStart + periodDuration).toISOString();
        return res.status(403).json({
          error: "Budget Exceeded",
          error_code: "BUDGET_EXCEEDED",
          remaining_usdc: budgetInfo.remainingUsdc ?? 0,
          budget_limit_usdc: budgetInfo.maxUsdc ?? null,
          spent_usdc: budgetInfo.spentUsdc ?? null,
          reset_at: resetAt,
          _payment_status: "not_charged",
          message: check.reason,
        });
      }
      // Propagate budget state to response phase so X-Budget-Warning can be emitted
      if (check.allowed && check.budget) {
        req._budgetCheckResult = check;
      }
    }

    // --- SPLIT MODE ---
    if (isSplitMode) {
      return handleSplitMode(req, res, {
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
      });
    }

    // --- LEGACY MODE ---
    // If the service has an owner_address, intercept the 402 response to enrich it
    // with provider_wallet + split info so clients can switch to split mode
    if (service.owner_address) {
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (res.statusCode === 402 && body && body.payment_details) {
          const _chainCfg = getChainConfig(chainKey);
          const _isFacilitator = !!(
            _chainCfg &&
            _chainCfg.facilitator &&
            _chainCfg &&
            _chainCfg.feeSplitterContract
          );

          // Relay-eligible: force legacy mode (no provider_wallet)
          if (isRelayEligible) {
            body.payment_details.payment_mode = "relay_upstream";
            body.payment_details.note =
              "Upstream payment relay active. Provider receives net payout after upstream cost deduction.";
          } else if (_isFacilitator) {
            // Phase 2 Polygon facilitator: the FeeSplitter contract handles the 95/5 split
            // on-chain automatically. We expose fee_splitter info but NOT provider_wallet
            // to prevent the client from attempting a manual double transfer.
            body.payment_details.payment_mode = "fee_splitter";
            body.payment_details.fee_splitter_contract =
              _chainCfg.feeSplitterContract;
            // Expose facilitator URL so MCP agents can use gas-free flow
            // even if POLYGON_FACILITATOR_URL is not set locally in the MCP.
            body.payment_details.facilitator = _chainCfg.facilitator;
            body.payment_details.split = {
              provider_percent: 95,
              platform_percent: 5,
              note: "Split handled automatically by FeeSplitter contract on-chain",
            };
          } else {
            // Phase 1 / Base / SKALE: standard split_native mode
            body.payment_details.provider_wallet = service.owner_address;
            const grossRaw = Math.round(price * 1e6);
            const platformRaw = Math.floor((grossRaw * 5) / 100);
            const providerRaw = grossRaw - platformRaw;
            body.payment_details.split = {
              provider_amount: providerRaw / 1e6,
              platform_amount: platformRaw / 1e6,
              provider_percent: 95,
              platform_percent: 5,
            };
            body.payment_details.payment_mode = "split_native";
          }
        }
        return originalJson(body);
      };
    }

    // Apply payment middleware dynamically (legacy: single X-Payment-TxHash)
    // deferClaim: true → middleware verifies on-chain but does NOT INSERT into used_transactions.
    // The proxy claims the tx AFTER successful upstream response (deferred claiming).
    const dynamicPayment = paymentMiddleware(
      minAmountRaw,
      price,
      `API Call: ${service.name}`,
      { deferClaim: true },
    );

    dynamicPayment(req, res, async () => {
      const txHash = req.headers["x-payment-txhash"];
      const chain = req.headers["x-payment-chain"] || DEFAULT_CHAIN_KEY;

      const onSuccess = async () => {
        const claimed = await req._markTxUsed(
          req._paymentReplayKey,
          `API Call: ${service.name}`,
        );
        if (!claimed) return { ok: false };
        logActivity(
          "payment",
          `API Call: ${service.name} - ${price} USDC verified`,
          price,
          txHash,
        );
        return { ok: true };
      };

      await executeProxyCall(req, res, {
        service,
        price,
        txHash,
        chain,
        payoutManager,
        logActivity,
        splitMode: "legacy",
        splitMeta: null,
        onSuccess,
        supabase,
      });
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Split mode handler (called inside createProxyRouter context via explicit params)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared proxy execution (SSRF check + fetch with retry + deferred claiming)
// ---------------------------------------------------------------------------

// Retry backoff delays (ms): 1st attempt immediate, then 1s, then 3s
const RETRY_BACKOFF_MS = [0, 1000, 3000];
const MAX_RETRIES = RETRY_BACKOFF_MS.length;

// ---------------------------------------------------------------------------
// Circuit Breaker — prevents hammering failing upstream services
// ---------------------------------------------------------------------------

const CB_FAILURE_THRESHOLD = 3; // failures before opening circuit
const CB_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window
const CB_OPEN_DURATION_MS = 30 * 1000; // 30s before half-open
const CB_MAX_ENTRIES = 1000; // eviction cap (FIFO via insertion order)

// Map<serviceUrl, { failures: number, lastFailure: number, state: 'closed'|'open'|'half-open' }>
const circuitBreakers = new Map();

function getCircuitBreaker(serviceUrl) {
  if (!circuitBreakers.has(serviceUrl)) {
    // FIFO eviction when cap is reached
    if (circuitBreakers.size >= CB_MAX_ENTRIES) {
      const firstKey = circuitBreakers.keys().next().value;
      circuitBreakers.delete(firstKey);
    }
    circuitBreakers.set(serviceUrl, {
      failures: 0,
      lastFailure: 0,
      state: "closed",
    });
  }
  return circuitBreakers.get(serviceUrl);
}

/**
 * Check if the circuit is open (should block the request).
 * Transitions open → half-open after CB_OPEN_DURATION_MS.
 * Returns true if the request should be blocked (503).
 */
function isCircuitOpen(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);

  if (cb.state === "open") {
    const elapsed = Date.now() - cb.lastFailure;
    if (elapsed >= CB_OPEN_DURATION_MS) {
      cb.state = "half-open";
      return false; // let one probe request through
    }
    return true; // still open → block
  }

  return false;
}

/**
 * Record a successful upstream call.
 * Resets the circuit to 'closed' (from half-open or closed).
 */
function recordCircuitSuccess(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);
  cb.failures = 0;
  cb.lastFailure = 0;
  cb.state = "closed";
}

/**
 * Record a failed upstream call.
 * Increments failure count; opens circuit if threshold reached.
 * In half-open state, a single failure reopens the circuit.
 */
function recordCircuitFailure(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);
  const now = Date.now();

  // Reset counter if last failure is outside the rolling window
  if (now - cb.lastFailure > CB_WINDOW_MS) {
    cb.failures = 0;
  }

  cb.failures += 1;
  cb.lastFailure = now;

  if (cb.state === "half-open" || cb.failures >= CB_FAILURE_THRESHOLD) {
    cb.state = "open";
    logger.warn(
      "CircuitBreaker",
      `Circuit OPEN for ${serviceUrl} (${cb.failures} failures)`,
    );
  }
}

// ---------------------------------------------------------------------------
// In-Flight Dedup — prevents duplicate upstream calls for the same tx hash
// ---------------------------------------------------------------------------

const INFLIGHT_MAX_ENTRIES = 5000;

// Map<"chain:txHash", true>
const _proxyInFlight = new Map();

// ─── Consumer Protection: Response Quality Gate ──────────────────────────────
// Only charge the user when the upstream response contains useful data.

/**
 * Check if response data is empty / useless.
 * Conservative: arrays (even empty), booleans, numbers (even 0) are NOT empty.
 */
function isEmptyResponse(data) {
  if (data == null) return true; // null or undefined
  if (typeof data !== "object") return false; // primitives (string, number, boolean) are data
  if (Array.isArray(data)) return false; // arrays are valid (even [])

  const keys = Object.keys(data);
  if (keys.length === 0) return true; // {}

  // { raw: "" } or { raw: "   " } — text fallback with empty content
  if (
    keys.length === 1 &&
    keys[0] === "raw" &&
    typeof data.raw === "string" &&
    data.raw.trim() === ""
  )
    return true;

  // All values are null: { data: null, result: null }
  if (keys.every((k) => data[k] === null)) return true;

  return false;
}

/**
 * Decide whether to charge the user for this upstream response.
 * Layer 0: 4xx / empty check (existing)
 * Layer 1: Schema validation (fields match) — if serviceUrl provided
 * Layer 2: Content quality scoring — if schema available
 *
 * @param {number} httpStatus - upstream HTTP status code
 * @param {*} responseData - parsed response body
 * @param {string} [serviceUrl] - optional service URL for schema-based validation
 * @returns {{ shouldCharge: boolean, reason: string, _validation?: object }}
 */
function shouldChargeForResponse(httpStatus, responseData, serviceUrl) {
  // Layer 0: 4xx → upstream error, user should not pay
  if (httpStatus >= 400 && httpStatus < 500) {
    return { shouldCharge: false, reason: `upstream_error_${httpStatus}` };
  }

  // Layer 0: 2xx/3xx with empty data → no useful data delivered
  if (isEmptyResponse(responseData)) {
    return { shouldCharge: false, reason: "empty_response" };
  }

  // Layer 1+2: Schema-based validation (only for known internal APIs)
  if (serviceUrl) {
    const expected = getExpectedFieldsForUrl(serviceUrl);
    if (expected) {
      // Layer 1: Field presence check
      const schemaResult = validateResponseSchema(
        responseData,
        expected.fields,
      );
      if (!schemaResult.valid) {
        return {
          shouldCharge: false,
          reason: "schema_mismatch",
          _validation: {
            schema_match: schemaResult.ratio,
            fields_missing: schemaResult.missing,
          },
        };
      }

      // Layer 2: Content quality scoring
      const qualityResult = scoreContentQuality(responseData, expected.example);
      if (qualityResult.score < 0.3) {
        return {
          shouldCharge: false,
          reason: "low_quality_content",
          _validation: {
            quality_score: qualityResult.score,
            reasons: qualityResult.reasons,
          },
        };
      }
    }
  }

  // 2xx/3xx with data → charge
  return { shouldCharge: true, reason: "data_delivered" };
}

async function executeProxyCall(
  req,
  res,
  {
    service,
    price,
    txHash,
    chain,
    payoutManager,
    logActivity,
    splitMode,
    splitMeta,
    onSuccess,
    supabase,
  },
) {
  const cid = req.correlationId || "-";
  const hasCredentials = !!service.encrypted_credentials;
  logger.info(
    "Proxy",
    `→ ${service.name} (${price} USDC, ${splitMode}, chain:${chain})`,
    {
      correlationId: cid,
      serviceId: service.id,
      hasCredentials,
    },
  );

  // SSRF check on service URL
  try {
    await safeUrl(service.url);
  } catch (err) {
    logger.error(
      "Proxy",
      `SSRF blocked for service "${service.name}": ${err.message}`,
      { correlationId: cid },
    );
    return res.status(403).json({ error: "Service URL is not allowed" });
  }

  // Circuit breaker check — fail fast for persistently failing upstream services
  if (isCircuitOpen(service.url)) {
    logger.warn(
      "Proxy",
      `Circuit OPEN — blocking request for "${service.name}" (${service.url})`,
    );
    // RFC 7231 §7.1.3: Retry-After in seconds lets HTTP clients back off automatically
    res.set("Retry-After", Math.ceil(CB_OPEN_DURATION_MS / 1000));
    return res.status(503).json({
      error: "Service temporairement indisponible",
      message:
        "This service is temporarily unavailable due to repeated failures. Please retry in 30 seconds.",
      _x402: { circuit_breaker: "open", retry_after_ms: CB_OPEN_DURATION_MS },
    });
  }

  // In-flight dedup: block concurrent upstream calls with the same txHash
  const inflightKey = txHash ? `${chain}:${txHash}` : null;
  if (inflightKey && _proxyInFlight.has(inflightKey)) {
    return res.status(409).json({
      error: "TX_ALREADY_USED",
      code: "TX_REPLAY",
      message:
        "This transaction hash is already being processed by another request.",
    });
  }
  if (inflightKey) {
    // FIFO eviction when cap is reached
    if (_proxyInFlight.size >= INFLIGHT_MAX_ENTRIES) {
      const firstKey = _proxyInFlight.keys().next().value;
      _proxyInFlight.delete(firstKey);
    }
    _proxyInFlight.set(inflightKey, true);
  }

  try {
    // Determine upstream HTTP method (POST for /api/code, /api/contract-risk, etc.)
    const upstreamMethod = getMethodForUrl(service.url);

    // Build target URL and request body
    let targetUrl = service.url;
    const DANGEROUS_PROPS = new Set(["__proto__", "constructor", "prototype"]);
    const safeCopy = (target, source) => {
      for (const [k, v] of Object.entries(source)) {
        if (!DANGEROUS_PROPS.has(k)) target[k] = v;
      }
    };
    const params = Object.create(null);
    if (req.body && typeof req.body === "object") safeCopy(params, req.body);
    if (req.query && Object.keys(req.query).length > 0)
      safeCopy(params, req.query);
    let fetchBody;
    if (upstreamMethod === "POST") {
      // POST endpoints: send params as JSON body, keep URL clean
      fetchBody =
        Object.keys(params).length > 0 ? JSON.stringify(params) : undefined;
    } else {
      // GET endpoints: append params as query string
      if (Object.keys(params).length > 0) {
        const url = new URL(targetUrl);
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }
        targetUrl = url.toString();
      }
    }

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        logger.info(
          "Proxy",
          `Retry ${attempt}/${MAX_RETRIES - 1} for "${service.name}" after ${RETRY_BACKOFF_MS[attempt]}ms`,
          { correlationId: cid },
        );
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
      }

      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const proxyHeaders = { "Content-Type": "application/json" };
        if (req.headers["x-agent-wallet"]) {
          proxyHeaders["X-Agent-Wallet"] = req.headers["x-agent-wallet"];
        }

        // Internal bypass token: MUST be created inside retry loop (single-use, 30s TTL)
        try {
          if (new URL(service.url).hostname === SELF_HOSTNAME) {
            proxyHeaders["X-Internal-Proxy"] = createInternalBypassToken();
          }
        } catch {
          /* invalid URL — safeUrl already checked */
        }

        // Inject provider credentials (header, bearer, basic, or query param)
        if (service.encrypted_credentials) {
          const decrypted = decryptCredentials(service.encrypted_credentials);
          if (decrypted) {
            targetUrl = injectCredentials(
              proxyHeaders,
              targetUrl,
              decrypted,
            ).url;
            logger.debug(
              "Proxy",
              `Credentials injected (type:${decrypted.type}) for "${service.name}"`,
              { correlationId: cid },
            );
          } else {
            logger.warn(
              "Proxy",
              `Failed to decrypt credentials for service "${service.name}" (${service.id.slice(0, 8)}) — proceeding without auth`,
              { correlationId: cid },
            );
          }
        }

        const proxyRes = await fetch(targetUrl, {
          method: upstreamMethod,
          headers: proxyHeaders,
          body: fetchBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // 5xx → retry (upstream error)
        if (proxyRes.status >= 500) {
          const errBody = await proxyRes.text().catch(() => "");
          logger.warn(
            "Proxy",
            `Upstream ${proxyRes.status} for "${service.name}" (attempt ${attempt + 1}/${MAX_RETRIES}): ${errBody.slice(0, 300)}`,
          );
          lastError = new Error(`Upstream returned ${proxyRes.status}`);
          continue;
        }

        // --- UPSTREAM PAYMENT RELAY: detect 402, pay upstream, retry ---
        if (proxyRes.status === 402) {
          let headers402 = {};
          try {
            headers402 = Object.fromEntries(proxyRes.headers);
          } catch {
            /* empty */
          }
          let body402 = {};
          const rawText = await proxyRes.text().catch(() => "");
          try {
            body402 = JSON.parse(rawText);
          } catch {
            /* not JSON */
          }

          const normalized = normalize402(402, headers402, body402);
          logger.info(
            "Proxy",
            `Upstream 402 for "${service.name}" — protocol: ${normalized.format}, payable: ${normalized.payable}`,
            {
              correlationId: cid,
              protocol: normalized.format,
              detectionPath: normalized.detectionPath,
            },
          );

          // Update payment_protocol in DB (fire-and-forget)
          if (normalized.format !== "unknown" && supabase) {
            supabase
              .from("services")
              .update({ payment_protocol: normalized.format })
              .eq("id", service.id)
              .then(null, (err) => {
                logger.debug(
                  "Proxy",
                  `DB update payment_protocol failed: ${err.message}`,
                );
              });
          }

          // Attempt upstream payment relay
          logger.info(
            "Proxy",
            `Relay check: configured=${isRelayConfigured()}, canPay=${canPayUpstream(normalized)}, payable=${normalized.payable}, chain=${normalized.chain}, amount=${normalized.amount}, recipient=${normalized.recipient}`,
            { correlationId: cid },
          );
          if (isRelayConfigured() && canPayUpstream(normalized)) {
            const upstreamCostUsdc = Number(normalized.amount) / 1e6;

            // Price guard
            if (price < upstreamCostUsdc) {
              logger.warn(
                "Proxy",
                `Price guard: ${price} < upstream ${upstreamCostUsdc} for "${service.name}"`,
              );
              if (inflightKey) _proxyInFlight.delete(inflightKey);
              return res.status(502).json({
                error: "UPSTREAM_PRICE_EXCEEDS_SERVICE",
                message: `Service price ($${price}) is less than upstream cost ($${upstreamCostUsdc}). Provider must increase the price.`,
                upstream_cost: upstreamCostUsdc,
                service_price: price,
                _payment_status: "not_charged",
              });
            }

            logger.info(
              "Proxy",
              `Paying upstream ${upstreamCostUsdc} USDC for "${service.name}" on ${normalized.chain}`,
              { correlationId: cid },
            );

            let retryHeaders;
            let relayTxHash = null;
            let relayChain = null;

            let _relayErrors = [];
            if (shouldUseEIP3009(normalized)) {
              // x402-standard: sign EIP-3009 off-chain (no gas, no TX, instant)
              const eip3009Result = await signEIP3009ForUpstream(normalized);
              if (!eip3009Result.success) {
                _relayErrors.push(`eip3009: ${eip3009Result.error}`);
                logger.warn(
                  "Proxy",
                  `EIP-3009 signing failed: ${eip3009Result.error} — falling back to direct transfer`,
                  { correlationId: cid },
                );
              } else {
                retryHeaders = {
                  ...proxyHeaders,
                  "X-PAYMENT": eip3009Result.xPaymentV1,
                  "PAYMENT-SIGNATURE": eip3009Result.paymentSignatureV2,
                  "X-Agent-Wallet": getRelayAddress(),
                  "X-Payer-Address": getRelayAddress(),
                };
                relayChain = eip3009Result.chain;
                logger.info(
                  "Proxy",
                  `EIP-3009 signed for "${service.name}" — retrying upstream`,
                  { correlationId: cid },
                );
              }
            }

            if (!retryHeaders) {
              // Direct transfer path (non-x402-standard protocols or EIP-3009 fallback)
              const payResult = await payUpstream(normalized);
              if (payResult.success) {
                const proofResult = buildUniversalProofHeaders(
                  normalized,
                  payResult.txHash,
                  payResult.chain,
                  getRelayAddress(),
                );
                if (proofResult.supported && proofResult.headers) {
                  retryHeaders = {
                    ...proxyHeaders,
                    ...proofResult.headers,
                  };
                  relayTxHash = payResult.txHash;
                  relayChain = payResult.chain;
                }
              } else {
                _relayErrors.push(`directPay: ${payResult.error}`);
                logger.warn(
                  "Proxy",
                  `Upstream payment failed: ${payResult.error}`,
                  { correlationId: cid },
                );
              }
            }
            // Store errors for debug response
            res._relayErrors = _relayErrors;

            if (retryHeaders) {
              logger.info(
                "Proxy",
                `Retrying upstream with proof headers for "${service.name}"`,
                { correlationId: cid },
              );

              try {
                const retryController = new AbortController();
                const retryTimeout = setTimeout(
                  () => retryController.abort(),
                  30000,
                );
                const retryRes = await fetch(targetUrl, {
                  method: upstreamMethod,
                  headers: retryHeaders,
                  body: fetchBody,
                  signal: retryController.signal,
                });
                clearTimeout(retryTimeout);

                if (retryRes.status >= 200 && retryRes.status < 400) {
                  const retryContentType =
                    retryRes.headers.get("content-type") || "";
                  let retryData;
                  if (retryContentType.includes("application/json")) {
                    retryData = await retryRes.json();
                  } else {
                    retryData = { raw: await retryRes.text() };
                  }

                  logger.info(
                    "Proxy",
                    `Upstream relay SUCCESS for "${service.name}"`,
                    { correlationId: cid },
                  );

                  // Record provider payout with upstream cost deducted
                  if (payoutManager && service.owner_address) {
                    const platformFee = price * 0.05;
                    const providerNet = price - upstreamCostUsdc - platformFee;
                    if (providerNet > 0) {
                      payoutManager
                        .recordPayout({
                          serviceId: service.id,
                          serviceName: service.name,
                          providerWallet: service.owner_address,
                          grossAmount: providerNet,
                          txHashIn: txHash,
                          chain,
                        })
                        .catch((err) =>
                          logger.error(
                            "Proxy",
                            `Relay payout error: ${err.message}`,
                          ),
                        );
                    }
                  }

                  if (onSuccess) await onSuccess();
                  logActivity(
                    "proxy_relay",
                    `Relay: "${service.name}" (${price} USDC, upstream ${upstreamCostUsdc} USDC)`,
                    price,
                    txHash,
                  );

                  if (inflightKey) _proxyInFlight.delete(inflightKey);
                  return res.status(200).json({
                    ...retryData,
                    _x402: {
                      payment: `${price} USDC`,
                      upstream_relay: {
                        paid: `${upstreamCostUsdc} USDC`,
                        tx_hash: relayTxHash || "eip3009-offchain",
                        chain: relayChain,
                        protocol: normalized.format,
                        provider_net: `${Math.max(0, price - upstreamCostUsdc - price * 0.05).toFixed(6)} USDC`,
                      },
                    },
                  });
                }
                const retryBody = await retryRes.text().catch(() => "");
                res._retryStatus = retryRes.status;
                res._retryBody = retryBody.slice(0, 500);
                logger.warn(
                  "Proxy",
                  `Upstream retry failed for "${service.name}" — status ${retryRes.status}: ${retryBody.slice(0, 200)}`,
                  { correlationId: cid },
                );
              } catch (retryErr) {
                res._retryError = retryErr.message;
                logger.error(
                  "Proxy",
                  `Upstream retry error: ${retryErr.message}`,
                  { correlationId: cid },
                );
              }
            }
          }

          // Fallback: relay not configured, payment failed, or retry failed
          if (inflightKey) _proxyInFlight.delete(inflightKey);
          return res.status(502).json({
            error: "UPSTREAM_PAYMENT_REQUIRED",
            message: `Upstream service "${service.name}" requires its own payment (${normalized.format} protocol).`,
            upstream_protocol: normalized.format,
            upstream_price: normalized.amount || null,
            upstream_recipient: normalized.recipient || null,
            upstream_chain: normalized.chain || null,
            _relay_debug: {
              relay_configured: isRelayConfigured(),
              can_pay: canPayUpstream(normalized),
              normalized_payable: normalized.payable,
              normalized_chain: normalized.chain,
              normalized_amount: normalized.amount,
              normalized_recipient: normalized.recipient,
              relay_address: getRelayAddress(),
              relay_errors: res._relayErrors || [],
              should_use_eip3009: shouldUseEIP3009(normalized),
              retry_status: res._retryStatus || null,
              retry_body: res._retryBody || null,
              retry_error: res._retryError || null,
            },
            _payment_status: "not_charged",
            _x402: {
              upstream_402: true,
              protocol: normalized.format,
              detection_path: normalized.detectionPath,
            },
          });
        }

        // 2xx or 4xx → accept response, claim tx
        // Size cap: reject responses larger than MAX_RESPONSE_BYTES to prevent OOM
        const upstreamContentLength = parseInt(
          proxyRes.headers.get("content-length") || "0",
          10,
        );
        if (upstreamContentLength > MAX_RESPONSE_BYTES) {
          logger.warn(
            "Proxy",
            `Response too large from "${service.name}": ${upstreamContentLength} bytes`,
            { correlationId: cid },
          );
          if (inflightKey) _proxyInFlight.delete(inflightKey);
          return res.status(502).json({
            error: "UPSTREAM_RESPONSE_TOO_LARGE",
            message: `Upstream response exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024}MB limit`,
            _payment_status: "charged_but_failed",
          });
        }

        const contentType = proxyRes.headers.get("content-type") || "";
        let responseData;
        try {
          const rawBody = await proxyRes.text();
          if (rawBody.length > MAX_RESPONSE_BYTES) {
            logger.warn(
              "Proxy",
              `Response body too large from "${service.name}": ${rawBody.length} bytes`,
              { correlationId: cid },
            );
            if (inflightKey) _proxyInFlight.delete(inflightKey);
            return res.status(502).json({
              error: "UPSTREAM_RESPONSE_TOO_LARGE",
              message: `Upstream response exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024}MB limit`,
              _payment_status: "charged_but_failed",
            });
          }
          if (contentType.includes("application/json")) {
            responseData = JSON.parse(rawBody);
          } else {
            responseData = { raw: rawBody };
          }
        } catch (parseErr) {
          logger.warn(
            "Proxy",
            `Failed to parse upstream response: ${parseErr.message}`,
            { correlationId: cid },
          );
          responseData = { raw: "", _warning: "parse_error" };
        }

        // Detect HTML SPA responses (proxy returning frontend instead of API data)
        if (responseData.raw && typeof responseData.raw === "string") {
          const raw = responseData.raw.trimStart().toLowerCase();
          if (raw.startsWith("<!doctype") || raw.startsWith("<html")) {
            logger.warn(
              "Proxy",
              `HTML response from "${service.name}" — likely SPA/paywall, not API data`,
              { correlationId: cid },
            );
            responseData._warning = "html_response";
            responseData._message =
              "Upstream returned HTML instead of API data. This may indicate a paywall or misconfigured service.";
          }
        }

        const upstreamLatency = Date.now() - (start || Date.now());
        logger.info(
          "Proxy",
          `← ${service.name} upstream ${proxyRes.status} in ${upstreamLatency}ms`,
          {
            correlationId: cid,
            httpStatus: proxyRes.status,
            latencyMs: upstreamLatency,
          },
        );

        // --- CONSUMER PROTECTION: Response Quality Gate (Layers 0+1+2) ---
        const chargeDecision = shouldChargeForResponse(
          proxyRes.status,
          responseData,
          service.url,
        );

        // Upstream responded (even 4xx) → circuit breaker success (service is reachable)
        recordCircuitSuccess(service.url);

        if (!chargeDecision.shouldCharge) {
          logger.info(
            "Proxy",
            `Consumer protection: NOT charging for "${service.name}" (${chargeDecision.reason})`,
            { correlationId: cid, reason: chargeDecision.reason },
          );
          const refundEngine = require("../lib/refund");
          const rawAgentWallet = req.headers["x-agent-wallet"];
          const agentWallet = /^0x[a-fA-F0-9]{40}$/.test(rawAgentWallet)
            ? rawAgentWallet
            : null;

          let paymentStatus = "not_charged";
          let refundMeta = null;

          let refundSkipReason = null;
          if (agentWallet && refundEngine.isConfigured()) {
            // Anti-double-spend: mark tx used BEFORE refund (Option A)
            let txClaimed = false;
            if (onSuccess) {
              const claimResult = await onSuccess();
              if (claimResult && !claimResult.ok) {
                // Race condition — tx already claimed, skip refund
                paymentStatus = "not_charged";
              } else {
                txClaimed = true;
                // Attempt on-chain refund
                const refundResult = await refundEngine.processRefund(
                  agentWallet,
                  price,
                  chain,
                  service.id,
                  txHash,
                );
                if (refundResult.refunded) {
                  paymentStatus = "refunded";
                  refundMeta = {
                    refund_tx_hash: refundResult.txHash,
                    refund_wallet: refundEngine.getRefundWalletAddress(),
                    refund_chain: chain,
                  };
                  logActivity(
                    "refund",
                    `Refunded ${price} USDC to ${agentWallet.slice(0, 10)}... for "${service.name}" (${chargeDecision.reason})`,
                    price,
                    refundResult.txHash,
                  );
                } else {
                  // Refund failed — unmark tx to restore reusability (Option A rollback)
                  refundSkipReason = refundResult.reason;
                  if (supabase) {
                    const replayKey = `${chain}:${splitMode === "split" ? "split_provider:" : ""}${txHash}`;
                    supabase
                      .from("used_transactions")
                      .update({ status: "rolled_back" })
                      .eq("tx_hash", replayKey)
                      .then(
                        ({ error }) => {
                          if (error)
                            logger.error(
                              "Proxy:refund-rollback",
                              `Failed to mark tx ${replayKey} as rolled_back: ${error.message}`,
                            );
                        },
                        (err) =>
                          logger.error(
                            "Proxy:refund-rollback",
                            `Exception marking tx ${replayKey} as rolled_back: ${err?.message}`,
                          ),
                      );
                  }
                  txClaimed = false;
                }
              }
            }
            if (paymentStatus !== "refunded") {
              logActivity(
                "proxy_not_charged",
                `NOT charged for "${service.name}" (${chargeDecision.reason}${refundSkipReason ? ", refund_skip: " + refundSkipReason : ""})`,
                0,
                txHash,
              );
            }
          } else {
            logActivity(
              "proxy_not_charged",
              `NOT charged for "${service.name}" (${chargeDecision.reason})`,
              0,
              txHash,
            );
          }

          // Persist refund record (fire-and-forget)
          if (supabase && agentWallet) {
            supabase
              .from("refunds")
              .insert([
                {
                  original_tx_hash: txHash,
                  chain,
                  service_id: service.id,
                  service_name: service.name,
                  amount_usdc: price,
                  agent_wallet: agentWallet,
                  status:
                    paymentStatus === "refunded"
                      ? "completed"
                      : refundSkipReason &&
                          (refundSkipReason === "transfer_failed" ||
                            refundSkipReason === "balance_check_failed" ||
                            refundSkipReason === "insufficient_balance")
                        ? "failed"
                        : "skipped",
                  refund_tx_hash: refundMeta?.refund_tx_hash || null,
                  refund_wallet: refundMeta?.refund_wallet || null,
                  reason: chargeDecision.reason,
                  failure_reason: refundSkipReason || null,
                },
              ])
              .then(
                ({ error }) => {
                  if (error)
                    logger.warn(
                      "Proxy",
                      `Failed to persist refund record: ${error.message}`,
                    );
                },
                (err) =>
                  logger.warn(
                    "Proxy",
                    `Exception persisting refund record: ${err?.message}`,
                  ),
              );
          }

          return res.status(proxyRes.status).json({
            success: false,
            service: { id: service.id, name: service.name },
            data: responseData,
            _payment_status: paymentStatus,
            _x402: {
              retry_eligible: paymentStatus !== "refunded",
              tx_hash: txHash,
              payment: price + " USDC",
              reason: chargeDecision.reason,
              ...(refundSkipReason
                ? { refund_skip_reason: refundSkipReason }
                : {}),
              ...(refundMeta || {}),
            },
          });
        }

        // --- DEFERRED CLAIMING: claim tx AFTER successful upstream response ---
        if (onSuccess) {
          const claimResult = await onSuccess();
          if (claimResult && !claimResult.ok) {
            return res.status(409).json({
              error: "TX_ALREADY_USED",
              code: "TX_REPLAY",
              message:
                "This transaction hash has already been used for a previous payment. Please send a new transaction.",
            });
          }
          // Update splitMeta with actual splitMode if available
          if (claimResult && claimResult.splitMode && splitMeta) {
            splitMeta.platform_split_status =
              claimResult.splitMode === "split_complete"
                ? "on_chain"
                : "fallback_pending";
          }
        }

        // Fire-and-forget: trigger FeeSplitter distribute for Polygon facilitator payments.
        // When USDC was sent to the FeeSplitter contract (fee_splitter mode), we need to
        // call distribute(provider, amount) so the contract splits 95/5 and sends funds.
        // For native wrappers (no owner_address), the platform IS the provider → use WALLET_ADDRESS.
        const _feeSplitterChain = getChainConfig(chain);
        const _isFeeSplitter =
          splitMode === "legacy" &&
          chain === "polygon" &&
          !!(
            _feeSplitterChain &&
            _feeSplitterChain.facilitator &&
            _feeSplitterChain.feeSplitterContract
          );
        if (_isFeeSplitter) {
          const distributeProvider =
            service.owner_address || process.env.WALLET_ADDRESS;
          const distributeAmount = Math.round(price * 1e6);
          feeSplitter
            .callDistribute(distributeProvider, distributeAmount)
            .catch((err) => {
              logger.error(
                "FeeSplitter",
                `distribute fire-and-forget error: ${err.message}`,
              );
            });
        }

        // Record legacy payout if applicable (after successful claim)
        if (payoutManager && service.owner_address && splitMode === "legacy") {
          payoutManager
            .recordPayout({
              serviceId: service.id,
              serviceName: service.name,
              providerWallet: service.owner_address,
              grossAmount: price,
              txHashIn: txHash,
              chain,
            })
            .catch((err) => {
              logger.error(
                "Proxy",
                `Failed to record payout for "${service.name}": ${err.message}`,
              );
            });
        }

        if (splitMode === "legacy") {
          logActivity(
            "proxy_call",
            `Proxied call to "${service.name}" (${price} USDC)`,
            price,
            txHash,
          );
        }

        logger.info(
          "Proxy",
          `✓ ${service.name} — ${price} USDC charged (${splitMode})`,
          {
            correlationId: cid,
            serviceId: service.id,
            price,
            splitMode,
            chain,
            txHash: txHash?.slice(0, 18),
          },
        );

        // Build _x402 metadata
        const _x402Chain = getChainConfig(chain);
        const _isFeeSplitterMode =
          splitMode === "legacy" &&
          !!(
            _x402Chain &&
            _x402Chain.facilitator &&
            _x402Chain.feeSplitterContract
          );

        const x402Meta = splitMeta
          ? {
              payment: price + " USDC",
              split_mode: "native",
              provider_share: splitMeta.provider_amount + " USDC",
              platform_fee: splitMeta.platform_amount + " USDC",
              tx_hash_provider: splitMeta.tx_hash_provider,
              tx_hash_platform: splitMeta.tx_hash_platform,
              platform_split_status: splitMeta.platform_split_status,
            }
          : _isFeeSplitterMode
            ? {
                payment: price + " USDC",
                split_mode: "fee_splitter",
                fee_splitter: _x402Chain.feeSplitterContract,
                facilitator: _x402Chain.facilitator,
                tx_hash: txHash,
              }
            : (() => {
                const grossRaw = Math.round(price * 1e6);
                const platformRaw = Math.floor((grossRaw * 5) / 100);
                const providerRaw = grossRaw - platformRaw;
                return {
                  payment: price + " USDC",
                  provider_share: (providerRaw / 1e6).toFixed(6) + " USDC",
                  platform_fee: (platformRaw / 1e6).toFixed(6) + " USDC",
                  tx_hash: txHash,
                };
              })();

        // Layer 3: Build signed _validation metadata for client-side verification
        const validationSecret = process.env.VALIDATION_SECRET || null;
        const expectedSchema = getExpectedFieldsForUrl(service.url);
        let validationMeta = null;
        if (expectedSchema) {
          const schemaCheck = validateResponseSchema(
            responseData,
            expectedSchema.fields,
          );
          const qualityCheck = scoreContentQuality(
            responseData,
            expectedSchema.example,
          );
          validationMeta = buildValidationMeta(
            schemaCheck,
            qualityCheck,
            validationSecret,
          );
        }

        if (validationMeta) {
          x402Meta._validation = validationMeta;
        }

        // Warn agents when they have used >80% of their budget so they can top up proactively
        const budgetCheckResult = req._budgetCheckResult;
        if (budgetCheckResult && budgetCheckResult.budget) {
          const { budget, pct, remaining } = budgetCheckResult;
          if (pct !== undefined && pct >= 80) {
            const limitStr = (budget.maxUsdc || 0).toFixed(2);
            const remainingStr = (remaining || 0).toFixed(2);
            const percentStr = Math.round(100 - pct).toString();
            res.set(
              "X-Budget-Warning",
              `remaining=${remainingStr};limit=${limitStr};percent=${percentStr}`,
            );
          }
        }

        const responseBody = {
          success: proxyRes.ok,
          service: { id: service.id, name: service.name },
          data: responseData,
          _x402: x402Meta,
        };
        return res.status(proxyRes.status).json(responseBody);
      } catch (err) {
        // Network error (timeout, DNS, connection refused, abort) → retry
        logger.warn(
          "Proxy",
          `Network error for "${service.name}" (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message}`,
        );
        lastError = err;
        continue;
      }
    }

    // --- ALL RETRIES EXHAUSTED ---
    // DON'T call onSuccess → tx NOT consumed → user can retry with same hash
    // Record a single circuit breaker failure for this failed proxy call
    recordCircuitFailure(service.url);
    logger.error(
      "Proxy",
      `All ${MAX_RETRIES} attempts failed for "${service.name}": ${lastError?.message}`,
    );

    return res.status(502).json({
      error: "Bad Gateway",
      message:
        "Upstream service unavailable. Payment NOT consumed \u2014 you can retry with the same transaction hash.",
      _x402: {
        retry_eligible: true,
        tx_hash: txHash,
        payment: price + " USDC",
        status:
          "Payment verified but not consumed. Retry with the same X-Payment-TxHash.",
      },
    });
  } finally {
    if (inflightKey) _proxyInFlight.delete(inflightKey);
    if (req._releasePaymentLock) req._releasePaymentLock();
  }
}

module.exports = createProxyRouter;
module.exports.shouldChargeForResponse = shouldChargeForResponse;
module.exports.isEmptyResponse = isEmptyResponse;
