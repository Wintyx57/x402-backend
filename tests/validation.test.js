// tests/validation.test.js — Validation pattern tests (tx hash, wallet, URL)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Validation patterns used across the codebase
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const URL_REGEX = /^https?:\/\/.+/;

describe('Transaction hash validation', () => {
    it('should accept valid tx hashes', () => {
        const hashes = [
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ];
        for (const hash of hashes) {
            assert.ok(TX_HASH_REGEX.test(hash), `should accept: ${hash}`);
        }
    });

    it('should reject invalid tx hashes', () => {
        const invalid = [
            '',                                // empty
            '0x',                              // too short
            '0x123',                           // too short
            '0x' + 'a'.repeat(63),             // 63 chars (too short by 1)
            '0x' + 'a'.repeat(65),             // 65 chars (too long by 1)
            'a'.repeat(64),                    // no 0x prefix
            '0x' + 'g'.repeat(64),             // non-hex
            '0x' + 'z'.repeat(64),             // non-hex
            '1x' + 'a'.repeat(64),             // wrong prefix
            ' 0x' + 'a'.repeat(64),            // leading space
            '0x' + 'a'.repeat(64) + ' ',       // trailing space
        ];
        for (const hash of invalid) {
            assert.ok(!TX_HASH_REGEX.test(hash), `should reject: "${hash}"`);
        }
    });
});

describe('Wallet address validation', () => {
    it('should accept valid Ethereum addresses', () => {
        const addresses = [
            '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
            '0x0000000000000000000000000000000000000000',
            '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b',
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        ];
        for (const addr of addresses) {
            assert.ok(WALLET_ADDRESS_REGEX.test(addr), `should accept: ${addr}`);
        }
    });

    it('should reject invalid addresses', () => {
        const invalid = [
            '',                                // empty
            '0x',                              // too short
            '0x123',                           // too short
            '0x' + 'a'.repeat(39),             // 39 chars (too short)
            '0x' + 'a'.repeat(41),             // 41 chars (too long)
            'a'.repeat(40),                    // no prefix
            '0x' + 'g'.repeat(40),             // non-hex chars
            '0x' + 'a'.repeat(64),             // tx hash length, not address
        ];
        for (const addr of invalid) {
            assert.ok(!WALLET_ADDRESS_REGEX.test(addr), `should reject: "${addr}"`);
        }
    });
});

describe('URL validation', () => {
    it('should accept valid URLs', () => {
        const urls = [
            'https://example.com',
            'http://localhost:3000',
            'https://x402-api.onrender.com/api/search',
            'https://x402bazaar.org',
            'http://127.0.0.1:8080/path?query=1',
        ];
        for (const url of urls) {
            assert.ok(URL_REGEX.test(url), `should accept: ${url}`);
        }
    });

    it('should reject invalid URLs', () => {
        const invalid = [
            '',                    // empty
            'ftp://example.com',   // wrong protocol
            'example.com',         // no protocol
            'javascript:alert(1)', // XSS attempt
            '//example.com',       // protocol-relative
        ];
        for (const url of invalid) {
            assert.ok(!URL_REGEX.test(url), `should reject: "${url}"`);
        }
    });
});
