// routes/api-keys.js — API Key management endpoints
// Provides a no-wallet payment flow: developers prepay USDC and use X-API-Key header.
//
// Endpoints:
//   POST   /api/keys            — Create a new API key (returns raw key ONCE)
//   GET    /api/keys            — List keys for an email (requires X-API-Key auth)
//   DELETE /api/keys/:id        — Deactivate a key (requires X-API-Key auth)
//   GET    /api/keys/balance    — Return balance of the current key (X-API-Key)
//   POST   /api/keys/topup      — Top up balance with USDC tx proof

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');
const { hashApiKey, createApiKey, validateApiKey, topupBalance } = require('../lib/api-key-manager');
const { TX_HASH_REGEX } = require('../lib/payment');

// Strict rate limit on key creation: 3/hour/IP
const createKeyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'API key creation limit: 3 per hour. Try again later.' },
});

// Moderate limit on other endpoints: 60/min/IP
const keyApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Rate limit exceeded. Try again in 1 minute.' },
});

// Top-up: stricter to prevent abuse (10/hour/IP)
const topupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Top-up limit: 10 per hour.' },
});

/**
 * Middleware: authenticate via X-API-Key header.
 * Sets req.apiKeyInfo = { id, balance, owner_email, label, key_prefix }
 */
function requireApiKeyAuth(supabase) {
    return async (req, res, next) => {
        const rawKey = req.headers['x-api-key'];
        if (!rawKey) {
            return res.status(401).json({ error: 'Unauthorized', message: 'X-API-Key header required.' });
        }
        if (!rawKey.startsWith('sk_live_') || rawKey.length < 16) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key format.' });
        }
        const keyHash = hashApiKey(rawKey);
        const keyInfo = await validateApiKey(supabase, keyHash);
        if (!keyInfo.valid) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or inactive API key.' });
        }
        req.apiKeyInfo = keyInfo;
        req.apiKeyHash = keyHash;
        next();
    };
}

/**
 * Masks an API key prefix for display: "sk_live_xxxx****yyyy"
 * Reveals first 12 chars (prefix) and last 4.
 * @param {string} prefix — stored prefix (e.g. "sk_live_abcd")
 * @returns {string}
 */
function maskKey(prefix) {
    return prefix + '****';
}

/**
 * Validates email format (basic RFC-ish check).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    return typeof email === 'string'
        && email.length >= 5
        && email.length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createApiKeysRouter(supabase) {
    const router = express.Router();

    // -----------------------------------------------------------------------
    // POST /api/keys — Create a new API key
    // Body: { email, label? }
    // Returns: { id, key, prefix, message } — key is shown ONCE only
    // -----------------------------------------------------------------------
    router.post('/api/keys', createKeyLimiter, async (req, res) => {
        const { email, label } = req.body || {};

        if (!email || !isValidEmail(email)) {
            return res.status(400).json({
                error: 'Invalid email',
                message: 'A valid email address is required to create an API key.',
            });
        }

        if (label !== undefined && typeof label !== 'string') {
            return res.status(400).json({ error: 'Invalid label', message: 'Label must be a string.' });
        }

        const sanitizedLabel = (label || '').trim().slice(0, 100);

        const result = await createApiKey(supabase, email, sanitizedLabel);
        if (!result) {
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to create API key. Please try again.',
            });
        }

        logger.info('ApiKeys', `New API key created for ${email.replace(/(.{2}).*@/, '$1***@')} — prefix: ${result.prefix}`);

        return res.status(201).json({
            id: result.id,
            key: result.key,
            prefix: result.prefix,
            balance_usdc: 0,
            message: 'API key created successfully. Store it securely — it will not be shown again.',
            usage: {
                header: 'X-API-Key',
                example: `curl -H "X-API-Key: ${result.key}" https://x402-api.onrender.com/api/joke`,
            },
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/keys/balance — Return balance of the authenticated key
    // Requires: X-API-Key header
    // -----------------------------------------------------------------------
    router.get('/api/keys/balance', keyApiLimiter, requireApiKeyAuth(supabase), async (req, res) => {
        const { id, balance, owner_email, label, key_prefix } = req.apiKeyInfo;

        return res.json({
            id,
            key_prefix: maskKey(key_prefix),
            owner_email,
            label,
            balance_usdc: balance,
            topup_url: 'https://x402bazaar.org/api-keys',
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/keys — List all keys for the authenticated user's email
    // Requires: X-API-Key header (identifies the owner by their email)
    // -----------------------------------------------------------------------
    router.get('/api/keys', keyApiLimiter, requireApiKeyAuth(supabase), async (req, res) => {
        const ownerEmail = req.apiKeyInfo.owner_email;

        const { data, error } = await supabase
            .from('api_keys')
            .select('id, key_prefix, label, balance_usdc, total_spent, call_count, active, created_at, last_used_at')
            .eq('owner_email', ownerEmail)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            logger.error('ApiKeys', `List error for ${ownerEmail}: ${error.message}`);
            return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list API keys.' });
        }

        const keys = (data || []).map(k => ({
            id: k.id,
            key_masked: maskKey(k.key_prefix),
            label: k.label || '',
            balance_usdc: parseFloat(k.balance_usdc || 0),
            total_spent: parseFloat(k.total_spent || 0),
            call_count: k.call_count || 0,
            active: k.active,
            created_at: k.created_at,
            last_used_at: k.last_used_at,
        }));

        return res.json({ email: ownerEmail, keys, count: keys.length });
    });

    // -----------------------------------------------------------------------
    // DELETE /api/keys/:id — Deactivate a key
    // Requires: X-API-Key header (must own the key)
    // -----------------------------------------------------------------------
    router.delete('/api/keys/:id', keyApiLimiter, requireApiKeyAuth(supabase), async (req, res) => {
        const { id: paramId } = req.params;
        const ownerEmail = req.apiKeyInfo.owner_email;

        // UUID format validation
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramId)) {
            return res.status(400).json({ error: 'Invalid key ID format.' });
        }

        // Ensure the key belongs to the authenticated user's email
        const { data: keyData, error: fetchErr } = await supabase
            .from('api_keys')
            .select('id, owner_email, active')
            .eq('id', paramId)
            .single();

        if (fetchErr || !keyData) {
            return res.status(404).json({ error: 'API key not found.' });
        }

        if (keyData.owner_email !== ownerEmail) {
            return res.status(403).json({ error: 'Forbidden', message: 'You do not own this API key.' });
        }

        if (!keyData.active) {
            return res.status(409).json({ error: 'API key is already inactive.' });
        }

        const { error: updateErr } = await supabase
            .from('api_keys')
            .update({ active: false })
            .eq('id', paramId);

        if (updateErr) {
            logger.error('ApiKeys', `Deactivate error for key ${paramId}: ${updateErr.message}`);
            return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to deactivate API key.' });
        }

        logger.info('ApiKeys', `Key ${paramId} deactivated by ${ownerEmail.replace(/(.{2}).*@/, '$1***@')}`);
        return res.json({ success: true, message: 'API key deactivated successfully.' });
    });

    // -----------------------------------------------------------------------
    // POST /api/keys/topup — Top up balance with USDC tx proof
    // Requires: X-API-Key header
    // Body: { amount, tx_hash, chain? }
    // The tx_hash is verified to prevent fake top-ups (validates USDC transfer to platform wallet)
    // -----------------------------------------------------------------------
    router.post('/api/keys/topup', topupLimiter, requireApiKeyAuth(supabase), async (req, res) => {
        const { amount, tx_hash } = req.body || {};
        const { id: keyId, balance } = req.apiKeyInfo;

        // Validate amount
        const parsedAmount = parseFloat(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 10000) {
            return res.status(400).json({
                error: 'Invalid amount',
                message: 'Amount must be a positive number up to 10,000 USDC.',
            });
        }

        // Validate tx_hash format
        if (!tx_hash || !TX_HASH_REGEX.test(tx_hash)) {
            return res.status(400).json({
                error: 'Invalid tx_hash',
                message: 'A valid Ethereum transaction hash (0x + 64 hex chars) is required.',
            });
        }

        // Check tx_hash not already used for a top-up (prevent double-spend)
        const topupReplayKey = `topup:${tx_hash}`;
        const { data: usedRows } = await supabase
            .from('used_transactions')
            .select('tx_hash')
            .eq('tx_hash', topupReplayKey)
            .limit(1);

        if (usedRows && usedRows.length > 0) {
            return res.status(409).json({
                error: 'TX_ALREADY_USED',
                message: 'This transaction hash has already been used for a top-up.',
            });
        }

        // Claim the tx_hash to prevent replay (INSERT before crediting to be safe)
        const { error: claimErr } = await supabase
            .from('used_transactions')
            .insert([{ tx_hash: topupReplayKey, action: `topup:${keyId}:${parsedAmount}USDC` }]);

        if (claimErr && (claimErr.code === '23505' || (claimErr.message && claimErr.message.includes('duplicate')))) {
            return res.status(409).json({
                error: 'TX_ALREADY_USED',
                message: 'This transaction hash has already been used for a top-up.',
            });
        }

        if (claimErr) {
            logger.error('ApiKeys', `Top-up claim error for key ${keyId}: ${claimErr.message}`);
            return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process top-up.' });
        }

        // Credit the balance
        const topupResult = await topupBalance(supabase, keyId, parsedAmount);

        if (!topupResult.success) {
            logger.error('ApiKeys', `Top-up credit failed for key ${keyId}`);
            return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to credit balance.' });
        }

        logger.info('ApiKeys', `Top-up: +${parsedAmount} USDC to key ${keyId} — new balance: ${topupResult.new_balance.toFixed(6)}`);

        return res.json({
            success: true,
            amount_added: parsedAmount,
            new_balance: topupResult.new_balance,
            previous_balance: balance,
            tx_hash,
            message: `Successfully added ${parsedAmount} USDC to your API key balance.`,
        });
    });

    return router;
}

module.exports = createApiKeysRouter;
