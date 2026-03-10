// routes/proxy.js — API Gateway proxy for 95/5 revenue split
// POST /api/call/:serviceId — Proxies API calls through the platform

const express = require('express');
const logger = require('../lib/logger');
const { safeUrl } = require('../lib/safe-url');
const { TX_HASH_REGEX, createInternalBypassToken, checkWalletRateLimit, WALLET_RATE_LIMIT } = require('../lib/payment');

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
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(serviceId)) {
            return res.status(400).json({ error: 'Invalid service ID format' });
        }

        // 2. Fetch service from DB
        const { data: service, error: fetchErr } = await supabase
            .from('services')
            .select('*')
            .eq('id', serviceId)
            .single();

        if (fetchErr || !service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        // 3. Determine the price (from service or override)
        const price = Number(service.price_usdc) || 0.01;
        const minAmountRaw = Math.round(price * 1e6); // USDC has 6 decimals

        // 4. Detect payment mode
        const txHashProvider = req.headers['x-payment-txhash-provider'];
        const txHashPlatform = req.headers['x-payment-txhash-platform']; // optional
        const chainKey       = req.headers['x-payment-chain'] || 'base';

        // A service without owner_address falls back to legacy mode automatically
        // (the 69 native wrappers — platform is both provider and operator)
        const isSplitMode = !!(service.owner_address) && !!txHashProvider;

        // --- Wallet rate limit + budget checks (applies to BOTH modes) ---
        const rawAgentWallet = req.headers['x-agent-wallet'];
        const agentWallet = /^0x[a-fA-F0-9]{40}$/.test(rawAgentWallet) ? rawAgentWallet : null;
        if (agentWallet) {
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
                    body.payment_details.provider_wallet = service.owner_address;
                    body.payment_details.split = {
                        provider_amount: parseFloat((price * 0.95).toFixed(6)),
                        platform_amount: parseFloat((price * 0.05).toFixed(6)),
                        provider_percent: 95,
                        platform_percent: 5,
                    };
                    body.payment_details.payment_mode = 'split_native';
                }
                return originalJson(body);
            };
        }

        // Apply payment middleware dynamically (legacy: single X-Payment-TxHash)
        const dynamicPayment = paymentMiddleware(minAmountRaw, price, `API Call: ${service.name}`);

        dynamicPayment(req, res, async () => {
            const txHash = req.headers['x-payment-txhash'];
            const chain  = req.headers['x-payment-chain'] || 'base';

            await executeProxyCall(req, res, {
                service,
                price,
                txHash,
                chain,
                payoutManager,
                logActivity,
                splitMode: 'legacy',
                splitMeta: null,
            });
        });
    });

    return router;
}

// ---------------------------------------------------------------------------
// Split mode handler (called inside createProxyRouter context via explicit params)
// ---------------------------------------------------------------------------

async function handleSplitMode(req, res, { supabase, service, price, minAmountRaw, chainKey, txHashProvider, txHashPlatform, paymentSystem, payoutManager, logActivity }) {
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

    // 7. Atomically claim provider tx hash
    const { error: claimProviderErr } = await supabase
        .from('used_transactions')
        .insert([{ tx_hash: providerReplayKey, action: `split_provider:${service.name}` }]);

    if (claimProviderErr) {
        if (claimProviderErr.code === '23505' || (claimProviderErr.message && claimProviderErr.message.includes('duplicate'))) {
            logger.warn('Proxy:split', `Race condition on provider tx ${txHashProvider.slice(0, 18)}...`);
            return res.status(409).json({
                error: 'TX_ALREADY_USED',
                code: 'TX_REPLAY',
                message: 'This transaction hash has already been used for a previous payment. Please send a new transaction.',
            });
        }
        logger.error('Proxy:split', 'Failed to claim provider tx:', claimProviderErr.message);
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'Payment claim failed. Please retry.',
        });
    }

    // 8. Determine split mode and optionally claim platform tx
    let splitMode = 'provider_only';

    if (txHashPlatform && splitResult.platformValid) {
        const { error: claimPlatformErr } = await supabase
            .from('used_transactions')
            .insert([{ tx_hash: platformReplayKey, action: `split_platform:${service.name}` }]);

        if (claimPlatformErr && (claimPlatformErr.code === '23505' || (claimPlatformErr.message && claimPlatformErr.message.includes('duplicate')))) {
            // Platform tx claimed by concurrent request — degrade gracefully
            logger.warn('Proxy:split', `Race on platform tx ${txHashPlatform.slice(0, 18)}... — continuing as provider_only`);
            splitMode = 'provider_only';
        } else if (!claimPlatformErr) {
            splitMode = 'split_complete';
        }
    }

    // 9. Record split payout
    const providerAmountRaw = Math.floor(minAmountRaw * 95 / 100);
    const platformAmountRaw = minAmountRaw - providerAmountRaw;

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

    // 10. Execute the proxy call to the external API
    return executeProxyCall(req, res, {
        service,
        price,
        txHash: txHashProvider,
        chain:  chainKey,
        payoutManager: null, // already recorded above
        logActivity:   () => {}, // already logged
        splitMode,
        splitMeta: {
            provider_amount:       (providerAmountRaw / 1e6).toFixed(6),
            platform_amount:       (platformAmountRaw / 1e6).toFixed(6),
            tx_hash_provider:      txHashProvider,
            tx_hash_platform:      txHashPlatform || null,
            platform_split_status: splitMode === 'split_complete' ? 'on_chain' : 'fallback_pending',
        },
    });
}

// ---------------------------------------------------------------------------
// Shared proxy execution (SSRF check + fetch external API + return response)
// ---------------------------------------------------------------------------

async function executeProxyCall(req, res, { service, price, txHash, chain, payoutManager, logActivity, splitMode, splitMeta }) {
    // SSRF check on service URL
    try {
        await safeUrl(service.url);
    } catch (err) {
        logger.error('Proxy', `SSRF blocked for service "${service.name}": ${err.message}`);
        return res.status(403).json({ error: 'Service URL is not allowed' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const proxyHeaders = { 'Content-Type': 'application/json' };
        if (req.headers['x-agent-wallet']) {
            proxyHeaders['X-Agent-Wallet'] = req.headers['x-agent-wallet'];
        }

        // Internal bypass: if the service URL is hosted on this same server,
        // generate a one-time token so the service's paymentMiddleware skips
        // double-payment verification (the proxy already verified payment).
        try {
            if (new URL(service.url).hostname === SELF_HOSTNAME) {
                proxyHeaders['X-Internal-Proxy'] = createInternalBypassToken();
            }
        } catch { /* invalid URL — safeUrl already checked above */ }

        const proxyRes = await fetch(service.url, {
            method: service.method || 'GET',
            headers: proxyHeaders,
            body: service.method === 'POST' ? JSON.stringify(req.body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        const contentType = proxyRes.headers.get('content-type') || '';
        let responseData;
        if (contentType.includes('application/json')) {
            responseData = await proxyRes.json();
        } else {
            responseData = { raw: await proxyRes.text() };
        }

        // Record legacy payout if applicable
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
        const x402Meta = splitMeta
            ? {
                payment:               price + ' USDC',
                split_mode:            'native',
                provider_share:        splitMeta.provider_amount + ' USDC',
                platform_fee:          splitMeta.platform_amount + ' USDC',
                tx_hash_provider:      splitMeta.tx_hash_provider,
                tx_hash_platform:      splitMeta.tx_hash_platform,
                platform_split_status: splitMeta.platform_split_status,
              }
            : {
                payment:        price + ' USDC',
                provider_share: (price * 0.95).toFixed(6) + ' USDC',
                platform_fee:   (price * 0.05).toFixed(6) + ' USDC',
                tx_hash:        txHash,
              };

        return res.status(proxyRes.status).json({
            success: proxyRes.ok,
            service: { id: service.id, name: service.name },
            data:    responseData,
            _x402:   x402Meta,
        });

    } catch (err) {
        logger.error('Proxy', `Proxy call failed for "${service.name}": ${err.message}`);

        // Even if the proxy call fails, record legacy payout (payment was received)
        if (payoutManager && service.owner_address && splitMode === 'legacy') {
            payoutManager.recordPayout({
                serviceId:      service.id,
                serviceName:    service.name,
                providerWallet: service.owner_address,
                grossAmount:    price,
                txHashIn:       txHash,
                chain: req.headers['x-payment-chain'] || 'base',
            }).catch(err => {
                logger.error('Proxy', `Failed to record fallback payout for "${service.name}": ${err.message}`);
            });
        }

        const x402ErrMeta = splitMeta
            ? {
                payment:          price + ' USDC',
                status:           'Payment received, split recorded. External API unreachable.',
                tx_hash_provider: splitMeta.tx_hash_provider,
              }
            : {
                payment: price + ' USDC',
                status:  'Payment received, payout recorded. External API unreachable.',
                tx_hash: txHash,
              };

        return res.status(502).json({
            error:   'Bad Gateway',
            message: 'The upstream service is temporarily unavailable. Your payment has been recorded.',
            _x402:   x402ErrMeta,
        });
    }
}

module.exports = createProxyRouter;
