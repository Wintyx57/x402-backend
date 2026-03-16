// tests/batch-register.test.js — Unit tests for batch-register endpoint logic
// Covers: BatchRegisterSchema validation, verifyBatchRegisterSignature, checkDuplicateUrl,
// POST /batch-register logic, duplicate URL checks on /register and /quick-register.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BatchRegisterSchema } = require('../schemas');

// ─── Replicate verifyBatchRegisterSignature from routes/register.js ────────────

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

async function verifyBatchRegisterSignature({ ownerAddress, serviceCount, timestamp, signature, _recoverFn }) {
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || ts <= 0) {
        return { valid: false, reason: 'invalid_timestamp' };
    }
    const age = Date.now() - ts;
    if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
        return { valid: false, reason: 'timestamp_expired', age_ms: age };
    }
    const message = `batch-register:${ownerAddress}:${serviceCount}:${timestamp}`;
    const recoverFn = _recoverFn || (() => Promise.reject(new Error('No recoverFn provided in test')));
    try {
        const recovered = await recoverFn({ message, signature });
        if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
            return { valid: false, reason: 'signature_mismatch', recovered };
        }
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: 'signature_recovery_failed', error: err.message };
    }
}

// ─── Replicate checkDuplicateUrl from routes/register.js ───────────────────────

async function checkDuplicateUrl(supabase, url) {
    const { data } = await supabase
        .from('services')
        .select('id, name')
        .eq('url', url)
        .limit(1);
    if (data && data.length > 0) {
        return data[0];
    }
    return null;
}

// ─── Replicate intra-batch duplicate detection logic ──────────────────────────

function detectIntraBatchDuplicates(services) {
    const urls = services.map(s => s.url);
    const uniqueUrls = new Set(urls);
    return uniqueUrls.size !== urls.length;
}

// ─── Replicate batch endpoint response builder ───────────────────────────────

function buildBatchEndpointResponse({ validatedData, sigCheck, ssrfBlockedUrl, intraBatchDuplicate, existingServices, insertResult }) {
    if (!sigCheck.valid) {
        return {
            status: 401,
            body: { error: 'Invalid signature', reason: sigCheck.reason },
        };
    }
    if (ssrfBlockedUrl) {
        return {
            status: 400,
            body: { error: 'Invalid service URL', message: `URL "${ssrfBlockedUrl}" must point to a publicly reachable address` },
        };
    }
    if (intraBatchDuplicate) {
        return {
            status: 400,
            body: { error: 'Duplicate URLs in batch', message: 'Each service must have a unique URL within the batch' },
        };
    }
    if (existingServices && existingServices.length > 0) {
        return {
            status: 409,
            body: {
                error: 'URLs already registered',
                duplicates: existingServices.map(s => ({
                    url: s.url,
                    existing_service_id: s.id,
                    existing_service_name: s.name,
                })),
            },
        };
    }
    if (insertResult.error) {
        return { status: 500, body: { error: 'Batch registration failed' } };
    }
    return {
        status: 201,
        body: {
            success: true,
            message: `${insertResult.data.length} services registered successfully!`,
            data: insertResult.data,
        },
    };
}

// ─── Replicate /register and /quick-register 409 duplicate logic ──────────────

function buildRegisterDuplicateResponse(existingService) {
    if (existingService) {
        return {
            status: 409,
            body: {
                error: 'URL already registered',
                existing_service_id: existingService.id,
                existing_service_name: existingService.name,
            },
        };
    }
    return { status: 201, body: { success: true } };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_ADDRESS = '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430';

function makeValidService(overrides = {}) {
    return {
        name: 'Test Service',
        url: 'https://api.example.com/v1',
        price: 0.05,
        ...overrides,
    };
}

function makeValidBatchBody(overrides = {}) {
    return {
        services: [makeValidService()],
        ownerAddress: VALID_ADDRESS,
        signature: '0xsignature',
        timestamp: Date.now(),
        ...overrides,
    };
}

function makeSignatureParams(overrides = {}) {
    return {
        ownerAddress: VALID_ADDRESS,
        serviceCount: 1,
        timestamp: Date.now(),
        signature: '0xsignature',
        _recoverFn: async () => VALID_ADDRESS,
        ...overrides,
    };
}

// ─── Suite 1: BatchRegisterSchema validation ───────────────────────────────────

describe('BatchRegisterSchema — valid batch', () => {
    it('should accept a valid batch with one service', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody());
        assert.strictEqual(result.success, true);
    });

    it('should accept a batch with 50 services (maximum allowed)', () => {
        const services = Array.from({ length: 50 }, (_, i) => makeValidService({
            name: `Service ${i}`,
            url: `https://api.example.com/v${i}`,
        }));
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({ services }));
        assert.strictEqual(result.success, true);
    });

    it('should accept a service with optional description', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ description: 'My great service' })],
        }));
        assert.strictEqual(result.success, true);
    });

    it('should accept a service with optional tags', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ tags: ['ai', 'weather'] })],
        }));
        assert.strictEqual(result.success, true);
    });
});

describe('BatchRegisterSchema — empty services array', () => {
    it('should reject an empty services array', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({ services: [] }));
        assert.strictEqual(result.success, false);
    });
});

describe('BatchRegisterSchema — max 50 services', () => {
    it('should reject a batch with 51 services', () => {
        const services = Array.from({ length: 51 }, (_, i) => makeValidService({
            name: `Service ${i}`,
            url: `https://api.example.com/v${i}`,
        }));
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({ services }));
        assert.strictEqual(result.success, false);
    });
});

describe('BatchRegisterSchema — invalid ownerAddress', () => {
    it('should reject ownerAddress without 0x prefix', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            ownerAddress: 'a'.repeat(40),
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject ownerAddress that is too short', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            ownerAddress: '0x' + 'a'.repeat(39),
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject ownerAddress with non-hex characters', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            ownerAddress: '0x' + 'g'.repeat(40),
        }));
        assert.strictEqual(result.success, false);
    });
});

describe('BatchRegisterSchema — missing required top-level fields', () => {
    it('should reject when signature is missing', () => {
        const body = makeValidBatchBody();
        delete body.signature;
        const result = BatchRegisterSchema.safeParse(body);
        assert.strictEqual(result.success, false);
    });

    it('should reject when timestamp is missing', () => {
        const body = makeValidBatchBody();
        delete body.timestamp;
        const result = BatchRegisterSchema.safeParse(body);
        assert.strictEqual(result.success, false);
    });
});

describe('BatchRegisterSchema — service field validation', () => {
    it('should reject a service with invalid URL (no protocol)', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ url: 'example.com/no-protocol' })],
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a service with price too high (above 1000)', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ price: 1001 })],
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a service with price too low (below 0.001)', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ price: 0 })],
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a service with name too long (over 200 chars)', () => {
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ name: 'a'.repeat(201) })],
        }));
        assert.strictEqual(result.success, false);
    });

    it('should reject a service with more than 10 tags', () => {
        const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ tags })],
        }));
        assert.strictEqual(result.success, false);
    });
});

// ─── Suite 2: verifyBatchRegisterSignature ────────────────────────────────────

describe('verifyBatchRegisterSignature — timestamp validation', () => {
    it('should reject an invalid (non-integer) timestamp', async () => {
        const params = makeSignatureParams({ timestamp: 'not-a-number' });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should reject a zero timestamp', async () => {
        const params = makeSignatureParams({ timestamp: 0 });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'invalid_timestamp');
    });

    it('should reject an expired timestamp (older than 5 minutes)', async () => {
        const params = makeSignatureParams({ timestamp: Date.now() - 6 * 60 * 1000 });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'timestamp_expired');
    });

    it('should reject a timestamp in the future', async () => {
        const params = makeSignatureParams({ timestamp: Date.now() + 10 * 60 * 1000 });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'timestamp_expired');
    });
});

describe('verifyBatchRegisterSignature — signature mismatch and errors', () => {
    it('should reject when recovered address differs from ownerAddress', async () => {
        const otherAddress = '0x' + 'b'.repeat(40);
        const params = makeSignatureParams({
            _recoverFn: async () => otherAddress,
        });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'signature_mismatch');
        assert.strictEqual(result.recovered, otherAddress);
    });

    it('should return signature_recovery_failed when recoverFn throws', async () => {
        const params = makeSignatureParams({
            _recoverFn: async () => { throw new Error('Invalid signature bytes'); },
        });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'signature_recovery_failed');
        assert.ok(result.error.includes('Invalid signature bytes'));
    });

    it('should not throw when recoverFn rejects', async () => {
        const params = makeSignatureParams({
            _recoverFn: async () => { throw new Error('Crypto error'); },
        });
        await assert.doesNotReject(async () => {
            await verifyBatchRegisterSignature(params);
        });
    });

    it('should accept a valid signature (case-insensitive address match)', async () => {
        const params = makeSignatureParams({
            ownerAddress: VALID_ADDRESS.toLowerCase(),
            _recoverFn: async () => VALID_ADDRESS.toUpperCase(),
        });
        const result = await verifyBatchRegisterSignature(params);
        assert.strictEqual(result.valid, true);
    });
});

// ─── Suite 3: checkDuplicateUrl ───────────────────────────────────────────────

describe('checkDuplicateUrl — no duplicate found', () => {
    it('should return null when no existing service has the URL', async () => {
        const supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => Promise.resolve({ data: [] }),
                    }),
                }),
            }),
        };
        const result = await checkDuplicateUrl(supabase, 'https://api.new-service.com');
        assert.strictEqual(result, null);
    });
});

describe('checkDuplicateUrl — duplicate found', () => {
    it('should return the existing service id and name when URL already exists', async () => {
        const existing = { id: 'uuid-1234', name: 'Existing Service' };
        const supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => Promise.resolve({ data: [existing] }),
                    }),
                }),
            }),
        };
        const result = await checkDuplicateUrl(supabase, 'https://api.existing.com');
        assert.deepStrictEqual(result, existing);
    });

    it('should return null when supabase returns null data', async () => {
        const supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => Promise.resolve({ data: null }),
                    }),
                }),
            }),
        };
        const result = await checkDuplicateUrl(supabase, 'https://api.example.com');
        assert.strictEqual(result, null);
    });
});

// ─── Suite 4: POST /batch-register logic ──────────────────────────────────────

describe('POST /batch-register — validation failure', () => {
    it('should return 400 when services array is empty', () => {
        const parseResult = BatchRegisterSchema.safeParse(makeValidBatchBody({ services: [] }));
        assert.strictEqual(parseResult.success, false);
        // Simulated response
        const errors = parseResult.error.issues.map(err => ({
            field: err.path.join('.') || 'root',
            message: err.message,
        }));
        assert.ok(errors.length > 0);
    });

    it('should return 400 when a service has an invalid URL', () => {
        const parseResult = BatchRegisterSchema.safeParse(makeValidBatchBody({
            services: [makeValidService({ url: 'not-a-valid-url' })],
        }));
        assert.strictEqual(parseResult.success, false);
    });
});

describe('POST /batch-register — signature rejected', () => {
    it('should return 401 when signature is invalid', async () => {
        const sigCheck = { valid: false, reason: 'signature_mismatch' };
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck,
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices: [],
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.status, 401);
        assert.strictEqual(response.body.reason, 'signature_mismatch');
    });

    it('should return 401 when timestamp is expired', async () => {
        const sigCheck = { valid: false, reason: 'timestamp_expired' };
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck,
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices: [],
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.status, 401);
        assert.strictEqual(response.body.reason, 'timestamp_expired');
    });
});

describe('POST /batch-register — SSRF blocked URL', () => {
    it('should return 400 for a private IP URL', () => {
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: 'http://192.168.1.1/api',
            intraBatchDuplicate: false,
            existingServices: [],
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.status, 400);
        assert.ok(response.body.error.includes('Invalid service URL'));
    });
});

describe('POST /batch-register — intra-batch duplicate URLs', () => {
    it('should detect duplicate URLs within the same batch', () => {
        const services = [
            makeValidService({ url: 'https://api.example.com/same' }),
            makeValidService({ name: 'Other Service', url: 'https://api.example.com/same' }),
        ];
        const hasDuplicates = detectIntraBatchDuplicates(services);
        assert.strictEqual(hasDuplicates, true);
    });

    it('should return 400 when intra-batch duplicate URLs are detected', () => {
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: null,
            intraBatchDuplicate: true,
            existingServices: [],
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.body.error, 'Duplicate URLs in batch');
    });

    it('should not flag duplicates when all URLs are unique', () => {
        const services = [
            makeValidService({ url: 'https://api.example.com/v1' }),
            makeValidService({ name: 'Other Service', url: 'https://api.example.com/v2' }),
        ];
        const hasDuplicates = detectIntraBatchDuplicates(services);
        assert.strictEqual(hasDuplicates, false);
    });
});

describe('POST /batch-register — existing URL in DB', () => {
    it('should return 409 when an existing URL is found in database', () => {
        const existingServices = [{ id: 'uuid-abc', name: 'Old Service', url: 'https://api.example.com/v1' }];
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices,
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.status, 409);
        assert.strictEqual(response.body.error, 'URLs already registered');
        assert.ok(Array.isArray(response.body.duplicates));
        assert.strictEqual(response.body.duplicates[0].existing_service_id, 'uuid-abc');
    });

    it('should include all duplicates in the 409 response', () => {
        const existingServices = [
            { id: 'uuid-1', name: 'Service 1', url: 'https://api.example.com/v1' },
            { id: 'uuid-2', name: 'Service 2', url: 'https://api.example.com/v2' },
        ];
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices,
            insertResult: { data: [], error: null },
        });
        assert.strictEqual(response.body.duplicates.length, 2);
    });
});

describe('POST /batch-register — successful batch insert', () => {
    it('should return 201 with inserted service data on success', () => {
        const insertedServices = [
            { id: 'new-uuid-1', name: 'Service A', price_usdc: 0.05 },
            { id: 'new-uuid-2', name: 'Service B', price_usdc: 0.10 },
        ];
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices: [],
            insertResult: { data: insertedServices, error: null },
        });
        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.body.success, true);
        assert.strictEqual(response.body.data.length, 2);
        assert.ok(response.body.message.includes('2 services'));
    });

    it('should return 500 when supabase insert fails', () => {
        const response = buildBatchEndpointResponse({
            validatedData: makeValidBatchBody(),
            sigCheck: { valid: true },
            ssrfBlockedUrl: null,
            intraBatchDuplicate: false,
            existingServices: [],
            insertResult: { data: null, error: new Error('DB constraint violation') },
        });
        assert.strictEqual(response.status, 500);
        assert.strictEqual(response.body.error, 'Batch registration failed');
    });
});

describe('POST /batch-register — max 50 services enforcement', () => {
    it('should accept exactly 50 services via schema', () => {
        const services = Array.from({ length: 50 }, (_, i) => makeValidService({
            name: `Service ${i}`,
            url: `https://api.example.com/svc${i}`,
        }));
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({ services }));
        assert.strictEqual(result.success, true);
    });

    it('should reject 51 services via schema before endpoint logic', () => {
        const services = Array.from({ length: 51 }, (_, i) => makeValidService({
            name: `Service ${i}`,
            url: `https://api.example.com/svc${i}`,
        }));
        const result = BatchRegisterSchema.safeParse(makeValidBatchBody({ services }));
        assert.strictEqual(result.success, false);
    });
});

// ─── Suite 5: Duplicate URL check on /register and /quick-register ─────────────

describe('Duplicate URL check on /register', () => {
    it('should return 409 when URL already exists in /register', () => {
        const existingService = { id: 'uuid-existing', name: 'Already Registered' };
        const response = buildRegisterDuplicateResponse(existingService);
        assert.strictEqual(response.status, 409);
        assert.strictEqual(response.body.error, 'URL already registered');
    });

    it('should include existing_service_id in 409 response body', () => {
        const existingService = { id: 'uuid-existing', name: 'Already Registered' };
        const response = buildRegisterDuplicateResponse(existingService);
        assert.strictEqual(response.body.existing_service_id, 'uuid-existing');
    });

    it('should include existing_service_name in 409 response body', () => {
        const existingService = { id: 'uuid-existing', name: 'Already Registered' };
        const response = buildRegisterDuplicateResponse(existingService);
        assert.strictEqual(response.body.existing_service_name, 'Already Registered');
    });

    it('should return 201 when URL is new (no duplicate)', () => {
        const response = buildRegisterDuplicateResponse(null);
        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.body.success, true);
    });

    it('should return 409 for /quick-register with same duplicate logic', () => {
        const existingService = { id: 'uuid-quick', name: 'Quick Service' };
        const response = buildRegisterDuplicateResponse(existingService);
        assert.strictEqual(response.status, 409);
        assert.ok(response.body.existing_service_id);
    });
});

// ─── Suite 6: verifyBatchRegisterSignature message format ─────────────────────

describe('verifyBatchRegisterSignature — message format', () => {
    it('should construct message as batch-register:<ownerAddress>:<serviceCount>:<timestamp>', async () => {
        let capturedMessage = null;
        const ts = Date.now();
        const params = makeSignatureParams({
            ownerAddress: VALID_ADDRESS,
            serviceCount: 3,
            timestamp: ts,
            _recoverFn: async ({ message }) => {
                capturedMessage = message;
                return VALID_ADDRESS;
            },
        });
        await verifyBatchRegisterSignature(params);
        assert.strictEqual(capturedMessage, `batch-register:${VALID_ADDRESS}:3:${ts}`);
    });

    it('message should contain the service count', async () => {
        let msg = null;
        const params = makeSignatureParams({
            serviceCount: 7,
            _recoverFn: async ({ message }) => { msg = message; return VALID_ADDRESS; },
        });
        await verifyBatchRegisterSignature(params);
        assert.ok(msg.includes(':7:'), 'Message must include the service count');
    });

    it('message should contain the timestamp', async () => {
        let msg = null;
        const ts = Date.now();
        const params = makeSignatureParams({
            timestamp: ts,
            _recoverFn: async ({ message }) => { msg = message; return VALID_ADDRESS; },
        });
        await verifyBatchRegisterSignature(params);
        assert.ok(msg.includes(String(ts)), 'Message must include the timestamp');
    });
});
