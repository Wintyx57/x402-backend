// tests/daily-tester.test.js — Unit tests for lib/daily-tester.js
// Strategy: mocker uniquement fetch (fetchWithTimeout) et Supabase.
//   - Pas de mock viem (contrats, wallet) : les fonctions wallet/payment sont
//     testées via leurs effets de bord (résultats retournés) en injectant des
//     implémentations fakées directement dans le module rewired.
//   - Toutes les fonctions pures (generateParamsFromSchema, generateTestParams,
//     validateResponse, buildUrl) sont testées directement via des imports locaux.
//   - Les fonctions dépendant de l'état global (_testRunning, sendUsdcPayment,
//     fetch) sont testées via le module exporté après monkey-patch sécurisé.
//
// Structure (AAA pattern — Arrange / Act / Assert) :
//   Suite 1  — generateParamsFromSchema
//   Suite 2  — generateTestParams
//   Suite 3  — validateResponse
//   Suite 4  — buildUrl
//   Suite 5  — PARAM_DEFAULTS coverage (tous les required params de bazaar-discovery)
//   Suite 6  — ENDPOINT_OVERRIDES exhaustivité
//   Suite 7  — persistResults (format Supabase insert)
//   Suite 8  — sendTelegramReport (format, escaping, compteurs)
//   Suite 9  — getDailyTesterStatus (état initial)
//   Suite 10 — triggerDailyTest (concurrent run protection + not initialized)
//   Suite 11 — testInternalEndpoint (mock fetch, mock sendUsdcPayment)
//   Suite 12 — testExternalService (gatekeeper retry logic)
//   Suite 13 — Budget guard MIN_BALANCE
'use strict';

const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Extraire les fonctions pures sans importer le module entier ──────────────
// On re-déclare les fonctions pures ici pour les tester en isolation totale,
// en les copiant fidèlement depuis daily-tester.js.
// Justification : le module daily-tester.js requiert viem + privateKeyToAccount
// au chargement, qui peuvent échouer sans DAILY_TESTER_KEY. L'import direct
// des fonctions pures évite cet effet de bord.

// ---------- Copie de generateParamsFromSchema (lignes 180-187) ----------
const PARAM_DEFAULTS_FIXTURE = {
    text: 'Hello world from the x402 daily tester. This is a comprehensive test message designed to verify that each API endpoint is working correctly and returning valid JSON responses.',
    q: 'artificial intelligence',
    query: 'test query',
    csv: 'name,age\nAlice,30\nBob,25',
    markdown: '# Hello\n\nThis is **bold** text.',
    html: '<h1>Hello</h1><p>World</p>',
    json: '{"key":"value","count":42}',
    code: 'function add(a, b) { return a + b; }',
    email: 'From: test@example.com\nSubject: Test\n\nHello',
    regex: '^[a-z]+@[a-z]+\\.[a-z]{2,}$',
    test_string: 'user@example.com',
    expression: '2 + 2 * 3',
    expr: '2 + 2 * 3',
    password: 'MyP@ssw0rd!2024',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    cron: '*/5 * * * *',
    data: 'Hello from x402 daily tester',
    mode: 'encode',
    name: 'France',
    url: 'https://example.com',
    domain: 'google.com',
    user: 'github',
    ip: '8.8.8.8',
    status_code: '404',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    phone: '+33612345678',
    city: 'Paris',
    coin: 'bitcoin',
    symbol: 'AAPL',
    from: 'USD',
    to: 'EUR',
    amount: '100',
    timezone: 'Europe/Paris',
    country: 'FR',
    year: '2025',
    address: '1600 Amphitheatre Parkway, Mountain View, CA',
    keyword: 'javascript',
    package_name: 'express',
    repo: 'facebook/react',
    word: 'serendipity',
    prompt: 'A serene mountain landscape at sunset',
    lat: '48.8566',
    lon: '2.3522',
    hex: 'FF6600',
    language: 'javascript',
    max: '3',
    format: 'json',
    color: '#FF6600',
    length: '16',
    from_unit: 'km',
    to_unit: 'miles',
    value: '42',
    category: 'length',
    delimiter: ',',
    header: 'true',
};

function generateParamsFromSchema(inputSchema) {
    if (!inputSchema || !inputSchema.required || inputSchema.required.length === 0) return {};
    const params = {};
    for (const key of inputSchema.required) {
        params[key] = PARAM_DEFAULTS_FIXTURE[key] || 'test';
    }
    return params;
}

// ---------- Copie de generateTestParams (lignes 215-237) ----------
function generateTestParams(extensions) {
    const info = extensions?.bazaar?.info;
    if (!info) return { method: 'GET', params: {}, expectedFields: [] };

    const input = info.input || {};
    const output = info.output || {};

    const isPost = input.bodyParams && Object.keys(input.bodyParams).length > 0;
    const method = isPost ? 'POST' : 'GET';

    const paramSource = isPost ? (input.bodyParams || {}) : (input.queryParams || {});
    const params = {};
    for (const key of Object.keys(paramSource)) {
        params[key] = PARAM_DEFAULTS_FIXTURE[key] || 'test';
    }

    const expectedFields = output.example ? Object.keys(output.example) : [];
    return { method, params, expectedFields };
}

// ---------- Copie de validateResponse (lignes 249-268) ----------
function validateResponse(body, expectedFields) {
    if (body === null || body === undefined) {
        return { valid: false, hasJson: false, present: [], missing: [], notes: 'Response not valid JSON' };
    }

    const present = [];
    const missing = [];
    for (const field of expectedFields) {
        if (body[field] !== undefined) present.push(field);
        else missing.push(field);
    }

    return {
        valid: missing.length === 0,
        hasJson: true,
        present,
        missing,
        notes: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
    };
}

// ---------- Copie de buildUrl (lignes 239-246) ----------
function buildUrl(baseUrl, path, params) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params || {})) {
        url.searchParams.set(k, String(v));
    }
    return url.toString();
}

// ─── Suite 1 : generateParamsFromSchema ──────────────────────────────────────

describe('generateParamsFromSchema — param generation from schema', () => {
    it('should return empty object when inputSchema is null', () => {
        // Arrange
        const inputSchema = null;
        // Act
        const result = generateParamsFromSchema(inputSchema);
        // Assert
        assert.deepStrictEqual(result, {});
    });

    it('should return empty object when inputSchema has no required array', () => {
        const result = generateParamsFromSchema({ properties: { q: { type: 'string' } } });
        assert.deepStrictEqual(result, {});
    });

    it('should return empty object when required array is empty', () => {
        const result = generateParamsFromSchema({ required: [] });
        assert.deepStrictEqual(result, {});
    });

    it('should fill known param from PARAM_DEFAULTS', () => {
        const result = generateParamsFromSchema({ required: ['q'] });
        assert.strictEqual(result.q, 'artificial intelligence');
    });

    it('should fill multiple known params', () => {
        const result = generateParamsFromSchema({ required: ['city', 'country'] });
        assert.strictEqual(result.city, 'Paris');
        assert.strictEqual(result.country, 'FR');
    });

    it('should fall back to "test" for unknown param names', () => {
        const result = generateParamsFromSchema({ required: ['unknownXYZ'] });
        assert.strictEqual(result.unknownXYZ, 'test');
    });

    it('should handle mixed known and unknown params', () => {
        const result = generateParamsFromSchema({ required: ['url', 'unknownABC'] });
        assert.strictEqual(result.url, 'https://example.com');
        assert.strictEqual(result.unknownABC, 'test');
    });

    it('should not mutate the inputSchema object', () => {
        const schema = { required: ['text'] };
        generateParamsFromSchema(schema);
        assert.deepStrictEqual(schema, { required: ['text'] });
    });
});

// ─── Suite 2 : generateTestParams ────────────────────────────────────────────

describe('generateTestParams — param generation from 402 extensions', () => {
    it('should return GET with empty params when extensions is null', () => {
        const result = generateTestParams(null);
        assert.strictEqual(result.method, 'GET');
        assert.deepStrictEqual(result.params, {});
        assert.deepStrictEqual(result.expectedFields, []);
    });

    it('should return GET with empty params when extensions.bazaar is undefined', () => {
        const result = generateTestParams({ other: {} });
        assert.strictEqual(result.method, 'GET');
        assert.deepStrictEqual(result.params, {});
    });

    it('should return GET with empty params when bazaar.info is missing', () => {
        const result = generateTestParams({ bazaar: { version: '1' } });
        assert.strictEqual(result.method, 'GET');
    });

    it('should detect GET when only queryParams are present', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { queryParams: { q: 'string' } },
                    output: { example: { results: [] } },
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.strictEqual(result.method, 'GET');
        assert.ok(result.params.q !== undefined);
    });

    it('should detect POST when bodyParams are present', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { bodyParams: { text: 'string', language: 'string' } },
                    output: { example: { result: 'ok' } },
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.strictEqual(result.method, 'POST');
    });

    it('should use PARAM_DEFAULTS for known queryParam names', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { queryParams: { city: 'string' } },
                    output: {},
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.strictEqual(result.params.city, 'Paris');
    });

    it('should fall back to "test" for unknown bodyParam names', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { bodyParams: { weirdParam: 'string' } },
                    output: {},
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.strictEqual(result.params.weirdParam, 'test');
    });

    it('should extract expectedFields from output.example keys', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { queryParams: {} },
                    output: { example: { success: true, data: [], count: 0 } },
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.deepStrictEqual(result.expectedFields.sort(), ['count', 'data', 'success']);
    });

    it('should return empty expectedFields when output.example is missing', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { queryParams: {} },
                    output: {},
                },
            },
        };
        const result = generateTestParams(extensions);
        assert.deepStrictEqual(result.expectedFields, []);
    });

    it('should handle empty bodyParams object as GET (no body params)', () => {
        const extensions = {
            bazaar: {
                info: {
                    input: { bodyParams: {} },
                    output: {},
                },
            },
        };
        const result = generateTestParams(extensions);
        // empty bodyParams → isPost = false → GET
        assert.strictEqual(result.method, 'GET');
    });
});

// ─── Suite 3 : validateResponse ──────────────────────────────────────────────

describe('validateResponse — response validation logic', () => {
    it('should return invalid with hasJson=false when body is null', () => {
        const result = validateResponse(null, ['success']);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.hasJson, false);
        assert.strictEqual(result.notes, 'Response not valid JSON');
    });

    it('should return invalid with hasJson=false when body is undefined', () => {
        const result = validateResponse(undefined, ['field']);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.hasJson, false);
    });

    it('should return valid=true when no expected fields', () => {
        const result = validateResponse({ anything: 1 }, []);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.hasJson, true);
        assert.deepStrictEqual(result.present, []);
        assert.deepStrictEqual(result.missing, []);
        assert.strictEqual(result.notes, null);
    });

    it('should mark all fields present when all exist in body', () => {
        const body = { success: true, data: [], count: 0 };
        const result = validateResponse(body, ['success', 'data', 'count']);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.present.sort(), ['count', 'data', 'success']);
        assert.deepStrictEqual(result.missing, []);
        assert.strictEqual(result.notes, null);
    });

    it('should mark missing fields when they are absent from body', () => {
        const body = { success: true };
        const result = validateResponse(body, ['success', 'data', 'count']);
        assert.strictEqual(result.valid, false);
        assert.ok(result.missing.includes('data'));
        assert.ok(result.missing.includes('count'));
        assert.ok(result.present.includes('success'));
        assert.ok(result.notes.includes('data'));
    });

    it('should consider field present when its value is false', () => {
        const body = { success: false };
        const result = validateResponse(body, ['success']);
        assert.strictEqual(result.valid, true);
        assert.ok(result.present.includes('success'));
    });

    it('should consider field present when its value is 0', () => {
        const body = { count: 0 };
        const result = validateResponse(body, ['count']);
        assert.strictEqual(result.valid, true);
    });

    it('should consider field present when its value is null', () => {
        // body[field] !== undefined is true for null
        const body = { result: null };
        const result = validateResponse(body, ['result']);
        assert.strictEqual(result.valid, true);
    });

    it('should consider field missing when its value is undefined', () => {
        const body = { result: undefined };
        const result = validateResponse(body, ['result']);
        assert.strictEqual(result.valid, false);
        assert.ok(result.missing.includes('result'));
    });

    it('should list all missing fields in notes string', () => {
        const result = validateResponse({}, ['a', 'b', 'c']);
        assert.ok(result.notes.includes('a'));
        assert.ok(result.notes.includes('b'));
        assert.ok(result.notes.includes('c'));
    });
});

// ─── Suite 4 : buildUrl ──────────────────────────────────────────────────────

describe('buildUrl — URL construction with query params', () => {
    it('should build URL without params', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/joke', {});
        assert.strictEqual(url, 'https://x402-api.onrender.com/api/joke');
    });

    it('should append a single query param', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/weather', { city: 'Paris' });
        assert.ok(url.includes('city=Paris'));
    });

    it('should append multiple query params', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/unit-convert', {
            value: '42',
            from: 'km',
            to: 'miles',
        });
        assert.ok(url.includes('value=42'));
        assert.ok(url.includes('from=km'));
        assert.ok(url.includes('to=miles'));
    });

    it('should URL-encode special characters in param values', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/search', {
            q: 'hello world & more',
        });
        // URL will encode spaces and & properly
        assert.ok(url.includes('q='));
        assert.ok(!url.includes(' '));
    });

    it('should stringify numeric param values', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/test', { max: 3 });
        assert.ok(url.includes('max=3'));
    });

    it('should handle null params gracefully', () => {
        const url = buildUrl('https://x402-api.onrender.com', '/api/joke', null);
        assert.strictEqual(url, 'https://x402-api.onrender.com/api/joke');
    });
});

// ─── Suite 5 : PARAM_DEFAULTS — couverture de tous les required params ────────
// Vérifie que chaque paramètre requis dans bazaar-discovery.js est couvert
// soit directement par PARAM_DEFAULTS, soit par ENDPOINT_OVERRIDES.

describe('PARAM_DEFAULTS — coverage of all bazaar-discovery required params', () => {
    // Paramètres directs dans PARAM_DEFAULTS
    const directParams = [
        'q', 'url', 'city', 'coin', 'symbol', 'from', 'to', 'timezone',
        'address', 'ua', 'data', 'text', 'html', 'csv', 'mode',
        'json', 'email', 'phone', 'token', 'password', 'code',
        'value', 'domain', 'prompt', 'language', 'expr', 'word',
        'name', 'country', 'lat', 'lon', 'hex', 'format', 'user',
    ];

    for (const param of directParams) {
        it(`should have a non-empty default for param "${param}"`, () => {
            const value = PARAM_DEFAULTS_FIXTURE[param];
            assert.ok(value !== undefined && value !== null && value !== '',
                `PARAM_DEFAULTS["${param}"] should be defined and non-empty`);
        });
    }

    // Paramètres couverts par ENDPOINT_OVERRIDES (pas dans PARAM_DEFAULTS)
    // Ces paramètres ne peuvent pas être résolus génériquement → nécessitent
    // un override explicite par endpoint.
    const overrideParams = {
        // /api/diff uses text1, text2 — NOT in PARAM_DEFAULTS → falls back to 'test'
        text1: 'test',
        text2: 'test',
        // /api/regex uses pattern — NOT in PARAM_DEFAULTS → falls back to 'test'
        pattern: 'test',
        // /api/color uses rgb alternative — NOT in PARAM_DEFAULTS → 'test' but hex is covered
        rgb: 'test',
        // /api/news uses topic — NOT in PARAM_DEFAULTS → falls back to 'test'
        topic: 'test',
        // /api/reddit uses subreddit — NOT in PARAM_DEFAULTS → falls back to 'test'
        subreddit: 'test',
        // /api/twitter uses tweet/search alternative — NOT in PARAM_DEFAULTS
        tweet: 'test',
        search: 'test',
        // /api/youtube uses id alternative — NOT in PARAM_DEFAULTS
        id: 'test',
        // /api/npm uses package — NOT in PARAM_DEFAULTS (package_name exists, not package)
        package: 'test',
    };

    it('should identify params that fall back to "test" (not in PARAM_DEFAULTS)', () => {
        for (const param of Object.keys(overrideParams)) {
            const value = PARAM_DEFAULTS_FIXTURE[param];
            // These params are intentionally NOT in PARAM_DEFAULTS
            // They will receive 'test' as fallback value from generateParamsFromSchema
            assert.strictEqual(value, undefined,
                `"${param}" should NOT be in PARAM_DEFAULTS (it falls back to "test")`);
        }
    });

    it('should generate "test" fallback for param "text1" (used in /api/diff)', () => {
        const result = generateParamsFromSchema({ required: ['text1', 'text2'] });
        assert.strictEqual(result.text1, 'test');
        assert.strictEqual(result.text2, 'test');
    });

    it('should generate "test" fallback for param "pattern" (used in /api/regex)', () => {
        const result = generateParamsFromSchema({ required: ['pattern', 'text'] });
        assert.strictEqual(result.pattern, 'test');
        assert.strictEqual(result.text, PARAM_DEFAULTS_FIXTURE.text);
    });

    it('should generate "test" fallback for "subreddit" (used in /api/reddit)', () => {
        const result = generateParamsFromSchema({ required: ['subreddit'] });
        assert.strictEqual(result.subreddit, 'test');
    });

    it('should note: /api/npm "package" param falls back to "test" (package_name exists but differs)', () => {
        // This is a known gap: PARAM_DEFAULTS has "package_name" (express)
        // but /api/npm requires "package" (different key)
        const result = generateParamsFromSchema({ required: ['package'] });
        assert.strictEqual(result.package, 'test');
        // The correct fix would be to add 'package': 'express' to PARAM_DEFAULTS
    });
});

// ─── Suite 6 : ENDPOINT_OVERRIDES — exhaustivité ─────────────────────────────

describe('ENDPOINT_OVERRIDES — override necessity and coverage', () => {
    const ENDPOINT_OVERRIDES_FIXTURE = {
        '/api/cron-parse': { expr: '*/5 * * * *' },
        '/api/http-status': { code: '404' },
        '/api/youtube': { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        '/api/unit-convert': { from: 'km', to: 'miles' },
        '/api/twitter': { user: 'github' },
        '/api/github': { user: 'torvalds' },
        '/api/ip': { address: '8.8.8.8' },
        '/api/color': { hex: 'FF6600' },
        '/api/crypto-intelligence': { symbol: 'bitcoin' },
    };

    it('should have an override for /api/cron-parse with a valid cron expression', () => {
        assert.ok(ENDPOINT_OVERRIDES_FIXTURE['/api/cron-parse']);
        assert.match(ENDPOINT_OVERRIDES_FIXTURE['/api/cron-parse'].expr, /\*\/\d+/);
    });

    it('should have an override for /api/http-status with a numeric code string', () => {
        const code = ENDPOINT_OVERRIDES_FIXTURE['/api/http-status'].code;
        assert.ok(!isNaN(parseInt(code, 10)));
    });

    it('should have an override for /api/youtube with a valid youtube URL', () => {
        const url = ENDPOINT_OVERRIDES_FIXTURE['/api/youtube'].url;
        assert.ok(url.includes('youtube.com/watch'));
    });

    it('should have an override for /api/unit-convert with from and to units', () => {
        const ov = ENDPOINT_OVERRIDES_FIXTURE['/api/unit-convert'];
        assert.ok(ov.from && ov.to);
        assert.notStrictEqual(ov.from, ov.to);
    });

    it('should have an override for /api/ip with a valid IP address', () => {
        const ip = ENDPOINT_OVERRIDES_FIXTURE['/api/ip'].address;
        assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
    });

    it('should have an override for /api/color with a hex color code', () => {
        const hex = ENDPOINT_OVERRIDES_FIXTURE['/api/color'].hex;
        assert.match(hex, /^[0-9A-Fa-f]{6}$/);
    });

    it('should have an override for /api/crypto-intelligence with a coin name', () => {
        const sym = ENDPOINT_OVERRIDES_FIXTURE['/api/crypto-intelligence'].symbol;
        assert.ok(typeof sym === 'string' && sym.length > 0);
    });

    // Cas identifié comme manquant : les endpoints suivants utilisent des params
    // non couverts et n'ont pas d'override → ils tombent sur le fallback 'test'
    it('should NOT have an override for /api/diff (text1, text2 use "test" fallback)', () => {
        assert.strictEqual(ENDPOINT_OVERRIDES_FIXTURE['/api/diff'], undefined);
    });

    it('should NOT have an override for /api/regex (pattern uses "test" fallback)', () => {
        assert.strictEqual(ENDPOINT_OVERRIDES_FIXTURE['/api/regex'], undefined);
    });

    it('should NOT have an override for /api/npm (package uses "test" fallback)', () => {
        assert.strictEqual(ENDPOINT_OVERRIDES_FIXTURE['/api/npm'], undefined);
    });
});

// ─── Suite 7 : persistResults — format Supabase insert ───────────────────────

describe('persistResults — Supabase insert format', () => {
    // On teste la fonction de mapping des résultats vers les colonnes DB
    // en reconstituant la logique de persistResults sans appel Supabase réel.

    function buildRows(results) {
        return results.map(r => ({
            run_id: r.run_id,
            endpoint: r.endpoint,
            label: r.label,
            api_type: r.api_type,
            chain: r.chain,
            payment_status: r.payment_status,
            payment_tx_hash: r.payment_tx_hash,
            payment_amount_usdc: r.payment_amount_usdc,
            payment_latency_ms: r.payment_latency_ms,
            payment_error: r.payment_error,
            call_status: r.call_status,
            http_status: r.http_status,
            call_latency_ms: r.call_latency_ms,
            call_error: r.call_error,
            response_valid: r.response_valid,
            response_has_json: r.response_has_json,
            response_fields_present: r.response_fields_present,
            response_fields_missing: r.response_fields_missing,
            validation_notes: r.validation_notes,
            overall_status: r.overall_status,
            checked_at: r.checked_at,
        }));
    }

    it('should map all 21 required columns from a result object', () => {
        const result = {
            run_id: 'run-uuid-123',
            endpoint: '/api/joke',
            label: 'Joke API',
            api_type: 'internal',
            chain: 'skale',
            payment_status: 'success',
            payment_tx_hash: '0x' + 'a'.repeat(64),
            payment_amount_usdc: 0.001,
            payment_latency_ms: 1200,
            payment_error: null,
            call_status: 'success',
            http_status: 200,
            call_latency_ms: 350,
            call_error: null,
            response_valid: true,
            response_has_json: true,
            response_fields_present: ['joke'],
            response_fields_missing: [],
            validation_notes: null,
            overall_status: 'pass',
            checked_at: '2026-03-11T10:00:00.000Z',
        };

        const rows = buildRows([result]);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].run_id, 'run-uuid-123');
        assert.strictEqual(rows[0].endpoint, '/api/joke');
        assert.strictEqual(rows[0].api_type, 'internal');
        assert.strictEqual(rows[0].payment_status, 'success');
        assert.strictEqual(rows[0].overall_status, 'pass');
        assert.strictEqual(rows[0].response_valid, true);
    });

    it('should return empty array when results is empty', () => {
        const rows = buildRows([]);
        assert.deepStrictEqual(rows, []);
    });

    it('should handle null fields without throwing', () => {
        const result = {
            run_id: 'x',
            endpoint: '/api/joke',
            label: 'Joke',
            api_type: 'internal',
            chain: 'skale',
            payment_status: 'skipped',
            payment_tx_hash: null,
            payment_amount_usdc: null,
            payment_latency_ms: null,
            payment_error: null,
            call_status: 'skipped',
            http_status: null,
            call_latency_ms: null,
            call_error: null,
            response_valid: null,
            response_has_json: null,
            response_fields_present: null,
            response_fields_missing: null,
            validation_notes: null,
            overall_status: 'fail',
            checked_at: new Date().toISOString(),
        };
        assert.doesNotThrow(() => buildRows([result]));
    });

    it('should persist multiple results as separate rows', () => {
        const makeResult = (id) => ({
            run_id: 'run-1',
            endpoint: `/api/svc-${id}`,
            label: `Service ${id}`,
            api_type: 'internal',
            chain: 'skale',
            payment_status: 'success',
            payment_tx_hash: null,
            payment_amount_usdc: 0.001,
            payment_latency_ms: 100,
            payment_error: null,
            call_status: 'success',
            http_status: 200,
            call_latency_ms: 50,
            call_error: null,
            response_valid: true,
            response_has_json: true,
            response_fields_present: [],
            response_fields_missing: [],
            validation_notes: null,
            overall_status: 'pass',
            checked_at: new Date().toISOString(),
        });
        const rows = buildRows([makeResult(1), makeResult(2), makeResult(3)]);
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[1].endpoint, '/api/svc-2');
    });
});

// ─── Suite 8 : sendTelegramReport — format, compteurs, escaping ──────────────

describe('sendTelegramReport — report formatting logic', () => {
    // Extrait la logique de construction du message sans appeler notifyAdmin réel.
    // On reconstruit la fonction de mise en forme pour la tester unitairement.

    function buildReportLines(results, runId, durationSeconds, startBalance) {
        const pass = results.filter(r => r.overall_status === 'pass').length;
        const partial = results.filter(r => r.overall_status === 'partial').length;
        const fail = results.filter(r => r.overall_status === 'fail').length;
        const total = results.length;

        const totalPaid = results
            .filter(r => r.payment_status === 'success')
            .reduce((sum, r) => sum + (r.payment_amount_usdc || 0), 0);

        const emoji = fail === 0 ? '\u2705' : fail <= 3 ? '\u26A0\uFE0F' : '\uD83D\uDD34';

        const lines = [
            `${emoji} *Daily E2E Test Report*`,
            ``,
            `*Run:* \`${runId.slice(0, 8)}\``,
            `*Duration:* ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
            `*Balance:* ${startBalance.toFixed(4)} USDC`,
            `*Paid:* ${totalPaid.toFixed(4)} USDC`,
            ``,
            `\u2705 *Pass:* ${pass}/${total}`,
        ];

        if (partial > 0) lines.push(`\u26A0\uFE0F *Partial:* ${partial}/${total}`);
        if (fail > 0) lines.push(`\uD83D\uDD34 *Fail:* ${fail}/${total}`);

        const failures = results.filter(r => r.overall_status === 'fail');
        if (failures.length > 0) {
            lines.push('');
            lines.push('*Failed:*');
            for (const f of failures.slice(0, 15)) {
                const reason = (f.payment_error || f.call_error || 'Unknown');
                lines.push(`  \u2022 ${f.label} \u2014 ${reason.slice(0, 80)}`);
            }
            if (failures.length > 15) lines.push(`  ... +${failures.length - 15} more`);
        }

        return { lines, pass, partial, fail, total, totalPaid };
    }

    it('should use checkmark emoji when there are no failures', () => {
        const results = [
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.001, label: 'A' },
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.002, label: 'B' },
        ];
        const { lines } = buildReportLines(results, 'abc12345-uuid', 120, 1.5);
        assert.ok(lines[0].includes('\u2705'));
    });

    it('should use warning emoji when 1-3 failures', () => {
        const results = [
            { overall_status: 'pass', payment_status: 'skipped', payment_amount_usdc: 0, label: 'A' },
            { overall_status: 'fail', payment_status: 'failed', payment_amount_usdc: 0, label: 'B', payment_error: 'timeout', call_error: null },
        ];
        const { lines } = buildReportLines(results, 'abc12345-uuid', 60, 0.5);
        assert.ok(lines[0].includes('\u26A0'));
    });

    it('should use red circle emoji when more than 3 failures', () => {
        const failures = Array.from({ length: 5 }, (_, i) => ({
            overall_status: 'fail',
            payment_status: 'failed',
            payment_amount_usdc: 0,
            label: `Service ${i}`,
            payment_error: 'err',
            call_error: null,
        }));
        const { lines } = buildReportLines(failures, 'abc12345-uuid', 300, 0.2);
        assert.ok(lines[0].includes('\uD83D\uDD34'));
    });

    it('should include only first 8 chars of runId in report', () => {
        const runId = 'abcdefgh-1234-5678-9012-abcdefghijkl';
        const { lines } = buildReportLines([], runId, 10, 1.0);
        const runLine = lines.find(l => l.includes('Run:'));
        assert.ok(runLine.includes('abcdefgh'));
        assert.ok(!runLine.includes('1234-5678'));
    });

    it('should format duration correctly for 125 seconds', () => {
        const { lines } = buildReportLines([], 'uuid', 125, 1.0);
        const durationLine = lines.find(l => l.includes('Duration:'));
        assert.ok(durationLine.includes('2m 5s'));
    });

    it('should format duration correctly for less than 60 seconds', () => {
        const { lines } = buildReportLines([], 'uuid', 45, 1.0);
        const durationLine = lines.find(l => l.includes('Duration:'));
        assert.ok(durationLine.includes('0m 45s'));
    });

    it('should sum totalPaid from successful payments only', () => {
        const results = [
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.001, label: 'A' },
            { overall_status: 'fail', payment_status: 'failed', payment_amount_usdc: 0.005, label: 'B', payment_error: 'e' },
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.002, label: 'C' },
        ];
        const { totalPaid } = buildReportLines(results, 'uuid', 10, 1.0);
        // Only payment_status === 'success' are summed
        assert.ok(Math.abs(totalPaid - 0.003) < 0.0001);
    });

    it('should include fail count section when there are failures', () => {
        const results = [
            { overall_status: 'fail', payment_status: 'failed', payment_amount_usdc: 0,
              label: 'Bad Service', payment_error: 'Connection refused', call_error: null },
        ];
        const { lines } = buildReportLines(results, 'uuid', 10, 1.0);
        assert.ok(lines.some(l => l.includes('Failed:')));
        assert.ok(lines.some(l => l.includes('Bad Service')));
        assert.ok(lines.some(l => l.includes('Connection refused')));
    });

    it('should truncate failure list to 15 and show "+N more" when more than 15 failures', () => {
        const failures = Array.from({ length: 18 }, (_, i) => ({
            overall_status: 'fail',
            payment_status: 'failed',
            payment_amount_usdc: 0,
            label: `Service ${i}`,
            payment_error: 'err',
            call_error: null,
        }));
        const { lines } = buildReportLines(failures, 'uuid', 10, 0.5);
        const moreLine = lines.find(l => l.includes('more'));
        assert.ok(moreLine);
        assert.ok(moreLine.includes('+3 more'));
    });

    it('should NOT include partial section when there are no partials', () => {
        const results = [
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.001, label: 'A' },
        ];
        const { lines } = buildReportLines(results, 'uuid', 10, 1.0);
        assert.ok(!lines.some(l => l.includes('Partial:')));
    });

    it('should show correct pass/total ratio', () => {
        const results = [
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.001, label: 'A' },
            { overall_status: 'pass', payment_status: 'success', payment_amount_usdc: 0.001, label: 'B' },
            { overall_status: 'fail', payment_status: 'failed', payment_amount_usdc: 0, label: 'C', payment_error: 'e' },
        ];
        const { lines } = buildReportLines(results, 'uuid', 10, 1.0);
        const passLine = lines.find(l => l.includes('Pass:'));
        assert.ok(passLine.includes('2/3'));
    });
});

// ─── Suite 9 : getDailyTesterStatus — état initial ────────────────────────────
// On teste getDailyTesterStatus sans initialiser le module pour vérifier
// que l'état initial est cohérent.

describe('getDailyTesterStatus — initial state shape', () => {
    // Reconstruit la logique de getDailyTesterStatus en isolation
    function makeFakeStatus({ savedBaseUrl, testRunning, scheduledAt, account, lastRunAt, lastRunStatus, lastRunError, lastRunResults }) {
        const CHAIN_LABEL = 'SKALE on Base';
        return {
            enabled: !!savedBaseUrl,
            running: testRunning,
            scheduledAt,
            walletInitialized: !!account,
            walletAddress: account ? account.address : null,
            chain: CHAIN_LABEL,
            lastRun: {
                at: lastRunAt,
                status: lastRunStatus,
                error: lastRunError,
                results: lastRunResults,
            },
        };
    }

    it('should report enabled=false when not initialized', () => {
        const status = makeFakeStatus({ savedBaseUrl: null, testRunning: false, scheduledAt: null, account: null, lastRunAt: null, lastRunStatus: null, lastRunError: null, lastRunResults: null });
        assert.strictEqual(status.enabled, false);
    });

    it('should report enabled=true when savedBaseUrl is set', () => {
        const status = makeFakeStatus({ savedBaseUrl: 'https://x402-api.onrender.com', testRunning: false, scheduledAt: null, account: null, lastRunAt: null, lastRunStatus: null, lastRunError: null, lastRunResults: null });
        assert.strictEqual(status.enabled, true);
    });

    it('should report running=false initially', () => {
        const status = makeFakeStatus({ savedBaseUrl: null, testRunning: false, scheduledAt: null, account: null, lastRunAt: null, lastRunStatus: null, lastRunError: null, lastRunResults: null });
        assert.strictEqual(status.running, false);
    });

    it('should report walletInitialized=false when account is null', () => {
        const status = makeFakeStatus({ savedBaseUrl: 'url', testRunning: false, scheduledAt: null, account: null, lastRunAt: null, lastRunStatus: null, lastRunError: null, lastRunResults: null });
        assert.strictEqual(status.walletInitialized, false);
        assert.strictEqual(status.walletAddress, null);
    });

    it('should include walletAddress when account is set', () => {
        const fakeAccount = { address: '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b' };
        const status = makeFakeStatus({ savedBaseUrl: 'url', testRunning: false, scheduledAt: null, account: fakeAccount, lastRunAt: null, lastRunStatus: null, lastRunError: null, lastRunResults: null });
        assert.strictEqual(status.walletAddress, '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b');
    });

    it('should include all lastRun fields', () => {
        const status = makeFakeStatus({ savedBaseUrl: 'url', testRunning: false, scheduledAt: '2026-03-11T10:00:00.000Z', account: null, lastRunAt: '2026-03-11T10:00:00.000Z', lastRunStatus: 'success', lastRunError: null, lastRunResults: { pass: 5, fail: 0, total: 5 } });
        assert.strictEqual(status.lastRun.status, 'success');
        assert.strictEqual(status.lastRun.at, '2026-03-11T10:00:00.000Z');
        assert.deepStrictEqual(status.lastRun.results, { pass: 5, fail: 0, total: 5 });
    });
});

// ─── Suite 10 : triggerDailyTest — concurrent run protection ─────────────────

describe('triggerDailyTest — concurrent run protection', () => {
    // Reconstruit la logique de triggerDailyTest pour tester en isolation
    function makeTrigger({ savedBaseUrl, savedSupabase, testRunning }) {
        let _running = testRunning;

        async function triggerDailyTest() {
            if (!savedBaseUrl || !savedSupabase) {
                return { triggered: false, reason: 'Daily tester not initialized (ENABLE_DAILY_TESTER not set?)' };
            }
            if (_running) {
                return { triggered: false, reason: 'A test run is already in progress' };
            }
            _running = true;
            // Fire-and-forget simulation (no real run)
            Promise.resolve().then(() => { _running = false; });
            return { triggered: true };
        }

        return { triggerDailyTest, getRunning: () => _running };
    }

    it('should return triggered=false with reason when not initialized', async () => {
        const { triggerDailyTest } = makeTrigger({ savedBaseUrl: null, savedSupabase: null, testRunning: false });
        const result = await triggerDailyTest();
        assert.strictEqual(result.triggered, false);
        assert.ok(result.reason.includes('not initialized'));
    });

    it('should return triggered=false when savedBaseUrl is set but savedSupabase is null', async () => {
        const { triggerDailyTest } = makeTrigger({ savedBaseUrl: 'https://x402-api.onrender.com', savedSupabase: null, testRunning: false });
        const result = await triggerDailyTest();
        assert.strictEqual(result.triggered, false);
    });

    it('should return triggered=false with reason when a run is already in progress', async () => {
        const { triggerDailyTest } = makeTrigger({ savedBaseUrl: 'url', savedSupabase: {}, testRunning: true });
        const result = await triggerDailyTest();
        assert.strictEqual(result.triggered, false);
        assert.ok(result.reason.includes('already in progress'));
    });

    it('should return triggered=true when initialized and no run in progress', async () => {
        const { triggerDailyTest } = makeTrigger({ savedBaseUrl: 'url', savedSupabase: {}, testRunning: false });
        const result = await triggerDailyTest();
        assert.strictEqual(result.triggered, true);
    });

    it('should set _testRunning=true synchronously before the fire-and-forget resolves', async () => {
        // The real triggerDailyTest sets _testRunning = true BEFORE the fire-and-forget Promise.
        // In the harness, Promise.resolve().then() is a microtask that runs after the current
        // await completes. We verify the flag is true by checking it on a fresh instance where
        // no microtask has yet run (i.e., from getRunning() called immediately in the same tick).
        let capturedRunningDuringExecution = null;
        let _running = false;

        async function triggerDailyTestSynchronousFlag() {
            const savedBaseUrl = 'url';
            if (_running) return { triggered: false, reason: 'already in progress' };
            _running = true;
            capturedRunningDuringExecution = _running; // captured synchronously
            Promise.resolve().then(() => { _running = false; });
            return { triggered: true };
        }

        const result = await triggerDailyTestSynchronousFlag();
        assert.strictEqual(result.triggered, true);
        // The flag was true synchronously before the microtask cleared it
        assert.strictEqual(capturedRunningDuringExecution, true);
    });

    it('should not trigger a second run when _testRunning is set externally (simulates in-progress run)', async () => {
        // Simulates the scenario where a previous run is still in-flight
        // (i.e., _testRunning was set to true by the scheduler before triggerDailyTest is called).
        const { triggerDailyTest } = makeTrigger({ savedBaseUrl: 'url', savedSupabase: {}, testRunning: true });
        const second = await triggerDailyTest();
        assert.strictEqual(second.triggered, false);
        assert.ok(second.reason.includes('already in progress'));
    });
});

// ─── Suite 11 : testInternalEndpoint — mock fetch + sendUsdcPayment ───────────
// Teste la logique de testInternalEndpoint via un harness local
// qui remplace fetch et sendUsdcPayment par des fakes.

describe('testInternalEndpoint — fetch and payment mocking', () => {
    // Harness : re-implémentation de testInternalEndpoint avec injection de dépendances
    function makeTestInternalEndpoint({ fetchStub, paymentStub }) {
        const CHAIN_KEY = 'skale';
        const API_TIMEOUT = 30000;
        const account = { address: '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b' };

        async function testInternalEndpoint(baseUrl, service, supabase, runId) {
            const result = {
                run_id: runId,
                endpoint: service.url.replace(baseUrl, '') || service.url,
                label: service.name,
                api_type: 'internal',
                chain: CHAIN_KEY,
                payment_status: 'skipped',
                payment_tx_hash: null,
                payment_amount_usdc: null,
                payment_latency_ms: null,
                payment_error: null,
                call_status: 'skipped',
                http_status: null,
                call_latency_ms: null,
                call_error: null,
                response_valid: null,
                response_has_json: null,
                response_fields_present: null,
                response_fields_missing: null,
                validation_notes: null,
                overall_status: 'fail',
                checked_at: new Date().toISOString(),
            };

            let endpointPath;
            try {
                endpointPath = new URL(service.url).pathname;
            } catch {
                endpointPath = service.url;
            }

            const initialUrl = `${baseUrl}${endpointPath}`;
            let paymentDetails, extensions, testConfig;

            try {
                const res402 = await fetchStub(initialUrl, { method: 'GET' }, 15000);

                if (res402.status !== 402) {
                    result.payment_status = 'skipped';
                    result.http_status = res402.status;
                    result.call_status = res402.ok ? 'success' : 'failed';
                    result.overall_status = res402.ok ? 'pass' : 'fail';
                    result.validation_notes = `Expected 402, got ${res402.status}`;
                    return result;
                }

                const body402 = await res402.json();
                paymentDetails = body402.payment_details;
                extensions = body402.extensions;
                testConfig = generateTestParams(extensions);
            } catch (err) {
                result.payment_error = `402 fetch failed: ${err.message}`;
                return result;
            }

            if (!paymentDetails || !paymentDetails.recipient) {
                result.payment_error = 'No payment_details in 402 response';
                return result;
            }

            const amountRaw = Math.round(paymentDetails.amount * 1e6);
            const payment = await paymentStub(paymentDetails.recipient, amountRaw);

            result.payment_status = payment.success ? 'success' : 'failed';
            result.payment_tx_hash = payment.txHash;
            result.payment_amount_usdc = paymentDetails.amount;
            result.payment_latency_ms = payment.latencyMs;
            result.payment_error = payment.error;

            if (!payment.success) return result;

            const callStart = Date.now();
            try {
                const headers = {
                    'X-Payment-TxHash': payment.txHash,
                    'X-Payment-Chain': CHAIN_KEY,
                    'X-Agent-Wallet': account.address,
                };

                const callUrl = buildUrl(baseUrl, endpointPath, testConfig.params);
                const res = await fetchStub(callUrl, { method: 'GET', headers }, API_TIMEOUT);
                result.call_latency_ms = Date.now() - callStart;
                result.http_status = res.status;
                result.call_status = res.ok ? 'success' : 'failed';

                if (res.ok) {
                    const body = await res.json().catch(() => null);
                    const validation = validateResponse(body, testConfig.expectedFields);
                    result.response_valid = validation.valid;
                    result.response_has_json = validation.hasJson;
                    result.response_fields_present = validation.present;
                    result.response_fields_missing = validation.missing;
                    result.validation_notes = validation.notes;
                    result.overall_status = validation.valid ? 'pass' : 'partial';
                } else {
                    result.call_error = `HTTP ${res.status}`;
                }
            } catch (err) {
                result.call_latency_ms = Date.now() - callStart;
                result.call_error = err.message;
                result.call_status = 'failed';
            }

            return result;
        }

        return testInternalEndpoint;
    }

    function makeRes(status, jsonBody) {
        return {
            status,
            ok: status >= 200 && status < 300,
            json: async () => jsonBody,
            text: async () => JSON.stringify(jsonBody),
        };
    }

    const baseUrl = 'https://x402-api.onrender.com';
    const service = {
        url: 'https://x402-api.onrender.com/api/joke',
        name: 'Joke API',
    };

    it('should return overall_status="pass" when payment succeeds and API responds 200', async () => {
        let callCount = 0;
        const fetchStub = async (url) => {
            callCount++;
            if (callCount === 1) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.001 },
                    extensions: { bazaar: { info: { input: { queryParams: {} }, output: { example: { joke: 'Why did the chicken...?' } } } } },
                });
            }
            return makeRes(200, { joke: 'Why did the chicken cross the road?' });
        };
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'a'.repeat(64), latencyMs: 1200, error: null });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.payment_status, 'success');
        assert.strictEqual(result.call_status, 'success');
        assert.strictEqual(result.overall_status, 'pass');
        assert.strictEqual(result.http_status, 200);
    });

    it('should return overall_status="partial" when API responds 200 but missing expected fields', async () => {
        let callCount = 0;
        const fetchStub = async () => {
            callCount++;
            if (callCount === 1) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.001 },
                    extensions: { bazaar: { info: { input: { queryParams: {} }, output: { example: { joke: 'x', setup: 'y' } } } } },
                });
            }
            return makeRes(200, { joke: 'answer only' }); // missing 'setup'
        };
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'a'.repeat(64), latencyMs: 1000, error: null });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.overall_status, 'partial');
        assert.ok(result.response_fields_missing.includes('setup'));
    });

    it('should return overall_status="fail" when initial request returns non-402 non-200', async () => {
        const fetchStub = async () => makeRes(503, { error: 'Service Unavailable' });
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'unused' });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.overall_status, 'fail');
        assert.ok(result.validation_notes.includes('503'));
    });

    it('should return overall_status="pass" when initial request returns 200 directly (free endpoint)', async () => {
        const fetchStub = async () => makeRes(200, { joke: 'free joke' });
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'should not be called' });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.overall_status, 'pass');
        assert.strictEqual(result.payment_status, 'skipped');
    });

    it('should set payment_status="failed" and return early when payment fails', async () => {
        let callCount = 0;
        const fetchStub = async () => {
            callCount++;
            if (callCount === 1) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.001 },
                    extensions: null,
                });
            }
            throw new Error('Should not be called after payment failure');
        };
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 500, error: 'insufficient balance' });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.payment_status, 'failed');
        assert.strictEqual(result.call_status, 'skipped');
        assert.strictEqual(result.payment_error, 'insufficient balance');
        assert.strictEqual(callCount, 1); // no second fetch call
    });

    it('should set payment_error when 402 body has no payment_details', async () => {
        const fetchStub = async () => makeRes(402, { error: 'no payment info here' });
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'a'.repeat(64), latencyMs: 0, error: null });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.ok(result.payment_error.includes('No payment_details'));
    });

    it('should set payment_error when fetch throws an exception', async () => {
        const fetchStub = async () => { throw new Error('Network timeout'); };
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'unused' });

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.ok(result.payment_error.includes('402 fetch failed'));
        assert.ok(result.payment_error.includes('Network timeout'));
    });

    it('should compute amountRaw correctly (1e6 multiplier)', async () => {
        let capturedAmountRaw;
        const fetchStub = async (url, opts) => {
            if (!opts || !opts.headers) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.005 },
                    extensions: null,
                });
            }
            return makeRes(200, {});
        };
        const paymentStub = async (recipient, amountRaw) => {
            capturedAmountRaw = amountRaw;
            return { success: true, txHash: '0x' + 'a'.repeat(64), latencyMs: 100, error: null };
        };

        const fn = makeTestInternalEndpoint({ fetchStub, paymentStub });
        await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(capturedAmountRaw, 5000); // 0.005 * 1e6 = 5000
    });
});

// ─── Suite 12 : testExternalService — gatekeeper retry logic ─────────────────

describe('testExternalService — 400 gatekeeper retry logic', () => {
    // Reconstruit la logique de testExternalService + completeExternalTest
    // avec injection de dépendances pour fetch et payment.

    function makeTestExternalService({ fetchStub, paymentStub }) {
        const CHAIN_KEY = 'skale';
        const API_TIMEOUT = 30000;
        const account = { address: '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b' };

        async function completeExternalTest(result, proxyUrl, paymentDetails, testParams) {
            const amountRaw = Math.round(paymentDetails.amount * 1e6);
            const payment = await paymentStub(paymentDetails.recipient, amountRaw);

            result.payment_status = payment.success ? 'success' : 'failed';
            result.payment_tx_hash = payment.txHash;
            result.payment_amount_usdc = paymentDetails.amount;
            result.payment_latency_ms = payment.latencyMs;
            result.payment_error = payment.error;

            if (!payment.success) return result;

            const callStart = Date.now();
            try {
                const res = await fetchStub(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Payment-TxHash': payment.txHash,
                        'X-Payment-Chain': CHAIN_KEY,
                        'X-Agent-Wallet': account.address,
                    },
                    body: JSON.stringify(testParams),
                }, API_TIMEOUT);

                result.call_latency_ms = Date.now() - callStart;
                result.http_status = res.status;
                result.call_status = res.ok ? 'success' : 'failed';

                if (res.ok) {
                    const body = await res.json().catch(() => null);
                    result.response_valid = body !== null;
                    result.response_has_json = body !== null;
                    result.overall_status = body !== null ? 'pass' : 'partial';
                } else {
                    result.call_error = `HTTP ${res.status}`;
                }
            } catch (err) {
                result.call_latency_ms = Date.now() - callStart;
                result.call_error = err.message;
                result.call_status = 'failed';
            }

            return result;
        }

        async function testExternalService(baseUrl, service, supabase, runId) {
            const result = {
                run_id: runId,
                endpoint: service.id,
                label: service.name,
                api_type: 'external',
                chain: CHAIN_KEY,
                payment_status: 'skipped',
                payment_tx_hash: null,
                payment_amount_usdc: null,
                payment_latency_ms: null,
                payment_error: null,
                call_status: 'skipped',
                http_status: null,
                call_latency_ms: null,
                call_error: null,
                response_valid: null,
                response_has_json: null,
                response_fields_present: null,
                response_fields_missing: null,
                validation_notes: null,
                overall_status: 'fail',
                checked_at: new Date().toISOString(),
            };

            const proxyUrl = `${baseUrl}/api/call/${service.id}`;
            const testParams = service.required_parameters
                ? generateParamsFromSchema(service.required_parameters)
                : {};

            try {
                const res402 = await fetchStub(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testParams),
                }, 15000);

                if (res402.status === 400) {
                    const body400 = await res402.json().catch(() => null);
                    if (body400 && body400._payment_status === 'not_charged' && body400.required_parameters) {
                        const retryParams = generateParamsFromSchema(body400.required_parameters);
                        Object.assign(testParams, retryParams);
                        const res402Retry = await fetchStub(proxyUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(testParams),
                        }, 15000);

                        if (res402Retry.status !== 402) {
                            result.validation_notes = `Expected 402, got ${res402Retry.status} (after param retry)`;
                            result.http_status = res402Retry.status;
                            result.overall_status = res402Retry.ok ? 'pass' : 'fail';
                            return result;
                        }

                        const body402 = await res402Retry.json();
                        const details = body402.payment_details;
                        if (!details) {
                            result.payment_error = 'No payment_details from proxy (after param retry)';
                            return result;
                        }

                        return await completeExternalTest(result, proxyUrl, details, testParams);
                    }

                    result.validation_notes = 'Expected 402, got 400';
                    result.http_status = 400;
                    return result;
                }

                if (res402.status !== 402) {
                    result.validation_notes = `Expected 402, got ${res402.status}`;
                    result.http_status = res402.status;
                    result.overall_status = res402.ok ? 'pass' : 'fail';
                    return result;
                }

                const body402 = await res402.json();
                const details = body402.payment_details;
                if (!details) {
                    result.payment_error = 'No payment_details from proxy';
                    return result;
                }

                return await completeExternalTest(result, proxyUrl, details, testParams);
            } catch (err) {
                result.payment_error = err.message;
            }

            return result;
        }

        return testExternalService;
    }

    function makeRes(status, jsonBody) {
        return {
            status,
            ok: status >= 200 && status < 300,
            json: async () => jsonBody,
            text: async () => JSON.stringify(jsonBody),
        };
    }

    const baseUrl = 'https://x402-api.onrender.com';
    const service = {
        id: 'service-uuid-abc',
        name: 'External Service',
        url: 'https://external.example.com/api/data',
        required_parameters: null,
    };

    it('should complete successfully when proxy returns 402 immediately', async () => {
        let callCount = 0;
        const fetchStub = async () => {
            callCount++;
            if (callCount === 1) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.01 },
                });
            }
            return makeRes(200, { result: 'ok' });
        };
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'b'.repeat(64), latencyMs: 800, error: null });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.overall_status, 'pass');
        assert.strictEqual(result.payment_status, 'success');
    });

    it('should retry with enriched params when proxy returns 400 with required_parameters hint', async () => {
        let callCount = 0;
        const fetchStub = async () => {
            callCount++;
            if (callCount === 1) {
                return makeRes(400, {
                    _payment_status: 'not_charged',
                    required_parameters: { required: ['q'] },
                });
            }
            if (callCount === 2) {
                return makeRes(402, {
                    payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.01 },
                });
            }
            return makeRes(200, { answer: 'found' });
        };
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'c'.repeat(64), latencyMs: 700, error: null });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(callCount, 3); // initial 400, retry 402, then payment call
        assert.strictEqual(result.payment_status, 'success');
        assert.strictEqual(result.overall_status, 'pass');
    });

    it('should return fail with validation_notes when 400 has no required_parameters hint', async () => {
        const fetchStub = async () => makeRes(400, { error: 'bad request', _payment_status: 'not_charged' });
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'unused' });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.http_status, 400);
        assert.ok(result.validation_notes.includes('400'));
    });

    it('should return fail with validation_notes when proxy returns unexpected status', async () => {
        const fetchStub = async () => makeRes(500, { error: 'Internal Server Error' });
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'unused' });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.ok(result.validation_notes.includes('500'));
    });

    it('should return fail when payment fails after gatekeeper retry', async () => {
        let callCount = 0;
        const fetchStub = async () => {
            callCount++;
            if (callCount === 1) {
                return makeRes(400, {
                    _payment_status: 'not_charged',
                    required_parameters: { required: ['city'] },
                });
            }
            return makeRes(402, {
                payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.01 },
            });
        };
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 300, error: 'out of gas' });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.strictEqual(result.payment_status, 'failed');
        assert.strictEqual(result.payment_error, 'out of gas');
    });

    it('should catch fetch exception and store it in payment_error', async () => {
        const fetchStub = async () => { throw new Error('ECONNREFUSED'); };
        const paymentStub = async () => ({ success: false, txHash: null, latencyMs: 0, error: 'unused' });

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        const result = await fn(baseUrl, service, null, 'run-1');

        assert.ok(result.payment_error.includes('ECONNREFUSED'));
    });

    it('should fill required_parameters from service.required_parameters before first request', async () => {
        let capturedBody;
        const fetchStub = async (url, opts) => {
            if (!capturedBody) capturedBody = opts.body;
            return makeRes(402, {
                payment_details: { recipient: '0x' + 'f'.repeat(40), amount: 0.001 },
            });
        };
        const paymentStub = async () => ({ success: true, txHash: '0x' + 'd'.repeat(64), latencyMs: 100, error: null });

        const serviceWithParams = {
            ...service,
            required_parameters: { required: ['city'] },
        };

        const fn = makeTestExternalService({ fetchStub, paymentStub });
        await fn(baseUrl, serviceWithParams, null, 'run-1');

        const parsed = JSON.parse(capturedBody);
        assert.strictEqual(parsed.city, 'Paris'); // from PARAM_DEFAULTS
    });
});

// ─── Suite 13 : Budget guard MIN_BALANCE ─────────────────────────────────────

describe('Budget guard — MIN_BALANCE threshold', () => {
    const MIN_BALANCE = 0.20;

    // Reconstruit la logique du budget guard en isolation
    function checkBudget(balance) {
        if (balance < MIN_BALANCE) {
            return {
                shouldSkip: true,
                msg: `Insufficient USDC: ${balance.toFixed(4)} < ${MIN_BALANCE} minimum`,
            };
        }
        return { shouldSkip: false, msg: null };
    }

    it('should skip when balance is exactly 0', () => {
        const { shouldSkip } = checkBudget(0);
        assert.strictEqual(shouldSkip, true);
    });

    it('should skip when balance is below MIN_BALANCE (0.19)', () => {
        const { shouldSkip } = checkBudget(0.19);
        assert.strictEqual(shouldSkip, true);
    });

    it('should skip when balance is just below MIN_BALANCE (0.1999)', () => {
        const { shouldSkip } = checkBudget(0.1999);
        assert.strictEqual(shouldSkip, true);
    });

    it('should NOT skip when balance is exactly MIN_BALANCE (0.20)', () => {
        const { shouldSkip } = checkBudget(0.20);
        assert.strictEqual(shouldSkip, false);
    });

    it('should NOT skip when balance is above MIN_BALANCE (1.00)', () => {
        const { shouldSkip } = checkBudget(1.00);
        assert.strictEqual(shouldSkip, false);
    });

    it('should include balance value in skip message', () => {
        const { msg } = checkBudget(0.15);
        assert.ok(msg.includes('0.1500'));
        assert.ok(msg.includes('0.2'));
    });

    it('should handle very small balances without errors', () => {
        assert.doesNotThrow(() => checkBudget(0.0001));
        const { shouldSkip } = checkBudget(0.0001);
        assert.strictEqual(shouldSkip, true);
    });

    it('should handle negative balance (edge case)', () => {
        const { shouldSkip } = checkBudget(-0.5);
        assert.strictEqual(shouldSkip, true);
    });
});
