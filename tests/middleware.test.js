// tests/middleware.test.js — Unit tests for server.js middleware (adminAuth, CORS, rate limit skip)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Replicate adminAuth logic from server.js for unit testing
function adminAuth(adminToken) {
    return function (req, res, next) {
        const expected = (adminToken || '').trim();
        if (!expected) {
            return next();
        }
        const token = (req.headers['x-admin-token'] || '').trim();
        if (!token || token !== expected) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Valid X-Admin-Token header required.' });
        }
        next();
    };
}

// Mock Express req/res/next
function mockReq(headers = {}) {
    return { headers };
}

function mockRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
    };
    return res;
}

describe('adminAuth middleware', () => {
    it('should pass through when ADMIN_TOKEN is not set (empty)', () => {
        const middleware = adminAuth('');
        const req = mockReq({});
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called');
        assert.equal(res.statusCode, null, 'should not set status code');
    });

    it('should pass through when ADMIN_TOKEN is undefined', () => {
        const middleware = adminAuth(undefined);
        const req = mockReq({});
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called');
    });

    it('should pass through with correct token', () => {
        const middleware = adminAuth('my-secret-token');
        const req = mockReq({ 'x-admin-token': 'my-secret-token' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called with valid token');
        assert.equal(res.statusCode, null, 'should not set status code');
    });

    it('should return 401 with invalid token', () => {
        const middleware = adminAuth('my-secret-token');
        const req = mockReq({ 'x-admin-token': 'wrong-token' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled, 'next() should NOT be called');
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, 'Unauthorized');
    });

    it('should return 401 when no token header is provided', () => {
        const middleware = adminAuth('my-secret-token');
        const req = mockReq({});
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled, 'next() should NOT be called');
        assert.equal(res.statusCode, 401);
    });

    it('should trim whitespace from expected token', () => {
        const middleware = adminAuth('  my-token  ');
        const req = mockReq({ 'x-admin-token': 'my-token' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called after trim');
    });

    it('should trim whitespace from provided token', () => {
        const middleware = adminAuth('my-token');
        const req = mockReq({ 'x-admin-token': '  my-token  ' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called after trim');
    });

    it('should reject empty string token when ADMIN_TOKEN is set', () => {
        const middleware = adminAuth('my-secret');
        const req = mockReq({ 'x-admin-token': '' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled, 'next() should NOT be called with empty token');
        assert.equal(res.statusCode, 401);
    });

    it('should be case-sensitive', () => {
        const middleware = adminAuth('MyToken');
        const req = mockReq({ 'x-admin-token': 'mytoken' });
        const res = mockRes();
        let nextCalled = false;

        middleware(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled, 'next() should NOT be called — tokens are case-sensitive');
        assert.equal(res.statusCode, 401);
    });
});

describe('rate limit skip logic', () => {
    // Replicate the skip functions from server.js
    const generalSkip = (req) => req.path === '/health' || req.headers['x-monitor'] === 'internal' || req.path.startsWith('/api/status');
    const paidSkip = (req) => req.headers['x-monitor'] === 'internal';

    it('general: should skip /health', () => {
        assert.ok(generalSkip({ path: '/health', headers: {} }));
    });

    it('general: should skip X-Monitor: internal', () => {
        assert.ok(generalSkip({ path: '/api/search', headers: { 'x-monitor': 'internal' } }));
    });

    it('general: should skip /api/status', () => {
        assert.ok(generalSkip({ path: '/api/status', headers: {} }));
    });

    it('general: should skip /api/status/uptime', () => {
        assert.ok(generalSkip({ path: '/api/status/uptime', headers: {} }));
    });

    it('general: should skip /api/status/history', () => {
        assert.ok(generalSkip({ path: '/api/status/history', headers: {} }));
    });

    it('general: should NOT skip /api/search', () => {
        assert.ok(!generalSkip({ path: '/api/search', headers: {} }));
    });

    it('general: should NOT skip /services', () => {
        assert.ok(!generalSkip({ path: '/services', headers: {} }));
    });

    it('general: should NOT skip /register', () => {
        assert.ok(!generalSkip({ path: '/register', headers: {} }));
    });

    it('paid: should skip X-Monitor: internal', () => {
        assert.ok(paidSkip({ headers: { 'x-monitor': 'internal' } }));
    });

    it('paid: should NOT skip normal requests', () => {
        assert.ok(!paidSkip({ headers: {} }));
    });

    it('paid: should NOT skip X-Monitor with wrong value', () => {
        assert.ok(!paidSkip({ headers: { 'x-monitor': 'external' } }));
    });
});

describe('CORS origin logic', () => {
    const PROD_ORIGINS = [
        'https://x402bazaar.org',
        'https://www.x402bazaar.org',
        'https://x402-frontend-one.vercel.app',
    ];
    const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

    const prodAllowed = PROD_ORIGINS;
    const devAllowed = [...PROD_ORIGINS, ...DEV_ORIGINS];

    it('production: should allow x402bazaar.org', () => {
        assert.ok(prodAllowed.includes('https://x402bazaar.org'));
    });

    it('production: should allow www.x402bazaar.org', () => {
        assert.ok(prodAllowed.includes('https://www.x402bazaar.org'));
    });

    it('production: should allow Vercel URL', () => {
        assert.ok(prodAllowed.includes('https://x402-frontend-one.vercel.app'));
    });

    it('production: should NOT allow localhost', () => {
        assert.ok(!prodAllowed.includes('http://localhost:5173'));
        assert.ok(!prodAllowed.includes('http://localhost:3000'));
    });

    it('development: should allow localhost:5173', () => {
        assert.ok(devAllowed.includes('http://localhost:5173'));
    });

    it('development: should allow localhost:3000', () => {
        assert.ok(devAllowed.includes('http://localhost:3000'));
    });

    it('development: should also allow production origins', () => {
        assert.ok(devAllowed.includes('https://x402bazaar.org'));
        assert.ok(devAllowed.includes('https://x402-frontend-one.vercel.app'));
    });

    it('should NOT allow arbitrary origins', () => {
        assert.ok(!prodAllowed.includes('https://evil.com'));
        assert.ok(!devAllowed.includes('https://evil.com'));
    });
});
