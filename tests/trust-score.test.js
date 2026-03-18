// tests/trust-score.test.js — Unit tests for Proof of Quality TrustScore engine

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    _test: {
        computeTrustScore,
        computeSuccessRate,
        computeLatencyScore,
        computeReviewScore,
        computeVolumeScore,
        extractPath,
        W,
    },
} = require('../lib/trust-score');

// ---------------------------------------------------------------------------
// Helper: create mock Supabase client
// ---------------------------------------------------------------------------
function mockSupabase(tables = {}) {
    const chain = () => {
        const builder = {
            select: () => builder,
            from: () => builder,
            eq: () => builder,
            gte: () => builder,
            not: () => builder,
            limit: () => builder,
            single: () => builder,
            order: () => builder,
            is: () => builder,
        };
        return builder;
    };

    return {
        from: (table) => {
            const data = tables[table] || [];
            const builder = {
                select: (cols, opts) => {
                    if (opts && opts.head) {
                        // count query
                        builder._countMode = true;
                    }
                    return builder;
                },
                eq: (col, val) => {
                    builder._filters = builder._filters || [];
                    builder._filters.push({ col, val });
                    return builder;
                },
                gte: () => builder,
                not: () => builder,
                limit: () => builder,
                single: () => {
                    builder._single = true;
                    return builder;
                },
                order: () => builder,
                is: () => builder,
                _countMode: false,
                _single: false,
                then: (resolve) => {
                    if (builder._countMode) {
                        resolve({ count: data.length, error: null });
                    } else if (builder._single) {
                        resolve({ data: data[0] || null, error: null });
                    } else {
                        resolve({ data, error: null });
                    }
                },
            };
            // Make it thenable (for await)
            builder[Symbol.for('nodejs.util.promisify.custom')] = undefined;
            return builder;
        },
    };
}

// ---------------------------------------------------------------------------
// extractPath
// ---------------------------------------------------------------------------
describe('extractPath', () => {
    it('extracts path from full URL', () => {
        assert.strictEqual(extractPath('https://x402-api.onrender.com/api/joke'), '/api/joke');
    });

    it('returns path as-is if already a path', () => {
        assert.strictEqual(extractPath('/api/joke'), '/api/joke');
    });

    it('returns null for empty input', () => {
        assert.strictEqual(extractPath(''), null);
        assert.strictEqual(extractPath(null), null);
        assert.strictEqual(extractPath(undefined), null);
    });

    it('returns null for non-path strings', () => {
        assert.strictEqual(extractPath('not-a-url'), null);
    });
});

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------
describe('Weights', () => {
    it('sum to 1.0', () => {
        const sum = W.SUCCESS_RATE + W.LATENCY + W.REVIEWS + W.VOLUME;
        assert.ok(Math.abs(sum - 1.0) < 1e-9, `Expected sum to be close to 1.0, got ${sum}`);
    });

    it('are all positive', () => {
        assert.ok(W.SUCCESS_RATE > 0);
        assert.ok(W.LATENCY > 0);
        assert.ok(W.REVIEWS > 0);
        assert.ok(W.VOLUME > 0);
    });

    it('success rate has highest weight', () => {
        assert.ok(W.SUCCESS_RATE >= W.LATENCY);
        assert.ok(W.SUCCESS_RATE >= W.REVIEWS);
        assert.ok(W.SUCCESS_RATE >= W.VOLUME);
    });
});

// ---------------------------------------------------------------------------
// computeReviewScore
// ---------------------------------------------------------------------------
describe('computeReviewScore', () => {
    it('returns null when no reviews', async () => {
        const sb = mockSupabase({ reviews: [] });
        const score = await computeReviewScore(sb, 'uuid-1');
        assert.strictEqual(score, null);
    });

    it('normalizes 5-star average to 1.0', async () => {
        const sb = mockSupabase({ reviews: [{ rating: 5 }, { rating: 5 }] });
        const score = await computeReviewScore(sb, 'uuid-1');
        assert.ok(Math.abs(score - 1.0) < 0.01, `Expected ~1.0, got ${score}`);
    });

    it('normalizes 1-star average to 0.0', async () => {
        const sb = mockSupabase({ reviews: [{ rating: 1 }, { rating: 1 }] });
        const score = await computeReviewScore(sb, 'uuid-1');
        assert.ok(Math.abs(score - 0.0) < 0.01, `Expected ~0.0, got ${score}`);
    });

    it('normalizes 3-star average to 0.5', async () => {
        const sb = mockSupabase({ reviews: [{ rating: 3 }, { rating: 3 }] });
        const score = await computeReviewScore(sb, 'uuid-1');
        assert.ok(Math.abs(score - 0.5) < 0.01, `Expected ~0.5, got ${score}`);
    });

    it('handles mixed ratings correctly', async () => {
        // avg = (5+4+3+2+1)/5 = 3.0 → (3-1)/4 = 0.5
        const sb = mockSupabase({ reviews: [
            { rating: 5 }, { rating: 4 }, { rating: 3 }, { rating: 2 }, { rating: 1 }
        ]});
        const score = await computeReviewScore(sb, 'uuid-1');
        assert.ok(Math.abs(score - 0.5) < 0.01, `Expected ~0.5, got ${score}`);
    });
});

// ---------------------------------------------------------------------------
// computeSuccessRate
// ---------------------------------------------------------------------------
describe('computeSuccessRate', () => {
    it('returns null with insufficient data', async () => {
        const sb = mockSupabase({
            monitoring_checks: [{ status: 'online' }],
            daily_checks: [],
        });
        const score = await computeSuccessRate(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        // Only 1 datapoint < MIN_DATAPOINTS (3)
        assert.strictEqual(score, null);
    });

    it('returns 1.0 when all checks pass', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { status: 'online' }, { status: 'online' }, { status: 'online' }, { status: 'online' }
            ],
            daily_checks: [],
        });
        const score = await computeSuccessRate(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.ok(Math.abs(score - 1.0) < 0.01, `Expected ~1.0, got ${score}`);
    });

    it('returns 0.0 when all checks fail', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { status: 'offline' }, { status: 'offline' }, { status: 'offline' }, { status: 'offline' }
            ],
            daily_checks: [],
        });
        const score = await computeSuccessRate(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.ok(Math.abs(score - 0.0) < 0.01, `Expected ~0.0, got ${score}`);
    });

    it('counts partial daily checks as 0.5', async () => {
        const sb = mockSupabase({
            monitoring_checks: [],
            daily_checks: [
                { overall_status: 'pass' },
                { overall_status: 'partial' },
                { overall_status: 'fail' },
                { overall_status: 'pass' },
            ],
        });
        // pass=2, partial=1(0.5), fail=1(0) → success = 2.5/4 = 0.625
        const score = await computeSuccessRate(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.ok(Math.abs(score - 0.625) < 0.01, `Expected ~0.625, got ${score}`);
    });
});

// ---------------------------------------------------------------------------
// computeLatencyScore
// ---------------------------------------------------------------------------
describe('computeLatencyScore', () => {
    it('returns null with insufficient data', async () => {
        const sb = mockSupabase({
            monitoring_checks: [{ latency: 100 }],
            daily_checks: [],
        });
        const score = await computeLatencyScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, null);
    });

    it('returns 1.0 for very fast responses', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { latency: 50 }, { latency: 80 }, { latency: 100 }, { latency: 120 }
            ],
            daily_checks: [],
        });
        const score = await computeLatencyScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, 1.0);
    });

    it('returns 0.0 for very slow responses', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { latency: 6000 }, { latency: 7000 }, { latency: 8000 }, { latency: 9000 }
            ],
            daily_checks: [],
        });
        const score = await computeLatencyScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, 0.0);
    });

    it('returns intermediate score for moderate latency', async () => {
        // P75 of [500, 1000, 2000, 3000] → sorted [500, 1000, 2000, 3000], p75=3000
        // score = 1 - (3000-200)/(5000-200) = 1 - 2800/4800 ≈ 0.417
        const sb = mockSupabase({
            monitoring_checks: [
                { latency: 500 }, { latency: 1000 }, { latency: 2000 }, { latency: 3000 }
            ],
            daily_checks: [],
        });
        const score = await computeLatencyScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.ok(score > 0);
        assert.ok(score < 1);
    });

    it('ignores null/zero latency values', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { latency: null }, { latency: 0 }, { latency: 100 }, { latency: 100 },
                { latency: 100 }, { latency: 100 },
            ],
            daily_checks: [],
        });
        const score = await computeLatencyScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, 1.0);
    });
});

// ---------------------------------------------------------------------------
// computeVolumeScore
// ---------------------------------------------------------------------------
describe('computeVolumeScore', () => {
    it('returns 0 for no volume', async () => {
        const sb = mockSupabase({
            monitoring_checks: [],
            daily_checks: [],
        });
        const score = await computeVolumeScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, 0);
    });

    it('returns value between 0 and 1 for moderate volume', async () => {
        // 100 checks → log10(100)/log10(10000) = 2/4 = 0.5
        const checks = Array(100).fill({ id: '1' });
        const sb = mockSupabase({
            monitoring_checks: checks,
            daily_checks: [],
        });
        const score = await computeVolumeScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.ok(Math.abs(score - 0.5) < 0.01, `Expected ~0.5, got ${score}`);
    });

    it('caps at 1.0 for very high volume', async () => {
        const checks = Array(15000).fill({ id: '1' });
        const sb = mockSupabase({
            monitoring_checks: checks,
            daily_checks: [],
        });
        const score = await computeVolumeScore(sb, 'https://x402-api.onrender.com/api/joke', 'uuid-1', new Date().toISOString());
        assert.strictEqual(score, 1.0);
    });
});

// ---------------------------------------------------------------------------
// computeTrustScore (integration)
// ---------------------------------------------------------------------------
describe('computeTrustScore', () => {
    it('returns default score 43 when no data available', async () => {
        const sb = mockSupabase({
            monitoring_checks: [],
            daily_checks: [],
            reviews: [],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.strictEqual(result.hasData, false);
        assert.strictEqual(result.score, 43); // Default neutral score (0.5*W for S/L/R + 0 for V)
    });

    it('returns a score between 0 and 100 with data', async () => {
        const sb = mockSupabase({
            monitoring_checks: [
                { status: 'online', latency: 100 },
                { status: 'online', latency: 150 },
                { status: 'online', latency: 200 },
                { status: 'offline', latency: 5000 },
            ],
            daily_checks: [],
            reviews: [{ rating: 4 }, { rating: 5 }],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.strictEqual(result.hasData, true);
        assert.ok(result.score >= 0);
        assert.ok(result.score <= 100);
    });

    it('returns higher score for perfect service', async () => {
        const perfect = mockSupabase({
            monitoring_checks: Array(100).fill({ status: 'online', latency: 50 }),
            daily_checks: Array(10).fill({ overall_status: 'pass', call_latency_ms: 80 }),
            reviews: [{ rating: 5 }, { rating: 5 }, { rating: 5 }],
        });

        const poor = mockSupabase({
            monitoring_checks: Array(100).fill({ status: 'offline', latency: 8000 }),
            daily_checks: Array(10).fill({ overall_status: 'fail', call_latency_ms: 9000 }),
            reviews: [{ rating: 1 }, { rating: 1 }, { rating: 1 }],
        });

        const perfectResult = await computeTrustScore(perfect, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        const poorResult = await computeTrustScore(poor, { id: 'uuid-2', url: 'https://x402-api.onrender.com/api/joke' });

        assert.ok(perfectResult.score > poorResult.score);
        assert.ok(perfectResult.score >= 80);
        assert.ok(poorResult.score <= 30);
    });

    it('uses neutral defaults (0.5) for missing components', async () => {
        // Only monitoring data, no reviews, no daily checks
        const sb = mockSupabase({
            monitoring_checks: Array(10).fill({ status: 'online', latency: 100 }),
            daily_checks: [],
            reviews: [],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.strictEqual(result.hasData, true);
        // S=1.0, L=1.0, R=0.5(default), V=log10(10)/log10(10000)=0.25
        // = 0.40*1.0 + 0.25*1.0 + 0.20*0.5 + 0.15*0.25 = 0.40 + 0.25 + 0.10 + 0.0375 = 0.7875 → 79
        assert.ok(result.score >= 70);
        assert.ok(result.score <= 85);
    });

    it('factors object contains all 4 components', async () => {
        const sb = mockSupabase({
            monitoring_checks: Array(10).fill({ status: 'online', latency: 100 }),
            daily_checks: [],
            reviews: [{ rating: 4 }],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.ok(result.factors !== undefined);
        assert.ok('S' in result.factors);
        assert.ok('L' in result.factors);
        assert.ok('R' in result.factors);
        assert.ok('V' in result.factors);
    });

    it('score is an integer', async () => {
        const sb = mockSupabase({
            monitoring_checks: Array(5).fill({ status: 'online', latency: 300 }),
            daily_checks: [],
            reviews: [{ rating: 3 }],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.ok(Number.isInteger(result.score));
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
    it('handles external service URL (non-onrender)', async () => {
        const sb = mockSupabase({
            monitoring_checks: Array(5).fill({ status: 'online', latency: 200 }),
            daily_checks: [],
            reviews: [],
        });
        const result = await computeTrustScore(sb, { id: 'uuid-ext', url: 'https://api.interzoid.com/getcompanymatch' });
        // Should still work — extractPath gets /getcompanymatch
        assert.ok(result !== undefined);
    });

    it('score is clamped to 0-100', async () => {
        const sb = mockSupabase({
            monitoring_checks: Array(20000).fill({ status: 'online', latency: 10 }),
            daily_checks: Array(500).fill({ overall_status: 'pass', call_latency_ms: 5 }),
            reviews: Array(100).fill({ rating: 5 }),
        });
        const result = await computeTrustScore(sb, { id: 'uuid-1', url: 'https://x402-api.onrender.com/api/joke' });
        assert.ok(result.score <= 100);
        assert.ok(result.score >= 0);
    });
});
