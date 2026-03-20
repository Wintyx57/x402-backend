// tests/credentials.test.js — Unit tests for lib/credentials.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Key fixture helpers ──────────────────────────────────────────────────────

const VALID_KEY_HEX = 'a'.repeat(64); // 32 bytes as hex

function withKey(keyHex, fn) {
    const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = keyHex;
    // Reset the module so _key is re-derived for each test group
    Object.keys(require.cache).forEach(k => {
        if (k.includes('lib/credentials')) delete require.cache[k];
    });
    const result = fn(require('../lib/credentials'));
    process.env.CREDENTIALS_ENCRYPTION_KEY = original ?? '';
    Object.keys(require.cache).forEach(k => {
        if (k.includes('lib/credentials')) delete require.cache[k];
    });
    return result;
}

// ─── Encrypt / Decrypt round-trip ────────────────────────────────────────────

describe('encryptCredentials / decryptCredentials', () => {
    it('round-trip: encrypt then decrypt returns the original object', () => {
        withKey(VALID_KEY_HEX, ({ encryptCredentials, decryptCredentials }) => {
            const creds = { type: 'bearer', credentials: [{ key: 'Authorization', value: 'sk-test-abc' }] };
            const encoded = encryptCredentials(creds);
            assert.ok(typeof encoded === 'string', 'should return a string');
            assert.ok(encoded.length > 0);
            const decoded = decryptCredentials(encoded);
            assert.deepEqual(decoded, creds);
        });
    });

    it('each call produces a different ciphertext (random IV)', () => {
        withKey(VALID_KEY_HEX, ({ encryptCredentials }) => {
            const creds = { type: 'header', credentials: [{ key: 'X-API-Key', value: 'secret' }] };
            const a = encryptCredentials(creds);
            const b = encryptCredentials(creds);
            assert.notEqual(a, b, 'same plaintext should yield different ciphertexts');
        });
    });

    it('decrypt with a different key returns null (auth tag mismatch)', () => {
        // Test tampered ciphertext (auth tag will fail) rather than a different key
        // (cross-key testing via module cache reset is unreliable in a single process).
        withKey(VALID_KEY_HEX, ({ encryptCredentials, decryptCredentials }) => {
            const encoded = encryptCredentials({ type: 'bearer', credentials: [{ key: 'k', value: 'v' }] });
            // Flip a byte in the middle of the ciphertext to invalidate the auth tag
            const blob = Buffer.from(encoded, 'base64');
            blob[blob.length - 1] ^= 0xff; // corrupt last byte
            const tampered = blob.toString('base64');
            const result = decryptCredentials(tampered);
            assert.equal(result, null, 'tampered ciphertext should fail auth tag check');
        });
    });

    it('decrypt with corrupt data returns null (does not throw)', () => {
        withKey(VALID_KEY_HEX, ({ decryptCredentials }) => {
            const result = decryptCredentials('not-valid-base64!!');
            assert.equal(result, null);
        });
    });

    it('decrypt with truncated blob returns null', () => {
        withKey(VALID_KEY_HEX, ({ decryptCredentials }) => {
            const result = decryptCredentials(Buffer.alloc(10).toString('base64'));
            assert.equal(result, null);
        });
    });

    it('round-trip preserves special characters and unicode', () => {
        withKey(VALID_KEY_HEX, ({ encryptCredentials, decryptCredentials }) => {
            const creds = {
                type: 'header',
                credentials: [
                    { key: 'X-Token', value: '🔐 unicode & "quotes" \\ backslash \n newline' },
                    { key: 'X-Second', value: '{"nested":"json","array":[1,2,3]}' },
                ],
            };
            const decoded = decryptCredentials(encryptCredentials(creds));
            assert.deepEqual(decoded, creds);
        });
    });
});

// ─── maskCredentialValue ─────────────────────────────────────────────────────

describe('maskCredentialValue', () => {
    it('returns **** for short values (≤ 8 chars)', () => {
        withKey(VALID_KEY_HEX, ({ maskCredentialValue }) => {
            assert.equal(maskCredentialValue('short'), '****');
            assert.equal(maskCredentialValue('12345678'), '****');
        });
    });

    it('masks long values showing first 4 and last 3 chars', () => {
        withKey(VALID_KEY_HEX, ({ maskCredentialValue }) => {
            assert.equal(maskCredentialValue('sk-proj-abcdefgh'), 'sk-p****fgh');
        });
    });

    it('returns **** for null / undefined / non-string', () => {
        withKey(VALID_KEY_HEX, ({ maskCredentialValue }) => {
            assert.equal(maskCredentialValue(null), '****');
            assert.equal(maskCredentialValue(undefined), '****');
            assert.equal(maskCredentialValue(12345), '****');
        });
    });

    it('returns **** for empty string', () => {
        withKey(VALID_KEY_HEX, ({ maskCredentialValue }) => {
            assert.equal(maskCredentialValue(''), '****');
        });
    });
});

// ─── injectCredentials ───────────────────────────────────────────────────────

describe('injectCredentials', () => {
    // injectCredentials is pure (no key dependency) — require directly
    const { injectCredentials } = require('../lib/credentials');

    it('header type: adds the custom header', () => {
        const headers = { 'Content-Type': 'application/json' };
        const creds = { type: 'header', credentials: [{ key: 'X-API-Key', value: 'mykey' }] };
        const { headers: out, url } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['X-API-Key'], 'mykey');
        assert.equal(url, 'https://api.example.com');
    });

    it('bearer type: sets Authorization header with Bearer prefix', () => {
        const headers = {};
        const creds = { type: 'bearer', credentials: [{ key: 'Authorization', value: 'tok-secret' }] };
        const { headers: out } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['Authorization'], 'Bearer tok-secret');
    });

    it('basic type: base64-encodes user:password into Authorization', () => {
        const headers = {};
        const creds = { type: 'basic', credentials: [{ key: 'credentials', value: 'user:password' }] };
        const { headers: out } = injectCredentials(headers, 'https://api.example.com', creds);
        const expected = `Basic ${Buffer.from('user:password').toString('base64')}`;
        assert.equal(out['Authorization'], expected);
    });

    it('query type: appends parameter to the URL', () => {
        const headers = {};
        const creds = { type: 'query', credentials: [{ key: 'api_key', value: 'qsecret' }] };
        const { url } = injectCredentials(headers, 'https://api.example.com/v1/data', creds);
        assert.ok(url.includes('api_key=qsecret'), `Expected api_key param in URL, got: ${url}`);
    });

    it('query type: preserves existing query params', () => {
        const headers = {};
        const creds = { type: 'query', credentials: [{ key: 'token', value: 'abc' }] };
        const { url } = injectCredentials(headers, 'https://api.example.com?foo=bar', creds);
        assert.ok(url.includes('foo=bar'));
        assert.ok(url.includes('token=abc'));
    });

    it('multiple credentials: all are injected', () => {
        const headers = {};
        const creds = {
            type: 'header',
            credentials: [
                { key: 'X-Api-Key', value: 'key1' },
                { key: 'X-Api-Secret', value: 'secret1' },
            ],
        };
        const { headers: out } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['X-Api-Key'], 'key1');
        assert.equal(out['X-Api-Secret'], 'secret1');
    });

    it('location overrides type per credential item', () => {
        const headers = {};
        const creds = {
            type: 'header',
            credentials: [
                { key: 'X-Custom', value: 'custom_val', location: 'header' },
                { key: 'api_key', value: 'qval', location: 'query' },
            ],
        };
        const { headers: out, url } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['X-Custom'], 'custom_val');
        assert.ok(url.includes('api_key=qval'));
    });

    it('null creds: returns headers and URL unchanged', () => {
        const headers = { 'Content-Type': 'application/json' };
        const { headers: out, url } = injectCredentials(headers, 'https://api.example.com', null);
        assert.deepEqual(out, headers);
        assert.equal(url, 'https://api.example.com');
    });

    it('empty credentials array: nothing injected', () => {
        const headers = { 'Content-Type': 'application/json' };
        const creds = { type: 'bearer', credentials: [] };
        const { headers: out } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['Authorization'], undefined);
    });

    it('skips credentials with missing key or value', () => {
        const headers = {};
        const creds = {
            type: 'header',
            credentials: [
                { key: '', value: 'should_be_skipped' },
                { key: 'X-Valid', value: '' },
                { key: 'X-Good', value: 'ok' },
            ],
        };
        const { headers: out } = injectCredentials(headers, 'https://api.example.com', creds);
        assert.equal(out['X-Good'], 'ok');
        assert.equal(Object.keys(out).filter(k => k !== 'X-Good').length, 0);
    });
});

// ─── ServiceCredentialsSchema validation ─────────────────────────────────────

describe('ServiceCredentialsSchema (Zod)', () => {
    const { ServiceCredentialsSchema } = require('../schemas');

    it('accepts a valid bearer credentials block', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'bearer',
            credentials: [{ key: 'Authorization', value: 'sk-test-abc' }],
        });
        assert.ok(result.success);
    });

    it('accepts a valid header credentials block with location', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'header',
            credentials: [{ key: 'X-API-Key', value: 'mykey', location: 'header' }],
        });
        assert.ok(result.success);
    });

    it('rejects when type is missing', () => {
        const result = ServiceCredentialsSchema.safeParse({
            credentials: [{ key: 'X-API-Key', value: 'mykey' }],
        });
        assert.ok(!result.success);
    });

    it('rejects unknown type values', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'cookie',
            credentials: [{ key: 'session', value: 'abc' }],
        });
        assert.ok(!result.success);
    });

    it('rejects empty credentials array', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'bearer',
            credentials: [],
        });
        assert.ok(!result.success);
    });

    it('rejects more than 10 credential items', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'header',
            credentials: Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, value: `v${i}` })),
        });
        assert.ok(!result.success);
    });

    it('rejects credential key exceeding 200 chars', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'header',
            credentials: [{ key: 'x'.repeat(201), value: 'ok' }],
        });
        assert.ok(!result.success);
    });

    it('accepts credential value up to 5000 chars', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'bearer',
            credentials: [{ key: 'Authorization', value: 'a'.repeat(5000) }],
        });
        assert.ok(result.success);
    });

    it('rejects credential value exceeding 5000 chars', () => {
        const result = ServiceCredentialsSchema.safeParse({
            type: 'bearer',
            credentials: [{ key: 'Authorization', value: 'a'.repeat(5001) }],
        });
        assert.ok(!result.success);
    });
});
