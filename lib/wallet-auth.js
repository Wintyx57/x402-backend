// lib/wallet-auth.js — Middleware for wallet signature verification
// Reuses the viem verifyMessage pattern from routes/rgpd.js

const { verifyMessage } = require('viem');
const logger = require('./logger');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Express middleware factory that verifies an EIP-191 signed message.
 *
 * Expected headers:
 *   x-wallet-address   — 0x... (40 hex chars)
 *   x-wallet-message   — x402-bazaar:<action>:<resourceId>:<timestamp_ms>
 *   x-wallet-signature — 0x... (EIP-191 signature)
 *
 * On success sets req.verifiedWallet (lowercased) and calls next().
 * On failure returns 401 JSON.
 *
 * @param {string} action — Expected action segment in the message (e.g. 'update-service')
 * @returns {import('express').RequestHandler}
 */
function walletAuth(action) {
    return async (req, res, next) => {
        const message = req.headers['x-wallet-message'];
        const signature = req.headers['x-wallet-signature'];
        const wallet = req.headers['x-wallet-address'];

        if (!wallet || !WALLET_REGEX.test(wallet)) {
            return res.status(401).json({ error: 'Missing or invalid X-Wallet-Address header' });
        }
        if (!message || !signature) {
            return res.status(401).json({ error: 'Missing X-Wallet-Message or X-Wallet-Signature headers' });
        }

        // Validate timestamp from message (last segment after last colon)
        const parts = message.split(':');
        const ts = Number(parts[parts.length - 1]);
        if (!Number.isFinite(ts) || ts <= 0 || (Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
            return res.status(401).json({ error: 'Message expired or invalid timestamp. Sign a new message.' });
        }

        // Verify signature
        let valid = false;
        try {
            valid = await verifyMessage({
                address: /** @type {`0x${string}`} */ (wallet),
                message,
                signature: /** @type {`0x${string}`} */ (signature),
            });
        } catch (err) {
            logger.warn('WalletAuth', `verifyMessage threw: ${err.message}`);
            valid = false;
        }

        if (!valid) {
            return res.status(401).json({ error: 'Signature verification failed.' });
        }

        req.verifiedWallet = wallet.toLowerCase();
        next();
    };
}

module.exports = { walletAuth };
