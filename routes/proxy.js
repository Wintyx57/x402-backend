// routes/proxy.js — API Gateway proxy for 95/5 revenue split
// POST /api/call/:serviceId — Proxies API calls through the platform
//
// Extracted modules:
//   routes/proxy-circuit.js  — Circuit breaker (failure tracking, open/half-open/closed)
//   routes/proxy-execute.js  — executeProxyCall + consumer protection + in-flight dedup
//   routes/proxy-split.js    — handleSplitMode (split payment verification 95/5)

const express = require("express");
const logger = require("../lib/logger");
const {
  UUID_REGEX,
  checkWalletRateLimit,
  WALLET_RATE_LIMIT,
} = require("../lib/payment");
const { getInputSchemaForUrl } = require("../lib/bazaar-discovery");
const { DEFAULT_CHAIN_KEY, getChainConfig } = require("../lib/chains");
const { hashIp, checkFreeTier, recordFreeUsage } = require("../lib/free-tier");
const { isRelayConfigured } = require("../lib/upstreamPayer");
const { validateApiKey, deductCredits, KEY_PREFIX } = require("../lib/credits");
const {
  executeProxyCall,
  isEmptyResponse,
  shouldChargeForResponse,
} = require("./proxy-execute");
const { handleSplitMode } = require("./proxy-split");

// Protocol classification sets (module scope — avoid per-request allocation)
const DANGEROUS_PROPS = new Set(["__proto__", "constructor", "prototype"]);
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

      const missing = inputSchema.required
        .filter((p) => typeof p === "string" && !DANGEROUS_PROPS.has(p))
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

    // --- API KEY AUTH (after free tier, before payment) ---
    // Accept "Authorization: Bearer x402_sk_..." as an alternative to on-chain payment.
    // If a valid key with sufficient credits is found, deduct credits and serve the request.
    const authHeader = (req.headers["authorization"] || "").trim();
    if (
      authHeader.startsWith("Bearer ") &&
      authHeader.slice(7).startsWith(KEY_PREFIX)
    ) {
      const rawKey = authHeader.slice(7);
      const keyRow = await validateApiKey(supabase, rawKey);

      if (!keyRow) {
        return res.status(401).json({
          error: "Invalid or revoked API key",
          _payment_status: "not_charged",
        });
      }

      // Daily limit check
      if (
        keyRow.daily_limit_usdc !== null &&
        keyRow.daily_limit_usdc !== undefined
      ) {
        const spent = Number(keyRow.daily_spent_usdc || 0);
        const limit = Number(keyRow.daily_limit_usdc);
        if (spent + price > limit) {
          return res.status(402).json({
            error: "Daily API key limit exceeded",
            daily_limit_usdc: limit,
            daily_spent_usdc: spent,
            _payment_status: "not_charged",
          });
        }
      }

      // Deduct credits atomically (passing daily_spent so it's incremented in the same UPDATE)
      const deductResult = await deductCredits(
        supabase,
        keyRow.id,
        price,
        Number(keyRow.credits_usdc),
        Number(keyRow.daily_spent_usdc || 0),
      );

      if (!deductResult.ok) {
        return res.status(402).json({
          error: "Insufficient API key credits",
          credits_usdc: Number(keyRow.credits_usdc),
          required_usdc: price,
          message: "Top up your credits at POST /api/credits/topup",
          _payment_status: "not_charged",
        });
      }

      res.setHeader("X-Payment-Method", "api-key");
      res.setHeader(
        "X-Credits-Remaining",
        String(deductResult.credits_remaining ?? 0),
      );

      // Serve the request as a free-tier-style call (credits already deducted)
      const keyOnSuccess = async () => {
        logActivity(
          "api_key_call",
          `API key call: ${service.name} (${price} USDC deducted from key ${keyRow.id.slice(0, 8)})`,
          price,
          null,
        );
        return { ok: true };
      };

      return executeProxyCall(req, res, {
        service,
        price,
        txHash: null,
        chain: DEFAULT_CHAIN_KEY,
        payoutManager,
        logActivity,
        splitMode: "legacy",
        splitMeta: null,
        onSuccess: keyOnSuccess,
        supabase,
      });
    }

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

module.exports = createProxyRouter;
module.exports.shouldChargeForResponse = shouldChargeForResponse;
module.exports.isEmptyResponse = isEmptyResponse;
