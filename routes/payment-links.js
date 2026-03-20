// routes/payment-links.js — Shareable paywall links for any content/URL
// Allows creators to put any content behind a USDC paywall and share it as a URL.
// AI agents can access the target URL via the x402 payment protocol.

const express = require('express');
const { recoverMessageAddress } = require('viem');
const logger = require('../lib/logger');
const { notifyAdmin } = require('../lib/telegram-bot');
const { safeUrl } = require('../lib/safe-url');
const { PaymentLinkSchema } = require('../schemas');
const { TX_HASH_REGEX, UUID_REGEX } = require('../lib/payment');
const { DEFAULT_CHAIN_KEY, CHAINS, NETWORK, getChainConfig } = require('../lib/chains');

// Reuse the same regex already defined in lib/wallet-auth.js — single source of truth
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Max allowed age for signed timestamps (5 minutes) — prevents replay attacks.
// Same value as SIGNATURE_MAX_AGE_MS in routes/register.js.
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

// Public fields returned when listing/getting a link (target_url is withheld behind paywall)
const PUBLIC_FIELDS = 'id, title, description, price_usdc, owner_address, is_active, views, paid_count, total_earned_usdc, redirect_after_payment, created_at, updated_at';

// Precompute the available networks list once at module load — CHAINS is static.
// Mirrors the NETWORK-aware filtering used in lib/payment.js and routes/health.js.
const AVAILABLE_NETWORKS = Object.entries(CHAINS)
    .filter(([key]) => NETWORK === 'testnet' ? key === 'base-sepolia' : key !== 'base-sepolia')
    .map(([key, cfg]) => ({
        network: key,
        chainId: cfg.chainId,
        label: cfg.label,
        usdc_contract: cfg.usdcContract,
        explorer: cfg.explorer,
        gas: key === 'skale' ? '~$0.0007 (CREDITS)' : key === 'polygon' ? '~$0.001 (POL)' : '~$0.001',
        ...(cfg.facilitator ? { facilitator: cfg.facilitator } : {}),
    }));

// ─── EIP-191 signature verification ──────────────────────────────────────────
// Same algorithm as routes/register.js (verifyQuickRegisterSignature et al.).
// Extracted here as a generic helper to avoid duplication within this module.

/**
 * Verifies an EIP-191 personal_sign signature with timestamp freshness check.
 * @param {string} message - The exact message that was signed
 * @param {string} ownerAddress - Expected signer address (0x...)
 * @param {string} signature - The EIP-191 signature
 * @param {number} timestamp - Unix ms timestamp embedded in the message
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>}
 */
async function verifyEip191Signature(message, ownerAddress, signature, timestamp) {
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || ts <= 0) {
        return { valid: false, reason: 'invalid_timestamp' };
    }
    const age = Date.now() - ts;
    if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
        return { valid: false, reason: 'timestamp_expired', age_ms: age };
    }
    try {
        const recovered = await recoverMessageAddress({ message, signature });
        if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
            return { valid: false, reason: 'signature_mismatch', recovered };
        }
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: 'signature_recovery_failed', error: err.message };
    }
}

// ─── 402 response builder ─────────────────────────────────────────────────────

function buildPaymentRequired(link, chainKey = DEFAULT_CHAIN_KEY) {
    const price = Number(link.price_usdc);
    const chainCfg = getChainConfig(chainKey);
    const recipient = (chainCfg && chainCfg.feeSplitterContract)
        ? chainCfg.feeSplitterContract
        : process.env.WALLET_ADDRESS;

    return {
        error: 'Payment Required',
        title: link.title,
        description: link.description || '',
        price_usdc: price,
        payment_details: {
            amount: price,
            amount_raw: Math.round(price * 1e6),
            currency: 'USDC',
            network: DEFAULT_CHAIN_KEY,
            networks: AVAILABLE_NETWORKS,
            recipient,
            accepted: ['USDC'],
            action: `Access: ${link.title}`,
        },
        instructions: 'Send USDC payment, then POST to /api/payment-links/:id/access with X-Payment-TxHash and X-Payment-Chain headers.',
    };
}

// ─── Router factory ───────────────────────────────────────────────────────────

/**
 * @param {object} supabase - Supabase client
 * @param {Function} logActivity - Activity logger
 * @param {object} createLinkLimiter - express-rate-limit instance (registerLimiter is reused)
 * @param {object} paymentSystem - { verifyPayment, markTxUsed } from createPaymentSystem()
 * @param {object} payoutManager - from createPayoutManager (records 95/5 split payouts)
 */
function createPaymentLinksRouter(supabase, logActivity, createLinkLimiter, paymentSystem, payoutManager) {
    // Destructure once at factory init — avoid per-request property lookup
    const { verifyPayment, markTxUsed } = paymentSystem;

    const router = express.Router();

    // ── POST /api/payment-links — Create a new payment link ───────────────────
    router.post('/api/payment-links', createLinkLimiter, async (req, res) => {
        // 1. Validate request body
        const parsed = PaymentLinkSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation Error',
                details: (parsed.error.issues || parsed.error.errors || []).map(e => ({ field: e.path.join('.'), message: e.message })),
            });
        }

        const { title, description, targetUrl, priceUsdc, ownerAddress, signature, timestamp, redirectAfterPayment } = parsed.data;

        // 2. Verify EIP-191 signature
        const message = `create-payment-link:${ownerAddress}:${timestamp}`;
        const sigCheck = await verifyEip191Signature(message, ownerAddress, signature, timestamp);
        if (!sigCheck.valid) {
            return res.status(401).json({ error: 'Invalid signature', reason: sigCheck.reason });
        }

        // 3. SSRF protection on targetUrl
        try {
            await safeUrl(targetUrl);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid target URL', message: err.message });
        }

        // 4. Insert into Supabase
        const { data: link, error: insertErr } = await supabase
            .from('payment_links')
            .insert([{
                title,
                description,
                target_url: targetUrl,
                price_usdc: priceUsdc,
                owner_address: ownerAddress.toLowerCase(),
                redirect_after_payment: redirectAfterPayment,
            }])
            .select('id, title, description, price_usdc, owner_address, is_active, redirect_after_payment, created_at')
            .single();

        if (insertErr) {
            logger.error('PaymentLinks', `Insert error: ${insertErr.message}`);
            return res.status(500).json({ error: 'Failed to create payment link', message: insertErr.message });
        }

        // 5. Notify admin (fire-and-forget)
        const baseUrl = process.env.FRONTEND_URL || 'https://x402bazaar.org';
        const paywallUrl = `${baseUrl}/pay/${link.id}`;
        notifyAdmin(`New payment link created: "${title}" @ ${priceUsdc} USDC by ${ownerAddress.slice(0, 10)}...`).catch(() => {});
        logActivity('register', `Payment link created: "${title}" @ ${priceUsdc} USDC`);

        return res.status(201).json({
            success: true,
            payment_link: {
                ...link,
                paywall_url: paywallUrl,
            },
        });
    });

    // ── GET /api/payment-links/my/:address — List links for an owner ──────────
    // NOTE: Registered BEFORE /:id to avoid Express treating "my" as a UUID param
    router.get('/api/payment-links/my/:address', async (req, res) => {
        const { address } = req.params;
        if (!ETH_ADDRESS_REGEX.test(address)) {
            return res.status(400).json({ error: 'Invalid Ethereum address format' });
        }

        const { data, error } = await supabase
            .from('payment_links')
            .select(PUBLIC_FIELDS)
            .eq('owner_address', address.toLowerCase())
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('PaymentLinks', `List error for ${address}: ${error.message}`);
            return res.status(500).json({ error: 'Failed to fetch payment links' });
        }

        const links = data || [];
        return res.json({ links, count: links.length });
    });

    // ── GET /api/payment-links/:id — Public info, returns 402 (no target_url) ─
    router.get('/api/payment-links/:id', async (req, res) => {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
            return res.status(400).json({ error: 'Invalid payment link ID format' });
        }

        const { data: link, error } = await supabase
            .from('payment_links')
            .select(PUBLIC_FIELDS)
            .eq('id', id)
            .single();

        if (error || !link) {
            return res.status(404).json({ error: 'Payment link not found' });
        }

        if (!link.is_active) {
            return res.status(410).json({ error: 'Payment link has been deactivated' });
        }

        // Increment views count (fire-and-forget — non-critical)
        supabase
            .from('payment_links')
            .update({ views: (link.views || 0) + 1 })
            .eq('id', id)
            .then(() => {})
            .catch(() => {});

        const chainKey = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;
        return res.status(402).json(buildPaymentRequired(link, chainKey));
    });

    // ── POST /api/payment-links/:id/access — Verify payment, return target URL ─
    router.post('/api/payment-links/:id/access', async (req, res) => {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
            return res.status(400).json({ error: 'Invalid payment link ID format' });
        }

        // 1. Fetch link (include target_url — this is the protected resource)
        const { data: link, error: fetchErr } = await supabase
            .from('payment_links')
            .select('id, title, description, price_usdc, owner_address, is_active, redirect_after_payment, paid_count, total_earned_usdc, target_url')
            .eq('id', id)
            .single();

        if (fetchErr || !link) {
            return res.status(404).json({ error: 'Payment link not found' });
        }

        if (!link.is_active) {
            return res.status(410).json({ error: 'Payment link has been deactivated' });
        }

        const chainKey = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

        // 2. Check payment header is present
        const txHash = req.headers['x-payment-txhash'];
        if (!txHash) {
            return res.status(402).json(buildPaymentRequired(link, chainKey));
        }

        // 3. Validate tx hash format
        if (!TX_HASH_REGEX.test(txHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash format' });
        }

        // 4. Validate chain
        if (!CHAINS[chainKey]) {
            return res.status(400).json({
                error: 'Invalid chain',
                message: `Unsupported chain: ${chainKey}. Accepted: ${Object.keys(CHAINS).join(', ')}`,
            });
        }

        const price = Number(link.price_usdc);
        const minAmountRaw = Math.round(price * 1e6);
        // Scope replay key with paylink: prefix to avoid collisions with proxy payment keys
        const replayKey = `paylink:${chainKey}:${txHash}`;

        // 5. Anti-replay: early rejection before expensive on-chain verification
        try {
            const { data: existing } = await supabase
                .from('used_transactions')
                .select('tx_hash')
                .in('tx_hash', [txHash, replayKey])
                .limit(1);
            if (existing && existing.length > 0) {
                return res.status(409).json({
                    error: 'TX_ALREADY_USED',
                    code: 'TX_REPLAY',
                    message: 'This transaction hash has already been used. Please send a new transaction.',
                });
            }
        } catch (err) {
            logger.error('PaymentLinks', `Anti-replay check error: ${err.message}`);
            return res.status(503).json({ error: 'Service temporarily unavailable', message: 'Payment verification system error. Please retry.' });
        }

        // 6. Verify on-chain payment (same logic as proxy.js)
        let verifyResult;
        try {
            const chainCfg = getChainConfig(chainKey);
            const recipient = (chainCfg && chainCfg.feeSplitterContract) ? chainCfg.feeSplitterContract : null;
            verifyResult = await verifyPayment(txHash, minAmountRaw, chainKey, recipient);
        } catch (err) {
            logger.error('PaymentLinks', `Verification error on ${chainKey}: ${err.message}`);
            // Mirror the network-error detection from lib/payment.js and routes/proxy.js
            const isNetworkError = err.message === 'RPC timeout'
                || err.message.includes('fetch')
                || err.message.includes('network')
                || err.message.includes('ECONNREFUSED')
                || err.message.includes('ETIMEDOUT');
            if (isNetworkError) {
                return res.status(503).json({ error: 'Service Unavailable', message: 'RPC node unreachable. Please retry.' });
            }
            return res.status(402).json({ error: 'Payment Required', message: 'Invalid transaction or insufficient payment.' });
        }

        if (!verifyResult || !verifyResult.valid) {
            return res.status(402).json({
                error: 'Payment Required',
                message: `Payment not verified. Ensure you sent at least ${price} USDC to the correct address.`,
                ...buildPaymentRequired(link, chainKey),
            });
        }

        // 7. Claim tx atomically — INSERT fails on duplicate key, preventing race conditions
        const claimed = await markTxUsed(replayKey, `Payment Link Access: ${link.title}`);
        if (!claimed) {
            return res.status(409).json({
                error: 'TX_ALREADY_USED',
                code: 'TX_REPLAY',
                message: 'This transaction hash has already been claimed by another request.',
            });
        }

        // 8. Record 95/5 split payout (same as proxy.js) — fire-and-forget
        if (payoutManager && link.owner_address) {
            payoutManager.recordPayout({
                serviceId:      id,
                serviceName:    `PayLink: ${link.title}`,
                providerWallet: link.owner_address,
                grossAmount:    price,
                txHashIn:       txHash,
                chain:          chainKey,
            }).catch(err => {
                logger.error('PaymentLinks', `Failed to record payout for "${link.title}": ${err.message}`);
            });
        }

        // 9. Update paid_count and total_earned_usdc (fire-and-forget)
        supabase
            .from('payment_links')
            .update({
                paid_count: (link.paid_count || 0) + 1,
                total_earned_usdc: Number((Number(link.total_earned_usdc || 0) + price).toFixed(4)),
            })
            .eq('id', id)
            .then(() => {})
            .catch(() => {});

        logActivity('payment_link', `Payment link accessed: "${link.title}" @ ${price} USDC (95/5 split)`, price, txHash);

        return res.json({
            success: true,
            title: link.title,
            description: link.description || '',
            target_url: link.target_url,
            redirect_after_payment: link.redirect_after_payment,
            price_paid_usdc: price,
            tx_hash: txHash,
            chain: chainKey,
        });
    });

    // ── DELETE /api/payment-links/:id — Soft-delete (EIP-191 auth) ───────────
    router.delete('/api/payment-links/:id', async (req, res) => {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
            return res.status(400).json({ error: 'Invalid payment link ID format' });
        }

        const { ownerAddress, signature, timestamp } = req.body || {};
        if (!ownerAddress || !signature || !timestamp) {
            return res.status(400).json({ error: 'Missing required fields: ownerAddress, signature, timestamp' });
        }
        if (!ETH_ADDRESS_REGEX.test(ownerAddress)) {
            return res.status(400).json({ error: 'Invalid ownerAddress format' });
        }

        // 1. Verify EIP-191 signature
        const message = `delete-payment-link:${id}:${ownerAddress}:${timestamp}`;
        const sigCheck = await verifyEip191Signature(message, ownerAddress, signature, timestamp);
        if (!sigCheck.valid) {
            return res.status(401).json({ error: 'Invalid signature', reason: sigCheck.reason });
        }

        // 2. Fetch link and verify ownership
        const { data: link, error: fetchErr } = await supabase
            .from('payment_links')
            .select('id, owner_address, is_active')
            .eq('id', id)
            .single();

        if (fetchErr || !link) {
            return res.status(404).json({ error: 'Payment link not found' });
        }

        if (link.owner_address.toLowerCase() !== ownerAddress.toLowerCase()) {
            return res.status(403).json({ error: 'Forbidden', message: 'You are not the owner of this payment link.' });
        }

        if (!link.is_active) {
            return res.status(410).json({ error: 'Payment link is already deactivated' });
        }

        // 3. Soft-delete (set is_active = false)
        const { error: updateErr } = await supabase
            .from('payment_links')
            .update({ is_active: false })
            .eq('id', id);

        if (updateErr) {
            logger.error('PaymentLinks', `Deactivate error: ${updateErr.message}`);
            return res.status(500).json({ error: 'Failed to deactivate payment link' });
        }

        logActivity('register', `Payment link deactivated: ${id}`);
        return res.json({ success: true, message: 'Payment link has been deactivated.' });
    });

    return router;
}

module.exports = createPaymentLinksRouter;
