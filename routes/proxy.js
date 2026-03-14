// routes/proxy.js — API Gateway proxy for 95/5 revenue split
// POST /api/call/:serviceId — Proxies API calls through the platform

const express = require('express');
const logger = require('../lib/logger');
const { safeUrl } = require('../lib/safe-url');
const { TX_HASH_REGEX, UUID_REGEX, createInternalBypassToken, checkWalletRateLimit, WALLET_RATE_LIMIT } = require('../lib/payment');
const { getInputSchemaForUrl, getMethodForUrl } = require('../lib/bazaar-discovery');
const { DEFAULT_CHAIN_KEY, getChainConfig } = require('../lib/chains');
const feeSplitter = require('../lib/fee-splitter');
const { checkFreeUsage, incrementFreeUsage } = require('../lib/free-usage');
const { hashApiKey, validateApiKey, deductBalance } = require('../lib/api-key-manager');

// Hostname of this server — used to detect internal service URLs
const SELF_HOSTNAME = (() => {
    try { return new URL(process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL || 'https://x402-api.onrender.com').hostname; }
    catch { return 'x402-api.onrender.com'; }
})();

// Minimum price (micro-USDC) for split payment to ensure both split amounts are non-zero
const MIN_SPLIT_AMOUNT_RAW = 100; // 0.0001 USDC

/**
 * @param {object} supabase
 * @param {Function} logActivity
 * @param {Function} paymentMiddleware - factory from createPaymentSystem
 * @param {object} paidEndpointLimiter - express-rate-limit middleware
 * @param {object} payoutManager - from createPayoutManager
 * @param {object} paymentSystem  - { verifySplitPayment } from createPaymentSystem
 */
function createProxyRouter(supabase, logActivity, paymentMiddleware, paidEndpointLimiter, payoutManager, paymentSystem, budgetManager) {
    const router = express.Router();

    // POST /api/call/:serviceId — Call an external service through the Bazaar proxy
    // Supports two payment modes:
    //   Split mode  : X-Payment-TxHash-Provider (+ optional X-Payment-TxHash-Platform)
    //   Legacy mode : X-Payment-TxHash (100% to platform wallet, pending payout for provider)
    router.post('/api/call/:serviceId', paidEndpointLimiter, async (req, res) => {
        const { serviceId } = req.params;

        // 1. Validate serviceId (UUID format)
        if (!UUID_REGEX.test(serviceId)) {
            return res.status(400).json({ error: 'Invalid service ID format' });
        }

        // 2. Fetch service from DB
        const { data: service, error: fetchErr } = await supabase
            .from('services')
            .select('id, name, url, price_usdc, owner_address, tags, description, required_parameters, free_calls_per_month')
            .eq('id', serviceId)
            .single();

        if (fetchErr || !service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        // --- API KEY MODE: no-wallet payment flow ---
        // If X-API-Key header is present, validate the key and deduct balance.
        // This bypasses the on-chain 402 flow entirely — balance is deducted server-side.
        const rawApiKey = req.headers['x-api-key'];
        if (rawApiKey) {
            if (!rawApiKey.startsWith('sk_live_') || rawApiKey.length < 16) {
                return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key format.' });
            }
            const keyHash = hashApiKey(rawApiKey);
            const keyInfo = await validateApiKey(supabase, keyHash);
            if (!keyInfo.valid) {
                return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or inactive API key.' });
            }

            const callPrice = Number(service.price_usdc) || 0.01;
            if (callPrice > 0) {
                const deduction = await deductBalance(supabase, keyHash, callPrice);
                if (!deduction.success) {
                    return res.status(402).json({
                        error: 'Insufficient API key balance',
                        balance: deduction.remaining_balance,
                        required: callPrice,
                        topup_url: 'https://x402bazaar.org/api-keys',
                        message: `Your API key balance (${deduction.remaining_balance.toFixed(4)} USDC) is insufficient. Top up at x402bazaar.org/api-keys`,
                    });
                }
            }

            // Log activity (fire-and-forget)
            logActivity('api_key_call', `API Key call to "${service.name}" (${callPrice} USDC, key: ${keyInfo.key_prefix})`, callPrice, null);

            // Forward to upstream directly — no 402 check needed
            return executeProxyCall(req, res, {
                service,
                price: callPrice,
                txHash: null,
                chain: req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY,
                payoutManager,
                logActivity,
                splitMode: 'api_key',
                splitMeta: null,
                onSuccess: null,
                apiKeyMeta: {
                    key_prefix: keyInfo.key_prefix,
                    remaining_balance: callPrice > 0
                        ? (keyInfo.balance - callPrice)
                        : keyInfo.balance,
                },
            });
        }

        // --- GATEKEEPER: validate required parameters BEFORE payment ---
        // Priority: DB required_parameters (external services) > discoveryMap (internal wrappers)
        const inputSchema = service.required_parameters || getInputSchemaForUrl(service.url);
        if (inputSchema && inputSchema.required && inputSchema.required.length > 0) {
            const params = {};
            if (req.body && typeof req.body === 'object') Object.assign(params, req.body);
            if (req.query && Object.keys(req.query).length > 0) Object.assign(params, req.query);

            const DANGEROUS_PROPS = ['__proto__', 'constructor', 'prototype'];
            const missing = inputSchema.required
                .filter(p => typeof p === 'string' && !DANGEROUS_PROPS.includes(p))
                .filter(p => params[p] === undefined || params[p] === null || params[p] === '');

            if (missing.length > 0) {
                return res.status(400).json({
                    error: 'Missing required parameters',
                    missing,
                    required_parameters: inputSchema,
                    message: `This service requires: ${missing.join(', ')}. No payment was made.`,
                    _payment_status: 'not_charged',
                });
            }
        }

        // --- FREE TIER CHECK ---
        // If the service has free_calls_per_month > 0, check whether the caller
        // still has quota remaining for the current calendar month.
        // userIdentifier priority: X-Wallet-Address header → req.ip fallback.
        // If quota remains, bypass payment entirely and forward the request.
        const freeTierLimit = Number(service.free_calls_per_month) || 0;
        if (freeTierLimit > 0) {
            const rawWallet = req.headers['x-wallet-address'];
            const userIdentifier = /^0x[a-fA-F0-9]{40}$/.test(rawWallet)
                ? rawWallet.toLowerCase()
                : (req.ip || null);

            if (userIdentifier) {
                const freeCheck = await checkFreeUsage(supabase, service.id, userIdentifier, freeTierLimit);
                if (freeCheck.allowed) {
                    // Increment counter fire-and-forget (non-blocking)
                    incrementFreeUsage(supabase, service.id, userIdentifier).catch(err => {
                        logger.warn('FreeTier', `increment error for service ${service.id}: ${err.message}`);
                    });

                    // Log free call in activity (fire-and-forget)
                    logActivity('free_call', `Free call to "${service.name}" (${freeCheck.remaining - 1} remaining this month)`, 0, null);

                    // Forward request to upstream — reuse executeProxyCall with no onSuccess (no tx to claim)
                    return executeProxyCall(req, res, {
                        service,
                        price: 0,
                        txHash: null,
                        chain: req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY,
                        payoutManager: null,
                        logActivity: () => {},
                        splitMode: 'free',
                        splitMeta: null,
                        onSuccess: null,
                        freeTierMeta: {
                            remaining: freeCheck.remaining - 1,
                            limit: freeTierLimit,
                        },
                    });
                }
            }
        }

        // 3. Determine the price (from service or override)
        const price = Number(service.price_usdc) || 0.01;
        const minAmountRaw = Math.round(price * 1e6); // USDC has 6 decimals

        // 4. Detect payment mode
        const txHashProvider = req.headers['x-payment-txhash-provider'];
        const txHashPlatform = req.headers['x-payment-txhash-platform']; // optional
        const chainKey       = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

        // A service without owner_address falls back to legacy mode automatically
        // (the 69 native wrappers — platform is both provider and operator)
        const isSplitMode = !!(service.owner_address) && !!txHashProvider;

        // --- Wallet rate limit + budget checks ---
        // For split mode: check here (paymentMiddleware is not used).
        // For legacy mode: paymentMiddleware already calls checkWalletRateLimit — skip here
        // to avoid double-counting the wallet's rate limit window.
        const rawAgentWallet = req.headers['x-agent-wallet'];
        const agentWallet = /^0x[a-fA-F0-9]{40}$/.test(rawAgentWallet) ? rawAgentWallet : null;

        if (agentWallet && isSplitMode) {
            const rlCheck = checkWalletRateLimit(agentWallet);
            res.setHeader('X-RateLimit-Remaining', rlCheck.remaining);
            res.setHeader('X-RateLimit-Limit', WALLET_RATE_LIMIT);
            if (!rlCheck.allowed) {
                const retryAfter = Math.ceil((rlCheck.resetAt - Date.now()) / 1000);
                res.setHeader('Retry-After', retryAfter);
                return res.status(429).json({ error: 'Too Many Requests', retry_after: retryAfter });
            }
        }
        if (agentWallet && budgetManager) {
            const check = budgetManager.checkAndRecord(agentWallet, price);
            if (!check.allowed) {
                return res.status(403).json({ error: 'Budget Exceeded', message: check.reason });
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
            res.json = function(body) {
                if (res.statusCode === 402 && body && body.payment_details) {
                    const _chainCfg = getChainConfig(chainKey);
                    const _isFacilitator = !!((_chainCfg && _chainCfg.facilitator) && (_chainCfg && _chainCfg.feeSplitterContract));

                    if (_isFacilitator) {
                        // Phase 2 Polygon facilitator: the FeeSplitter contract handles the 95/5 split
                        // on-chain automatically. We expose fee_splitter info but NOT provider_wallet
                        // to prevent the client from attempting a manual double transfer.
                        body.payment_details.payment_mode = 'fee_splitter';
                        body.payment_details.fee_splitter_contract = _chainCfg.feeSplitterContract;
                        // Expose facilitator URL so MCP agents can use gas-free flow
                        // even if POLYGON_FACILITATOR_URL is not set locally in the MCP.
                        body.payment_details.facilitator = _chainCfg.facilitator;
                        body.payment_details.split = {
                            provider_percent: 95,
                            platform_percent: 5,
                            note: 'Split handled automatically by FeeSplitter contract on-chain',
                        };
                    } else {
                        // Phase 1 / Base / SKALE: standard split_native mode
                        body.payment_details.provider_wallet = service.owner_address;
                        const grossRaw = Math.round(price * 1e6);
                        const platformRaw = Math.floor(grossRaw * 5 / 100);
                        const providerRaw = grossRaw - platformRaw;
                        body.payment_details.split = {
                            provider_amount: providerRaw / 1e6,
                            platform_amount: platformRaw / 1e6,
                            provider_percent: 95,
                            platform_percent: 5,
                        };
                        body.payment_details.payment_mode = 'split_native';
                    }
                }
                return originalJson(body);
            };
        }

        // Apply payment middleware dynamically (legacy: single X-Payment-TxHash)
        // deferClaim: true → middleware verifies on-chain but does NOT INSERT into used_transactions.
        // The proxy claims the tx AFTER successful upstream response (deferred claiming).
        const dynamicPayment = paymentMiddleware(minAmountRaw, price, `API Call: ${service.name}`, { deferClaim: true });

        dynamicPayment(req, res, async () => {
            const txHash = req.headers['x-payment-txhash'];
            const chain  = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

            const onSuccess = async () => {
                const claimed = await req._markTxUsed(req._paymentReplayKey, `API Call: ${service.name}`);
                if (!claimed) return { ok: false };
                logActivity('payment', `API Call: ${service.name} - ${price} USDC verified`, price, txHash);
                return { ok: true };
            };

            await executeProxyCall(req, res, {
                service,
                price,
                txHash,
                chain,
                payoutManager,
                logActivity,
                splitMode: 'legacy',
                splitMeta: null,
                onSuccess,
            });
        });
    });

    return router;
}

// ---------------------------------------------------------------------------
// Split mode handler (called inside createProxyRouter context via explicit params)
// ---------------------------------------------------------------------------

async function handleSplitMode(req, res, { supabase, service, price, minAmountRaw, chainKey, txHashProvider, txHashPlatform, paymentSystem, payoutManager, logActivity }) {
    // 0. Guard: Polygon facilitator mode uses a FeeSplitter contract — single-hash flow only.
    //    The FeeSplitter handles the 95/5 revenue split automatically on-chain.
    //    Clients must send a single X-Payment-TxHash (not X-Payment-TxHash-Provider/Platform).
    const _splitChainCfg = getChainConfig(chainKey);
    if (_splitChainCfg && _splitChainCfg.facilitator && _splitChainCfg.feeSplitterContract) {
        return res.status(400).json({
            error: 'SPLIT_MODE_NOT_SUPPORTED',
            message: 'Polygon facilitator mode uses a FeeSplitter contract — send a single X-Payment-TxHash.',
            hint: 'The FeeSplitter handles the 95/5 revenue split automatically on-chain. Use X-Payment-TxHash instead of X-Payment-TxHash-Provider.',
            fee_splitter_contract: _splitChainCfg.feeSplitterContract,
        });
    }

    // 1. Guard: minimum price to ensure non-zero split amounts
    if (minAmountRaw < MIN_SPLIT_AMOUNT_RAW) {
        return res.status(400).json({
            error: 'Price too low for split payment',
            message: 'Minimum price for split payment is 0.0001 USDC',
        });
    }

    // 2. Validate tx hash formats
    if (!TX_HASH_REGEX.test(txHashProvider)) {
        return res.status(400).json({
            error: 'Invalid transaction hash format',
            field: 'X-Payment-TxHash-Provider',
        });
    }
    if (txHashPlatform && !TX_HASH_REGEX.test(txHashPlatform)) {
        return res.status(400).json({
            error: 'Invalid transaction hash format',
            field: 'X-Payment-TxHash-Platform',
        });
    }

    // 3. Guard: provider and platform hashes must be different
    if (txHashPlatform && txHashPlatform === txHashProvider) {
        return res.status(400).json({
            error: 'Invalid payment',
            message: 'Provider and platform transaction hashes must be different',
        });
    }

    // 4. Anti-replay check
    const providerReplayKey = `${chainKey}:split_provider:${txHashProvider}`;
    const platformReplayKey = txHashPlatform ? `${chainKey}:split_platform:${txHashPlatform}` : null;

    try {
        const keysToCheck = [txHashProvider, providerReplayKey];
        if (txHashPlatform) {
            keysToCheck.push(txHashPlatform, platformReplayKey);
        }

        const { data: usedRows } = await supabase
            .from('used_transactions')
            .select('tx_hash')
            .in('tx_hash', keysToCheck)
            .limit(1);

        if (usedRows && usedRows.length > 0) {
            const usedHash = usedRows[0].tx_hash;
            const isProviderHash = usedHash === txHashProvider || usedHash === providerReplayKey;
            return res.status(409).json({
                error: 'TX_ALREADY_USED',
                code: 'TX_REPLAY',
                message: isProviderHash
                    ? 'This provider transaction hash has already been used for a previous payment. Please send a new transaction.'
                    : 'This platform transaction hash has already been used for a previous payment. Please send a new transaction.',
            });
        }
    } catch (err) {
        logger.error('Proxy:split', 'Anti-replay check error:', err.message);
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'Payment verification system error. Please retry.',
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
            service.owner_address
        );
    } catch (err) {
        logger.error('Proxy:split', `verifySplitPayment error for "${service.name}":`, err.message);
        const isNetworkError = err.message === 'RPC timeout'
            || err.message.includes('fetch')
            || err.message.includes('network')
            || err.message.includes('ECONNREFUSED')
            || err.message.includes('ETIMEDOUT');
        if (isNetworkError) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'RPC node unreachable. Payment could not be verified. Please retry in a few seconds.',
            });
        }
        return res.status(402).json({
            error: 'Payment Required',
            message: 'Payment verification failed.',
        });
    }

    // 6. Provider payment is mandatory
    if (!splitResult.providerValid) {
        return res.status(402).json({
            error: 'Payment Required',
            message: 'Provider payment invalid or insufficient. Please send the correct amount to the provider wallet.',
        });
    }

    // 7. Compute split amounts (needed by onSuccess and splitMeta)
    const providerAmountRaw = Math.floor(minAmountRaw * 95 / 100);
    const platformAmountRaw = minAmountRaw - providerAmountRaw;

    // 8. Deferred claiming: INSERT tx hashes + record payout ONLY after successful upstream call.
    //    This prevents users from losing USDC when the upstream API fails.
    const onSuccess = async () => {
        // Atomically claim provider tx hash
        const { error: claimProviderErr } = await supabase
            .from('used_transactions')
            .insert([{ tx_hash: providerReplayKey, action: `split_provider:${service.name}` }]);

        if (claimProviderErr) {
            if (claimProviderErr.code === '23505' || (claimProviderErr.message && claimProviderErr.message.includes('duplicate'))) {
                logger.warn('Proxy:split', `Race condition on provider tx ${txHashProvider.slice(0, 18)}...`);
                return { ok: false };
            }
            logger.error('Proxy:split', 'Failed to claim provider tx:', claimProviderErr.message);
            return { ok: false };
        }

        // Determine split mode and optionally claim platform tx
        let splitMode = 'provider_only';
        if (txHashPlatform && splitResult.platformValid) {
            const { error: claimPlatformErr } = await supabase
                .from('used_transactions')
                .insert([{ tx_hash: platformReplayKey, action: `split_platform:${service.name}` }]);

            if (claimPlatformErr && (claimPlatformErr.code === '23505' || (claimPlatformErr.message && claimPlatformErr.message.includes('duplicate')))) {
                logger.warn('Proxy:split', `Race on platform tx ${txHashPlatform.slice(0, 18)}... — continuing as provider_only`);
            } else if (!claimPlatformErr) {
                splitMode = 'split_complete';
            }
        }

        // Record split payout
        if (payoutManager) {
            payoutManager.recordSplitPayout({
                serviceId:      service.id,
                serviceName:    service.name,
                providerWallet: service.owner_address,
                grossAmount:    price,
                txHashProvider,
                txHashPlatform: txHashPlatform || null,
                chain:          chainKey,
                splitMode,
            }).catch(err => {
                logger.error('Proxy:split', `Failed to record split payout for "${service.name}": ${err.message}`);
            });
        }

        logActivity('proxy_call_split', `Proxied split call to "${service.name}" (${price} USDC, mode: ${splitMode})`, price, txHashProvider);
        return { ok: true, splitMode };
    };

    // 9. Execute the proxy call with deferred claiming
    return executeProxyCall(req, res, {
        service,
        price,
        txHash: txHashProvider,
        chain:  chainKey,
        payoutManager: null, // handled inside onSuccess
        logActivity:   () => {}, // handled inside onSuccess
        splitMode: 'split',
        splitMeta: {
            provider_amount:       (providerAmountRaw / 1e6).toFixed(6),
            platform_amount:       (platformAmountRaw / 1e6).toFixed(6),
            tx_hash_provider:      txHashProvider,
            tx_hash_platform:      txHashPlatform || null,
            platform_split_status: txHashPlatform && splitResult.platformValid ? 'on_chain' : 'fallback_pending',
        },
        onSuccess,
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

const CB_FAILURE_THRESHOLD  = 3;      // failures before opening circuit
const CB_WINDOW_MS          = 5 * 60 * 1000; // 5-minute rolling window
const CB_OPEN_DURATION_MS   = 30 * 1000;     // 30s before half-open
const CB_MAX_ENTRIES        = 1000;   // eviction cap (FIFO via insertion order)

// Map<serviceUrl, { failures: number, lastFailure: number, state: 'closed'|'open'|'half-open' }>
const circuitBreakers = new Map();

function getCircuitBreaker(serviceUrl) {
    if (!circuitBreakers.has(serviceUrl)) {
        // FIFO eviction when cap is reached
        if (circuitBreakers.size >= CB_MAX_ENTRIES) {
            const firstKey = circuitBreakers.keys().next().value;
            circuitBreakers.delete(firstKey);
        }
        circuitBreakers.set(serviceUrl, { failures: 0, lastFailure: 0, state: 'closed' });
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

    if (cb.state === 'open') {
        const elapsed = Date.now() - cb.lastFailure;
        if (elapsed >= CB_OPEN_DURATION_MS) {
            cb.state = 'half-open';
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
    cb.state = 'closed';
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

    if (cb.state === 'half-open' || cb.failures >= CB_FAILURE_THRESHOLD) {
        cb.state = 'open';
        logger.warn('CircuitBreaker', `Circuit OPEN for ${serviceUrl} (${cb.failures} failures)`);
    }
}

async function executeProxyCall(req, res, { service, price, txHash, chain, payoutManager, logActivity, splitMode, splitMeta, onSuccess, freeTierMeta = null, apiKeyMeta = null }) {
    // SSRF check on service URL
    try {
        await safeUrl(service.url);
    } catch (err) {
        logger.error('Proxy', `SSRF blocked for service "${service.name}": ${err.message}`);
        return res.status(403).json({ error: 'Service URL is not allowed' });
    }

    // Circuit breaker check — fail fast for persistently failing upstream services
    if (isCircuitOpen(service.url)) {
        logger.warn('Proxy', `Circuit OPEN — blocking request for "${service.name}" (${service.url})`);
        return res.status(503).json({
            error: 'Service temporairement indisponible',
            message: 'This service is temporarily unavailable due to repeated failures. Please retry in 30 seconds.',
            _x402: { circuit_breaker: 'open', retry_after_ms: CB_OPEN_DURATION_MS },
        });
    }

    // Determine upstream HTTP method (POST for /api/code, /api/contract-risk, etc.)
    const upstreamMethod = getMethodForUrl(service.url);

    // Build target URL and request body
    let targetUrl = service.url;
    const params = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (req.query && Object.keys(req.query).length > 0) {
        Object.assign(params, req.query);
    }
    let fetchBody;
    if (upstreamMethod === 'POST') {
        // POST endpoints: send params as JSON body, keep URL clean
        fetchBody = Object.keys(params).length > 0 ? JSON.stringify(params) : undefined;
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
            logger.info('Proxy', `Retry ${attempt}/${MAX_RETRIES - 1} for "${service.name}" after ${RETRY_BACKOFF_MS[attempt]}ms`);
            await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const proxyHeaders = { 'Content-Type': 'application/json' };
            if (req.headers['x-agent-wallet']) {
                proxyHeaders['X-Agent-Wallet'] = req.headers['x-agent-wallet'];
            }

            // Internal bypass token: MUST be created inside retry loop (single-use, 30s TTL)
            try {
                if (new URL(service.url).hostname === SELF_HOSTNAME) {
                    proxyHeaders['X-Internal-Proxy'] = createInternalBypassToken();
                }
            } catch { /* invalid URL — safeUrl already checked */ }

            const proxyRes = await fetch(targetUrl, {
                method: upstreamMethod,
                headers: proxyHeaders,
                body: fetchBody,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            // 5xx → retry (upstream error)
            if (proxyRes.status >= 500) {
                const errBody = await proxyRes.text().catch(() => '');
                logger.warn('Proxy', `Upstream ${proxyRes.status} for "${service.name}" (attempt ${attempt + 1}/${MAX_RETRIES}): ${errBody.slice(0, 300)}`);
                lastError = new Error(`Upstream returned ${proxyRes.status}`);
                continue;
            }

            // 2xx or 4xx → accept response, claim tx
            const contentType = proxyRes.headers.get('content-type') || '';
            let responseData;
            if (contentType.includes('application/json')) {
                responseData = await proxyRes.json();
            } else {
                responseData = { raw: await proxyRes.text() };
            }

            // --- DEFERRED CLAIMING: claim tx AFTER successful upstream response ---
            if (onSuccess) {
                const claimResult = await onSuccess();
                if (claimResult && !claimResult.ok) {
                    return res.status(409).json({
                        error: 'TX_ALREADY_USED',
                        code: 'TX_REPLAY',
                        message: 'This transaction hash has already been used for a previous payment. Please send a new transaction.',
                    });
                }
                // Update splitMeta with actual splitMode if available
                if (claimResult && claimResult.splitMode && splitMeta) {
                    splitMeta.platform_split_status =
                        claimResult.splitMode === 'split_complete' ? 'on_chain' : 'fallback_pending';
                }
            }

            // Fire-and-forget: trigger FeeSplitter distribute for Polygon facilitator payments.
            // When USDC was sent to the FeeSplitter contract (fee_splitter mode), we need to
            // call distribute(provider, amount) so the contract splits 95/5 and sends funds.
            // For native wrappers (no owner_address), the platform IS the provider → use WALLET_ADDRESS.
            const _feeSplitterChain = getChainConfig(chain);
            const _isFeeSplitter = splitMode === 'legacy'
                && chain === 'polygon'
                && !!(_feeSplitterChain && _feeSplitterChain.facilitator && _feeSplitterChain.feeSplitterContract);
            if (_isFeeSplitter) {
                const distributeProvider = service.owner_address || process.env.WALLET_ADDRESS;
                const distributeAmount = Math.round(price * 1e6);
                feeSplitter.callDistribute(distributeProvider, distributeAmount).catch((err) => {
                    logger.error('FeeSplitter', `distribute fire-and-forget error: ${err.message}`);
                });
            }

            // Record legacy payout if applicable (after successful claim)
            if (payoutManager && service.owner_address && splitMode === 'legacy') {
                payoutManager.recordPayout({
                    serviceId:      service.id,
                    serviceName:    service.name,
                    providerWallet: service.owner_address,
                    grossAmount:    price,
                    txHashIn:       txHash,
                    chain,
                }).catch(err => {
                    logger.error('Proxy', `Failed to record payout for "${service.name}": ${err.message}`);
                });
            }

            if (splitMode === 'legacy') {
                logActivity('proxy_call', `Proxied call to "${service.name}" (${price} USDC)`, price, txHash);
            }

            // Build _x402 metadata
            const _x402Chain = getChainConfig(chain);
            const _isFeeSplitterMode = splitMode === 'legacy'
                && !!(_x402Chain && _x402Chain.facilitator && _x402Chain.feeSplitterContract);

            const x402Meta = splitMode === 'api_key'
                ? {
                    payment:           price + ' USDC',
                    split_mode:        'api_key',
                    remaining_balance: (apiKeyMeta?.remaining_balance ?? 0).toFixed(6) + ' USDC',
                    key_prefix:        apiKeyMeta?.key_prefix,
                  }
                : splitMode === 'free'
                ? { payment: '0 USDC', split_mode: 'free_tier' }
                : splitMeta
                ? {
                    payment:               price + ' USDC',
                    split_mode:            'native',
                    provider_share:        splitMeta.provider_amount + ' USDC',
                    platform_fee:          splitMeta.platform_amount + ' USDC',
                    tx_hash_provider:      splitMeta.tx_hash_provider,
                    tx_hash_platform:      splitMeta.tx_hash_platform,
                    platform_split_status: splitMeta.platform_split_status,
                  }
                : _isFeeSplitterMode
                ? {
                    payment:          price + ' USDC',
                    split_mode:       'fee_splitter',
                    fee_splitter:     _x402Chain.feeSplitterContract,
                    facilitator:      _x402Chain.facilitator,
                    tx_hash:          txHash,
                  }
                : (() => {
                    const grossRaw = Math.round(price * 1e6);
                    const platformRaw = Math.floor(grossRaw * 5 / 100);
                    const providerRaw = grossRaw - platformRaw;
                    return {
                        payment:        price + ' USDC',
                        provider_share: (providerRaw / 1e6).toFixed(6) + ' USDC',
                        platform_fee:   (platformRaw / 1e6).toFixed(6) + ' USDC',
                        tx_hash:        txHash,
                    };
                  })();

            // Upstream responded successfully → reset circuit breaker
            recordCircuitSuccess(service.url);

            const responseBody = {
                success: proxyRes.ok,
                service: { id: service.id, name: service.name },
                data:    responseData,
                _x402:   x402Meta,
            };
            if (freeTierMeta) {
                responseBody._free_tier = {
                    free_call:     true,
                    remaining:     freeTierMeta.remaining,
                    limit:         freeTierMeta.limit,
                    reset_monthly: true,
                };
            }
            return res.status(proxyRes.status).json(responseBody);

        } catch (err) {
            // Network error (timeout, DNS, connection refused, abort) → retry
            logger.warn('Proxy', `Network error for "${service.name}" (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message}`);
            lastError = err;
            continue;
        }
    }

    // --- ALL RETRIES EXHAUSTED ---
    // DON'T call onSuccess → tx NOT consumed → user can retry with same hash
    // Record a single circuit breaker failure for this failed proxy call
    recordCircuitFailure(service.url);
    logger.error('Proxy', `All ${MAX_RETRIES} attempts failed for "${service.name}": ${lastError?.message}`);

    return res.status(502).json({
        error:   'Bad Gateway',
        message: 'Upstream service unavailable. Payment NOT consumed \u2014 you can retry with the same transaction hash.',
        _x402: {
            retry_eligible: true,
            tx_hash:        txHash,
            payment:        price + ' USDC',
            status:         'Payment verified but not consumed. Retry with the same X-Payment-TxHash.',
        },
    });
}

module.exports = createProxyRouter;
