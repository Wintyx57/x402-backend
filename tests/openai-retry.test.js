// tests/openai-retry.test.js — Unit tests for lib/openai-retry.js
// Covers: isRetryable() for all known error shapes (OpenAI, Gemini, HTTP status),
// openaiRetry() retry behavior: immediate throw on non-retryable, backoff + retry on
// retryable, exhausting all attempts, and successful first-call path.
// No actual LLM API calls are made — all functions are stubs.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isRetryable, openaiRetry } = require('../lib/openai-retry');

// ---------------------------------------------------------------------------
// Suite 1: isRetryable() — all error shape variants
// ---------------------------------------------------------------------------

describe('isRetryable — HTTP status codes', () => {
    it('should retry on HTTP 429 (rate limit)', () => {
        assert.strictEqual(isRetryable({ status: 429 }), true);
    });

    it('should retry on HTTP 500 (server error)', () => {
        assert.strictEqual(isRetryable({ status: 500 }), true);
    });

    it('should retry on HTTP 502 (bad gateway)', () => {
        assert.strictEqual(isRetryable({ status: 502 }), true);
    });

    it('should retry on HTTP 503 (service unavailable)', () => {
        assert.strictEqual(isRetryable({ status: 503 }), true);
    });

    it('should retry on HTTP 599 (max 5xx)', () => {
        assert.strictEqual(isRetryable({ status: 599 }), true);
    });

    it('should NOT retry on HTTP 400 (bad request)', () => {
        assert.strictEqual(isRetryable({ status: 400 }), false);
    });

    it('should NOT retry on HTTP 401 (unauthorized)', () => {
        assert.strictEqual(isRetryable({ status: 401 }), false);
    });

    it('should NOT retry on HTTP 403 (forbidden)', () => {
        assert.strictEqual(isRetryable({ status: 403 }), false);
    });

    it('should NOT retry on HTTP 404 (not found)', () => {
        assert.strictEqual(isRetryable({ status: 404 }), false);
    });

    it('should NOT retry on HTTP 422 (validation error / content policy)', () => {
        assert.strictEqual(isRetryable({ status: 422 }), false);
    });
});

describe('isRetryable — statusCode variant (alternative error shape)', () => {
    it('should retry on statusCode 429', () => {
        assert.strictEqual(isRetryable({ statusCode: 429 }), true);
    });

    it('should retry on statusCode 503', () => {
        assert.strictEqual(isRetryable({ statusCode: 503 }), true);
    });

    it('should NOT retry on statusCode 400', () => {
        assert.strictEqual(isRetryable({ statusCode: 400 }), false);
    });
});

describe('isRetryable — response.status variant (axios/fetch-like)', () => {
    it('should retry on response.status 429', () => {
        assert.strictEqual(isRetryable({ response: { status: 429 } }), true);
    });

    it('should retry on response.status 500', () => {
        assert.strictEqual(isRetryable({ response: { status: 500 } }), true);
    });

    it('should NOT retry on response.status 403', () => {
        assert.strictEqual(isRetryable({ response: { status: 403 } }), false);
    });
});

describe('isRetryable — OpenAI SDK error codes', () => {
    it('should retry on code "rate_limit_exceeded"', () => {
        assert.strictEqual(isRetryable({ code: 'rate_limit_exceeded' }), true);
    });

    it('should retry on type "server_error"', () => {
        assert.strictEqual(isRetryable({ type: 'server_error' }), true);
    });

    it('should NOT retry on code "invalid_api_key"', () => {
        assert.strictEqual(isRetryable({ code: 'invalid_api_key' }), false);
    });

    it('should NOT retry on type "invalid_request_error"', () => {
        assert.strictEqual(isRetryable({ type: 'invalid_request_error' }), false);
    });
});

describe('isRetryable — Gemini SDK error messages', () => {
    it('should retry on RESOURCE_EXHAUSTED in message', () => {
        assert.strictEqual(
            isRetryable({ message: 'GoogleGenerativeAIError: RESOURCE_EXHAUSTED quota exceeded' }),
            true
        );
    });

    it('should retry when message includes "503"', () => {
        assert.strictEqual(isRetryable({ message: 'Service returned 503' }), true);
    });

    it('should retry when message includes "500"', () => {
        assert.strictEqual(isRetryable({ message: 'Internal error: 500' }), true);
    });

    it('should NOT retry on non-retryable Gemini message', () => {
        assert.strictEqual(isRetryable({ message: 'Invalid API key' }), false);
    });

    it('should NOT retry on content policy violation message', () => {
        assert.strictEqual(isRetryable({ message: 'HARM_CATEGORY_DANGEROUS_CONTENT' }), false);
    });
});

describe('isRetryable — edge cases', () => {
    it('should return false for empty error object', () => {
        assert.strictEqual(isRetryable({}), false);
    });

    it('should return false for error with no status', () => {
        assert.strictEqual(isRetryable({ message: 'Unknown error' }), false);
    });

    it('should throw TypeError for null (known missing guard in production code)', () => {
        // BUG: isRetryable() does not guard against null/undefined.
        // Line 17: `err.status` crashes when err is null.
        // This test documents the current behavior. The fix is: `const status = err?.status || ...`
        assert.throws(
            () => isRetryable(null),
            { name: 'TypeError' }
        );
    });

    it('should throw TypeError for undefined (known missing guard in production code)', () => {
        // Same bug as null — no optional chaining on the first access.
        assert.throws(
            () => isRetryable(undefined),
            { name: 'TypeError' }
        );
    });

    it('should handle httpStatusCode variant', () => {
        // Some SDKs use httpStatusCode
        const err = { httpStatusCode: 429 };
        // isRetryable checks: err.status || err.statusCode || err?.response?.status || err?.httpStatusCode
        assert.strictEqual(isRetryable(err), true);
    });
});

// ---------------------------------------------------------------------------
// Suite 2: openaiRetry() — behavioral contract
// ---------------------------------------------------------------------------

describe('openaiRetry — successful first call', () => {
    it('should return result immediately on success', async () => {
        const expected = { choices: [{ text: 'Hello' }] };
        const fn = async () => expected;

        const result = await openaiRetry(fn, 'TestSuccess');
        assert.strictEqual(result, expected);
    });

    it('should not retry when first call succeeds', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            return { result: 'ok' };
        };

        await openaiRetry(fn, 'NoRetry');
        assert.strictEqual(callCount, 1, 'Should be called exactly once on success');
    });
});

describe('openaiRetry — non-retryable error throws immediately', () => {
    it('should throw on first 400 error without retrying', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            const err = new Error('Bad request');
            err.status = 400;
            throw err;
        };

        await assert.rejects(
            () => openaiRetry(fn, 'NoRetry400'),
            (err) => {
                assert.strictEqual(err.status, 400);
                return true;
            }
        );
        // Should have been called only once (no retry for 400)
        assert.strictEqual(callCount, 1);
    });

    it('should throw on 401 without retrying', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            const err = new Error('Unauthorized');
            err.status = 401;
            throw err;
        };

        await assert.rejects(() => openaiRetry(fn, 'NoRetry401'));
        assert.strictEqual(callCount, 1);
    });

    it('should propagate the original error on non-retryable', async () => {
        const originalError = new Error('Content policy violation');
        originalError.status = 403;

        await assert.rejects(
            () => openaiRetry(async () => { throw originalError; }),
            (err) => {
                assert.strictEqual(err, originalError);
                return true;
            }
        );
    });
});

describe('openaiRetry — retryable error is retried then succeeds', () => {
    it('should succeed on second attempt after initial 429', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            if (callCount === 1) {
                const err = new Error('Rate limited');
                err.status = 429;
                throw err;
            }
            return { result: 'success on retry' };
        };

        // Note: openaiRetry has backoff delays (1s for attempt 0). To avoid
        // test taking 1+ seconds, we test with a function that only fails once.
        // In CI this is acceptable. For speed we verify the retry happened.
        const result = await openaiRetry(fn, 'RetryOnce');
        assert.ok(result.result === 'success on retry');
        assert.strictEqual(callCount, 2);
    }, { timeout: 5000 }); // allow up to 5s for the 1s backoff

    it('should retry on RESOURCE_EXHAUSTED Gemini error', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            if (callCount < 2) {
                const err = new Error('RESOURCE_EXHAUSTED: quota exceeded');
                throw err;
            }
            return 'ok';
        };

        const result = await openaiRetry(fn, 'GeminiRetry');
        assert.strictEqual(result, 'ok');
        assert.strictEqual(callCount, 2);
    }, { timeout: 5000 });
});

describe('openaiRetry — exhausting all retries throws last error', () => {
    it('should throw last error after all 3 attempts fail with 429', async () => {
        let callCount = 0;
        const lastErr = new Error('Rate limited forever');
        lastErr.status = 429;

        const fn = async () => {
            callCount++;
            throw lastErr;
        };

        await assert.rejects(
            () => openaiRetry(fn, 'Exhaust429'),
            (err) => {
                assert.strictEqual(err, lastErr);
                return true;
            }
        );
        assert.strictEqual(callCount, 3, 'Should have been called exactly MAX_RETRIES=3 times');
    }, { timeout: 15000 }); // 1s + 3s backoff = up to 4s for 3 attempts
});

describe('openaiRetry — label appears in behavior (no throw on label variation)', () => {
    it('should work without a label (uses default "LLM")', async () => {
        const result = await openaiRetry(async () => 'response');
        assert.strictEqual(result, 'response');
    });

    it('should work with a custom label', async () => {
        const result = await openaiRetry(async () => ({ data: 42 }), 'MyCustomLabel');
        assert.strictEqual(result.data, 42);
    });
});
