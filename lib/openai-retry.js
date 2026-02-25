// lib/openai-retry.js — Retry wrapper for OpenAI API calls with exponential backoff
// Retries on 429 (rate limit) and 5xx (server errors) — max 3 attempts, 1s/3s/9s backoff

const logger = require('./logger');

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 3s, 9s (base * 3^attempt)
const BACKOFF_MULTIPLIER = 3;

/**
 * Determines if an OpenAI error is retryable (429 rate limit or 5xx server error).
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryable(err) {
    const status = err.status || err.statusCode || err?.response?.status;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    // OpenAI SDK may throw with error.code or error.type
    if (err.code === 'rate_limit_exceeded') return true;
    if (err.type === 'server_error') return true;
    return false;
}

/**
 * Executes an async OpenAI call with retry + exponential backoff.
 *
 * Usage (drop-in replacement):
 *   // Before:  const response = await getOpenAI().chat.completions.create({...});
 *   // After:   const response = await openaiRetry(() => getOpenAI().chat.completions.create({...}));
 *
 * @param {Function} fn  — async function that performs the OpenAI call
 * @param {string} [label]  — optional label for log messages (e.g. 'Sentiment API')
 * @returns {Promise<*>} — the result from the OpenAI API
 * @throws {Error} — the last error if all retries are exhausted
 */
async function openaiRetry(fn, label = 'OpenAI') {
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (!isRetryable(err)) {
                throw err; // non-retryable → throw immediately (e.g. 400, 401, content policy)
            }

            if (attempt < MAX_RETRIES - 1) {
                const delayMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt); // 1s, 3s, 9s
                const status = err.status || err.statusCode || 'unknown';
                logger.warn(`[${label}] OpenAI call failed (status=${status}), retry ${attempt + 1}/${MAX_RETRIES - 1} in ${delayMs / 1000}s`);
                await sleep(delayMs);
            }
        }
    }

    // All retries exhausted
    const status = lastError.status || lastError.statusCode || 'unknown';
    logger.error(`[${label}] OpenAI call failed after ${MAX_RETRIES} attempts (last status=${status}): ${lastError.message}`);
    throw lastError;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { openaiRetry, isRetryable };
