// lib/openai-retry.js — Retry wrapper for LLM API calls with exponential backoff
// Retries on 429 (rate limit) and 5xx (server errors) — max 3 attempts, 1s/3s/9s backoff
// Works with both OpenAI and Google Gemini error shapes.

const logger = require('./logger');

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 3s, 9s (base * 3^attempt)
const BACKOFF_MULTIPLIER = 3;

/**
 * Determines if an LLM API error is retryable (429 rate limit or 5xx server error).
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryable(err) {
    const status = err.status || err.statusCode || err?.response?.status || err?.httpStatusCode;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    // OpenAI SDK error shapes
    if (err.code === 'rate_limit_exceeded') return true;
    if (err.type === 'server_error') return true;
    // Gemini SDK: GoogleGenerativeAIError with RESOURCE_EXHAUSTED
    if (err.message?.includes('RESOURCE_EXHAUSTED')) return true;
    if (err.message?.includes('503') || err.message?.includes('500')) return true;
    return false;
}

/**
 * Executes an async LLM call with retry + exponential backoff.
 *
 * Usage:
 *   const response = await openaiRetry(() => model.generateContent({...}));
 *
 * @param {Function} fn  — async function that performs the LLM call
 * @param {string} [label]  — optional label for log messages (e.g. 'Sentiment API')
 * @returns {Promise<*>} — the result from the API
 * @throws {Error} — the last error if all retries are exhausted
 */
async function openaiRetry(fn, label = 'LLM') {
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
                logger.warn('LLM', `[${label}] API call failed (status=${status}), retry ${attempt + 1}/${MAX_RETRIES - 1} in ${delayMs / 1000}s`);
                await sleep(delayMs);
            }
        }
    }

    // All retries exhausted
    const status = lastError.status || lastError.statusCode || 'unknown';
    logger.error('LLM', `[${label}] API call failed after ${MAX_RETRIES} attempts (last status=${status}): ${lastError.message}`);
    throw lastError;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { openaiRetry, isRetryable };
