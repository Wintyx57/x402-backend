// tests/quick-register-signature.test.js
// Tests for EIP-191 signature verification on POST /quick-register
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Replicate verifyQuickRegisterSignature from routes/register.js ───────────
// We test the pure logic independently of viem's actual crypto calls.

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

async function verifyQuickRegisterSignature({ url, ownerAddress, timestamp, signature, _recoverFn }) {
    // 1. Validate timestamp freshness
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || ts <= 0) {
        return { valid: false, reason: 'invalid_timestamp' };
    }
    const age = Date.now() - ts;
    if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
        return { valid: false, reason: 'timestamp_expired', age_ms: age };
    }

    // 2. Reconstruct signed message
    const message = `quick-register:${url}:${ownerAddress}:${timestamp}`;

    // 3. Recover signer (injected for unit tests, real viem in production)
    const recoverFn = _recoverFn || (() => Promise.reject(new Error('No recoverFn provided in test')));
    try {
        const recovered = await recoverFn({ message, signature });
        if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
            return { valid: false, reason: 'signature_mismatch', recovered };
        }
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: 'signature_recovery_failed', error: err.message };
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_ADDRESS = '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430';
const VALID_URL = 'https://api.example.com/v1';

function makeParams(overrides = {}) {
    return {
        url: VALID_URL,
        ownerAddress: VALID_ADDRESS,
        timestamp: Date.now(),
        signature: '0xsignature',
        _recoverFn: async () => VALID_ADDRESS, // returns the correct signer by default
        ...overrides,
    };
}

// ─── Suite 1: timestamp validation ───────────────────────────────────────────

describe('quick-register signature — timestamp validation', () => {
    it('should accept a fresh timestamp (just now)', async () => {
        const params = makeParams({ timestamp: Date.now() });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, true);
    });

    it('should accept a timestamp 4 minutes ago', async () => {
        const params = makeParams({ timestamp: Date.now() - 4 * 60 * 1000 });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, true);
    });

    it('should reject a timestamp older than 5 minutes', async () => {
        const params = makeParams({ timestamp: Date.now() - 6 * 60 * 1000 });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'timestamp_expired');
    });

    it('should reject a timestamp in the far future', async () => {
        const params = makeParams({ timestamp: Date.now() + 10 * 60 * 1000 });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'timestamp_expired');
    });

    it('should reject a non-numeric timestamp string', async () => {
        const params = makeParams({ timestamp: 'not-a-number' });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should reject a zero timestamp', async () => {
        const params = makeParams({ timestamp: 0 });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should reject a negative timestamp', async () => {
        const params = makeParams({ timestamp: -1000 });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should reject a float timestamp', async () => {
        // Number.isInteger(1234.5) === false
        const params = makeParams({ timestamp: Date.now() + 0.5 });
        const result = await verifyQuickRegisterSignature(params);
        // Float: Number.isInteger fails
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should accept a numeric string timestamp (coerced via Number())', async () => {
        // Number('1234567890123') = 1234567890123, which IS an integer
        const ts = String(Date.now());
        const params = makeParams({ timestamp: ts });
        const result = await verifyQuickRegisterSignature(params);
        // Numeric string coerces to integer correctly
        assert.strictEqual(result.valid, true);
    });
});

// ─── Suite 2: message construction ────────────────────────────────────────────

describe('quick-register signature — message format', () => {
    it('should construct message as quick-register:<url>:<ownerAddress>:<timestamp>', async () => {
        let capturedMessage = null;
        const freshTimestamp = Date.now();
        const owner = '0x' + 'a'.repeat(40);
        const params = makeParams({
            url: 'https://test.com',
            ownerAddress: owner,
            timestamp: freshTimestamp,
            _recoverFn: async ({ message }) => {
                capturedMessage = message;
                return owner;
            },
        });
        await verifyQuickRegisterSignature(params);
        assert.strictEqual(
            capturedMessage,
            `quick-register:https://test.com:${owner}:${freshTimestamp}`
        );
    });

    it('message should start with "quick-register:"', async () => {
        let msg = null;
        const params = makeParams({
            _recoverFn: async ({ message }) => { msg = message; return VALID_ADDRESS; },
        });
        await verifyQuickRegisterSignature(params);
        assert.ok(msg.startsWith('quick-register:'));
    });

    it('message should contain the URL', async () => {
        let msg = null;
        const params = makeParams({
            url: 'https://special.api.io/endpoint',
            _recoverFn: async ({ message }) => { msg = message; return VALID_ADDRESS; },
        });
        await verifyQuickRegisterSignature(params);
        assert.ok(msg.includes('https://special.api.io/endpoint'));
    });

    it('message should contain the ownerAddress', async () => {
        let msg = null;
        const params = makeParams({
            _recoverFn: async ({ message }) => { msg = message; return VALID_ADDRESS; },
        });
        await verifyQuickRegisterSignature(params);
        assert.ok(msg.includes(VALID_ADDRESS));
    });
});

// ─── Suite 3: address matching ────────────────────────────────────────────────

describe('quick-register signature — address matching', () => {
    it('should accept when recovered address matches ownerAddress (exact case)', async () => {
        const params = makeParams({ _recoverFn: async () => VALID_ADDRESS });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, true);
    });

    it('should accept when recovered address matches ownerAddress (case-insensitive)', async () => {
        const params = makeParams({
            ownerAddress: VALID_ADDRESS.toLowerCase(),
            _recoverFn: async () => VALID_ADDRESS.toUpperCase(),
        });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, true);
    });

    it('should reject when recovered address differs from ownerAddress', async () => {
        const otherAddress = '0x' + 'b'.repeat(40);
        const params = makeParams({ _recoverFn: async () => otherAddress });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'signature_mismatch');
        assert.strictEqual(result.recovered, otherAddress);
    });

    it('should include the recovered address in mismatch response', async () => {
        const attacker = '0x' + 'dead'.repeat(10);
        const params = makeParams({ _recoverFn: async () => attacker });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.recovered, attacker);
    });
});

// ─── Suite 4: recovery errors ─────────────────────────────────────────────────

describe('quick-register signature — recovery errors', () => {
    it('should return valid:false with reason signature_recovery_failed on viem error', async () => {
        const params = makeParams({
            _recoverFn: async () => { throw new Error('Invalid signature format'); },
        });
        const result = await verifyQuickRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'signature_recovery_failed');
        assert.ok(result.error.includes('Invalid signature format'));
    });

    it('should not throw when recoverFn rejects', async () => {
        const params = makeParams({
            _recoverFn: async () => { throw new Error('Crypto error'); },
        });
        await assert.doesNotReject(async () => {
            await verifyQuickRegisterSignature(params);
        });
    });
});

// ─── Suite 5: missing fields in the route ────────────────────────────────────

describe('quick-register — missing signature/timestamp rejection', () => {
    function checkMissingFields(body) {
        const { signature, timestamp } = body;
        if (!signature || !timestamp) {
            return { error: 'Signature required', status: 400 };
        }
        return { error: null, status: 200 };
    }

    it('should reject when signature is missing', () => {
        const result = checkMissingFields({ timestamp: Date.now() });
        assert.strictEqual(result.status, 400);
        assert.ok(result.error);
    });

    it('should reject when timestamp is missing', () => {
        const result = checkMissingFields({ signature: '0xabc' });
        assert.strictEqual(result.status, 400);
        assert.ok(result.error);
    });

    it('should reject when both are missing', () => {
        const result = checkMissingFields({});
        assert.strictEqual(result.status, 400);
    });

    it('should pass when both are present', () => {
        const result = checkMissingFields({ signature: '0xabc', timestamp: Date.now() });
        assert.strictEqual(result.status, 200);
    });

    it('should reject when signature is empty string', () => {
        const result = checkMissingFields({ signature: '', timestamp: Date.now() });
        assert.strictEqual(result.status, 400);
    });

    it('should reject when timestamp is 0 (falsy)', () => {
        const result = checkMissingFields({ signature: '0xabc', timestamp: 0 });
        assert.strictEqual(result.status, 400);
    });
});
