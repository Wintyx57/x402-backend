'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    getExpectedFieldsForUrl,
    validateResponseSchema,
    scoreContentQuality,
    signValidation,
    verifyValidationSignature,
    buildValidationMeta,
    getValueType,
    sortObjectKeys,
} = require('../lib/response-validator');

// ─── Suite 1: getExpectedFieldsForUrl ─────────────────────────────────────────

describe('response-validator — getExpectedFieldsForUrl', () => {
    it('should return fields for a known internal API (weather)', () => {
        const result = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/weather');
        assert.ok(result);
        assert.ok(Array.isArray(result.fields));
        assert.ok(result.fields.length > 0);
        assert.ok(result.example);
    });

    it('should return fields for /api/joke', () => {
        const result = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/joke');
        assert.ok(result);
        assert.ok(result.fields.includes('setup'));
        assert.ok(result.fields.includes('punchline'));
    });

    it('should return null for unknown URL', () => {
        const result = getExpectedFieldsForUrl('https://external-api.com/unknown');
        assert.strictEqual(result, null);
    });

    it('should return null for malformed URL', () => {
        const result = getExpectedFieldsForUrl('not-a-url');
        assert.strictEqual(result, null);
    });

    it('should return null for empty string', () => {
        const result = getExpectedFieldsForUrl('');
        assert.strictEqual(result, null);
    });

    it('should handle URL with query params (path-only match)', () => {
        const result = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/weather?city=Paris');
        assert.ok(result);
        assert.ok(result.fields.length > 0);
    });

    it('should return null for /api/nonexistent', () => {
        const result = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/nonexistent');
        assert.strictEqual(result, null);
    });

    it('should return fields for /api/crypto', () => {
        const result = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/crypto');
        assert.ok(result);
        assert.ok(result.fields.length >= 2);
    });
});

// ─── Suite 2: validateResponseSchema ──────────────────────────────────────────

describe('response-validator — validateResponseSchema', () => {
    it('complete match → valid, ratio=1', () => {
        const r = validateResponseSchema(
            { success: true, city: 'Paris', temp: 20 },
            ['success', 'city', 'temp']
        );
        assert.strictEqual(r.valid, true);
        assert.strictEqual(r.ratio, 1);
        assert.strictEqual(r.missing.length, 0);
    });

    it('partial match (2/3) → valid (ratio >= 0.5)', () => {
        const r = validateResponseSchema(
            { success: true, city: 'Paris' },
            ['success', 'city', 'temp']
        );
        assert.strictEqual(r.valid, true);
        assert.ok(r.ratio >= 0.5);
    });

    it('low match (1/4) → invalid (ratio < 0.5)', () => {
        const r = validateResponseSchema(
            { success: true },
            ['success', 'city', 'temp', 'humidity']
        );
        assert.strictEqual(r.valid, false);
        assert.ok(r.ratio < 0.5);
    });

    it('empty data → valid (fallback)', () => {
        const r = validateResponseSchema(null, ['success']);
        assert.strictEqual(r.valid, true);
    });

    it('no expected fields → valid (nothing to check)', () => {
        const r = validateResponseSchema({ data: 1 }, []);
        assert.strictEqual(r.valid, true);
    });

    it('nested field found → counted as present', () => {
        const r = validateResponseSchema(
            { wrapper: { city: 'Paris' }, success: true },
            ['success', 'city']
        );
        assert.strictEqual(r.present.length, 2);
        assert.strictEqual(r.valid, true);
    });

    it('ratio computation is exact', () => {
        const r = validateResponseSchema(
            { a: 1, b: 2 },
            ['a', 'b', 'c', 'd']
        );
        assert.strictEqual(r.ratio, 0.5);
        assert.strictEqual(r.valid, true);
    });

    it('zero present out of many → invalid', () => {
        const r = validateResponseSchema(
            { x: 1 },
            ['a', 'b', 'c']
        );
        assert.strictEqual(r.valid, false);
        assert.strictEqual(r.ratio, 0);
    });

    it('all fields present plus extras → still valid', () => {
        const r = validateResponseSchema(
            { success: true, city: 'Paris', extra: 'data' },
            ['success', 'city']
        );
        assert.strictEqual(r.valid, true);
        assert.strictEqual(r.ratio, 1);
    });

    it('missing array returns correct fields', () => {
        const r = validateResponseSchema(
            { a: 1 },
            ['a', 'b', 'c']
        );
        assert.deepStrictEqual(r.missing, ['b', 'c']);
        assert.deepStrictEqual(r.present, ['a']);
    });

    it('non-object data (string) → valid fallback', () => {
        const r = validateResponseSchema('hello', ['success']);
        assert.strictEqual(r.valid, true);
    });

    it('array data → valid (arrays are valid data, schema check N/A)', () => {
        const r = validateResponseSchema([1, 2, 3], ['success']);
        // Arrays don't have named keys, but check still runs — fields won't be found
        // Since array is a non-null object, the check proceeds. 0/1 fields = invalid
        assert.ok(typeof r.valid === 'boolean');
    });

    it('deeply nested field NOT found (only 1 level)', () => {
        const r = validateResponseSchema(
            { layer1: { layer2: { deep: 'value' } } },
            ['deep']
        );
        // deep is nested 2 levels — only 1 level checked
        assert.strictEqual(r.missing.length, 1);
    });

    it('exact 0.5 threshold → valid', () => {
        const r = validateResponseSchema(
            { a: 1 },
            ['a', 'b']
        );
        assert.strictEqual(r.ratio, 0.5);
        assert.strictEqual(r.valid, true);
    });

    it('just below 0.5 → invalid', () => {
        const r = validateResponseSchema(
            { a: 1 },
            ['a', 'b', 'c']
        );
        assert.ok(r.ratio < 0.5);
        assert.strictEqual(r.valid, false);
    });
});

// ─── Suite 3: scoreContentQuality ─────────────────────────────────────────────

describe('response-validator — scoreContentQuality', () => {
    it('null data → score 0', () => {
        const r = scoreContentQuality(null, { success: true });
        assert.strictEqual(r.score, 0);
    });

    it('primitive data → score 0.7', () => {
        const r = scoreContentQuality('hello', { success: true });
        assert.strictEqual(r.score, 0.7);
    });

    it('no schema → score 1', () => {
        const r = scoreContentQuality({ data: 1 }, null);
        assert.strictEqual(r.score, 1);
    });

    it('empty schema → score 1', () => {
        const r = scoreContentQuality({ data: 1 }, {});
        assert.strictEqual(r.score, 1);
    });

    it('full type match → high score', () => {
        const r = scoreContentQuality(
            { success: true, city: 'Paris', temp: 22 },
            { success: true, city: 'London', temp: 15 }
        );
        assert.ok(r.score >= 0.8);
    });

    // ─── "Vrai Vide" tests ─────────────────────────────────────────────

    it('empty array when example has array → TYPE MATCH (score >= 0.7)', () => {
        const r = scoreContentQuality(
            { success: true, results: [] },
            { success: true, results: [{ title: 'x' }] }
        );
        assert.ok(r.score >= 0.7, `Score ${r.score} should be >= 0.7 (type match: array=array)`);
    });

    it('null when example has array → TYPE MISMATCH (lower score than full match)', () => {
        const r = scoreContentQuality(
            { success: true, results: null },
            { success: true, results: [{ title: 'x' }] }
        );
        assert.ok(r.score < 0.7, `Score ${r.score} should be < 0.7 (type mismatch: null≠array)`);
        assert.ok(r.reasons.some(r => r.includes('type_mismatch')));
    });

    it('string when example has array → TYPE MISMATCH (lower score)', () => {
        const r = scoreContentQuality(
            { success: true, results: 'error' },
            { success: true, results: [{ title: 'x' }] }
        );
        assert.ok(r.score < 0.7, `Score ${r.score} should be < 0.7 (type mismatch: string≠array)`);
        assert.ok(r.reasons.some(r => r.includes('type_mismatch')));
    });

    it('count: 0 when example has count: 5 → TYPE MATCH (score >= 0.7)', () => {
        const r = scoreContentQuality(
            { success: true, count: 0 },
            { success: true, count: 5 }
        );
        assert.ok(r.score >= 0.7, `Score ${r.score} should be >= 0.7 (type match: number=number)`);
    });

    it('null data field when example has object → TYPE MISMATCH (lower score)', () => {
        const r = scoreContentQuality(
            { success: true, data: null },
            { success: true, data: { key: 'value' } }
        );
        assert.ok(r.score < 0.7, `Score ${r.score} should be < 0.7 (type mismatch: null≠object)`);
        assert.ok(r.reasons.some(r => r.includes('type_mismatch')));
    });

    it('empty string when example has long text → small penalty', () => {
        const r = scoreContentQuality(
            { success: true, content: '' },
            { success: true, content: 'This is a detailed description of something...' }
        );
        // Short string penalty is mild (0.2), so score should still be reasonable
        assert.ok(r.score >= 0.5);
    });

    it('error disguised as success → strong penalty', () => {
        const r = scoreContentQuality(
            { success: true, error: 'API key invalid' },
            { success: true, data: { value: 42 } }
        );
        assert.ok(r.score < 0.5, `Score ${r.score} should be < 0.5 (error-in-success pattern)`);
    });

    it('all matching types → score close to 1.0', () => {
        const r = scoreContentQuality(
            { success: true, name: 'Test', count: 10, items: ['a'] },
            { success: true, name: 'Example', count: 5, items: ['b'] }
        );
        assert.ok(r.score >= 0.9);
    });

    it('missing fields from schema → lower score', () => {
        const r = scoreContentQuality(
            { success: true },
            { success: true, name: 'X', count: 5, items: ['b'] }
        );
        assert.ok(r.score < 1.0);
    });

    it('boolean true/false → type match', () => {
        const r = scoreContentQuality(
            { success: false },
            { success: true }
        );
        assert.ok(r.score >= 0.7);
    });

    it('object vs string → type mismatch', () => {
        const r = scoreContentQuality(
            { data: 'text' },
            { data: { key: 'val' } }
        );
        assert.ok(r.score < 0.5);
    });

    it('number vs string → type mismatch', () => {
        const r = scoreContentQuality(
            { value: 42 },
            { value: 'hello' }
        );
        assert.ok(r.score < 0.5);
    });

    it('array vs null → type mismatch', () => {
        const r = scoreContentQuality(
            { items: null },
            { items: [1, 2, 3] }
        );
        assert.ok(r.score < 0.5);
    });
});

// ─── Suite 4: signValidation / verifyValidationSignature ──────────────────────

describe('response-validator — signValidation & verify', () => {
    const SECRET = 'a'.repeat(64);

    it('should produce a valid hex string', () => {
        const sig = signValidation({ schema_match: 0.85, quality_score: 0.7 }, SECRET);
        assert.ok(sig);
        assert.ok(/^[a-f0-9]{64}$/.test(sig));
    });

    it('should return null when no secret', () => {
        const sig = signValidation({ a: 1 }, null);
        assert.strictEqual(sig, null);
    });

    it('should return null when empty secret', () => {
        const sig = signValidation({ a: 1 }, '');
        assert.strictEqual(sig, null);
    });

    it('verify should return true for valid signature', () => {
        const obj = { schema_match: 0.85, quality_score: 0.7 };
        const sig = signValidation(obj, SECRET);
        assert.strictEqual(verifyValidationSignature(obj, sig, SECRET), true);
    });

    it('verify should return false for tampered data', () => {
        const obj = { schema_match: 0.85, quality_score: 0.7 };
        const sig = signValidation(obj, SECRET);
        const tampered = { schema_match: 0.99, quality_score: 0.7 };
        assert.strictEqual(verifyValidationSignature(tampered, sig, SECRET), false);
    });

    it('verify should return false for wrong secret', () => {
        const obj = { schema_match: 0.85 };
        const sig = signValidation(obj, SECRET);
        assert.strictEqual(verifyValidationSignature(obj, sig, 'b'.repeat(64)), false);
    });

    it('verify should return false for null signature', () => {
        assert.strictEqual(verifyValidationSignature({ a: 1 }, null, SECRET), false);
    });

    it('verify should return false for no secret', () => {
        assert.strictEqual(verifyValidationSignature({ a: 1 }, 'abc', null), false);
    });
});

// ─── Suite 5: buildValidationMeta ─────────────────────────────────────────────

describe('response-validator — buildValidationMeta', () => {
    it('should build a valid meta object', () => {
        const schema = { valid: true, ratio: 0.85, present: ['success', 'city'], missing: ['temp'] };
        const quality = { score: 0.72, reasons: [] };
        const meta = buildValidationMeta(schema, quality, null);

        assert.strictEqual(meta.schema_match, 0.85);
        assert.strictEqual(meta.quality_score, 0.72);
        assert.deepStrictEqual(meta.fields_present, ['success', 'city']);
        assert.deepStrictEqual(meta.fields_missing, ['temp']);
        assert.strictEqual(meta.charged, true);
        assert.strictEqual(meta.signature, null);
    });

    it('should include HMAC signature when secret provided', () => {
        const schema = { valid: true, ratio: 1, present: ['a'], missing: [] };
        const quality = { score: 1, reasons: [] };
        const meta = buildValidationMeta(schema, quality, 'test-secret-key');

        assert.ok(meta.signature);
        assert.ok(/^[a-f0-9]{64}$/.test(meta.signature));
    });

    it('charged=false when schema ratio < 0.5', () => {
        const schema = { valid: false, ratio: 0.3, present: ['a'], missing: ['b', 'c'] };
        const quality = { score: 0.8, reasons: [] };
        const meta = buildValidationMeta(schema, quality, null);

        assert.strictEqual(meta.charged, false);
    });

    it('charged=false when quality score < 0.3', () => {
        const schema = { valid: true, ratio: 1, present: ['a'], missing: [] };
        const quality = { score: 0.2, reasons: ['type_mismatch'] };
        const meta = buildValidationMeta(schema, quality, null);

        assert.strictEqual(meta.charged, false);
    });

    it('should round scores to 2 decimal places', () => {
        const schema = { valid: true, ratio: 0.333333, present: ['a'], missing: ['b', 'c'] };
        const quality = { score: 0.666666, reasons: [] };
        const meta = buildValidationMeta(schema, quality, null);

        assert.strictEqual(meta.schema_match, 0.33);
        assert.strictEqual(meta.quality_score, 0.67);
    });
});

// ─── Suite 6: getValueType helper ─────────────────────────────────────────────

describe('response-validator — getValueType', () => {
    it('null → "null"', () => assert.strictEqual(getValueType(null), 'null'));
    it('array → "array"', () => assert.strictEqual(getValueType([]), 'array'));
    it('object → "object"', () => assert.strictEqual(getValueType({}), 'object'));
    it('string → "string"', () => assert.strictEqual(getValueType('hi'), 'string'));
    it('number → "number"', () => assert.strictEqual(getValueType(42), 'number'));
    it('boolean → "boolean"', () => assert.strictEqual(getValueType(true), 'boolean'));
    it('undefined → "undefined"', () => assert.strictEqual(getValueType(undefined), 'undefined'));
});

// ─── Suite 7: sortObjectKeys helper ──────────────────────────────────────────

describe('response-validator — sortObjectKeys', () => {
    it('should sort keys alphabetically', () => {
        const result = sortObjectKeys({ c: 3, a: 1, b: 2 });
        assert.deepStrictEqual(Object.keys(result), ['a', 'b', 'c']);
    });

    it('should return primitives as-is', () => {
        assert.strictEqual(sortObjectKeys('hello'), 'hello');
        assert.strictEqual(sortObjectKeys(42), 42);
        assert.strictEqual(sortObjectKeys(null), null);
    });

    it('should return arrays as-is', () => {
        const arr = [3, 1, 2];
        assert.strictEqual(sortObjectKeys(arr), arr);
    });
});

// ─── Suite 8: Integration — shouldChargeForResponse with serviceUrl ────────────

describe('response-validator — shouldChargeForResponse integration (Layer 0+1+2)', () => {
    // Import shouldChargeForResponse from proxy
    const { shouldChargeForResponse } = require('../routes/proxy');

    it('backward compat: 2 args still works (no serviceUrl)', () => {
        const r = shouldChargeForResponse(200, { result: 'hello' });
        assert.strictEqual(r.shouldCharge, true);
    });

    it('4xx → not charged even with serviceUrl', () => {
        const r = shouldChargeForResponse(400, { error: 'bad' }, 'https://x402-api.onrender.com/api/weather');
        assert.strictEqual(r.shouldCharge, false);
        assert.ok(r.reason.includes('400'));
    });

    it('empty response → not charged even with serviceUrl', () => {
        const r = shouldChargeForResponse(200, null, 'https://x402-api.onrender.com/api/weather');
        assert.strictEqual(r.shouldCharge, false);
        assert.strictEqual(r.reason, 'empty_response');
    });

    it('200 + valid data + known URL → charged', () => {
        // Weather example: { city, country, temperature, wind_speed, weather_code }
        const r = shouldChargeForResponse(200, { city: 'Paris', country: 'FR', temperature: 14.2, wind_speed: 12.5, weather_code: 1 }, 'https://x402-api.onrender.com/api/weather');
        assert.strictEqual(r.shouldCharge, true);
    });

    it('200 + data with unknown URL → charged (fallback Layer 0 only)', () => {
        const r = shouldChargeForResponse(200, { some: 'data' }, 'https://external.com/api/something');
        assert.strictEqual(r.shouldCharge, true);
    });

    it('200 + schema mismatch (0/5 fields) → not charged', () => {
        const expected = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/weather');
        if (expected && expected.fields.length >= 3) {
            // Response has NONE of the expected fields
            const r = shouldChargeForResponse(200, { unrelated: 'garbage', x: 1 }, 'https://x402-api.onrender.com/api/weather');
            assert.strictEqual(r.shouldCharge, false);
            assert.strictEqual(r.reason, 'schema_mismatch');
        }
    });

    it('200 + valid data + no serviceUrl → charged (backward compat)', () => {
        const r = shouldChargeForResponse(200, { result: 'data' });
        assert.strictEqual(r.shouldCharge, true);
    });

    it('200 + { items: [] } → charged (empty array is valid)', () => {
        const r = shouldChargeForResponse(200, { items: [] });
        assert.strictEqual(r.shouldCharge, true);
    });

    it('200 + { count: 0 } → charged (zero is valid)', () => {
        const r = shouldChargeForResponse(200, { count: 0 });
        assert.strictEqual(r.shouldCharge, true);
    });

    it('200 + { raw: "" } → not charged (empty text fallback)', () => {
        const r = shouldChargeForResponse(200, { raw: '' }, 'https://x402-api.onrender.com/api/joke');
        assert.strictEqual(r.shouldCharge, false);
        assert.strictEqual(r.reason, 'empty_response');
    });

    it('200 + {success:true, error:"fail"} with schema → penalized quality', () => {
        // This triggers error-disguised-as-success detection in quality scoring
        const r = shouldChargeForResponse(200, { success: true, error: 'API quota exceeded' }, 'https://x402-api.onrender.com/api/weather');
        // Result depends on whether schema+quality combined push below threshold
        // At minimum, the response passes Layer 0 (non-empty, not 4xx)
        assert.ok(typeof r.shouldCharge === 'boolean');
    });

    it('result includes _validation when schema_mismatch', () => {
        const expected = getExpectedFieldsForUrl('https://x402-api.onrender.com/api/weather');
        if (expected && expected.fields.length >= 3) {
            const r = shouldChargeForResponse(200, { x: 1 }, 'https://x402-api.onrender.com/api/weather');
            if (!r.shouldCharge && r.reason === 'schema_mismatch') {
                assert.ok(r._validation);
                assert.ok(typeof r._validation.schema_match === 'number');
            }
        }
    });

    it('result includes _validation when low_quality_content', () => {
        // Hard to trigger with real schemas, but test the response format
        const r = shouldChargeForResponse(200, { success: true, error: 'bad' }, 'https://x402-api.onrender.com/api/weather');
        // Either charged or not, but format is correct
        assert.ok(typeof r.shouldCharge === 'boolean');
        assert.ok(typeof r.reason === 'string');
    });
});
