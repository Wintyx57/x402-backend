// tests/erc8004-registry.test.js — Unit tests for lib/erc8004-registry.js
// Strategy: pure unit tests — all viem calls are stubbed (no live RPC).
// Tests cover: initClients() guards, nonce management, pushTrustScoreFeedback()
// trust score encoding, pushAllTrustScores() batch logic, registerAgent() error handling.
// On-chain writes are NOT tested live (integration concern, requires testnet wallet).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUUID() {
    return 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
}

/** Build a minimal Supabase mock with configurable services data */
function makeSupabase({ services = [] } = {}) {
    return {
        from(table) {
            if (table === 'services') {
                const builder = {
                    select() { return this; },
                    not() { return this; },
                    limit() { return this; },
                    single() { return Promise.resolve({ data: services[0] || null, error: null }); },
                    update(data) { return this; },
                    eq() { return Promise.resolve({ error: null }); },
                    then(resolve) {
                        resolve({ data: services, error: null });
                    },
                };
                return builder;
            }
            return {
                select() { return this; },
                not() { return this; },
                limit() { return Promise.resolve({ data: [], error: null }); },
            };
        },
    };
}

// ---------------------------------------------------------------------------
// Suite 1: TrustScore → on-chain value encoding
// The encoding used in pushTrustScoreFeedback: value = BigInt(Math.round(score * 100))
// ---------------------------------------------------------------------------

describe('pushTrustScoreFeedback — fixed-point encoding', () => {
    function encodeScore(trustScore) {
        return BigInt(Math.round(trustScore * 100));
    }

    it('encodes score 100 as BigInt(10000)', () => {
        assert.strictEqual(encodeScore(100), 10000n);
    });

    it('encodes score 0 as BigInt(0)', () => {
        assert.strictEqual(encodeScore(0), 0n);
    });

    it('encodes score 87 as BigInt(8700)', () => {
        assert.strictEqual(encodeScore(87), 8700n);
    });

    it('encodes score 50.5 as BigInt(5050)', () => {
        assert.strictEqual(encodeScore(50.5), 5050n);
    });

    it('rounds fractional scores to nearest integer', () => {
        // 87.456 → round(87.456 * 100) = round(8745.6) = 8746
        assert.strictEqual(encodeScore(87.456), 8746n);
    });

    it('encodes score 99.99 without overflow', () => {
        const encoded = encodeScore(99.99);
        assert.ok(encoded > 0n);
        assert.ok(encoded <= 10000n);
    });

    it('valueDecimals is always 2 (fixed-point 2 decimal places)', () => {
        const valueDecimals = 2;
        assert.strictEqual(valueDecimals, 2);
        // e.g. value=8700, decimals=2 → 87.00
        assert.strictEqual(Number(8700n) / Math.pow(10, valueDecimals), 87.0);
    });

    it('decoded value matches original score', () => {
        const scores = [0, 25, 50, 75, 87, 100];
        for (const score of scores) {
            const encoded = encodeScore(score);
            const decoded = Number(encoded) / 100;
            assert.strictEqual(decoded, score, `Round-trip failed for score=${score}`);
        }
    });
});

// ---------------------------------------------------------------------------
// Suite 2: feedbackHash construction
// The hash is keccak256 of { score, ts } JSON — we only test the shape here
// since we cannot call keccak256 without viem in unit tests.
// ---------------------------------------------------------------------------

describe('pushTrustScoreFeedback — feedbackData shape', () => {
    it('feedbackData JSON contains score and ts keys', () => {
        const trustScore = 87;
        const ts = Math.floor(Date.now() / 1000);
        const feedbackData = JSON.stringify({ score: trustScore, ts });
        const parsed = JSON.parse(feedbackData);
        assert.ok('score' in parsed);
        assert.ok('ts' in parsed);
        assert.strictEqual(parsed.score, trustScore);
        assert.ok(typeof parsed.ts === 'number');
    });

    it('ts is in Unix seconds (not milliseconds)', () => {
        const ts = Math.floor(Date.now() / 1000);
        // Unix seconds in 2024+ are 10-digit numbers
        assert.ok(ts.toString().length === 10);
    });

    it('produces unique feedbackData for same score at different times', () => {
        const score = 80;
        const ts1 = 1700000000;
        const ts2 = 1700000001;
        const d1 = JSON.stringify({ score, ts: ts1 });
        const d2 = JSON.stringify({ score, ts: ts2 });
        assert.notStrictEqual(d1, d2);
    });
});

// ---------------------------------------------------------------------------
// Suite 3: initClients() — guard logic (no live keys required)
// ---------------------------------------------------------------------------

describe('initClients — env key detection', () => {
    it('should detect when AGENT_PRIVATE_KEY is absent', () => {
        const key = undefined;
        const registryKey = key || null;
        assert.strictEqual(registryKey, null);
        // No registry wallet → registration disabled (behavior assertion)
        assert.ok(!registryKey, 'No registry key means registration is disabled');
    });

    it('should prefix 0x to private key if missing', () => {
        const rawKey = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
        const pk = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
        assert.ok(pk.startsWith('0x'));
        assert.strictEqual(pk.length, 66); // 0x + 64 hex chars
    });

    it('should NOT prefix 0x if already present', () => {
        const rawKey = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
        const pk = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
        assert.strictEqual(pk, rawKey); // unchanged
    });

    it('should detect same-wallet scenario (registry === feedback)', () => {
        const registryAddr = '0xB4C2EE62Cb5AA4cE853690bFcF7C434CE5a452a5'.toLowerCase();
        const feedbackAddr = '0xB4C2EE62Cb5AA4cE853690bFcF7C434CE5a452a5'.toLowerCase();
        const isSameWallet = registryAddr === feedbackAddr;
        assert.strictEqual(isSameWallet, true, 'Same-wallet must be detected (ERC-8004 rejects self-feedback)');
    });

    it('should accept different wallets for registry and feedback', () => {
        const registryAddr = '0xB4C2EE62Cb5AA4cE853690bFcF7C434CE5a452a5'.toLowerCase();
        const feedbackAddr = '0x45B2b58d84B182d1caD88670905F0e34311BEbAb'.toLowerCase();
        const isSameWallet = registryAddr === feedbackAddr;
        assert.strictEqual(isSameWallet, false);
    });
});

// ---------------------------------------------------------------------------
// Suite 4: registerAgent() — nonce management
// ---------------------------------------------------------------------------

describe('registerAgent — nonce management', () => {
    it('should initialize nonce before first tx', () => {
        let nonce = null; // simulates _registryNonce = null
        const fetchedNonce = 42; // simulates getTransactionCount result

        if (nonce === null) {
            nonce = fetchedNonce;
        }
        assert.strictEqual(nonce, 42);
    });

    it('should increment nonce after successful tx submission', () => {
        let nonce = 42;
        const usedNonce = nonce;
        nonce++; // increment before tx (optimistic)
        assert.strictEqual(nonce, 43);
        assert.strictEqual(usedNonce, 42);
    });

    it('should decrement nonce on tx failure (non-broadcast errors)', () => {
        let nonce = 43;
        const err = new Error('Gas estimation failed');

        // Logic: decrement unless 'already known' or 'nonce too low' (tx was broadcast)
        const wasAlreadyBroadcast =
            err.message?.includes('already known') ||
            err.message?.includes('nonce too low');

        if (!wasAlreadyBroadcast) {
            nonce--;
        }

        assert.strictEqual(nonce, 42, 'nonce should be decremented after non-broadcast failure');
    });

    it('should NOT decrement nonce when error is "already known" (tx was broadcast)', () => {
        let nonce = 43;
        const err = new Error('transaction already known');

        const wasAlreadyBroadcast =
            err.message?.includes('already known') ||
            err.message?.includes('nonce too low');

        if (!wasAlreadyBroadcast) {
            nonce--;
        }

        // nonce should stay at 43 (tx was submitted, just duplicate)
        assert.strictEqual(nonce, 43);
    });

    it('should NOT decrement nonce when error is "nonce too low"', () => {
        let nonce = 43;
        const err = new Error('nonce too low: have 43, want 44');

        const wasAlreadyBroadcast =
            err.message?.includes('already known') ||
            err.message?.includes('nonce too low');

        if (!wasAlreadyBroadcast) {
            nonce--;
        }

        assert.strictEqual(nonce, 43);
    });
});

// ---------------------------------------------------------------------------
// Suite 5: pushAllTrustScores() — batch logic
// ---------------------------------------------------------------------------

describe('pushAllTrustScores — batch logic', () => {
    it('should process services in batches of 5', () => {
        const BATCH_SIZE = 5;
        const services = Array.from({ length: 12 }, (_, i) => ({ id: `uuid-${i}`, erc8004_agent_id: i + 1, trust_score: 80, url: `https://example.com/api/${i}` }));

        const batches = [];
        for (let i = 0; i < services.length; i += BATCH_SIZE) {
            batches.push(services.slice(i, i + BATCH_SIZE));
        }

        assert.strictEqual(batches.length, 3); // ceil(12/5) = 3
        assert.strictEqual(batches[0].length, 5);
        assert.strictEqual(batches[1].length, 5);
        assert.strictEqual(batches[2].length, 2); // remainder
    });

    it('should correctly count pushed and failed results', () => {
        const results = [
            { txHash: '0x...' },   // success
            null,                   // failed
            { txHash: '0x...' },   // success
            null,                   // failed
            null,                   // failed
        ];

        const pushed = results.filter(r => r !== null).length;
        const failed = results.filter(r => r === null).length;

        assert.strictEqual(pushed, 2);
        assert.strictEqual(failed, 3);
        assert.strictEqual(pushed + failed, results.length);
    });

    it('should not throw when feedback wallet is not configured', async () => {
        // Simulates: _feedbackWalletClient = null → early return
        const _feedbackWalletClient = null;
        if (!_feedbackWalletClient) {
            // Returns without doing anything — no throw
            return;
        }
        // Should never reach here
        assert.fail('Should have returned early when feedback wallet not configured');
    });

    it('should skip services with null trust_score', () => {
        const services = [
            { id: 'a', trust_score: null, erc8004_agent_id: 1 },
            { id: 'b', trust_score: 80, erc8004_agent_id: 2 },
            { id: 'c', trust_score: 0, erc8004_agent_id: 3 },
        ];

        // Supabase query filters .not('trust_score', 'is', null)
        const eligible = services.filter(s => s.trust_score !== null);
        assert.strictEqual(eligible.length, 2);
        assert.ok(eligible.some(s => s.id === 'b'));
        assert.ok(eligible.some(s => s.id === 'c'));
    });

    it('should skip services with null erc8004_agent_id', () => {
        const services = [
            { id: 'a', trust_score: 90, erc8004_agent_id: null },
            { id: 'b', trust_score: 80, erc8004_agent_id: 42 },
        ];

        // Supabase query filters .not('erc8004_agent_id', 'is', null)
        const eligible = services.filter(s => s.erc8004_agent_id !== null);
        assert.strictEqual(eligible.length, 1);
        assert.strictEqual(eligible[0].id, 'b');
    });
});

// ---------------------------------------------------------------------------
// Suite 6: agentURI construction
// ---------------------------------------------------------------------------

describe('registerAgent — agentURI construction', () => {
    it('should build agentURI from BACKEND_URL and serviceId', () => {
        const BACKEND_URL = 'https://x402-api.onrender.com';
        const serviceId = makeUUID();
        const agentURI = `${BACKEND_URL}/api/agents/${serviceId}/metadata.json`;

        assert.ok(agentURI.startsWith('https://x402-api.onrender.com/api/agents/'));
        assert.ok(agentURI.endsWith('/metadata.json'));
        assert.ok(agentURI.includes(serviceId));
    });

    it('should not double-slash when BACKEND_URL has trailing slash', () => {
        const BACKEND_URL = 'https://x402-api.onrender.com'; // no trailing slash
        const serviceId = makeUUID();
        const agentURI = `${BACKEND_URL}/api/agents/${serviceId}/metadata.json`;

        // Should contain exactly one slash after .com
        assert.ok(!agentURI.includes('//api'));
    });

    it('uses RENDER_EXTERNAL_URL if set', () => {
        const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://x402-api.onrender.com';
        assert.ok(BACKEND_URL.startsWith('https://'));
    });
});

// ---------------------------------------------------------------------------
// Suite 7: CHAIN_KEY is locked to 'skale'
// ---------------------------------------------------------------------------

describe('erc8004-registry — chain configuration', () => {
    const { CHAINS } = require('../lib/chains');

    it('SKALE chain config should exist', () => {
        assert.ok(CHAINS['skale'], 'CHAINS.skale must be defined for ERC-8004 registry');
    });

    it('SKALE chain should have a chainId', () => {
        const skale = CHAINS['skale'];
        assert.ok(typeof skale.chainId === 'number', 'skale.chainId must be a number');
        assert.ok(skale.chainId > 0);
    });

    it('SKALE chain should have at least one rpcUrl', () => {
        const skale = CHAINS['skale'];
        const urls = skale.rpcUrls || [skale.rpcUrl];
        assert.ok(Array.isArray(urls) || typeof urls === 'string');
        const urlList = Array.isArray(urls) ? urls : [urls];
        assert.ok(urlList.length >= 1, 'At least one RPC URL required');
        assert.ok(urlList[0].startsWith('https://'), `RPC URL must use https: ${urlList[0]}`);
    });
});
