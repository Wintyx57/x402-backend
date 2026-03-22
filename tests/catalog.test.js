// tests/catalog.test.js — Unit tests for GET /api/catalog (routes/catalog.js)
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock Supabase ──────────────────────────────────────────────────────────

const MOCK_SERVICES = [
    {
        id: 'aaaa-1111-bbbb-2222',
        name: 'Web Search API',
        description: 'Search the web',
        price_usdc: 0.001,
        tags: ['search', 'web'],
        status: 'online',
        trust_score: 95,
        required_parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        logo_url: null,
    },
    {
        id: 'cccc-3333-dddd-4444',
        name: 'Weather API',
        description: 'Get weather data',
        price_usdc: 0.001,
        tags: ['weather'],
        status: 'online',
        trust_score: 88,
        required_parameters: null,
        logo_url: 'https://example.com/weather.png',
    },
    {
        id: 'eeee-5555-ffff-6666',
        name: 'Private API',
        description: 'Pending validation',
        price_usdc: 0.05,
        tags: ['test'],
        status: 'pending_validation',
        trust_score: null,
        required_parameters: null,
        logo_url: null,
    },
];

function createMockSupabase(overrides = {}) {
    const chain = {
        select: () => chain,
        neq: () => chain,
        or: () => chain,
        contains: () => chain,
        eq: () => chain,
        order: () => chain,
        range: () => chain,
    };

    // Default: return first 2 services (not pending_validation)
    const activeServices = MOCK_SERVICES.filter(s => s.status !== 'pending_validation');
    chain.range = () => Promise.resolve({
        data: overrides.data !== undefined ? overrides.data : activeServices,
        count: overrides.count !== undefined ? overrides.count : activeServices.length,
        error: overrides.error || null,
    });

    return {
        from: () => chain,
        _chain: chain,
    };
}

// ─── Mock Express ────────────────────────────────────────────────────────────

function mockReq(query = {}) {
    return { query, path: '/api/catalog', ip: '127.0.0.1' };
}

function mockRes() {
    const res = {
        _status: null,
        _body: null,
        _headers: {},
        status(code) { res._status = code; return res; },
        json(data) { res._body = data; return res; },
        setHeader(key, val) { res._headers[key] = val; },
        sendStatus(code) { res._status = code; },
    };
    return res;
}

const noopLimiter = (req, res, next) => next();

// ─── Import router and extract handler ──────────────────────────────────────

const createCatalogRouter = require('../routes/catalog');

function getCatalogHandler(supabase) {
    const router = createCatalogRouter(supabase, noopLimiter);
    // Extract the GET /api/catalog handler from the router stack
    const layer = router.stack.find(l => l.route && l.route.path === '/api/catalog' && l.route.methods.get);
    if (!layer) throw new Error('GET /api/catalog route not found');
    // Last handler in the stack (after rate limiter middleware)
    const handlers = layer.route.stack.filter(s => s.method === 'get');
    return handlers[handlers.length - 1].handle;
}

// ─── Suite 1: Response shape ────────────────────────────────────────────────

describe('GET /api/catalog — response shape', () => {
    it('returns success with data array and meta block', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.ok(res._body.success);
        assert.ok(Array.isArray(res._body.data));
        assert.ok(res._body.pagination);
        assert.ok(res._body.meta);
        assert.equal(res._body.meta.marketplace, 'x402 Bazaar');
        assert.equal(res._body.meta.payment_protocol, 'x402 (HTTP 402 + USDC)');
        assert.deepEqual(res._body.meta.supported_chains, ['base', 'skale', 'polygon']);
    });

    it('each item has call_endpoint pre-built', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        for (const item of res._body.data) {
            assert.ok(item.call_endpoint);
            assert.ok(item.call_endpoint.includes('/api/call/'));
            assert.ok(item.call_endpoint.includes(item.id));
        }
    });

    it('includes has_credentials field as false', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        for (const item of res._body.data) {
            assert.equal(item.has_credentials, false);
        }
    });
});

// ─── Suite 2: No sensitive data ─────────────────────────────────────────────

describe('GET /api/catalog — no sensitive fields', () => {
    it('does not expose owner_address, url, encrypted_credentials', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        for (const item of res._body.data) {
            assert.equal(item.owner_address, undefined);
            assert.equal(item.url, undefined);
            assert.equal(item.encrypted_credentials, undefined);
            assert.equal(item.credential_type, undefined);
        }
    });
});

// ─── Suite 3: CORS headers ──────────────────────────────────────────────────

describe('GET /api/catalog — CORS', () => {
    it('does not set manual Access-Control-Allow-Origin (handled by global CORS middleware)', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._headers['Access-Control-Allow-Origin'], undefined);
    });
});

// ─── Suite 4: Cache headers ─────────────────────────────────────────────────

describe('GET /api/catalog — caching', () => {
    it('sets Cache-Control with max-age=300', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.ok(res._headers['Cache-Control'].includes('max-age=300'));
        assert.ok(res._headers['Cache-Control'].includes('stale-while-revalidate=600'));
    });
});

// ─── Suite 5: Pagination ────────────────────────────────────────────────────

describe('GET /api/catalog — pagination', () => {
    it('defaults to page=1, limit=100', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._body.pagination.page, 1);
        assert.equal(res._body.pagination.limit, 100);
    });

    it('respects custom page and limit params', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq({ page: '2', limit: '10' });
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._body.pagination.page, 2);
        assert.equal(res._body.pagination.limit, 10);
    });

    it('clamps limit to max 200', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq({ limit: '999' });
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._body.pagination.limit, 200);
    });
});

// ─── Suite 6: Error handling ────────────────────────────────────────────────

describe('GET /api/catalog — error handling', () => {
    it('returns 500 on Supabase error', async () => {
        const supabase = createMockSupabase({ error: { message: 'DB down' }, data: null, count: 0 });
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._status, 500);
        assert.equal(res._body.error, 'Failed to fetch catalog');
    });
});

// ─── Suite 7: Field completeness ────────────────────────────────────────────

describe('GET /api/catalog — field completeness', () => {
    it('every item has all expected fields', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        const expectedFields = ['id', 'name', 'description', 'price_usdc', 'tags', 'status', 'trust_score', 'required_parameters', 'has_credentials', 'logo_url', 'call_endpoint'];
        for (const item of res._body.data) {
            for (const field of expectedFields) {
                assert.ok(field in item, `Missing field: ${field}`);
            }
        }
    });

    it('count matches data array length', async () => {
        const supabase = createMockSupabase();
        const handler = getCatalogHandler(supabase);
        const req = mockReq();
        const res = mockRes();
        await handler(req, res);

        assert.equal(res._body.count, res._body.data.length);
    });
});
