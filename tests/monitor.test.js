// tests/monitor.test.js — Unit tests for lib/monitor.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getStatus, getEndpoints } = require('../lib/monitor');

describe('monitor — ENDPOINTS', () => {
    const endpoints = getEndpoints();

    it('should return exactly 41 endpoints', () => {
        assert.equal(endpoints.length, 41);
    });

    it('each endpoint should have path, method, and label', () => {
        for (const ep of endpoints) {
            assert.ok(ep.path, `endpoint missing path: ${JSON.stringify(ep)}`);
            assert.ok(ep.method, `endpoint missing method: ${JSON.stringify(ep)}`);
            assert.ok(ep.label, `endpoint missing label: ${JSON.stringify(ep)}`);
        }
    });

    it('all paths should start with /api/', () => {
        for (const ep of endpoints) {
            assert.ok(ep.path.startsWith('/api/'), `path should start with /api/: ${ep.path}`);
        }
    });

    it('method should be GET or POST', () => {
        for (const ep of endpoints) {
            assert.ok(
                ep.method === 'GET' || ep.method === 'POST',
                `method should be GET or POST: ${ep.method} for ${ep.path}`
            );
        }
    });

    it('all paths should be unique', () => {
        const paths = endpoints.map(ep => ep.path);
        const unique = new Set(paths);
        assert.equal(unique.size, paths.length, 'Duplicate paths found');
    });

    it('all labels should be unique', () => {
        const labels = endpoints.map(ep => ep.label);
        const unique = new Set(labels);
        assert.equal(unique.size, labels.length, 'Duplicate labels found');
    });

    it('should contain known critical endpoints', () => {
        const paths = endpoints.map(ep => ep.path);
        const criticalPaths = [
            '/api/weather', '/api/crypto', '/api/search', '/api/scrape',
            '/api/twitter', '/api/image', '/api/joke', '/api/translate',
            '/api/code', '/api/json-validate',
        ];
        for (const path of criticalPaths) {
            assert.ok(paths.includes(path), `missing critical endpoint: ${path}`);
        }
    });

    it('POST endpoints should be /api/code and /api/json-validate', () => {
        const postEndpoints = endpoints.filter(ep => ep.method === 'POST');
        assert.equal(postEndpoints.length, 2);
        const postPaths = postEndpoints.map(ep => ep.path).sort();
        assert.deepStrictEqual(postPaths, ['/api/code', '/api/json-validate']);
    });

    it('GET endpoints should be 39', () => {
        const getEndpointsArr = endpoints.filter(ep => ep.method === 'GET');
        assert.equal(getEndpointsArr.length, 39);
    });

    it('labels should be non-empty strings', () => {
        for (const ep of endpoints) {
            assert.equal(typeof ep.label, 'string');
            assert.ok(ep.label.length > 0, `label should not be empty for ${ep.path}`);
        }
    });
});

describe('monitor — getStatus()', () => {
    it('should return an object', () => {
        const status = getStatus();
        assert.equal(typeof status, 'object');
        assert.ok(status !== null);
    });

    it('should have expected fields', () => {
        const status = getStatus();
        assert.ok('lastCheck' in status);
        assert.ok('overall' in status);
        assert.ok('endpoints' in status);
    });

    it('initial overall should be "unknown"', () => {
        const status = getStatus();
        assert.equal(status.overall, 'unknown');
    });

    it('initial lastCheck should be null', () => {
        const status = getStatus();
        assert.equal(status.lastCheck, null);
    });

    it('initial endpoints should be an empty array', () => {
        const status = getStatus();
        assert.ok(Array.isArray(status.endpoints));
        assert.equal(status.endpoints.length, 0);
    });
});

describe('monitor — getEndpoints()', () => {
    it('should return an array', () => {
        const result = getEndpoints();
        assert.ok(Array.isArray(result));
    });

    it('should return the same reference each time', () => {
        const a = getEndpoints();
        const b = getEndpoints();
        assert.strictEqual(a, b);
    });
});

describe('monitor — updateCurrentStatus logic', () => {
    // Test the logic used in updateCurrentStatus (replicated here since it's not exported)
    function computeOverall(results) {
        const onlineCount = results.filter(r => r.status === 'online').length;
        const total = results.length;
        if (onlineCount === 0) return 'major_outage';
        if (onlineCount < total) return 'degraded';
        return 'operational';
    }

    it('all online → operational', () => {
        const results = [
            { status: 'online' }, { status: 'online' }, { status: 'online' }
        ];
        assert.equal(computeOverall(results), 'operational');
    });

    it('all offline → major_outage', () => {
        const results = [
            { status: 'offline' }, { status: 'offline' }, { status: 'offline' }
        ];
        assert.equal(computeOverall(results), 'major_outage');
    });

    it('mixed → degraded', () => {
        const results = [
            { status: 'online' }, { status: 'offline' }, { status: 'online' }
        ];
        assert.equal(computeOverall(results), 'degraded');
    });

    it('single online → operational', () => {
        assert.equal(computeOverall([{ status: 'online' }]), 'operational');
    });

    it('single offline → major_outage', () => {
        assert.equal(computeOverall([{ status: 'offline' }]), 'major_outage');
    });

    it('empty results → major_outage (0 online out of 0)', () => {
        assert.equal(computeOverall([]), 'major_outage');
    });
});

describe('monitor — online/offline classification logic', () => {
    // Replicate the isOnline logic from checkEndpoint
    function isOnline(httpStatus) {
        return httpStatus === 402 || httpStatus === 400 || httpStatus === 200 || httpStatus === 429;
    }

    it('402 (Payment Required) → online', () => {
        assert.ok(isOnline(402));
    });

    it('400 (Bad Request) → online', () => {
        assert.ok(isOnline(400));
    });

    it('200 (OK) → online', () => {
        assert.ok(isOnline(200));
    });

    it('429 (Too Many Requests) → online', () => {
        assert.ok(isOnline(429));
    });

    it('500 (Internal Server Error) → offline', () => {
        assert.ok(!isOnline(500));
    });

    it('503 (Service Unavailable) → offline', () => {
        assert.ok(!isOnline(503));
    });

    it('404 (Not Found) → offline', () => {
        assert.ok(!isOnline(404));
    });

    it('0 (no response / timeout) → offline', () => {
        assert.ok(!isOnline(0));
    });

    it('301 (Redirect) → offline', () => {
        assert.ok(!isOnline(301));
    });

    it('201 (Created) → offline', () => {
        assert.ok(!isOnline(201));
    });
});
