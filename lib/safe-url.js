// lib/safe-url.js — Shared SSRF protection utility
// Used by: routes/wrappers/intelligence.js, routes/wrappers/web.js, routes/wrappers/ai.js

const dns = require('node:dns');

const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\]|\[::ffff:)/i;
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/;

/**
 * Validates a URL against SSRF attacks.
 * - Rejects non-HTTP(S) protocols
 * - Blocks internal/private hostnames by name
 * - Resolves the hostname and blocks private IP addresses (DNS rebinding protection)
 *
 * @param {string} rawUrl - The URL to validate
 * @returns {Promise<URL>} The parsed URL if safe
 * @throws {Error} If the URL is invalid or resolves to an internal address
 */
async function safeUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS URLs allowed');
    } catch (e) {
        throw new Error(e.message.includes('Only') ? e.message : 'Invalid URL format');
    }
    if (BLOCKED_HOST.test(parsed.hostname)) throw new Error('Internal URLs not allowed');
    try {
        const { address } = await dns.promises.lookup(parsed.hostname);
        if (PRIVATE_IP.test(address)) {
            throw new Error('Internal IPs not allowed');
        }
    } catch (e) {
        if (e.message.includes('Internal')) throw e;
        throw new Error('Could not resolve hostname');
    }
    return parsed;
}

module.exports = { safeUrl };
