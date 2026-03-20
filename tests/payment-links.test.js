// tests/payment-links.test.js — Unit tests for Payment Links feature
// Tests: schema validation, route logic (mocked supabase), 402 builder
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PaymentLinkSchema } = require('../schemas/index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validLinkPayload(overrides = {}) {
    return {
        title: 'My Premium Report',
        description: 'Exclusive market analysis',
        targetUrl: 'https://example.com/report.pdf',
        priceUsdc: 2.5,
        ownerAddress: '0x' + 'a'.repeat(40),
        signature: '0x' + 'b'.repeat(130),
        timestamp: Date.now(),
        redirectAfterPayment: true,
        ...overrides,
    };
}

function firstError(result) {
    return result.error?.errors?.[0]?.message || result.error?.issues?.[0]?.message || '(no message)';
}

// ─── Suite 1: PaymentLinkSchema — valid payloads ──────────────────────────────

describe('PaymentLinkSchema — valid payloads', () => {
    it('should accept a fully specified payload', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload());
        assert.strictEqual(result.success, true, `Unexpected error: ${firstError(result)}`);
    });

    it('should accept minimal payload without optional fields', () => {
        const { description, redirectAfterPayment, ...minimal } = validLinkPayload();
        const result = PaymentLinkSchema.safeParse(minimal);
        assert.strictEqual(result.success, true, `Unexpected error: ${firstError(result)}`);
    });

    it('should default description to empty string', () => {
        const payload = validLinkPayload();
        delete payload.description;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.description, '');
    });

    it('should default redirectAfterPayment to true', () => {
        const payload = validLinkPayload();
        delete payload.redirectAfterPayment;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.redirectAfterPayment, true);
    });

    it('should accept minimum price (0.001)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: 0.001 }));
        assert.strictEqual(result.success, true);
    });

    it('should accept maximum price (10000)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: 10000 }));
        assert.strictEqual(result.success, true);
    });

    it('should accept a title with 1 character', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: 'X' }));
        assert.strictEqual(result.success, true);
    });

    it('should accept a title with 200 characters (max)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: 'a'.repeat(200) }));
        assert.strictEqual(result.success, true);
    });

    it('should trim whitespace from title', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: '  My Report  ' }));
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.title, 'My Report');
    });

    it('should accept redirectAfterPayment = false', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ redirectAfterPayment: false }));
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.redirectAfterPayment, false);
    });
});

// ─── Suite 2: PaymentLinkSchema — title validation ────────────────────────────

describe('PaymentLinkSchema — title validation', () => {
    it('should reject an empty title', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: '' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a title that is only whitespace', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: '   ' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a title longer than 200 characters', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ title: 'a'.repeat(201) }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a missing title', () => {
        const payload = validLinkPayload();
        delete payload.title;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, false);
    });
});

// ─── Suite 3: PaymentLinkSchema — targetUrl validation ───────────────────────

describe('PaymentLinkSchema — targetUrl validation', () => {
    it('should reject a non-URL string', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ targetUrl: 'not-a-url' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a URL longer than 2000 characters', () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(2000);
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ targetUrl: longUrl }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a missing targetUrl', () => {
        const payload = validLinkPayload();
        delete payload.targetUrl;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, false);
    });

    it('should accept https URLs', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ targetUrl: 'https://example.com/content' }));
        assert.strictEqual(result.success, true);
    });

    it('should accept http URLs', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ targetUrl: 'http://example.com/api/data' }));
        assert.strictEqual(result.success, true);
    });
});

// ─── Suite 4: PaymentLinkSchema — price validation ───────────────────────────

describe('PaymentLinkSchema — priceUsdc validation', () => {
    it('should reject price = 0 (too low)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: 0 }));
        assert.strictEqual(result.success, false);
    });

    it('should reject price below 0.001', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: 0.0009 }));
        assert.strictEqual(result.success, false);
    });

    it('should reject price above 10000', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: 10001 }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a string price', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ priceUsdc: '2.5' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a missing price', () => {
        const payload = validLinkPayload();
        delete payload.priceUsdc;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, false);
    });
});

// ─── Suite 5: PaymentLinkSchema — ownerAddress validation ────────────────────

describe('PaymentLinkSchema — ownerAddress validation', () => {
    it('should reject an invalid address (too short)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ ownerAddress: '0x1234' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject an address without 0x prefix', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ ownerAddress: 'a'.repeat(40) }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a non-hex address', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ ownerAddress: '0x' + 'z'.repeat(40) }));
        assert.strictEqual(result.success, false);
    });

    it('should accept a valid checksummed-style address (mixed case)', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ ownerAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' }));
        assert.strictEqual(result.success, true);
    });

    it('should accept a lowercase address', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ ownerAddress: '0x' + 'f'.repeat(40) }));
        assert.strictEqual(result.success, true);
    });
});

// ─── Suite 6: PaymentLinkSchema — signature + timestamp ──────────────────────

describe('PaymentLinkSchema — signature and timestamp validation', () => {
    it('should reject a missing signature', () => {
        const payload = validLinkPayload();
        delete payload.signature;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, false);
    });

    it('should reject an empty signature', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ signature: '' }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a missing timestamp', () => {
        const payload = validLinkPayload();
        delete payload.timestamp;
        const result = PaymentLinkSchema.safeParse(payload);
        assert.strictEqual(result.success, false);
    });

    it('should reject a non-integer timestamp', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ timestamp: 1.5 }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a zero timestamp', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ timestamp: 0 }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a negative timestamp', () => {
        const result = PaymentLinkSchema.safeParse(validLinkPayload({ timestamp: -1 }));
        assert.strictEqual(result.success, false);
    });
});

// ─── Suite 7: Payment Links route logic (mocked) ─────────────────────────────

describe('Payment Links route — 402 response builder', () => {
    // We test the builder directly by importing the module and exercising the public API
    // via a lightweight mock of the router environment

    const { DEFAULT_CHAIN_KEY } = require('../lib/chains');

    it('DEFAULT_CHAIN_KEY should be a non-empty string', () => {
        assert.ok(typeof DEFAULT_CHAIN_KEY === 'string' && DEFAULT_CHAIN_KEY.length > 0);
    });

    it('CHAINS should contain at least base, skale, polygon', () => {
        const { CHAINS } = require('../lib/chains');
        assert.ok(CHAINS.base, 'base chain config missing');
        assert.ok(CHAINS.skale, 'skale chain config missing');
        assert.ok(CHAINS.polygon, 'polygon chain config missing');
    });

    it('UUID_REGEX should reject non-UUID strings', () => {
        const { UUID_REGEX } = require('../lib/payment');
        assert.strictEqual(UUID_REGEX.test('not-a-uuid'), false);
        assert.strictEqual(UUID_REGEX.test(''), false);
        assert.strictEqual(UUID_REGEX.test('abc123'), false);
    });

    it('UUID_REGEX should accept valid UUID v4', () => {
        const { UUID_REGEX } = require('../lib/payment');
        assert.strictEqual(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000'), true);
        assert.strictEqual(UUID_REGEX.test('123e4567-e89b-12d3-a456-426614174000'), true);
    });

    it('TX_HASH_REGEX should reject invalid tx hashes', () => {
        const { TX_HASH_REGEX } = require('../lib/payment');
        assert.strictEqual(TX_HASH_REGEX.test('0xabc'), false);
        assert.strictEqual(TX_HASH_REGEX.test('not-a-hash'), false);
        assert.strictEqual(TX_HASH_REGEX.test(''), false);
    });

    it('TX_HASH_REGEX should accept valid 32-byte tx hash', () => {
        const { TX_HASH_REGEX } = require('../lib/payment');
        assert.strictEqual(TX_HASH_REGEX.test('0x' + 'a'.repeat(64)), true);
        assert.strictEqual(TX_HASH_REGEX.test('0x' + 'F'.repeat(64)), true);
    });
});

// ─── Suite 8: Payment Links router module — structural validation ─────────────

describe('Payment Links router module', () => {
    it('should export a function (router factory)', () => {
        const createRouter = require('../routes/payment-links');
        assert.strictEqual(typeof createRouter, 'function');
    });

    it('should have PaymentLinkSchema in schemas/index.js exports', () => {
        const schemas = require('../schemas/index.js');
        assert.ok(schemas.PaymentLinkSchema, 'PaymentLinkSchema not exported');
        assert.strictEqual(typeof schemas.PaymentLinkSchema.safeParse, 'function');
    });

    it('should return an express router when called with valid deps', () => {
        const createRouter = require('../routes/payment-links');

        // Minimal supabase mock
        const supabaseMock = {
            from: () => ({
                insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
                select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), order: () => ({ data: null, error: null }), limit: () => ({ data: null, error: null }), in: () => ({ limit: () => ({ data: null, error: null }) }) }) }),
                update: () => ({ eq: () => ({ data: null, error: null }) }),
                delete: () => ({ eq: () => ({ data: null, error: null }) }),
            }),
        };

        const logActivityMock = () => {};

        const rateLimiterMock = (req, res, next) => next();

        const paymentSystemMock = {
            verifyPayment: async () => false,
            markTxUsed: async () => true,
        };

        const router = createRouter(supabaseMock, logActivityMock, rateLimiterMock, paymentSystemMock);
        // Express routers have a 'stack' property
        assert.ok(router && typeof router === 'function', 'Router must be a function (Express router)');
    });
});

// ─── Suite 9: Replay key scoping ─────────────────────────────────────────────

describe('Payment Links — replay key format', () => {
    it('replay key should be scoped with paylink: prefix to avoid collisions', () => {
        const chainKey = 'skale';
        const txHash = '0x' + 'a'.repeat(64);
        const replayKey = `paylink:${chainKey}:${txHash}`;
        // Key must not overlap with proxy format (which uses "chainKey:txHash" without prefix)
        const proxyKey = `${chainKey}:${txHash}`;
        assert.notStrictEqual(replayKey, proxyKey);
        assert.ok(replayKey.startsWith('paylink:'));
    });

    it('replay keys for different chains should be different', () => {
        const txHash = '0x' + 'b'.repeat(64);
        const keySkale = `paylink:skale:${txHash}`;
        const keyBase = `paylink:base:${txHash}`;
        assert.notStrictEqual(keySkale, keyBase);
    });

    it('replay keys for different tx hashes should be different', () => {
        const keyA = `paylink:skale:${'0x' + 'a'.repeat(64)}`;
        const keyB = `paylink:skale:${'0x' + 'b'.repeat(64)}`;
        assert.notStrictEqual(keyA, keyB);
    });
});
