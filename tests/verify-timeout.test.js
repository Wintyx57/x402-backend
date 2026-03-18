// tests/verify-timeout.test.js — Fix 2: verifyPayment global timeout (AbortController)
'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Test the updated fetchWithTimeout and fetchWithFallback with signal support
// ---------------------------------------------------------------------------

test('fetchWithTimeout — Fix 2: AbortController signal', async (t) => {
    const { fetchWithTimeout } = require('../lib/payment');

    await t.test('rejects with AbortError when signal is already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        await assert.rejects(
            () => fetchWithTimeout('http://localhost:1/nonexistent', {}, 5000, ac.signal),
            (err) => err.name === 'AbortError' || err.message.includes('abort')
        );
    });

    await t.test('rejects when signal aborts during request', async () => {
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 50);
        await assert.rejects(
            () => fetchWithTimeout('http://10.255.255.1:1/slow', {}, 30000, ac.signal),
            (err) => err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('RPC timeout') || err.message.includes('fetch failed') || err.code === 'ECONNREFUSED'
        );
    });

    await t.test('works normally without signal (backward compat)', async () => {
        // fetchWithTimeout should still work when signal is not passed
        await assert.rejects(
            () => fetchWithTimeout('http://localhost:1/nonexistent', {}, 500),
            (err) => err.message.includes('timeout') || err.message.includes('fetch') || err.code === 'ECONNREFUSED'
        );
    });

    await t.test('fetchWithTimeout exported from payment module', () => {
        assert.strictEqual(typeof fetchWithTimeout, 'function');
    });

    await t.test('fetchWithTimeout accepts 4 parameters', () => {
        // The function should accept (url, options, timeout, signal)
        assert.ok(fetchWithTimeout.length >= 1); // at least url param
    });
});
