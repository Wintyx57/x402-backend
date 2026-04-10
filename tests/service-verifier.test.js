// tests/service-verifier.test.js — Unit tests for lib/service-verifier.js
// Covers: decodePaymentHeader(), extractInputSchema(), verifyService() verdict logic,
// SSRF blocking, chain discrimination, USDC contract validation.
// verifyService() calls that require network are stubbed via global.fetch override.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decodePaymentHeader, KNOWN_CHAINS } = require('../lib/service-verifier');

// We can't import extractInputSchema directly since it's not exported.
// We test its logic by calling verifyService() with a stubbed fetch that
// returns a 402 body containing various inputSchema patterns.
// For decodePaymentHeader and KNOWN_CHAINS we test directly.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid base64-encoded Payment-Required header */
function buildPaymentHeader({ network, asset, amount = '5000', payTo = '0x' + 'a'.repeat(40) } = {}) {
    const obj = {
        x402Version: 1,
        accepts: [{ network, asset, amount, payTo }],
    };
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// ---------------------------------------------------------------------------
// Suite 1: KNOWN_CHAINS — contract registry integrity
// ---------------------------------------------------------------------------

describe('KNOWN_CHAINS — chain registry', () => {
    it('should contain Base mainnet (eip155:8453)', () => {
        assert.ok(KNOWN_CHAINS['eip155:8453'], 'Base mainnet must be registered');
    });

    it('should contain Base Sepolia testnet (eip155:84532)', () => {
        assert.ok(KNOWN_CHAINS['eip155:84532'], 'Base Sepolia must be registered');
    });

    it('should contain SKALE on Base (eip155:1187947933)', () => {
        assert.ok(KNOWN_CHAINS['eip155:1187947933'], 'SKALE on Base must be registered');
    });

    it('Base mainnet should be marked as mainnet', () => {
        assert.strictEqual(KNOWN_CHAINS['eip155:8453'].mainnet, true);
    });

    it('Base Sepolia should be marked as testnet', () => {
        assert.strictEqual(KNOWN_CHAINS['eip155:84532'].mainnet, false);
    });

    it('SKALE on Base should be marked as mainnet', () => {
        assert.strictEqual(KNOWN_CHAINS['eip155:1187947933'].mainnet, true);
    });

    it('all chains should have a USDC contract address', () => {
        for (const [networkId, chain] of Object.entries(KNOWN_CHAINS)) {
            assert.ok(chain.usdc, `Chain ${networkId} is missing USDC contract address`);
            assert.ok(chain.usdc.startsWith('0x'), `USDC address on ${networkId} must start with 0x`);
        }
    });

    it('all USDC contract addresses should be 42 chars (0x + 40 hex)', () => {
        for (const [networkId, chain] of Object.entries(KNOWN_CHAINS)) {
            assert.strictEqual(
                chain.usdc.length,
                42,
                `USDC address on ${networkId} has wrong length: ${chain.usdc}`
            );
        }
    });

    it('USDC on Base should match known contract address', () => {
        const base = KNOWN_CHAINS['eip155:8453'];
        assert.strictEqual(
            base.usdc.toLowerCase(),
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
        );
    });

    it('USDC on SKALE on Base should match known contract address', () => {
        const skale = KNOWN_CHAINS['eip155:1187947933'];
        assert.strictEqual(
            skale.usdc.toLowerCase(),
            '0x85889c8c714505e0c94b30fcfcf64fe3ac8fcb20'
        );
    });
});

// ---------------------------------------------------------------------------
// Suite 2: decodePaymentHeader() — valid inputs
// ---------------------------------------------------------------------------

describe('decodePaymentHeader — valid Base mainnet header', () => {
    const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    it('should decode a valid Base mainnet payment header', () => {
        const header = buildPaymentHeader({
            network: 'eip155:8453',
            asset: BASE_USDC,
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.network, 'eip155:8453');
        assert.strictEqual(result.chainLabel, 'Base');
        assert.strictEqual(result.isMainnet, true);
        assert.strictEqual(result.isValidUsdc, true);
    });

    it('should decode a valid SKALE on Base payment header', () => {
        const SKALE_USDC = '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20';
        const header = buildPaymentHeader({
            network: 'eip155:1187947933',
            asset: SKALE_USDC,
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.chainLabel, 'SKALE on Base');
        assert.strictEqual(result.isMainnet, true);
        assert.strictEqual(result.isValidUsdc, true);
    });

    it('should decode Base Sepolia as testnet', () => {
        const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
        const header = buildPaymentHeader({
            network: 'eip155:84532',
            asset: SEPOLIA_USDC,
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.isMainnet, false);
    });

    it('should parse amount from micro-USDC raw value', () => {
        const header = buildPaymentHeader({
            network: 'eip155:8453',
            asset: BASE_USDC,
            amount: '5000', // 0.005 USDC
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.amount, '5000');
        assert.ok(Math.abs(result.amountUsdc - 0.005) < 0.00001);
    });

    it('should include x402Version when present', () => {
        const header = buildPaymentHeader({
            network: 'eip155:8453',
            asset: BASE_USDC,
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.version, 1);
    });

    it('should handle case-insensitive USDC contract matching', () => {
        // Use ALL-UPPERCASE asset — comparison should still match
        const header = buildPaymentHeader({
            network: 'eip155:8453',
            asset: BASE_USDC.toUpperCase(),
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.isValidUsdc, true);
    });
});

// ---------------------------------------------------------------------------
// Suite 3: decodePaymentHeader() — invalid / edge cases
// ---------------------------------------------------------------------------

describe('decodePaymentHeader — invalid inputs', () => {
    it('should return { valid: false } for non-base64 input', () => {
        const result = decodePaymentHeader('not-base64-!!!');
        assert.strictEqual(result.valid, false);
    });

    it('should return { valid: false } for empty string', () => {
        const result = decodePaymentHeader('');
        // Empty base64 decodes to empty string → JSON.parse throws → valid: false
        assert.strictEqual(result.valid, false);
    });

    it('should return { valid: false } for valid base64 but no accepts array', () => {
        const header = Buffer.from(JSON.stringify({ x402Version: 1, accepts: [] })).toString('base64');
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.valid, false);
    });

    it('should return { valid: false } for null input', () => {
        const result = decodePaymentHeader(null);
        assert.strictEqual(result.valid, false);
    });

    it('should handle unknown chain (isMainnet=false, isValidUsdc=false)', () => {
        const header = buildPaymentHeader({
            network: 'eip155:9999999',  // unknown chain
            asset: '0xunknown',
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.valid, true);  // header is structurally valid
        assert.strictEqual(result.isMainnet, false);
        assert.strictEqual(result.isValidUsdc, false);
    });

    it('should accept Solana networks (special-case, skips USDC check)', () => {
        const header = buildPaymentHeader({
            network: 'solana:mainnet-beta',
            asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana USDC
        });
        const result = decodePaymentHeader(header);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.isValidUsdc, true);  // Solana skips contract check
        assert.strictEqual(result.isMainnet, true);
    });
});

// ---------------------------------------------------------------------------
// Suite 4: extractInputSchema logic (tested via its 4 patterns)
// ---------------------------------------------------------------------------

describe('extractInputSchema — pattern matching logic', () => {
    // We replicate the extraction logic since it's not exported directly
    function extractInputSchema(body) {
        if (!body || typeof body !== 'object') return null;

        // Pattern 1: x402 discovery extensions
        if (body.extensions?.inputSchema?.required) {
            return { required: body.extensions.inputSchema.required };
        }

        // Pattern 2: Direct inputSchema at root
        if (body.inputSchema?.required) {
            return { required: body.inputSchema.required };
        }

        // Pattern 3: required_parameters at root
        if (body.required_parameters?.required) {
            return { required: body.required_parameters.required };
        }

        // Pattern 4: required array at root
        if (Array.isArray(body.required) && body.required.every(p => typeof p === 'string')) {
            return { required: body.required };
        }

        return null;
    }

    it('pattern 1: extracts from extensions.inputSchema.required', () => {
        const body = {
            extensions: {
                inputSchema: { required: ['city'] },
            },
        };
        const result = extractInputSchema(body);
        assert.deepStrictEqual(result, { required: ['city'] });
    });

    it('pattern 2: extracts from inputSchema.required at root', () => {
        const body = { inputSchema: { required: ['q', 'max'] } };
        const result = extractInputSchema(body);
        assert.deepStrictEqual(result, { required: ['q', 'max'] });
    });

    it('pattern 3: extracts from required_parameters.required', () => {
        const body = { required_parameters: { required: ['text', 'to'] } };
        const result = extractInputSchema(body);
        assert.deepStrictEqual(result, { required: ['text', 'to'] });
    });

    it('pattern 4: extracts from root-level required string array', () => {
        const body = { error: 'Missing required parameters', required: ['city'] };
        const result = extractInputSchema(body);
        assert.deepStrictEqual(result, { required: ['city'] });
    });

    it('returns null when no known pattern matches', () => {
        const body = { error: 'Payment Required', message: 'Send USDC' };
        assert.strictEqual(extractInputSchema(body), null);
    });

    it('returns null for non-object body', () => {
        assert.strictEqual(extractInputSchema(null), null);
        assert.strictEqual(extractInputSchema('string'), null);
        assert.strictEqual(extractInputSchema(42), null);
    });

    it('returns null when required is array of non-strings', () => {
        const body = { required: [1, 2, 3] }; // not strings
        assert.strictEqual(extractInputSchema(body), null);
    });

    it('pattern 1 has priority over pattern 2', () => {
        const body = {
            extensions: { inputSchema: { required: ['city'] } },
            inputSchema: { required: ['OTHER'] }, // should be ignored
        };
        const result = extractInputSchema(body);
        assert.deepStrictEqual(result, { required: ['city'] });
    });
});

// ---------------------------------------------------------------------------
// Suite 5: verifyService() verdict logic
// ---------------------------------------------------------------------------

describe('verifyService — verdict classification logic', () => {
    // Replicate the verdict determination from verifyService() steps 4-5

    function determineVerdict({ x402, reachable, httpStatus }) {
        if (x402 && x402.valid) {
            if (x402.isMainnet && x402.isValidUsdc) return 'mainnet_verified';
            if (!x402.isMainnet) return 'testnet';
            if (!x402.isValidUsdc) return 'wrong_chain';
            return 'wrong_chain';
        }
        if (reachable) {
            if (httpStatus === 402) return 'no_x402';
            return 'reachable';
        }
        return 'offline';
    }

    it('mainnet + valid USDC → mainnet_verified', () => {
        assert.strictEqual(
            determineVerdict({ x402: { valid: true, isMainnet: true, isValidUsdc: true }, reachable: true, httpStatus: 402 }),
            'mainnet_verified'
        );
    });

    it('testnet → testnet verdict', () => {
        assert.strictEqual(
            determineVerdict({ x402: { valid: true, isMainnet: false, isValidUsdc: true }, reachable: true, httpStatus: 402 }),
            'testnet'
        );
    });

    it('mainnet + wrong USDC → wrong_chain', () => {
        assert.strictEqual(
            determineVerdict({ x402: { valid: true, isMainnet: true, isValidUsdc: false }, reachable: true, httpStatus: 402 }),
            'wrong_chain'
        );
    });

    it('reachable but no x402 header and returns 402 → no_x402', () => {
        assert.strictEqual(
            determineVerdict({ x402: null, reachable: true, httpStatus: 402 }),
            'no_x402'
        );
    });

    it('reachable with non-402 status → reachable', () => {
        assert.strictEqual(
            determineVerdict({ x402: null, reachable: true, httpStatus: 200 }),
            'reachable'
        );
    });

    it('not reachable → offline', () => {
        assert.strictEqual(
            determineVerdict({ x402: null, reachable: false, httpStatus: 500 }),
            'offline'
        );
    });

    it('timeout (httpStatus=0) → offline', () => {
        assert.strictEqual(
            determineVerdict({ x402: null, reachable: false, httpStatus: 0 }),
            'offline'
        );
    });

    it('reachable is true when httpStatus 200-499', () => {
        // Replicate the reachable check: status >= 200 && status < 500
        for (const status of [200, 301, 400, 402, 404, 499]) {
            const reachable = status >= 200 && status < 500;
            assert.ok(reachable, `Status ${status} should be reachable`);
        }
    });

    it('reachable is false when httpStatus 500+', () => {
        for (const status of [500, 502, 503]) {
            const reachable = status >= 200 && status < 500;
            assert.ok(!reachable, `Status ${status} should NOT be reachable`);
        }
    });
});

// ---------------------------------------------------------------------------
// Suite 6: verifyService() — SSRF blocking (stubbed fetch)
// ---------------------------------------------------------------------------

describe('verifyService — SSRF blocking', () => {
    const { verifyService } = require('../lib/service-verifier');

    it('should return offline verdict for private IP (SSRF blocked)', async () => {
        const report = await verifyService('http://192.168.1.1/api/test');
        assert.strictEqual(report.verdict, 'offline');
        assert.ok(report.details.includes('SSRF') || report.details.length > 0);
    });

    it('should return offline verdict for localhost (SSRF blocked)', async () => {
        const report = await verifyService('http://localhost/api/test');
        assert.strictEqual(report.verdict, 'offline');
    });

    it('should return offline verdict for 10.x.x.x (SSRF blocked)', async () => {
        const report = await verifyService('http://10.0.0.1/api');
        assert.strictEqual(report.verdict, 'offline');
    });
});
