// routes/proxy.js — API Gateway proxy for 95/5 revenue split
// POST /api/call/:serviceId — Proxies API calls through the platform

const express = require('express');
const logger = require('../lib/logger');
const { safeUrl } = require('../lib/safe-url');

function createProxyRouter(supabase, logActivity, paymentMiddleware, paidEndpointLimiter, payoutManager) {
    const router = express.Router();

    // POST /api/call/:serviceId — Call an external service through the Bazaar proxy
    // Flow: Agent pays platform → platform proxies to external API → records pending payout (95% to provider)
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

        // 4. Apply payment middleware dynamically
        // We create an inline middleware that uses the service's price
        const dynamicPayment = paymentMiddleware(minAmountRaw, price, `API Call: ${service.name}`);

        // Execute payment middleware
        dynamicPayment(req, res, async () => {
            // Payment verified! Now proxy the request.
            const txHash = req.headers['x-payment-txhash'];
            const chain = req.headers['x-payment-chain'] || 'base';

            // 5. SSRF check on service URL
            try {
                await safeUrl(service.url);
            } catch (err) {
                logger.error('Proxy', `SSRF blocked for service "${service.name}": ${err.message}`);
                return res.status(403).json({ error: 'Service URL is not allowed' });
            }

            // 6. Proxy the request to the external API
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

                const proxyHeaders = { 'Content-Type': 'application/json' };
                // Forward agent wallet for the external API if it uses x402
                if (req.headers['x-agent-wallet']) {
                    proxyHeaders['X-Agent-Wallet'] = req.headers['x-agent-wallet'];
                }

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

                // 7. Record pending payout (95% to provider) — fire and forget
                if (payoutManager && service.owner_address) {
                    payoutManager.recordPayout({
                        serviceId: service.id,
                        serviceName: service.name,
                        providerWallet: service.owner_address,
                        grossAmount: price,
                        txHashIn: txHash,
                        chain,
                    }).catch(err => {
                        logger.error('Proxy', `Failed to record payout for "${service.name}": ${err.message}`);
                    });
                }

                logActivity('proxy_call', `Proxied call to "${service.name}" (${price} USDC)`, price, txHash);

                // 8. Return response with metadata
                return res.status(proxyRes.status).json({
                    success: proxyRes.ok,
                    service: {
                        id: service.id,
                        name: service.name,
                    },
                    data: responseData,
                    _x402: {
                        payment: price + ' USDC',
                        provider_share: (price * 0.95).toFixed(6) + ' USDC',
                        platform_fee: (price * 0.05).toFixed(6) + ' USDC',
                        tx_hash: txHash,
                    }
                });
            } catch (err) {
                logger.error('Proxy', `Proxy call failed for "${service.name}": ${err.message}`);

                // Even if proxy fails, payout is still recorded (payment was received)
                if (payoutManager && service.owner_address) {
                    payoutManager.recordPayout({
                        serviceId: service.id,
                        serviceName: service.name,
                        providerWallet: service.owner_address,
                        grossAmount: price,
                        txHashIn: txHash,
                        chain: req.headers['x-payment-chain'] || 'base',
                    }).catch(() => {});
                }

                return res.status(502).json({
                    error: 'Bad Gateway',
                    message: `External API call to "${service.name}" failed: ${err.message}`,
                    _x402: {
                        payment: price + ' USDC',
                        status: 'Payment received, payout recorded. External API unreachable.',
                        tx_hash: txHash,
                    }
                });
            }
        });
    });

    return router;
}

module.exports = createProxyRouter;
