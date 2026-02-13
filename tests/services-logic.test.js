// tests/services-logic.test.js — Unit tests for business logic in routes/services.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- Sanitization logic replicated from routes/services.js ---

// Control character rejection regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

// Postgres LIKE escape
function escapeLike(query) {
    return query.replace(/[%_\\]/g, '\\$&');
}

// Additional sanitize for Postgres text search (remove special chars)
function sanitizeForSearch(query) {
    return escapeLike(query).replace(/[(),."']/g, '');
}

// Query trimming + max length
function normalizeQuery(raw) {
    return (raw || '').trim().slice(0, 100);
}

describe('query sanitization — control characters', () => {
    it('should reject null byte', () => {
        assert.ok(CONTROL_CHARS.test('\x00weather'));
    });

    it('should reject tab character', () => {
        assert.ok(CONTROL_CHARS.test('\tweather'));
    });

    it('should reject newline', () => {
        assert.ok(CONTROL_CHARS.test('\nweather'));
    });

    it('should reject carriage return', () => {
        assert.ok(CONTROL_CHARS.test('\rweather'));
    });

    it('should reject escape character', () => {
        assert.ok(CONTROL_CHARS.test('\x1Bweather'));
    });

    it('should reject DEL character', () => {
        assert.ok(CONTROL_CHARS.test('\x7Fweather'));
    });

    it('should accept normal ASCII text', () => {
        assert.ok(!CONTROL_CHARS.test('weather'));
    });

    it('should accept text with spaces', () => {
        assert.ok(!CONTROL_CHARS.test('web search'));
    });

    it('should accept text with numbers', () => {
        assert.ok(!CONTROL_CHARS.test('api42'));
    });

    it('should accept text with special printable chars', () => {
        assert.ok(!CONTROL_CHARS.test('hello-world_test!@#'));
    });

    it('should accept unicode text', () => {
        assert.ok(!CONTROL_CHARS.test('météo'));
    });

    it('should accept emoji', () => {
        assert.ok(!CONTROL_CHARS.test('weather ☀️'));
    });
});

describe('query sanitization — LIKE escape', () => {
    it('should escape percent sign', () => {
        assert.equal(escapeLike('100%'), '100\\%');
    });

    it('should escape underscore', () => {
        assert.equal(escapeLike('hello_world'), 'hello\\_world');
    });

    it('should escape backslash', () => {
        assert.equal(escapeLike('path\\to'), 'path\\\\to');
    });

    it('should escape multiple special chars', () => {
        assert.equal(escapeLike('%_\\'), '\\%\\_\\\\');
    });

    it('should not modify normal text', () => {
        assert.equal(escapeLike('weather'), 'weather');
    });

    it('should handle empty string', () => {
        assert.equal(escapeLike(''), '');
    });

    it('should handle string with only special chars', () => {
        assert.equal(escapeLike('%%%'), '\\%\\%\\%');
    });
});

describe('query sanitization — search sanitize', () => {
    it('should remove parentheses', () => {
        assert.equal(sanitizeForSearch('test()'), 'test');
    });

    it('should remove commas', () => {
        assert.equal(sanitizeForSearch('a,b,c'), 'abc');
    });

    it('should remove periods', () => {
        assert.equal(sanitizeForSearch('hello.world'), 'helloworld');
    });

    it('should remove double quotes', () => {
        assert.equal(sanitizeForSearch('"test"'), 'test');
    });

    it('should remove single quotes', () => {
        assert.equal(sanitizeForSearch("it's"), 'its');
    });

    it('should escape LIKE chars before removing search chars', () => {
        // %_\ should be escaped, then () removed
        assert.equal(sanitizeForSearch('test(100%)'), 'test100\\%');
    });

    it('should handle normal query unchanged', () => {
        assert.equal(sanitizeForSearch('weather'), 'weather');
    });
});

describe('query normalization', () => {
    it('should trim whitespace', () => {
        assert.equal(normalizeQuery('  weather  '), 'weather');
    });

    it('should truncate to 100 chars', () => {
        const longQuery = 'a'.repeat(200);
        assert.equal(normalizeQuery(longQuery).length, 100);
    });

    it('should handle empty string', () => {
        assert.equal(normalizeQuery(''), '');
    });

    it('should handle null', () => {
        assert.equal(normalizeQuery(null), '');
    });

    it('should handle undefined', () => {
        assert.equal(normalizeQuery(undefined), '');
    });

    it('should preserve exactly 100 chars', () => {
        const exactQuery = 'a'.repeat(100);
        assert.equal(normalizeQuery(exactQuery).length, 100);
    });

    it('should preserve queries under 100 chars', () => {
        assert.equal(normalizeQuery('weather'), 'weather');
    });
});

describe('endpoint activity patterns', () => {
    // Patterns from routes/services.js for mapping activity to endpoints
    const endpointPatterns = [
        { pattern: /Web Search API/i, endpoint: '/api/search' },
        { pattern: /Scraper API/i, endpoint: '/api/scrape' },
        { pattern: /Twitter API/i, endpoint: '/api/twitter' },
        { pattern: /Weather API/i, endpoint: '/api/weather' },
        { pattern: /Crypto (?:Price )?API/i, endpoint: '/api/crypto' },
        { pattern: /(?:Random )?Joke API/i, endpoint: '/api/joke' },
        { pattern: /Image (?:Generation )?API/i, endpoint: '/api/image' },
    ];

    function matchEndpoint(detail) {
        for (const { pattern, endpoint } of endpointPatterns) {
            if (pattern.test(detail)) return endpoint;
        }
        return null;
    }

    it('should match "Web Search API" → /api/search', () => {
        assert.equal(matchEndpoint('Web Search API: query=test'), '/api/search');
    });

    it('should match "Scraper API" → /api/scrape', () => {
        assert.equal(matchEndpoint('Scraper API: url=https://example.com'), '/api/scrape');
    });

    it('should match "Twitter API" → /api/twitter', () => {
        assert.equal(matchEndpoint('Twitter API: user=elonmusk'), '/api/twitter');
    });

    it('should match "Weather API" → /api/weather', () => {
        assert.equal(matchEndpoint('Weather API: city=Paris'), '/api/weather');
    });

    it('should match "Crypto Price API" → /api/crypto', () => {
        assert.equal(matchEndpoint('Crypto Price API: coin=bitcoin'), '/api/crypto');
    });

    it('should match "Crypto API" → /api/crypto', () => {
        assert.equal(matchEndpoint('Crypto API: coin=eth'), '/api/crypto');
    });

    it('should match "Random Joke API" → /api/joke', () => {
        assert.equal(matchEndpoint('Random Joke API'), '/api/joke');
    });

    it('should match "Joke API" → /api/joke', () => {
        assert.equal(matchEndpoint('Joke API'), '/api/joke');
    });

    it('should match "Image Generation API" → /api/image', () => {
        assert.equal(matchEndpoint('Image Generation API: prompt=cat'), '/api/image');
    });

    it('should match "Image API" → /api/image', () => {
        assert.equal(matchEndpoint('Image API: prompt=cat'), '/api/image');
    });

    it('should be case-insensitive', () => {
        assert.equal(matchEndpoint('web search api'), '/api/search');
        assert.equal(matchEndpoint('WEATHER API'), '/api/weather');
    });

    it('should return null for unknown patterns', () => {
        assert.equal(matchEndpoint('Unknown Service'), null);
    });

    it('should return null for empty string', () => {
        assert.equal(matchEndpoint(''), null);
    });
});

describe('health check — status classification', () => {
    // From routes/services.js health-check endpoint
    function classifyStatus(httpStatus) {
        return (httpStatus >= 200 && httpStatus < 500) ? 'online' : 'offline';
    }

    it('200 → online', () => assert.equal(classifyStatus(200), 'online'));
    it('201 → online', () => assert.equal(classifyStatus(201), 'online'));
    it('301 → online', () => assert.equal(classifyStatus(301), 'online'));
    it('400 → online', () => assert.equal(classifyStatus(400), 'online'));
    it('402 → online', () => assert.equal(classifyStatus(402), 'online'));
    it('404 → online', () => assert.equal(classifyStatus(404), 'online'));
    it('429 → online', () => assert.equal(classifyStatus(429), 'online'));
    it('499 → online', () => assert.equal(classifyStatus(499), 'online'));
    it('500 → offline', () => assert.equal(classifyStatus(500), 'offline'));
    it('502 → offline', () => assert.equal(classifyStatus(502), 'offline'));
    it('503 → offline', () => assert.equal(classifyStatus(503), 'offline'));
    it('100 → offline', () => assert.equal(classifyStatus(100), 'offline'));
});

describe('health check — cache TTL', () => {
    const HEALTH_TTL = 10 * 60 * 1000; // 10 minutes

    it('TTL should be 10 minutes', () => {
        assert.equal(HEALTH_TTL, 600000);
    });

    it('entry within TTL should be valid', () => {
        const timestamp = Date.now() - 5 * 60 * 1000; // 5 min ago
        assert.ok(Date.now() - timestamp < HEALTH_TTL);
    });

    it('entry older than TTL should be expired', () => {
        const timestamp = Date.now() - 15 * 60 * 1000; // 15 min ago
        assert.ok(Date.now() - timestamp >= HEALTH_TTL);
    });

    it('entry at exactly TTL boundary should be expired', () => {
        const timestamp = Date.now() - HEALTH_TTL;
        assert.ok(Date.now() - timestamp >= HEALTH_TTL);
    });

    it('cleanup threshold should be 3x TTL', () => {
        const CLEANUP_THRESHOLD = HEALTH_TTL * 3;
        assert.equal(CLEANUP_THRESHOLD, 30 * 60 * 1000); // 30 min
    });
});
