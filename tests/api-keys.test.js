// tests/api-keys.test.js — Unit tests for API Key management feature
// Tests: lib/api-key-manager.js + routes/api-keys.js

'use strict';

const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ============================================================
// lib/api-key-manager.js unit tests
// ============================================================
const {
    generateApiKey,
    hashApiKey,
    getKeyPrefix,
    validateApiKey,
    deductBalance,
    createApiKey,
    topupBalance,
} = require('../lib/api-key-manager');

describe('generateApiKey', () => {
    test('produces keys with sk_live_ prefix', () => {
        const key = generateApiKey();
        assert.ok(key.startsWith('sk_live_'), `Expected sk_live_ prefix, got: ${key}`);
    });

    test('produces keys of expected length (8 + 32 = 40 chars)', () => {
        const key = generateApiKey();
        // 'sk_live_' = 8 chars, 16 random bytes hex = 32 chars → total 40
        assert.strictEqual(key.length, 40);
    });

    test('produces unique keys each call', () => {
        const keys = new Set();
        for (let i = 0; i < 20; i++) keys.add(generateApiKey());
        assert.strictEqual(keys.size, 20, 'All generated keys should be unique');
    });
});

describe('hashApiKey', () => {
    test('returns a 64-char hex string', () => {
        const hash = hashApiKey('sk_live_abc123');
        assert.match(hash, /^[a-f0-9]{64}$/);
    });

    test('is deterministic (same input → same hash)', () => {
        const key = 'sk_live_test_key_deterministic';
        assert.strictEqual(hashApiKey(key), hashApiKey(key));
    });

    test('different keys produce different hashes', () => {
        const h1 = hashApiKey('sk_live_aaaa');
        const h2 = hashApiKey('sk_live_bbbb');
        assert.notStrictEqual(h1, h2);
    });
});

describe('getKeyPrefix', () => {
    test('returns first 12 chars', () => {
        const key = 'sk_live_abcdef1234567890';
        assert.strictEqual(getKeyPrefix(key), 'sk_live_abcd');
    });
});

// ============================================================
// validateApiKey — mocked Supabase
// ============================================================
describe('validateApiKey', () => {
    function makeSupabase(data, error = null) {
        return {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            single: async () => ({ data, error }),
                        }),
                    }),
                }),
            }),
        };
    }

    test('returns valid=true with correct data when key is found', async () => {
        const supabase = makeSupabase({
            id: 'uuid-1',
            balance_usdc: '5.000000',
            owner_email: 'test@example.com',
            label: 'Production',
            active: true,
            key_prefix: 'sk_live_abcd',
        });
        const result = await validateApiKey(supabase, 'fakehash');
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.balance, 5.0);
        assert.strictEqual(result.owner_email, 'test@example.com');
    });

    test('returns valid=false when key not found', async () => {
        const supabase = makeSupabase(null, { message: 'not found' });
        const result = await validateApiKey(supabase, 'fakehash');
        assert.strictEqual(result.valid, false);
    });

    test('returns valid=false on DB error', async () => {
        const supabase = makeSupabase(null, { message: 'connection refused' });
        const result = await validateApiKey(supabase, 'fakehash');
        assert.strictEqual(result.valid, false);
    });
});

// ============================================================
// deductBalance — mocked Supabase
// ============================================================
describe('deductBalance', () => {
    function makeSupabaseForDeduct(currentBalance, updateError = null) {
        return {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: 'uuid-1',
                                    balance_usdc: String(currentBalance),
                                    total_spent: '0',
                                    call_count: 0,
                                },
                                error: null,
                            }),
                        }),
                    }),
                }),
                update: () => ({
                    eq: () => ({
                        gte: async () => ({ error: updateError }),
                    }),
                }),
            }),
        };
    }

    test('returns success=true when balance is sufficient', async () => {
        const supabase = makeSupabaseForDeduct(1.0);
        const result = await deductBalance(supabase, 'fakehash', 0.01);
        assert.strictEqual(result.success, true);
        assert.ok(result.remaining_balance >= 0, 'Remaining balance should be non-negative');
    });

    test('returns success=false when balance is insufficient', async () => {
        const supabase = makeSupabaseForDeduct(0.005);
        const result = await deductBalance(supabase, 'fakehash', 0.01);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.remaining_balance, 0.005);
    });

    test('returns success=false when key not found', async () => {
        const supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            single: async () => ({ data: null, error: { message: 'not found' } }),
                        }),
                    }),
                }),
            }),
        };
        const result = await deductBalance(supabase, 'fakehash', 0.01);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.remaining_balance, 0);
    });

    test('returns correct remaining after deduction', async () => {
        const supabase = makeSupabaseForDeduct(0.5);
        const result = await deductBalance(supabase, 'fakehash', 0.1);
        assert.strictEqual(result.success, true);
        // 0.5 - 0.1 = 0.4
        assert.ok(Math.abs(result.remaining_balance - 0.4) < 0.000001);
    });
});

// ============================================================
// createApiKey — mocked Supabase
// ============================================================
describe('createApiKey', () => {
    function makeSupabaseForCreate(insertError = null) {
        return {
            from: () => ({
                insert: () => ({
                    select: () => ({
                        single: async () => ({
                            data: insertError ? null : { id: 'new-uuid-123' },
                            error: insertError,
                        }),
                    }),
                }),
            }),
        };
    }

    test('returns key, id, prefix on success', async () => {
        const supabase = makeSupabaseForCreate();
        const result = await createApiKey(supabase, 'user@example.com', 'My Key');
        assert.ok(result !== null);
        assert.ok(result.key.startsWith('sk_live_'));
        assert.strictEqual(result.id, 'new-uuid-123');
        assert.ok(result.prefix.startsWith('sk_live_'));
    });

    test('returns null on DB error', async () => {
        const supabase = makeSupabaseForCreate({ message: 'DB error' });
        const result = await createApiKey(supabase, 'user@example.com', 'My Key');
        assert.strictEqual(result, null);
    });
});

// ============================================================
// topupBalance — mocked Supabase
// ============================================================
describe('topupBalance', () => {
    function makeSupabaseForTopup(currentBalance, updateError = null) {
        return {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: { balance_usdc: String(currentBalance) },
                            error: null,
                        }),
                    }),
                }),
                update: () => ({
                    eq: async () => ({ error: updateError }),
                }),
            }),
        };
    }

    test('returns correct new balance after top-up', async () => {
        const supabase = makeSupabaseForTopup(1.0);
        const result = await topupBalance(supabase, 'uuid-1', 5.0);
        assert.strictEqual(result.success, true);
        assert.ok(Math.abs(result.new_balance - 6.0) < 0.000001);
    });

    test('returns success=false on update error', async () => {
        const supabase = makeSupabaseForTopup(1.0, { message: 'update failed' });
        const result = await topupBalance(supabase, 'uuid-1', 5.0);
        assert.strictEqual(result.success, false);
    });
});

// ============================================================
// routes/api-keys.js — HTTP integration tests (mocked Supabase)
// ============================================================
describe('POST /api/keys', () => {
    // We test the route logic via direct handler invocation to avoid spinning up a full server
    // (consistent with the pattern used in other test files in this project).

    function makeReq(body = {}) {
        return { body, headers: {}, ip: '127.0.0.1' };
    }

    function makeRes() {
        const res = {
            _status: 200,
            _body: null,
            status(code) { this._status = code; return this; },
            json(body) { this._body = body; return this; },
        };
        return res;
    }

    test('rejects missing email with 400', async () => {
        // Import the route factory and instantiate with a mock supabase
        const createApiKeysRouter = require('../routes/api-keys');

        // Minimal mock supabase (shouldn't be called for validation failure)
        const mockSupabase = {};

        // We call the route handler indirectly by constructing a minimal Express app
        // and using supertest-style assertion via direct handler test
        const req = makeReq({ label: 'Test' });
        const res = makeRes();

        // Get the router and find the POST /api/keys route handler
        const router = createApiKeysRouter(mockSupabase);

        // Find the layer matching POST /api/keys
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys' && l.route.methods.post);
        assert.ok(layer, 'POST /api/keys route should exist');

        // Extract the final handler (last in the stack, after rate limiter)
        const handlers = layer.route.stack;
        const finalHandler = handlers[handlers.length - 1].handle;

        // Call the handler directly (bypassing rate limiter for tests)
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 400);
        assert.match(res._body.error, /email/i);
    });

    test('rejects invalid email with 400', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const router = createApiKeysRouter({});
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys' && l.route.methods.post);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq({ email: 'not-an-email', label: 'Test' });
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 400);
    });

    test('returns 201 with key on success', async () => {
        const createApiKeysRouter = require('../routes/api-keys');

        const mockSupabase = {
            from: () => ({
                insert: () => ({
                    select: () => ({
                        single: async () => ({ data: { id: 'new-uuid' }, error: null }),
                    }),
                }),
            }),
        };

        const router = createApiKeysRouter(mockSupabase);
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys' && l.route.methods.post);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq({ email: 'user@example.com', label: 'Prod' });
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 201);
        assert.ok(res._body.key.startsWith('sk_live_'));
        assert.strictEqual(res._body.id, 'new-uuid');
    });

    test('returns 500 on DB error', async () => {
        const createApiKeysRouter = require('../routes/api-keys');

        const mockSupabase = {
            from: () => ({
                insert: () => ({
                    select: () => ({
                        single: async () => ({ data: null, error: { message: 'DB connection failed' } }),
                    }),
                }),
            }),
        };

        const router = createApiKeysRouter(mockSupabase);
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys' && l.route.methods.post);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq({ email: 'user@example.com', label: 'Test' });
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 500);
    });
});

describe('GET /api/keys/balance', () => {
    function makeReq(apiKeyInfo) {
        return { body: {}, headers: {}, ip: '127.0.0.1', apiKeyInfo };
    }

    function makeRes() {
        const res = {
            _status: 200,
            _body: null,
            status(code) { this._status = code; return this; },
            json(body) { this._body = body; return this; },
        };
        return res;
    }

    test('returns balance info for authenticated key', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const router = createApiKeysRouter({});

        // Find GET /api/keys/balance — it's a specific route before /api/keys (GET)
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/balance' && l.route.methods.get);
        assert.ok(layer, 'GET /api/keys/balance route should exist');

        const handlers = layer.route.stack;
        const finalHandler = handlers[handlers.length - 1].handle;

        const req = makeReq({
            id: 'key-id-1',
            balance: 3.14,
            owner_email: 'user@test.com',
            label: 'My key',
            key_prefix: 'sk_live_abcd',
        });
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._body.balance_usdc, 3.14);
        assert.ok(res._body.key_prefix.includes('sk_live_abcd'));
    });
});

describe('DELETE /api/keys/:id — ownership validation', () => {
    function makeReq(apiKeyInfo, paramId) {
        return {
            body: {},
            headers: {},
            ip: '127.0.0.1',
            apiKeyInfo,
            params: { id: paramId },
        };
    }

    function makeRes() {
        const res = {
            _status: 200,
            _body: null,
            status(code) { this._status = code; return this; },
            json(body) { this._body = body; return this; },
        };
        return res;
    }

    test('returns 400 for invalid UUID format', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const router = createApiKeysRouter({});
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/:id' && l.route.methods.delete);
        assert.ok(layer, 'DELETE /api/keys/:id route should exist');
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq({ owner_email: 'u@t.com' }, 'not-a-uuid');
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 400);
    });

    test('returns 403 when key belongs to different owner', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: { id: 'uuid-1', owner_email: 'other@owner.com', active: true },
                            error: null,
                        }),
                    }),
                }),
            }),
        };
        const router = createApiKeysRouter(mockSupabase);
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/:id' && l.route.methods.delete);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq(
            { owner_email: 'attacker@evil.com' },
            'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        );
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 403);
    });
});

describe('POST /api/keys/topup — replay protection', () => {
    function makeReq(apiKeyInfo, body) {
        return { body, headers: {}, ip: '127.0.0.1', apiKeyInfo };
    }
    function makeRes() {
        const res = {
            _status: 200,
            _body: null,
            status(code) { this._status = code; return this; },
            json(body) { this._body = body; return this; },
        };
        return res;
    }

    test('returns 400 for invalid tx_hash', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const router = createApiKeysRouter({});
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/topup' && l.route.methods.post);
        assert.ok(layer, 'POST /api/keys/topup route should exist');
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq(
            { id: 'k1', balance: 0 },
            { amount: 10, tx_hash: 'not_a_valid_hash' }
        );
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 400);
        assert.match(res._body.error, /tx_hash/i);
    });

    test('returns 400 for invalid amount', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const router = createApiKeysRouter({});
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/topup' && l.route.methods.post);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq(
            { id: 'k1', balance: 0 },
            { amount: -5, tx_hash: '0x' + 'a'.repeat(64) }
        );
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 400);
    });

    test('returns 409 when tx_hash already used', async () => {
        const createApiKeysRouter = require('../routes/api-keys');
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: async () => ({
                            data: [{ tx_hash: 'topup:0x' + 'b'.repeat(64) }],
                            error: null,
                        }),
                    }),
                }),
            }),
        };
        const router = createApiKeysRouter(mockSupabase);
        const layer = router.stack.find(l => l.route && l.route.path === '/api/keys/topup' && l.route.methods.post);
        const finalHandler = layer.route.stack[layer.route.stack.length - 1].handle;

        const req = makeReq(
            { id: 'k1', balance: 0 },
            { amount: 10, tx_hash: '0x' + 'b'.repeat(64) }
        );
        const res = makeRes();
        await finalHandler(req, res, () => {});
        assert.strictEqual(res._status, 409);
        assert.match(res._body.error, /TX_ALREADY_USED/);
    });
});
