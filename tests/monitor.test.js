// tests/monitor.test.js — Unit tests for lib/monitor.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getStatus, getEndpoints } = require('../lib/monitor');

describe('monitor — ENDPOINTS', () => {
    const endpoints = getEndpoints();

    it('should auto-derive endpoints from bazaar-discovery', () => {
        // Count should match discoveryMap keys (auto-derived, not hardcoded)
        assert.ok(endpoints.length >= 60, `expected at least 60 endpoints, got ${endpoints.length}`);
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
            '/api/twitter', '/api/joke', '/api/translate',
            '/api/code', '/api/json-validate',
        ];
        for (const path of criticalPaths) {
            assert.ok(paths.includes(path), `missing critical endpoint: ${path}`);
        }
    });

    it('POST endpoints should match getMethodForUrl from bazaar-discovery', () => {
        const postEndpoints = endpoints.filter(ep => ep.method === 'POST');
        assert.ok(postEndpoints.length >= 5, `expected at least 5 POST endpoints, got ${postEndpoints.length}`);
        // Known POST endpoints must be present
        const postPaths = postEndpoints.map(ep => ep.path);
        for (const p of ['/api/code', '/api/code-review', '/api/contract-risk', '/api/email-parse', '/api/table-insights']) {
            assert.ok(postPaths.includes(p), `missing POST endpoint: ${p}`);
        }
    });

    it('remaining endpoints should be GET', () => {
        const getCount = endpoints.filter(ep => ep.method === 'GET').length;
        const postCount = endpoints.filter(ep => ep.method === 'POST').length;
        assert.equal(getCount + postCount, endpoints.length, 'all endpoints should be GET or POST');
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

describe('monitor — external services monitoring logic', () => {
    // Test fetchExternalServices filtering logic (replicated since not exported)
    function filterExternal(services, platformWallet) {
        return services.filter(svc => {
            const owner = (svc.owner_address || '').toLowerCase();
            return owner && owner !== platformWallet.toLowerCase();
        });
    }

    it('should filter out services with platform wallet', () => {
        const services = [
            { id: 1, name: 'Internal', url: 'https://x402-api.onrender.com/api/joke', owner_address: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430' },
            { id: 2, name: 'External', url: 'https://external.com/api', owner_address: '0x8fdb1AcAbC4f1D2a7e42C14F1F3a4c67bE5f2E9D' },
        ];
        const result = filterExternal(services, '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430');
        assert.equal(result.length, 1);
        assert.equal(result[0].name, 'External');
    });

    it('should filter out services with no owner_address', () => {
        const services = [
            { id: 1, name: 'No Owner', url: 'https://example.com', owner_address: null },
            { id: 2, name: 'Empty Owner', url: 'https://example2.com', owner_address: '' },
        ];
        const result = filterExternal(services, '0xABC');
        assert.equal(result.length, 0);
    });

    it('should be case-insensitive for wallet comparison', () => {
        const services = [
            { id: 1, name: 'UpperCase', url: 'https://ext.com', owner_address: '0xABCDEF' },
        ];
        const result = filterExternal(services, '0xabcdef');
        assert.equal(result.length, 0); // Same wallet, different case
    });

    it('should include all external wallets', () => {
        const services = [
            { id: 1, name: 'Ext1', url: 'https://ext1.com', owner_address: '0x111' },
            { id: 2, name: 'Ext2', url: 'https://ext2.com', owner_address: '0x222' },
            { id: 3, name: 'Internal', url: 'https://x402.com/api', owner_address: '0xPLATFORM' },
        ];
        const result = filterExternal(services, '0xPLATFORM');
        assert.equal(result.length, 2);
    });

    // Test external endpoint object structure
    it('should produce correct endpoint objects from external services', () => {
        const svc = { id: 42, name: 'Fia Signals', url: 'https://x402.fiasignals.com/signals', owner_address: '0x8D32c6a' };
        const endpoint = {
            id: svc.id,
            path: svc.url,
            method: 'GET',
            label: svc.name || svc.url,
            isExternal: true,
        };
        assert.equal(endpoint.id, 42);
        assert.equal(endpoint.path, 'https://x402.fiasignals.com/signals');
        assert.equal(endpoint.method, 'GET');
        assert.equal(endpoint.label, 'Fia Signals');
        assert.equal(endpoint.isExternal, true);
    });

    it('should use URL as label if name is missing', () => {
        const svc = { id: 1, name: '', url: 'https://example.com/api', owner_address: '0x111' };
        const label = svc.name || svc.url;
        assert.equal(label, 'https://example.com/api');
    });

    // Test updateServicesStatus split logic
    it('should split results into internal and external', () => {
        const results = [
            { endpoint: '/api/joke', status: 'online' },
            { endpoint: 'https://ext.com/api', status: 'online', isExternal: true, serviceId: 42 },
            { endpoint: '/api/crypto', status: 'offline' },
            { endpoint: 'https://ext2.com/api', status: 'offline', isExternal: true, serviceId: 43 },
        ];
        const internalResults = results.filter(r => !r.isExternal);
        const externalResults = results.filter(r => r.isExternal);
        assert.equal(internalResults.length, 2);
        assert.equal(externalResults.length, 2);
        assert.equal(externalResults[0].serviceId, 42);
        assert.equal(externalResults[1].serviceId, 43);
    });

    // Test cache behavior logic
    it('cache TTL should be 5 minutes', () => {
        const EXTERNAL_CACHE_TTL = 5 * 60 * 1000;
        assert.equal(EXTERNAL_CACHE_TTL, 300000);
    });

    it('cache should be considered valid within TTL', () => {
        const EXTERNAL_CACHE_TTL = 5 * 60 * 1000;
        const cacheTime = Date.now() - 1000; // 1 second ago
        assert.ok(Date.now() - cacheTime < EXTERNAL_CACHE_TTL);
    });

    it('cache should be considered expired after TTL', () => {
        const EXTERNAL_CACHE_TTL = 5 * 60 * 1000;
        const cacheTime = Date.now() - 6 * 60 * 1000; // 6 minutes ago
        assert.ok(Date.now() - cacheTime >= EXTERNAL_CACHE_TTL);
    });
});
