// lib/credentialValidator.js — Pre-validate provider credentials against upstream before registration
const logger = require('./logger');
const { injectCredentials } = require('./credentials');
const { safeUrl } = require('./safe-url');
const { normalize402 } = require('./protocolAdapter');

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Validate credentials by pinging the upstream service.
 *
 * @param {string} upstreamUrl - The upstream service URL to test
 * @param {object|null|undefined} rawCredentials - Parsed credentials { type, credentials: [{ key, value, location? }] }
 * @param {object} [options]
 * @param {boolean} [options.skipSsrf] - Skip SSRF check (for testing with localhost)
 * @param {number}  [options.timeoutMs] - Custom timeout in ms (default 10s)
 * @returns {Promise<{ valid: boolean, warning?: string, error?: string }>}
 */
async function validateCredentials(upstreamUrl, rawCredentials, options = {}) {
    // No credentials → nothing to validate
    if (!rawCredentials || !rawCredentials.type || !rawCredentials.credentials?.length) {
        return { valid: true };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Build the request with injected credentials (may mutate URL for query params)
    const headers = { 'User-Agent': 'x402-bazaar/credential-validator' };
    const { headers: injectedHeaders, url: injectedUrl } = injectCredentials(headers, upstreamUrl, rawCredentials);

    // SSRF protection — check the FINAL URL (after credential injection, query params may change it)
    if (!options.skipSsrf) {
        try {
            await safeUrl(injectedUrl);
        } catch (err) {
            return { valid: false, error: `URL blocked by security policy: ${err.message}` };
        }
    }

    // Try HEAD first, fall back to GET if 405
    // Use redirect:'manual' to prevent credential leakage to redirect targets and SSRF-via-open-redirect
    const result = await pingUpstream(injectedUrl, injectedHeaders, 'HEAD', timeoutMs);

    if (result.status === 405 || result.status === 402) {
        // HEAD not allowed (405) or 402 with no body — retry with GET to get full response
        const getResult = await pingUpstream(injectedUrl, injectedHeaders, 'GET', timeoutMs);
        const getInterpreted = interpretResponse(getResult);

        if (getInterpreted.is402 && getResult.headers402) {
            const normalized = normalize402(402, getResult.headers402, getResult.body402 || {});
            getInterpreted.detectedProtocol = normalized.format;
        }

        return getInterpreted;
    }

    const interpreted = interpretResponse(result);

    return interpreted;
}

/**
 * Send a test HTTP request to the upstream.
 * Uses redirect:'manual' to avoid leaking credentials to redirect targets.
 * @returns {Promise<{ status: number|null, error?: string }>}
 */
async function pingUpstream(url, headers, method, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method,
            headers,
            signal: controller.signal,
            redirect: 'manual',
        });
        clearTimeout(timer);

        if (res.status === 402) {
            let body402 = {};
            try { body402 = await res.json(); } catch { }
            let headers402 = {};
            try { headers402 = Object.fromEntries(res.headers); } catch { }
            return { status: res.status, headers402, body402 };
        }

        return { status: res.status };
    } catch (err) {
        clearTimeout(timer);
        const msg = err.name === 'AbortError' ? 'timeout' : err.message;
        return { status: null, error: msg };
    }
}

/**
 * Interpret the HTTP response from upstream.
 * @param {{ status: number|null, error?: string }} result
 * @returns {{ valid: boolean, warning?: string, error?: string }}
 */
function interpretResponse(result) {
    // Network/timeout error
    if (result.status === null) {
        logger.warn('CredentialValidator', `Upstream unreachable: ${result.error}`);
        return {
            valid: true,
            warning: `Upstream unreachable (${result.error}) — credentials not verified`,
        };
    }

    const status = result.status;

    // Explicit auth rejection
    if (status === 401 || status === 403) {
        return {
            valid: false,
            error: `Upstream rejected credentials (HTTP ${status}). Please check your API credentials.`,
        };
    }

    // Success
    if (status >= 200 && status < 300) {
        return { valid: true };
    }

    // Redirects (3xx) — not auth rejection, but we don't follow to avoid credential leakage
    if (status >= 300 && status < 400) {
        return {
            valid: true,
            warning: `Upstream returned redirect (${status}) — credentials not verified`,
        };
    }

    // URL issue but not auth rejection
    if (status === 404) {
        return {
            valid: true,
            warning: `URL returned 404 but credentials were not rejected`,
        };
    }

    // Server error — service may be temporarily down
    if (status >= 500) {
        return {
            valid: true,
            warning: `Upstream returned ${status} — credentials not verified`,
        };
    }

    // Payment required — this is a paid API, valid upstream
    if (status === 402) {
        return { valid: true, warning: 'Upstream requires payment (HTTP 402) — this is a paid API', is402: true };
    }

    // Other 4xx (400, 429, etc.) — not auth-related, accept with warning
    return {
        valid: true,
        warning: `Upstream returned ${status} — credentials not verified`,
    };
}

module.exports = { validateCredentials };
