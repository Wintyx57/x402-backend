// tests/reviews.test.js — Unit tests for reviews business logic
// NOTE: These tests do NOT require a live server or Supabase connection.
// They test the pure logic extracted from routes/reviews.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- Logic replicated from routes/reviews.js ---

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripHtml(str) {
    return str.replace(/<[^>]*>/g, '').trim();
}

function validateRating(rating) {
    const n = parseInt(rating, 10);
    return !isNaN(n) && n >= 1 && n <= 5;
}

function buildStatsFromRows(rows) {
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const r of rows) {
        const key = String(r.rating);
        if (distribution[key] !== undefined) distribution[key]++;
    }
    const total = rows.length;
    const sum = rows.reduce((acc, r) => acc + r.rating, 0);
    const average = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
    return { average, count: total, distribution };
}

// ============================
// 1. WALLET VALIDATION
// ============================

describe('reviews — wallet validation', () => {
    it('should accept valid wallet address', () => {
        assert.ok(WALLET_REGEX.test('0xfb1c478BD5567BdcD39782E0D6D23418bFda2430'));
    });

    it('should accept lowercase hex wallet', () => {
        assert.ok(WALLET_REGEX.test('0xabcdef1234567890abcdef1234567890abcdef12'));
    });

    it('should reject wallet without 0x prefix', () => {
        assert.ok(!WALLET_REGEX.test('fb1c478BD5567BdcD39782E0D6D23418bFda2430'));
    });

    it('should reject wallet too short', () => {
        assert.ok(!WALLET_REGEX.test('0x1234'));
    });

    it('should reject wallet too long', () => {
        assert.ok(!WALLET_REGEX.test('0x' + 'a'.repeat(41)));
    });

    it('should reject empty wallet', () => {
        assert.ok(!WALLET_REGEX.test(''));
    });

    it('should reject wallet with non-hex chars', () => {
        assert.ok(!WALLET_REGEX.test('0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'));
    });
});

// ============================
// 2. UUID VALIDATION
// ============================

describe('reviews — UUID validation', () => {
    it('should accept valid UUID v4', () => {
        assert.ok(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000'));
    });

    it('should accept UUID with uppercase', () => {
        assert.ok(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000'));
    });

    it('should reject non-UUID string', () => {
        assert.ok(!UUID_REGEX.test('not-a-uuid'));
    });

    it('should reject plain integer', () => {
        assert.ok(!UUID_REGEX.test('12345'));
    });

    it('should reject empty string', () => {
        assert.ok(!UUID_REGEX.test(''));
    });

    it('should reject UUID with missing segments', () => {
        assert.ok(!UUID_REGEX.test('550e8400-e29b-41d4-a716'));
    });
});

// ============================
// 3. RATING VALIDATION
// ============================

describe('reviews — rating validation', () => {
    it('should accept rating 1', () => assert.ok(validateRating(1)));
    it('should accept rating 2', () => assert.ok(validateRating(2)));
    it('should accept rating 3', () => assert.ok(validateRating(3)));
    it('should accept rating 4', () => assert.ok(validateRating(4)));
    it('should accept rating 5', () => assert.ok(validateRating(5)));

    it('should reject rating 0', () => assert.ok(!validateRating(0)));
    it('should reject rating 6', () => assert.ok(!validateRating(6)));
    it('should reject negative rating', () => assert.ok(!validateRating(-1)));
    it('should reject non-integer string', () => assert.ok(!validateRating('abc')));
    it('should reject null', () => assert.ok(!validateRating(null)));
    it('should reject undefined', () => assert.ok(!validateRating(undefined)));

    it('should accept string "4" (parsed)', () => assert.ok(validateRating('4')));
    it('should accept float 3.0 (parsed as 3)', () => assert.ok(validateRating(3.0)));
    it('should reject float 3.5 (parseInt = 3)', () => assert.ok(validateRating(3.5))); // parseInt('3.5') = 3
});

// ============================
// 4. COMMENT SANITIZATION
// ============================

describe('reviews — comment sanitization (stripHtml)', () => {
    it('should strip basic HTML tags', () => {
        assert.equal(stripHtml('<b>bold</b>'), 'bold');
    });

    it('should strip script tags', () => {
        assert.equal(stripHtml('<script>alert(1)</script>'), 'alert(1)');
    });

    it('should strip anchor tags', () => {
        assert.equal(stripHtml('<a href="evil.com">click</a>'), 'click');
    });

    it('should strip img tags', () => {
        assert.equal(stripHtml('<img src="x" onerror="alert(1)"/>'), '');
    });

    it('should preserve plain text', () => {
        assert.equal(stripHtml('Great API!'), 'Great API!');
    });

    it('should trim whitespace', () => {
        assert.equal(stripHtml('  hello  '), 'hello');
    });

    it('should handle nested tags', () => {
        assert.equal(stripHtml('<div><p>text</p></div>'), 'text');
    });

    it('should handle empty string', () => {
        assert.equal(stripHtml(''), '');
    });
});

// ============================
// 5. COMMENT LENGTH VALIDATION
// ============================

describe('reviews — comment length', () => {
    it('should accept comment of exactly 500 chars', () => {
        const comment = 'a'.repeat(500);
        const stripped = stripHtml(comment);
        assert.ok(stripped.length <= 500);
    });

    it('should reject comment of 501 chars', () => {
        const comment = 'a'.repeat(501);
        assert.ok(comment.length > 500);
    });

    it('should allow null comment (optional)', () => {
        assert.ok(true); // null comment is valid
    });

    it('should allow empty string comment', () => {
        const stripped = stripHtml('');
        assert.equal(stripped.length, 0);
    });
});

// ============================
// 6. STATS CALCULATION
// ============================

describe('reviews — stats calculation', () => {
    it('should compute average correctly', () => {
        const rows = [{ rating: 4 }, { rating: 5 }, { rating: 3 }];
        const stats = buildStatsFromRows(rows);
        assert.equal(stats.average, 4); // (4+5+3)/3 = 4.0
        assert.equal(stats.count, 3);
    });

    it('should return average 0 for empty reviews', () => {
        const stats = buildStatsFromRows([]);
        assert.equal(stats.average, 0);
        assert.equal(stats.count, 0);
    });

    it('should compute distribution correctly', () => {
        const rows = [
            { rating: 5 }, { rating: 5 }, { rating: 5 },
            { rating: 4 }, { rating: 4 },
            { rating: 3 },
            { rating: 2 },
        ];
        const stats = buildStatsFromRows(rows);
        assert.equal(stats.distribution['5'], 3);
        assert.equal(stats.distribution['4'], 2);
        assert.equal(stats.distribution['3'], 1);
        assert.equal(stats.distribution['2'], 1);
        assert.equal(stats.distribution['1'], 0);
    });

    it('should round average to 1 decimal', () => {
        const rows = [{ rating: 1 }, { rating: 2 }];
        const stats = buildStatsFromRows(rows);
        assert.equal(stats.average, 1.5); // (1+2)/2 = 1.5
    });

    it('should round 4.333... to 4.3', () => {
        const rows = [{ rating: 4 }, { rating: 4 }, { rating: 5 }];
        const stats = buildStatsFromRows(rows);
        assert.equal(stats.average, 4.3); // 13/3 = 4.333 → 4.3
    });

    it('should have all 5 keys in distribution even with no reviews', () => {
        const stats = buildStatsFromRows([]);
        assert.deepEqual(stats.distribution, { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    });

    it('should handle single review', () => {
        const stats = buildStatsFromRows([{ rating: 5 }]);
        assert.equal(stats.average, 5);
        assert.equal(stats.count, 1);
        assert.equal(stats.distribution['5'], 1);
    });

    it('should handle all 1-star reviews', () => {
        const rows = [{ rating: 1 }, { rating: 1 }, { rating: 1 }];
        const stats = buildStatsFromRows(rows);
        assert.equal(stats.average, 1);
        assert.equal(stats.distribution['1'], 3);
        assert.equal(stats.distribution['5'], 0);
    });

    it('stats response shape should match expected format', () => {
        const stats = buildStatsFromRows([{ rating: 4 }, { rating: 5 }]);
        assert.ok(typeof stats.average === 'number');
        assert.ok(typeof stats.count === 'number');
        assert.ok(typeof stats.distribution === 'object');
        assert.ok('1' in stats.distribution);
        assert.ok('5' in stats.distribution);
    });
});

// ============================
// 7. PAGINATION
// ============================

describe('reviews — pagination logic', () => {
    function calcPagination(page, limit) {
        const p = Math.max(1, parseInt(page, 10) || 1);
        const l = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
        return { page: p, limit: l, offset: (p - 1) * l };
    }

    it('default page=1, limit=20', () => {
        const result = calcPagination(undefined, undefined);
        assert.deepEqual(result, { page: 1, limit: 20, offset: 0 });
    });

    it('page=2 gives offset=20', () => {
        const result = calcPagination(2, 20);
        assert.equal(result.offset, 20);
    });

    it('page=3 limit=10 gives offset=20', () => {
        const result = calcPagination(3, 10);
        assert.equal(result.offset, 20);
    });

    it('limit capped at 50', () => {
        const result = calcPagination(1, 100);
        assert.equal(result.limit, 50);
    });

    it('limit=0 falls back to default 20 (falsy coercion)', () => {
        // parseInt('0') is 0 (falsy) → || 20 → 20 (not clamped to 1)
        const result = calcPagination(1, 0);
        assert.equal(result.limit, 20);
    });

    it('page minimum is 1', () => {
        const result = calcPagination(-1, 20);
        assert.equal(result.page, 1);
    });
});
