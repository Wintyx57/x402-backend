// tests/payment.test.js — Unit tests for lib/payment.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BoundedSet, TX_HASH_REGEX, fetchWithTimeout, createPaymentSystem } = require('../lib/payment');

describe('BoundedSet', () => {
    it('should add and check elements', () => {
        const set = new BoundedSet(10);
        set.add('a');
        assert.ok(set.has('a'));
        assert.ok(!set.has('b'));
    });

    it('should report correct size', () => {
        const set = new BoundedSet(10);
        assert.equal(set.size, 0);
        set.add('x');
        assert.equal(set.size, 1);
        set.add('y');
        assert.equal(set.size, 2);
    });

    it('should not add duplicates', () => {
        const set = new BoundedSet(10);
        set.add('a');
        set.add('a');
        assert.equal(set.size, 1);
    });

    it('should evict oldest element when maxSize is reached', () => {
        const set = new BoundedSet(3);
        set.add('a');
        set.add('b');
        set.add('c');
        assert.equal(set.size, 3);

        // Adding a 4th element should evict the first ('a')
        set.add('d');
        assert.equal(set.size, 3);
        assert.ok(!set.has('a'), 'oldest element "a" should be evicted');
        assert.ok(set.has('b'));
        assert.ok(set.has('c'));
        assert.ok(set.has('d'));
    });

    it('should handle maxSize of 1', () => {
        const set = new BoundedSet(1);
        set.add('a');
        assert.equal(set.size, 1);
        assert.ok(set.has('a'));

        set.add('b');
        assert.equal(set.size, 1);
        assert.ok(!set.has('a'));
        assert.ok(set.has('b'));
    });

    it('should use default maxSize when none provided', () => {
        const set = new BoundedSet();
        // Default is 10000 — just verify it works
        set.add('test');
        assert.ok(set.has('test'));
    });
});

describe('TX_HASH_REGEX', () => {
    it('should match a valid tx hash', () => {
        const validHash = '0x' + 'a'.repeat(64);
        assert.ok(TX_HASH_REGEX.test(validHash));
    });

    it('should match mixed case hex', () => {
        const hash = '0xAbCdEf0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789';
        assert.ok(TX_HASH_REGEX.test(hash));
    });

    it('should reject hash without 0x prefix', () => {
        const noPrefix = 'a'.repeat(64);
        assert.ok(!TX_HASH_REGEX.test(noPrefix));
    });

    it('should reject hash that is too short', () => {
        const tooShort = '0x' + 'a'.repeat(63);
        assert.ok(!TX_HASH_REGEX.test(tooShort));
    });

    it('should reject hash that is too long', () => {
        const tooLong = '0x' + 'a'.repeat(65);
        assert.ok(!TX_HASH_REGEX.test(tooLong));
    });

    it('should reject hash with non-hex characters', () => {
        const nonHex = '0x' + 'g'.repeat(64);
        assert.ok(!TX_HASH_REGEX.test(nonHex));
    });

    it('should reject empty string', () => {
        assert.ok(!TX_HASH_REGEX.test(''));
    });
});

describe('fetchWithTimeout', () => {
    it('should be a function', () => {
        assert.equal(typeof fetchWithTimeout, 'function');
    });
});

describe('createPaymentSystem', () => {
    it('should be a function', () => {
        assert.equal(typeof createPaymentSystem, 'function');
    });

    it('should return an object with paymentMiddleware, verifyPayment, and fetchWithTimeout', () => {
        // Provide minimal stubs for supabase and logActivity
        const fakeSupabase = { from: () => ({ select: () => ({ in: () => ({ limit: () => ({ data: [] }) }) }) }) };
        const fakeLogActivity = () => {};
        const result = createPaymentSystem(fakeSupabase, fakeLogActivity);

        assert.equal(typeof result.paymentMiddleware, 'function');
        assert.equal(typeof result.verifyPayment, 'function');
        assert.equal(typeof result.fetchWithTimeout, 'function');
    });
});
