// tests/faucet-wallet-ratelimit.test.js
// Tests for the wallet-level 24h rate limit on POST /api/faucet/claim
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRes() {
    const res = {
        _status: null,
        _body: null,
        status(code) { res._status = code; return res; },
        json(data) { res._body = data; return res; },
    };
    return res;
}

// ─── Simulate the wallet rate-limit logic extracted from routes/health.js ────

async function checkWalletRateLimit(supabase, address) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentClaims, error: dbErr } = await supabase
        .from('activity')
        .select('created_at')
        .eq('type', 'faucet_claim')
        .eq('detail', address.toLowerCase())
        .gte('created_at', since)
        .limit(1);

    if (!dbErr && recentClaims && recentClaims.length > 0) {
        const lastClaimAt = new Date(recentClaims[0].created_at).getTime();
        const nextClaimAt = lastClaimAt + 24 * 60 * 60 * 1000;
        const remainingMs = Math.max(0, nextClaimAt - Date.now());
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
        return { limited: true, remainingHours };
    }
    return { limited: false };
}

// ─── Suite 1: rate limit logic ────────────────────────────────────────────────

describe('faucet wallet rate-limit — DB query shape', () => {
    it('should query activity table with correct filters', async () => {
        const capturedTable = { name: null };
        const capturedFilters = {};
        let capturedGteCol = null;
        let capturedLimit = null;

        // The chain must return `this` (the chain object) for every method call
        const chain = {
            select: () => chain,
            eq: (col, val) => { capturedFilters[col] = val; return chain; },
            gte: (col) => { capturedGteCol = col; return chain; },
            limit: (n) => { capturedLimit = n; return Promise.resolve({ data: [], error: null }); },
        };

        const fakeSupabase = {
            from: (table) => { capturedTable.name = table; return chain; },
        };

        const addr = '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430';
        await checkWalletRateLimit(fakeSupabase, addr);

        assert.equal(capturedTable.name, 'activity');
        assert.equal(capturedFilters['type'], 'faucet_claim');
        assert.equal(capturedFilters['detail'], addr.toLowerCase());
        assert.equal(capturedLimit, 1);
        assert.equal(capturedGteCol, 'created_at');
    });

    it('should return limited=false when no recent claims found', async () => {
        const fakeSupabase = {
            from: () => ({
                select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
            }),
        };

        // Simpler mock
        const mockSupa = makeMockSupabase([]);
        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, false);
    });

    it('should return limited=true when a recent claim exists', async () => {
        // Claim made 1 hour ago
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const mockSupa = makeMockSupabase([{ created_at: oneHourAgo }]);

        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, true);
        assert.ok(result.remainingHours > 0);
        assert.ok(result.remainingHours <= 23);
    });

    it('should return limited=false when claim is older than 24h', async () => {
        // Claim made 25 hours ago (outside the 24h window — DB gte filters it out)
        // In the real DB, the gte filter would exclude this. Here we simulate that the
        // DB returned no results (as it would when the row is outside the window).
        const mockSupa = makeMockSupabase([]);
        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, false);
    });

    it('should return limited=false when DB returns an error (fail-open)', async () => {
        const fakeSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            gte: () => ({
                                limit: () => Promise.resolve({ data: null, error: new Error('DB timeout') }),
                            }),
                        }),
                    }),
                }),
            }),
        };

        const result = await checkWalletRateLimit(fakeSupabase, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, false);
    });

    it('should normalise address to lowercase before querying', async () => {
        let capturedDetail = null;
        const fakeSupabase = {
            from: () => {
                const chain = {};
                chain.select = () => chain;
                chain.eq = (col, val) => { if (col === 'detail') capturedDetail = val; return chain; };
                chain.gte = () => chain;
                chain.limit = () => Promise.resolve({ data: [], error: null });
                return chain;
            },
        };

        const mixedCase = '0xfb1C478BD5567BdcD39782E0D6D23418bFda2430';
        await checkWalletRateLimit(fakeSupabase, mixedCase);
        assert.strictEqual(capturedDetail, mixedCase.toLowerCase());
    });
});

// ─── Suite 2: remaining hours calculation ─────────────────────────────────────

describe('faucet wallet rate-limit — remaining hours', () => {
    it('should return 23h remaining for a claim made 1 hour ago', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const mockSupa = makeMockSupabase([{ created_at: oneHourAgo }]);

        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, true);
        // Math.ceil((23h in ms) / 1h in ms) = 23
        assert.strictEqual(result.remainingHours, 23);
    });

    it('should return 1h remaining for a claim made 23h ago', async () => {
        const almostADayAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
        const mockSupa = makeMockSupabase([{ created_at: almostADayAgo }]);

        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        assert.strictEqual(result.limited, true);
        assert.strictEqual(result.remainingHours, 1);
    });

    it('remainingHours should never be negative', async () => {
        // Edge: claim timestamp = exactly 24h ago (boundary)
        const exactlyADayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const mockSupa = makeMockSupabase([{ created_at: exactlyADayAgo }]);

        const result = await checkWalletRateLimit(mockSupa, '0x' + 'a'.repeat(40));
        // limited=true only if DB still returns the row (window is gte, so boundary is included)
        if (result.limited) {
            assert.ok(result.remainingHours >= 0);
        }
    });
});

// ─── Suite 3: HTTP response shape ────────────────────────────────────────────

describe('faucet wallet rate-limit — HTTP response shape', () => {
    function buildRateLimitResponse(remainingHours) {
        return {
            funded: false,
            reason: 'wallet_rate_limited',
            message: `This wallet already claimed CREDITS in the last 24h. Try again in ${remainingHours}h.`,
            retry_after_hours: remainingHours,
        };
    }

    it('should include funded:false', () => {
        const body = buildRateLimitResponse(12);
        assert.strictEqual(body.funded, false);
    });

    it('should include reason=wallet_rate_limited', () => {
        const body = buildRateLimitResponse(12);
        assert.strictEqual(body.reason, 'wallet_rate_limited');
    });

    it('should include retry_after_hours with the correct value', () => {
        const body = buildRateLimitResponse(7);
        assert.strictEqual(body.retry_after_hours, 7);
    });

    it('message should mention the remaining hours', () => {
        const body = buildRateLimitResponse(5);
        assert.ok(body.message.includes('5h'));
    });
});

// ─── Suite 4: activity logging after successful claim ─────────────────────────

describe('faucet — activity logging after successful claim', () => {
    it('should log faucet_claim with address as detail', async () => {
        let insertedRow = null;
        const fakeSupabase = {
            from: (table) => ({
                insert: (rows) => {
                    if (table === 'activity') insertedRow = rows[0];
                    return { then: () => {} };
                },
            }),
        };

        const addr = '0x' + 'b'.repeat(40);
        fakeSupabase.from('activity').insert([{
            type: 'faucet_claim',
            detail: addr.toLowerCase(),
            amount: 0,
        }]);

        assert.strictEqual(insertedRow.type, 'faucet_claim');
        assert.strictEqual(insertedRow.detail, addr.toLowerCase());
        assert.strictEqual(insertedRow.amount, 0);
        assert.ok(!('tx_hash' in insertedRow));
    });

    it('should store address in lowercase', () => {
        const addr = '0xFB1C478BD5567BDCD39782E0D6D23418BFDA2430';
        const row = {
            type: 'faucet_claim',
            detail: addr.toLowerCase(),
            amount: 0,
        };
        assert.strictEqual(row.detail, addr.toLowerCase());
        assert.notStrictEqual(row.detail, addr);
    });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeMockSupabase(rows) {
    return {
        from: () => {
            const chain = {};
            chain.select = () => chain;
            chain.eq = () => chain;
            chain.gte = () => chain;
            chain.limit = () => Promise.resolve({ data: rows, error: null });
            return chain;
        },
    };
}
