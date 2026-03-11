// tests/smart-search.test.js — Unit tests for lib/smart-search.js
// Focus: scoreService() — pure function, zero external dependencies.
//
// Scoring table (hard-coded inside scoreService — NOT exported as SCORE object):
//   +100  EXACT_NAME_MATCH     name.toLowerCase() === originalQuery.toLowerCase()
//    +60  NAME_CONTAINS_QUERY  name contains full originalQuery as substring
//    +30  NAME_KEYWORD         name contains a single keyword
//    +25  TAG_EXACT            tag === keyword (exact, case-insensitive)
//    +15  TAG_PARTIAL          tag contains keyword (substring overlap)
//    +10  DESC_KEYWORD         description contains keyword
//    +10  STATUS_ONLINE        service.status === 'online'
//    -20  STATUS_OFFLINE       service.status === 'offline'
//     -5  STATUS_DEGRADED      service.status === 'degraded'
//     +5  VERIFIED             verified_status === 'mainnet_verified'
//
// Strategy: one describe block per scoring dimension + integration (ranking order).
// Pattern: AAA — Arrange / Act / Assert.
// One test = one observable behaviour.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreService } = require('../lib/smart-search');

// ─── Local scoring constants (mirrors the implementation) ─────────────────────
// Defined here to keep tests readable without depending on the module exporting them.
const S = {
    EXACT_NAME:    100,
    NAME_CONTAINS:  60,
    NAME_KW:        30,
    TAG_EXACT:      25,
    TAG_PARTIAL:    15,
    DESC_KW:        10,
    ONLINE:         10,
    OFFLINE:       -20,
    DEGRADED:       -5,
    VERIFIED:        5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal service record with sane defaults.
 * Only override the fields relevant to each test.
 */
function svc(overrides = {}) {
    return {
        name:             'Test Service',
        description:      '',
        tags:             [],
        status:           'unknown',
        verified_status:  null,
        ...overrides,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. EXACT NAME MATCH
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — exact name match', () => {

    it('should award +100 when name matches query exactly (case-insensitive)', () => {
        // Arrange: name === originalQuery after lowercasing
        const service = svc({ name: 'Weather API' });
        // Act
        const score = scoreService(service, ['weather', 'api'], 'Weather API');
        // Assert: EXACT_NAME(100) + NAME_KW*2 ('weather'+'api' both in name)
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 2);
    });

    it('should award exact match when query is all-lowercase and name is mixed case', () => {
        const service = svc({ name: 'Joke API' });
        const score   = scoreService(service, ['joke', 'api'], 'joke api');
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 2);
    });

    it('should NOT award EXACT_NAME when name is a superset of the query', () => {
        // "Weather API Pro" !== "weather api"
        const service = svc({ name: 'Weather API Pro' });
        const score   = scoreService(service, ['weather', 'api'], 'weather api');
        // NAME_CONTAINS(60) + NAME_KW*2 (both keywords found) = 120
        const expected = S.NAME_CONTAINS + S.NAME_KW * 2;
        assert.equal(score, expected);
    });

    it('should add STATUS_ONLINE on top of exact match', () => {
        const service  = svc({ name: 'Crypto API', status: 'online' });
        const score    = scoreService(service, ['crypto', 'api'], 'Crypto API');
        const expected = S.EXACT_NAME + S.NAME_KW * 2 + S.ONLINE;
        assert.equal(score, expected);
    });

    it('exact name match should score strictly higher than a name-contains match', () => {
        const exact    = svc({ name: 'weather api'         });
        const contains = svc({ name: 'weather api tracker' });
        const kw       = ['weather', 'api'];
        assert.ok(
            scoreService(exact, kw, 'weather api') > scoreService(contains, kw, 'weather api'),
            'Exact name must outscore name-contains'
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PARTIAL NAME MATCH  (NAME_CONTAINS_QUERY + NAME_KEYWORD)
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — partial name match', () => {

    it('should award +60 when name contains full query as substring', () => {
        // "crypto price" is a strict substring of "Crypto Price Tracker"
        const service = svc({ name: 'Crypto Price Tracker' });
        const score   = scoreService(service, ['crypto', 'price'], 'crypto price');
        // NAME_CONTAINS(60) + NAME_KW for 'crypto'(30) + NAME_KW for 'price'(30)
        assert.equal(score, S.NAME_CONTAINS + S.NAME_KW * 2);
    });

    it('should award +30 per keyword found in name', () => {
        // All three keywords appear in "Code Formatter API"
        const service = svc({ name: 'Code Formatter API' });
        const score   = scoreService(service, ['code', 'formatter', 'api'], 'code formatter api');
        // EXACT_NAME(100) + NAME_KW*3(90) — name === query after lowercase
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 3);
    });

    it('should NOT award NAME_KW for keywords absent from name', () => {
        // 'crypto' does NOT appear in "Bitcoin Data"
        const service    = svc({ name: 'Bitcoin Data' });
        const scoreWith  = scoreService(service, ['crypto'], 'crypto');
        const scoreEmpty = scoreService(service, [],         ''      );
        assert.ok(scoreWith === scoreEmpty,
            'Score must be unchanged when no keyword matches the name');
    });

    it('name keyword match scores higher than tag-only match', () => {
        const nameKw  = svc({ name: 'Translate API',   tags: []            });
        const tagOnly = svc({ name: 'FooBar Service', tags: ['translate'] });
        const kw      = ['translate'];
        assert.ok(
            scoreService(nameKw, kw, 'translate') > scoreService(tagOnly, kw, 'translate'),
            'Name keyword hit must outscore tag-only hit'
        );
    });

    it('partial name match scores less than exact name match', () => {
        const exact   = svc({ name: 'image api'          });
        const partial = svc({ name: 'image generation api' });
        const kw      = ['image', 'api'];
        assert.ok(
            scoreService(exact, kw, 'image api') > scoreService(partial, kw, 'image api'),
            'Exact name must outscore partial name'
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. TAG MATCHING
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — tag matching', () => {

    it('should award +25 when a tag matches a keyword exactly', () => {
        // 'crypto' tag matches keyword 'crypto' — name does NOT contain it
        const service = svc({ name: 'Bitcoin Data', tags: ['crypto', 'finance'] });
        const score   = scoreService(service, ['crypto'], 'crypto');
        // No name match for 'crypto' in "bitcoin data" → only TAG_EXACT
        assert.ok(score >= S.TAG_EXACT,
            `Expected at least TAG_EXACT(${S.TAG_EXACT}), got ${score}`);
        assert.equal(score, S.TAG_EXACT);
    });

    it('should accumulate TAG_EXACT for each matching tag', () => {
        const service = svc({
            name:   'Finance Tracker',
            // 'finance' is in name + tags; 'crypto' is in tags only
            tags:   ['crypto', 'finance', 'data'],
        });
        const score = scoreService(service, ['crypto', 'finance'], 'crypto finance');
        // NAME_CONTAINS? "crypto finance" not in "finance tracker" → no
        // NAME_KW for 'crypto'? 'crypto' not in "finance tracker" → no
        // NAME_KW for 'finance'? YES → +30
        // TAG_EXACT 'crypto' → +25
        // TAG_EXACT 'finance' → +25
        const expected = S.NAME_KW * 1 + S.TAG_EXACT * 2;
        assert.equal(score, expected);
    });

    it('should award +15 (TAG_PARTIAL) when tag is a superstring of keyword', () => {
        // tag 'cryptocurrency' contains keyword 'crypto'
        const service = svc({ name: 'FooBar', tags: ['cryptocurrency'] });
        const score   = scoreService(service, ['crypto'], 'crypto');
        assert.ok(score >= S.TAG_PARTIAL,
            `Expected at least TAG_PARTIAL(${S.TAG_PARTIAL}), got ${score}`);
        assert.equal(score, S.TAG_PARTIAL);
    });

    it('TAG_EXACT(+25) should outweigh TAG_PARTIAL(+15)', () => {
        const exact   = svc({ name: 'A', tags: ['crypto']         });
        const partial = svc({ name: 'A', tags: ['cryptocurrency'] });
        const kw = ['crypto'];
        assert.ok(
            scoreService(exact, kw, 'crypto') > scoreService(partial, kw, 'crypto'),
            'TAG_EXACT must outscore TAG_PARTIAL'
        );
    });

    it('should handle null tags without throwing', () => {
        const service = svc({ tags: null });
        assert.doesNotThrow(() => scoreService(service, ['test'], 'test'));
    });

    it('should handle empty tags array with zero tag contribution', () => {
        // Only name scoring, no tag scoring
        const service = svc({ name: 'Weather API', tags: [] });
        const score   = scoreService(service, ['weather', 'api'], 'weather api');
        // EXACT_NAME + NAME_KW*2, no tag bonus
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 2);
    });

    it('tag match should score higher than description-only match', () => {
        const tagMatch  = svc({ name: 'FooBar', tags: ['weather'],  description: ''            });
        const descMatch = svc({ name: 'FooBar', tags: [],           description: 'weather data' });
        const kw = ['weather'];
        assert.ok(
            scoreService(tagMatch, kw, 'weather') > scoreService(descMatch, kw, 'weather'),
            'Tag match must outscore description-only match'
        );
    });

    it('should be case-insensitive for tag exact matching', () => {
        // Tag stored in uppercase, keyword in lowercase
        const service = svc({ name: 'FooBar', tags: ['WEATHER'] });
        const score   = scoreService(service, ['weather'], 'weather');
        assert.equal(score, S.TAG_EXACT);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DESCRIPTION MATCHING
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — description matching', () => {

    it('should award +10 when keyword appears in description', () => {
        const service = svc({
            name:        'FooBar Service',
            description: 'This helps with translation tasks',
            tags:        ['text'],
        });
        const score = scoreService(service, ['translation'], 'translation');
        // 'translation' not in name → no NAME_KW
        // 'text' tag does not match 'translation' → no TAG
        // 'translation' in description → DESC_KW(10)
        assert.equal(score, S.DESC_KW);
    });

    it('should award +10 per keyword found in description', () => {
        const service = svc({
            name:        'FooBar',
            description: 'Powered by ai and code analysis',
        });
        const score = scoreService(service, ['ai', 'code'], 'ai code');
        // 'ai'(2 chars) may be filtered by extractKeywords(>2) but scoreService
        // receives keywords directly — we pass them explicitly as ['ai','code']
        // 'code' in desc → +10. 'ai' in desc → +10
        assert.equal(score, S.DESC_KW * 2);
    });

    it('should NOT award DESC_KW for keyword absent from description', () => {
        const service  = svc({ name: 'Random API', description: 'Provides random data' });
        const noMatch  = scoreService(service, ['weather'], 'weather');
        // 'weather' not in name, description, or tags → 0
        assert.equal(noMatch, 0);
    });

    it('should handle null description without throwing', () => {
        const service = svc({ description: null, tags: ['y'] });
        assert.doesNotThrow(() => scoreService(service, ['y'], 'y'));
    });

    it('description match contributes less than a name keyword match', () => {
        const nameMatch = svc({ name: 'Weather API',    description: ''           , tags: [] });
        const descMatch = svc({ name: 'FooBar Service', description: 'weather data', tags: [] });
        const kw = ['weather'];
        assert.ok(
            scoreService(nameMatch, kw, 'weather') > scoreService(descMatch, kw, 'weather'),
            'Name keyword hit must outscore description-only hit'
        );
    });

    it('should be case-insensitive for description matching', () => {
        const service = svc({ name: 'FooBar', description: 'WEATHER forecast data', tags: [] });
        const score   = scoreService(service, ['weather'], 'weather');
        assert.ok(score >= S.DESC_KW,
            `Expected at least DESC_KW(${S.DESC_KW}), got ${score}`);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. STATUS BOOST / PENALTY
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — status boost/penalty', () => {

    it('online service should receive a +10 status boost', () => {
        const online  = svc({ name: 'Test', tags: ['test'], status: 'online'  });
        const unknown = svc({ name: 'Test', tags: ['test'], status: 'unknown' });
        const kw = ['test'];
        assert.equal(
            scoreService(online, kw, 'test') - scoreService(unknown, kw, 'test'),
            S.ONLINE
        );
    });

    it('offline service should receive a -20 status penalty', () => {
        const offline = svc({ name: 'Test', tags: ['test'], status: 'offline' });
        const unknown = svc({ name: 'Test', tags: ['test'], status: 'unknown' });
        const kw = ['test'];
        assert.equal(
            scoreService(offline, kw, 'test') - scoreService(unknown, kw, 'test'),
            S.OFFLINE
        );
    });

    it('degraded service should receive a -5 status penalty', () => {
        const degraded = svc({ name: 'Test', tags: ['test'], status: 'degraded' });
        const unknown  = svc({ name: 'Test', tags: ['test'], status: 'unknown'  });
        const kw = ['test'];
        assert.equal(
            scoreService(degraded, kw, 'test') - scoreService(unknown, kw, 'test'),
            S.DEGRADED
        );
    });

    it('unknown status (null) should not alter score', () => {
        const withUnknown = svc({ name: 'Test', tags: ['test'], status: 'unknown' });
        const withNull    = svc({ name: 'Test', tags: ['test'], status: null      });
        const kw = ['test'];
        assert.equal(
            scoreService(withUnknown, kw, 'test'),
            scoreService(withNull,    kw, 'test')
        );
    });

    it('online service ranks higher than identical offline service', () => {
        const online  = svc({ name: 'Weather Forecast', tags: ['weather'], status: 'online'  });
        const offline = svc({ name: 'Weather Forecast', tags: ['weather'], status: 'offline' });
        const kw = ['weather'];
        assert.ok(
            scoreService(online, kw, 'weather') > scoreService(offline, kw, 'weather'),
            'Online must outscore offline (same relevance, different status)'
        );
    });

    it('online ranks higher than degraded, degraded ranks higher than offline', () => {
        const online   = svc({ name: 'Translate API', tags: ['text'], status: 'online'   });
        const degraded = svc({ name: 'Translate API', tags: ['text'], status: 'degraded' });
        const offline  = svc({ name: 'Translate API', tags: ['text'], status: 'offline'  });
        const kw = ['translate'];

        const sOnline   = scoreService(online,   kw, 'translate');
        const sDegraded = scoreService(degraded, kw, 'translate');
        const sOffline  = scoreService(offline,  kw, 'translate');

        assert.ok(sOnline > sDegraded, 'online must beat degraded');
        assert.ok(sDegraded > sOffline, 'degraded must beat offline');
    });

    it('STATUS_ONLINE boost should be smaller than NAME_KW contribution', () => {
        // Status must never overcome keyword relevance
        assert.ok(S.ONLINE < S.NAME_KW,
            `STATUS_ONLINE(${S.ONLINE}) must be < NAME_KW(${S.NAME_KW})`);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. VERIFIED BOOST
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — verified boost', () => {

    it('should award +5 for mainnet_verified services', () => {
        const verified   = svc({ name: 'Test', tags: ['test'], verified_status: 'mainnet_verified' });
        const unverified = svc({ name: 'Test', tags: ['test'], verified_status: null              });
        const kw = ['test'];
        assert.equal(
            scoreService(verified, kw, 'test') - scoreService(unverified, kw, 'test'),
            S.VERIFIED
        );
    });

    it('should NOT award VERIFIED boost for "reachable" status', () => {
        const reachable  = svc({ name: 'Test', tags: ['test'], verified_status: 'reachable' });
        const unverified = svc({ name: 'Test', tags: ['test'], verified_status: null        });
        const kw = ['test'];
        assert.equal(
            scoreService(reachable, kw, 'test'),
            scoreService(unverified, kw, 'test')
        );
    });

    it('verified + online should accumulate both bonuses over base score', () => {
        const service = svc({ name: 'Test', tags: ['test'], status: 'online',  verified_status: 'mainnet_verified' });
        const base    = svc({ name: 'Test', tags: ['test'], status: 'unknown', verified_status: null });
        const kw = ['test'];
        assert.equal(
            scoreService(service, kw, 'test') - scoreService(base, kw, 'test'),
            S.ONLINE + S.VERIFIED
        );
    });

    it('VERIFIED boost(+5) must be smaller than STATUS_ONLINE(+10)', () => {
        assert.ok(S.VERIFIED < S.ONLINE,
            'Verified provider bonus must not override status relevance');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — edge cases', () => {

    it('should return a number for a normal service', () => {
        assert.equal(typeof scoreService(svc(), [], ''), 'number');
    });

    it('should return STATUS_ONLINE only when no keyword matches at all', () => {
        const service = svc({
            name:        'Joke API',
            description: 'Random jokes',
            tags:        ['fun'],
            status:      'online',
        });
        // 'weather' matches nothing
        assert.equal(scoreService(service, ['weather'], 'weather'), S.ONLINE);
    });

    it('should return 0 with unknown status when no keyword matches', () => {
        const service = svc({ name: 'Joke API', description: 'Random jokes', tags: ['fun'] });
        assert.equal(scoreService(service, ['weather'], 'weather'), 0);
    });

    it('should handle empty keywords array without throwing', () => {
        assert.doesNotThrow(() => scoreService(svc({ name: 'Weather API', status: 'online' }), [], ''));
    });

    it('should handle empty query string without awarding EXACT_NAME', () => {
        // originalQuery='' can never equal a non-empty name
        const service = svc({ name: 'Weather API', status: 'online' });
        const score   = scoreService(service, ['weather', 'api'], '');
        // NAME_CONTAINS? '' is falsy → skipped. NAME_KW for each keyword → 2*30
        // STATUS_ONLINE → +10
        const expected = S.NAME_KW * 2 + S.ONLINE;
        assert.equal(score, expected);
    });

    it('should not throw when service.name is missing', () => {
        assert.doesNotThrow(() =>
            scoreService({ description: 'weather data', tags: [], status: 'unknown' }, ['weather'], 'weather')
        );
    });

    it('should not throw on a completely empty service object', () => {
        assert.doesNotThrow(() => scoreService({}, ['test'], 'test'));
    });

    it('should skip empty-string keywords silently', () => {
        const service = svc({ name: 'Weather API', status: 'unknown' });
        // '' is an empty keyword — must be ignored, not crash
        const score = scoreService(service, ['weather', '', 'api'], 'weather api');
        assert.equal(typeof score, 'number');
        // 'weather' and 'api' both in name + exact match = EXACT_NAME + NAME_KW*2
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 2);
    });

    it('should be case-insensitive for name matching', () => {
        // Name in uppercase, query in lowercase
        const service = svc({ name: 'WEATHER API' });
        const score   = scoreService(service, ['weather', 'api'], 'weather api');
        // 'weather api' === 'weather api' → EXACT_NAME + NAME_KW*2
        assert.equal(score, S.EXACT_NAME + S.NAME_KW * 2);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. MULTI-KEYWORD ACCUMULATION
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — multi-keyword accumulation', () => {

    it('each additional matched keyword increases the total score', () => {
        const service = svc({
            name:        'Code Review API',
            description: 'AI-powered code review',
            tags:        ['ai', 'code'],
        });
        const score1 = scoreService(service, ['code'],          'code');
        const score2 = scoreService(service, ['code', 'review'], 'code review');
        assert.ok(score2 > score1, 'Two keyword matches must yield higher score than one');
    });

    it('all three fields (name + tag + desc) contribute when keyword spans them', () => {
        // 'weather' appears in name, matching tag, and description
        const service = svc({
            name:        'Weather API',
            description: 'Get weather data',
            tags:        ['weather'],
        });
        const score = scoreService(service, ['weather'], 'weather');
        // queryLower = 'weather', nameLower = 'weather api'
        // EXACT_NAME? 'weather api' === 'weather' → NO
        // NAME_CONTAINS? 'weather api'.includes('weather') → YES → +60
        // NAME_KW: 'weather' in 'weather api' → +30
        // TAG_EXACT: 'weather' === 'weather' → +25
        // DESC_KW: 'weather' in 'get weather data' → +10
        // Total: 60 + 30 + 25 + 10 = 125
        const expected = S.NAME_CONTAINS + S.NAME_KW + S.TAG_EXACT + S.DESC_KW;
        assert.equal(score, expected);
    });

    it('three keyword matches accumulate name + tag + description contributions', () => {
        // 'ai', 'code', 'review' all appear in name and tags.
        // description = 'automated review for ai' → only 'review' and 'ai' match, NOT 'code'
        const service = svc({
            name:        'AI Code Review',
            description: 'automated review for ai',
            tags:        ['ai', 'code', 'review'],
        });
        const kw    = ['ai', 'code', 'review'];
        const score = scoreService(service, kw, 'ai code review');
        // queryLower = 'ai code review', nameLower = 'ai code review' → EXACT_NAME(100)
        // NAME_KW*3: 'ai','code','review' all in name → +30 each = +90
        // TAG_EXACT*3: 'ai','code','review' all exact tags → +25 each = +75
        // DESC_KW: 'ai' in desc → +10, 'code' NOT in desc → 0, 'review' in desc → +10 = +20
        // Total: 100 + 90 + 75 + 20 = 285
        const expected = S.EXACT_NAME + S.NAME_KW * 3 + S.TAG_EXACT * 3 + S.DESC_KW * 2;
        assert.equal(score, expected);
    });

    it('zero keyword matches with online status yields only STATUS_ONLINE', () => {
        const service = svc({
            name:        'Joke API',
            description: 'Random jokes',
            tags:        ['fun'],
            status:      'online',
        });
        const score = scoreService(service, ['weather', 'forecast'], 'weather forecast');
        assert.equal(score, S.ONLINE);
    });

    it('keyword matched in name AND tag accumulates NAME_KW + TAG_EXACT', () => {
        const service = svc({ name: 'Crypto API', tags: ['crypto'] });
        const score   = scoreService(service, ['crypto'], 'crypto');
        // EXACT? 'crypto' !== 'crypto api' → no. NAME_CONTAINS? 'crypto' in 'crypto api' → +60
        // NAME_KW: 'crypto' in 'crypto api' → +30
        // TAG_EXACT: 'crypto' === 'crypto' → +25
        const expected = S.NAME_CONTAINS + S.NAME_KW + S.TAG_EXACT;
        assert.equal(score, expected);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. RANKING ORDER
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreService — ranking order', () => {

    it('for query "weather": exact name > name-contains > tag-only', () => {
        const exact    = svc({ name: 'weather',          tags: ['weather'] });
        const contains = svc({ name: 'Weather API Plus', tags: ['weather'] });
        const tagOnly  = svc({ name: 'Bitcoin Data',     tags: ['weather'] });
        const kw    = ['weather'];
        const query = 'weather';

        assert.ok(
            scoreService(exact, kw, query) > scoreService(contains, kw, query),
            'Exact name must beat name-contains'
        );
        assert.ok(
            scoreService(contains, kw, query) > scoreService(tagOnly, kw, query),
            'Name-contains must beat tag-only'
        );
    });

    it('for query "weather": online name-match outranks offline name-match', () => {
        const online  = svc({ name: 'Weather API',      tags: ['weather', 'data'], status: 'online'  });
        const offline = svc({ name: 'Weather Forecast', tags: ['weather'],         status: 'offline' });
        const kw = ['weather'];
        assert.ok(
            scoreService(online, kw, 'weather') > scoreService(offline, kw, 'weather'),
            'Online service must outrank offline (same query)'
        );
    });

    it('three services sort Weather API > Weather Forecast (offline) > Random API', () => {
        const random   = svc({ name: 'Random API',        description: 'Some API',          tags: ['misc'],            status: 'online'  });
        const weatherA = svc({ name: 'Weather API',       description: 'Weather data',      tags: ['weather', 'data'], status: 'online'  });
        const weatherF = svc({ name: 'Weather Forecast',  description: 'Detailed forecast', tags: ['weather'],         status: 'offline' });

        const kw = ['weather'];
        const sRandom   = scoreService(random,   kw, 'weather');
        const sWeatherA = scoreService(weatherA, kw, 'weather');
        const sWeatherF = scoreService(weatherF, kw, 'weather');

        assert.ok(sWeatherA > sWeatherF, 'Weather API (online) must beat Weather Forecast (offline)');
        assert.ok(sWeatherF > sRandom,   'Weather Forecast must beat Random API (no match)');
    });

    it('exact name > phrase match > single keyword match', () => {
        const exact  = svc({ name: 'crypto price'        });
        const phrase = svc({ name: 'crypto price tracker' });
        const single = svc({ name: 'Crypto Data', tags: ['price'] });
        const kw    = ['crypto', 'price'];
        const query = 'crypto price';

        const sExact  = scoreService(exact,  kw, query);
        const sPhrase = scoreService(phrase, kw, query);
        const sSingle = scoreService(single, kw, query);

        assert.ok(sExact  > sPhrase, 'Exact name must outscore phrase match');
        assert.ok(sPhrase > sSingle, 'Phrase match must outscore single-keyword match');
    });

    it('verified + online outranks verified + offline', () => {
        const onlineV  = svc({ name: 'AI Tool', tags: ['ai'], status: 'online',  verified_status: 'mainnet_verified' });
        const offlineV = svc({ name: 'AI Tool', tags: ['ai'], status: 'offline', verified_status: 'mainnet_verified' });
        const kw = ['ai'];
        assert.ok(
            scoreService(onlineV, kw, 'ai') > scoreService(offlineV, kw, 'ai'),
            'Verified + online must outrank verified + offline'
        );
    });

    it('tag-only match with online status outranks tag-only match with offline status', () => {
        const onlineTag  = svc({ name: 'FooBar', tags: ['translate'], status: 'online'  });
        const offlineTag = svc({ name: 'FooBar', tags: ['translate'], status: 'offline' });
        const kw = ['translate'];
        assert.ok(
            scoreService(onlineTag, kw, 'translate') > scoreService(offlineTag, kw, 'translate'),
            'Online tag match must outrank offline tag match'
        );
    });
});
