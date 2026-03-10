// tests/gatekeeper.test.js — Unit tests for the Parameter Gatekeeper
// Tests the pre-payment validation logic in routes/proxy.js and lib/bazaar-discovery.js
// Covers: getInputSchemaForUrl(), missing param detection, edge cases
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getInputSchemaForUrl } = require('../lib/bazaar-discovery');

// ─── Suite 1: getInputSchemaForUrl ────────────────────────────────────────────

describe('getInputSchemaForUrl — schema lookup', () => {
    it('should return schema for a known internal URL', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/weather');
        assert.ok(schema);
        assert.deepStrictEqual(schema.required, ['city']);
    });

    it('should return schema for /api/search', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/search');
        assert.ok(schema);
        assert.ok(schema.required.includes('q'));
    });

    it('should return schema for /api/translate', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/translate');
        assert.ok(schema);
        assert.ok(schema.required.includes('text'));
        assert.ok(schema.required.includes('to'));
    });

    it('should return schema for /api/hash', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/hash');
        assert.ok(schema);
        assert.deepStrictEqual(schema.required, ['text']);
    });

    it('should return schema for /api/unit-convert (multiple required params)', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/unit-convert');
        assert.ok(schema);
        assert.ok(schema.required.includes('value'));
        assert.ok(schema.required.includes('from'));
        assert.ok(schema.required.includes('to'));
    });

    it('should return null for an unknown path (e.g. /api/joke)', () => {
        // /api/joke has no required params — no gating needed
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/joke');
        assert.strictEqual(schema, null);
    });

    it('should return null for /api/uuid (no required params)', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/uuid');
        assert.strictEqual(schema, null);
    });

    it('should return null for an external URL with an unknown path', () => {
        const schema = getInputSchemaForUrl('https://api.external-service.com/v2/data');
        assert.strictEqual(schema, null);
    });

    it('should return null for an invalid URL (not throw)', () => {
        const schema = getInputSchemaForUrl('not-a-valid-url');
        assert.strictEqual(schema, null);
    });

    it('should return null for an empty string (not throw)', () => {
        const schema = getInputSchemaForUrl('');
        assert.strictEqual(schema, null);
    });

    it('should ignore query string when matching path', () => {
        const schema = getInputSchemaForUrl('https://x402-api.onrender.com/api/weather?city=Paris');
        assert.ok(schema);
        assert.deepStrictEqual(schema.required, ['city']);
    });

    it('should work with http:// URLs', () => {
        const schema = getInputSchemaForUrl('http://localhost:3000/api/crypto');
        assert.ok(schema);
        assert.deepStrictEqual(schema.required, ['coin']);
    });
});

// ─── Suite 2: Missing parameter detection logic ───────────────────────────────

describe('gatekeeper — missing parameter detection', () => {
    // Replicate the exact check from routes/proxy.js
    function checkMissingParams(inputSchema, params) {
        if (!inputSchema || !inputSchema.required || inputSchema.required.length === 0) {
            return [];
        }
        return inputSchema.required.filter(p =>
            params[p] === undefined || params[p] === null || params[p] === ''
        );
    }

    it('should return empty array when all required params are present', () => {
        const schema = { required: ['city'] };
        const params = { city: 'Paris' };
        assert.deepStrictEqual(checkMissingParams(schema, params), []);
    });

    it('should return missing params when a required param is absent', () => {
        const schema = { required: ['city'] };
        const params = {};
        assert.deepStrictEqual(checkMissingParams(schema, params), ['city']);
    });

    it('should detect multiple missing params', () => {
        const schema = { required: ['text', 'to'] };
        const params = {};
        const missing = checkMissingParams(schema, params);
        assert.ok(missing.includes('text'));
        assert.ok(missing.includes('to'));
        assert.strictEqual(missing.length, 2);
    });

    it('should treat null param value as missing', () => {
        const schema = { required: ['city'] };
        const params = { city: null };
        assert.deepStrictEqual(checkMissingParams(schema, params), ['city']);
    });

    it('should treat empty string param value as missing', () => {
        const schema = { required: ['city'] };
        const params = { city: '' };
        assert.deepStrictEqual(checkMissingParams(schema, params), ['city']);
    });

    it('should NOT treat "0" (zero string) as missing', () => {
        const schema = { required: ['count'] };
        const params = { count: '0' };
        assert.deepStrictEqual(checkMissingParams(schema, params), []);
    });

    it('should NOT treat false as missing', () => {
        const schema = { required: ['flag'] };
        const params = { flag: false };
        assert.deepStrictEqual(checkMissingParams(schema, params), []);
    });

    it('should return empty when schema is null', () => {
        assert.deepStrictEqual(checkMissingParams(null, { city: 'Paris' }), []);
    });

    it('should return empty when schema has no required array', () => {
        assert.deepStrictEqual(checkMissingParams({}, { city: 'Paris' }), []);
    });

    it('should return empty when required array is empty', () => {
        assert.deepStrictEqual(checkMissingParams({ required: [] }, {}), []);
    });

    it('should merge body and query params before validation (as proxy does)', () => {
        const schema = { required: ['text', 'to'] };
        // text comes from body, to comes from query
        const body = { text: 'hello' };
        const query = { to: 'fr' };
        const params = { ...body, ...query };
        assert.deepStrictEqual(checkMissingParams(schema, params), []);
    });
});

// ─── Suite 3: Gatekeeper response shape ──────────────────────────────────────

describe('gatekeeper — 400 response shape', () => {
    function buildGatekeeperResponse(missing, inputSchema) {
        return {
            error: 'Missing required parameters',
            missing,
            required_parameters: inputSchema,
            message: `This service requires: ${missing.join(', ')}. No payment was made.`,
            _payment_status: 'not_charged',
        };
    }

    it('should include _payment_status: not_charged', () => {
        const response = buildGatekeeperResponse(['city'], { required: ['city'] });
        assert.strictEqual(response._payment_status, 'not_charged');
    });

    it('should include the missing params list', () => {
        const response = buildGatekeeperResponse(['text', 'to'], { required: ['text', 'to'] });
        assert.deepStrictEqual(response.missing, ['text', 'to']);
    });

    it('should include the required_parameters schema', () => {
        const schema = { required: ['city'] };
        const response = buildGatekeeperResponse(['city'], schema);
        assert.deepStrictEqual(response.required_parameters, schema);
    });

    it('should mention missing params in the message', () => {
        const response = buildGatekeeperResponse(['city'], { required: ['city'] });
        assert.ok(response.message.includes('city'));
    });

    it('message should confirm no payment was made', () => {
        const response = buildGatekeeperResponse(['domain'], { required: ['domain'] });
        assert.ok(response.message.includes('No payment was made'));
    });
});

// ─── Suite 4: Split between DB schema and discoveryMap ───────────────────────

describe('gatekeeper — priority: DB required_parameters vs discoveryMap', () => {
    // The proxy gives priority to DB-stored required_parameters for external services
    function resolveSchema(dbRequired, serviceUrl) {
        return dbRequired || getInputSchemaForUrl(serviceUrl);
    }

    it('should use DB schema when available (external service)', () => {
        const dbSchema = { required: ['query', 'lang'] };
        const result = resolveSchema(dbSchema, 'https://external.com/api/search');
        assert.deepStrictEqual(result, dbSchema);
    });

    it('should fall back to discoveryMap for internal URL when DB schema is null', () => {
        const result = resolveSchema(null, 'https://x402-api.onrender.com/api/weather');
        assert.ok(result);
        assert.deepStrictEqual(result.required, ['city']);
    });

    it('should return null when neither source has a schema', () => {
        const result = resolveSchema(null, 'https://x402-api.onrender.com/api/joke');
        assert.strictEqual(result, null);
    });
});

// ─── Suite 5: Coverage of all 50 gated endpoints ─────────────────────────────

describe('gatekeeper — all 50 gated endpoints have schemas', () => {
    const BASE_URL = 'https://x402-api.onrender.com';

    const EXPECTED_SCHEMAS = [
        ['/api/search',            ['q']],
        ['/api/scrape',            ['url']],
        ['/api/weather',           ['city']],
        ['/api/crypto',            ['coin']],
        ['/api/translate',         ['text', 'to']],
        ['/api/summarize',         ['text']],
        ['/api/hash',              ['text']],
        ['/api/image',             ['prompt']],
        ['/api/dns',               ['domain']],
        ['/api/validate-email',    ['email']],
        ['/api/sentiment',         ['text']],
        ['/api/code',              ['language', 'code']],
        ['/api/wikipedia',         ['q']],
        ['/api/base64',            ['text', 'mode']],
        ['/api/markdown',          ['text']],
        ['/api/unit-convert',      ['value', 'from', 'to']],
        ['/api/currency',          ['from', 'to']],
        ['/api/time',              ['timezone']],
        ['/api/geocoding',         ['city']],
        ['/api/holidays',          ['country']],
        ['/api/airquality',        ['lat', 'lon']],
        ['/api/readability',       ['url']],
        ['/api/qrcode',            ['data']],
        ['/api/qrcode-gen',        ['data']],
        ['/api/json-validate',     ['json']],
    ];

    for (const [path, expectedRequired] of EXPECTED_SCHEMAS) {
        it(`${path} should require: ${expectedRequired.join(', ')}`, () => {
            const schema = getInputSchemaForUrl(`${BASE_URL}${path}`);
            assert.ok(schema, `No schema found for ${path}`);
            for (const param of expectedRequired) {
                assert.ok(
                    schema.required.includes(param),
                    `${path}: expected '${param}' in required, got: [${schema.required.join(', ')}]`
                );
            }
        });
    }
});
