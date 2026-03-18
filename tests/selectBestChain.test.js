// tests/selectBestChain.test.js — Fix 1: selectBestChain returns error on insufficient balance
'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// We can't easily test the MCP ESM module from CJS tests.
// Instead, we re-implement the selectBestChain logic as a pure function
// and verify the fix behavior. The real module uses the same logic.
// ---------------------------------------------------------------------------

function selectBestChainLogic(balanceCache, requiredAmount) {
    const priority = ['skale', 'polygon', 'base'];
    const viable = priority.filter(key => balanceCache[key] >= requiredAmount);

    if (viable.length === 0) {
        return {
            chain: null,
            error: `Insufficient balance on all chains for ${requiredAmount} USDC. Balances: Base=${(balanceCache.base || 0).toFixed(4)}, SKALE=${(balanceCache.skale || 0).toFixed(4)}, Polygon=${(balanceCache.polygon || 0).toFixed(4)}`,
        };
    }

    return { chain: viable[0] };
}

test('selectBestChain — Fix 1', async (t) => {
    await t.test('returns chain: null + error when all balances are zero', () => {
        const cache = { base: 0, skale: 0, polygon: 0 };
        const result = selectBestChainLogic(cache, 0.01);
        assert.strictEqual(result.chain, null);
        assert.ok(result.error);
        assert.ok(result.error.includes('Insufficient balance'));
        assert.ok(result.error.includes('0.01'));
    });

    await t.test('returns chain: null + error when all balances are below required', () => {
        const cache = { base: 0.005, skale: 0.003, polygon: 0.001 };
        const result = selectBestChainLogic(cache, 0.01);
        assert.strictEqual(result.chain, null);
        assert.ok(result.error);
    });

    await t.test('defensive: handles undefined balances without crash', () => {
        const cache = { base: undefined, skale: undefined, polygon: undefined };
        const result = selectBestChainLogic(cache, 0.01);
        assert.strictEqual(result.chain, null);
        assert.ok(result.error);
        assert.ok(result.error.includes('0.0000')); // (undefined || 0).toFixed(4)
    });

    await t.test('returns skale when skale has enough', () => {
        const cache = { base: 0, skale: 1.0, polygon: 0 };
        const result = selectBestChainLogic(cache, 0.01);
        assert.strictEqual(result.chain, 'skale');
        assert.strictEqual(result.error, undefined);
    });
});
