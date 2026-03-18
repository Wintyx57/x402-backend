'use strict';

const crypto = require('crypto');

// ─── Layer 1: Schema Validation ──────────────────────────────────────────────

/**
 * Get expected output fields for a service URL from discoveryMap.
 * Deferred require to avoid circular dependency.
 * @param {string} serviceUrl — full URL like https://x402-api.onrender.com/api/weather
 * @returns {{ fields: string[], example: object } | null}
 */
function getExpectedFieldsForUrl(serviceUrl) {
    try {
        const path = new URL(serviceUrl).pathname;
        // Lazy-load to avoid circular require
        const { discoveryMap } = require('./bazaar-discovery');
        const disc = discoveryMap[path];
        if (!disc) return null;

        // Discovery extensions have .bazaar.info.output.example or .output.example
        const example = disc?.bazaar?.info?.output?.example
            ?? disc?.output?.example
            ?? null;
        if (!example || typeof example !== 'object') return null;

        const fields = Object.keys(example);
        return { fields, example };
    } catch {
        return null;
    }
}

/**
 * Validate that response data contains the expected fields.
 * Inspired by daily-tester.js:validateResponse() but with a lower threshold
 * (proxy uses 0.5, daily-tester uses 0.7 — proxy is more conservative to avoid false positives).
 *
 * @param {*} data — parsed response body
 * @param {string[]} expectedFields — list of expected top-level field names
 * @returns {{ valid: boolean, ratio: number, present: string[], missing: string[] }}
 */
function validateResponseSchema(data, expectedFields) {
    if (data == null || typeof data !== 'object' || !Array.isArray(expectedFields) || expectedFields.length === 0) {
        return { valid: true, ratio: 1, present: [], missing: [] };
    }

    const present = [];
    const missing = [];

    for (const field of expectedFields) {
        if (data[field] !== undefined) {
            present.push(field);
        } else {
            // Check one level of nesting
            const foundNested = Object.values(data).some(v =>
                v && typeof v === 'object' && !Array.isArray(v) && v[field] !== undefined
            );
            if (foundNested) {
                present.push(field);
            } else {
                missing.push(field);
            }
        }
    }

    const ratio = present.length / expectedFields.length;
    const valid = ratio >= 0.5;

    return { valid, ratio, present, missing };
}

// ─── Layer 2: Content Quality Scoring ────────────────────────────────────────

/**
 * Score the quality of response data by comparing with the expected example schema.
 * Uses type-match heuristics — empty arrays/zero values are valid if the type matches.
 *
 * @param {*} data — parsed response body
 * @param {object} exampleSchema — the output.example from discoveryMap
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreContentQuality(data, exampleSchema) {
    if (data == null) return { score: 0, reasons: ['null_response'] };
    if (typeof data !== 'object') return { score: 0.7, reasons: ['primitive_response'] };
    if (!exampleSchema || typeof exampleSchema !== 'object') return { score: 1, reasons: ['no_schema'] };

    const reasons = [];
    let penalties = 0;
    let checks = 0;

    const exampleKeys = Object.keys(exampleSchema);
    if (exampleKeys.length === 0) return { score: 1, reasons: ['empty_schema'] };

    for (const key of exampleKeys) {
        const expected = exampleSchema[key];
        const actual = data[key];
        checks++;

        if (actual === undefined) {
            // Field missing entirely — already penalized by Layer 1, light penalty here
            penalties += 0.3;
            continue;
        }

        // Type match check
        const expectedType = getValueType(expected);
        const actualType = getValueType(actual);

        if (expectedType !== actualType) {
            // TYPE MISMATCH — strong penalty
            if (actual === null && expected !== null) {
                penalties += 1;
                reasons.push(`type_mismatch:${key}(expected=${expectedType},got=null)`);
            } else {
                penalties += 0.8;
                reasons.push(`type_mismatch:${key}(expected=${expectedType},got=${actualType})`);
            }
            continue;
        }

        // Type matches — check for deceptive patterns
        if (actualType === 'string' && expected.length >= 10 && actual.length < 3) {
            penalties += 0.2;
            reasons.push(`short_string:${key}`);
        }
    }

    // Pattern: {success: true, error: "..."} — error disguised as success
    if (data.success === true && typeof data.error === 'string' && data.error.length > 0) {
        penalties += 1.5;
        reasons.push('error_disguised_as_success');
    }

    // Compute score: 1.0 minus weighted penalties, clamped to [0, 1]
    const maxPenalty = checks > 0 ? checks : 1;
    const score = Math.max(0, Math.min(1, 1 - (penalties / maxPenalty)));

    return { score, reasons };
}

/**
 * Get a simplified type string for a value.
 * Distinguishes: array, object, string, number, boolean, null
 */
function getValueType(val) {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    return typeof val; // 'object', 'string', 'number', 'boolean', 'undefined'
}

// ─── Layer 3: HMAC Signature ─────────────────────────────────────────────────

/**
 * Sign a validation object with HMAC-SHA256.
 * @param {object} validationObj — the validation metadata (without signature)
 * @param {string} secret — VALIDATION_SECRET env var
 * @returns {string} hex HMAC signature
 */
function signValidation(validationObj, secret) {
    if (!secret) return null;
    const sorted = sortObjectKeys(validationObj);
    return crypto.createHmac('sha256', secret).update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Verify an HMAC signature on a validation object.
 * @param {object} validationObj — the validation metadata (without signature field)
 * @param {string} signature — the HMAC hex string to verify
 * @param {string} secret — VALIDATION_SECRET env var
 * @returns {boolean}
 */
function verifyValidationSignature(validationObj, signature, secret) {
    if (!secret || !signature) return false;
    const expected = signValidation(validationObj, secret);
    if (!expected) return false;
    // Timing-safe comparison
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * Sort object keys alphabetically (for deterministic HMAC).
 */
function sortObjectKeys(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = obj[key];
    }
    return sorted;
}

// ─── Build Validation Metadata ───────────────────────────────────────────────

/**
 * Build the _validation metadata object with optional HMAC signature.
 * @param {{ valid: boolean, ratio: number, present: string[], missing: string[] }} schema — from validateResponseSchema
 * @param {{ score: number, reasons: string[] }} quality — from scoreContentQuality
 * @param {string|null} secret — VALIDATION_SECRET env var (optional)
 * @returns {object} _validation metadata
 */
function buildValidationMeta(schema, quality, secret) {
    const meta = {
        schema_match: Number(schema.ratio.toFixed(2)),
        quality_score: Number(quality.score.toFixed(2)),
        fields_present: schema.present,
        fields_missing: schema.missing,
        charged: schema.valid && quality.score >= 0.3,
    };

    const signature = signValidation(meta, secret || null);
    meta.signature = signature;

    return meta;
}

module.exports = {
    getExpectedFieldsForUrl,
    validateResponseSchema,
    scoreContentQuality,
    signValidation,
    verifyValidationSignature,
    buildValidationMeta,
    // Exported for testing
    getValueType,
    sortObjectKeys,
};
