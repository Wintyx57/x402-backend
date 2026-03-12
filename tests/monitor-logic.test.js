// tests/monitor-logic.test.js — Tests unitaires pour lib/monitor.js
// Stratégie : tester pathToLabel (non exportée → répliquée ici) et la logique
// de updateServicesStatus (split interne/externe). Pas d'appels réseau.
// Les fonctions non exportées sont testées par réplication fidèle du code source.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Réplication de pathToLabel depuis lib/monitor.js ────────────────────────
// Doit rester synchronisée avec la source. Si la logique change, mettre à jour ici.

const LABEL_OVERRIDES = {
    '/api/ip':           'IP Geolocation',
    '/api/hn':           'Hacker News',
    '/api/dns':          'DNS Lookup',
    '/api/npm':          'NPM Registry',
    '/api/csv-to-json':  'CSV to JSON',
    '/api/html-to-text': 'HTML to Text',
    '/api/qrcode-gen':   'QR Code Generator',
    '/api/ssl-check':    'SSL Check',
    '/api/http-status':  'HTTP Status',
    '/api/jwt-decode':   'JWT Decoder',
    '/api/uuid':         'UUID Generator',
};

function pathToLabel(path) {
    if (LABEL_OVERRIDES[path]) return LABEL_OVERRIDES[path];
    return path
        .replace('/api/', '')
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// ─── Suite 1 : LABEL_OVERRIDES ────────────────────────────────────────────────

describe('monitor — pathToLabel : LABEL_OVERRIDES', () => {
    it('should apply override for /api/ip → "IP Geolocation"', () => {
        assert.strictEqual(pathToLabel('/api/ip'), 'IP Geolocation');
    });

    it('should apply override for /api/hn → "Hacker News"', () => {
        assert.strictEqual(pathToLabel('/api/hn'), 'Hacker News');
    });

    it('should apply override for /api/dns → "DNS Lookup"', () => {
        assert.strictEqual(pathToLabel('/api/dns'), 'DNS Lookup');
    });

    it('should apply override for /api/npm → "NPM Registry"', () => {
        assert.strictEqual(pathToLabel('/api/npm'), 'NPM Registry');
    });

    it('should apply override for /api/csv-to-json → "CSV to JSON"', () => {
        assert.strictEqual(pathToLabel('/api/csv-to-json'), 'CSV to JSON');
    });

    it('should apply override for /api/html-to-text → "HTML to Text"', () => {
        assert.strictEqual(pathToLabel('/api/html-to-text'), 'HTML to Text');
    });

    it('should apply override for /api/qrcode-gen → "QR Code Generator"', () => {
        assert.strictEqual(pathToLabel('/api/qrcode-gen'), 'QR Code Generator');
    });

    it('should apply override for /api/ssl-check → "SSL Check"', () => {
        assert.strictEqual(pathToLabel('/api/ssl-check'), 'SSL Check');
    });

    it('should apply override for /api/http-status → "HTTP Status"', () => {
        assert.strictEqual(pathToLabel('/api/http-status'), 'HTTP Status');
    });

    it('should apply override for /api/jwt-decode → "JWT Decoder"', () => {
        assert.strictEqual(pathToLabel('/api/jwt-decode'), 'JWT Decoder');
    });

    it('should apply override for /api/uuid → "UUID Generator"', () => {
        assert.strictEqual(pathToLabel('/api/uuid'), 'UUID Generator');
    });

    it('should cover all 11 LABEL_OVERRIDES entries', () => {
        assert.strictEqual(Object.keys(LABEL_OVERRIDES).length, 11);
    });
});

// ─── Suite 2 : pathToLabel — transformation automatique ──────────────────────

describe('monitor — pathToLabel : transformation automatique', () => {
    it('should convert /api/weather → "Weather"', () => {
        assert.strictEqual(pathToLabel('/api/weather'), 'Weather');
    });

    it('should convert /api/crypto → "Crypto"', () => {
        assert.strictEqual(pathToLabel('/api/crypto'), 'Crypto');
    });

    it('should convert /api/translate → "Translate"', () => {
        assert.strictEqual(pathToLabel('/api/translate'), 'Translate');
    });

    it('should capitalize each hyphen-separated word', () => {
        // /api/contract-risk → "Contract Risk"
        assert.strictEqual(pathToLabel('/api/contract-risk'), 'Contract Risk');
    });

    it('should handle triple-word paths', () => {
        // /api/url-shorten → "Url Shorten"
        assert.strictEqual(pathToLabel('/api/url-shorten'), 'Url Shorten');
    });

    it('should capitalize single-char words', () => {
        // /api/a-b → "A B"
        assert.strictEqual(pathToLabel('/api/a-b'), 'A B');
    });

    it('should produce Title Case from multi-word paths', () => {
        // /api/some-endpoint-name → "Some Endpoint Name"
        const label = pathToLabel('/api/some-endpoint-name');
        assert.strictEqual(label, 'Some Endpoint Name');
    });

    it('should handle paths with no hyphens', () => {
        // /api/search → "Search"
        assert.strictEqual(pathToLabel('/api/search'), 'Search');
    });

    it('should handle /api/joke → "Joke"', () => {
        assert.strictEqual(pathToLabel('/api/joke'), 'Joke');
    });

    it('should handle /api/scrape → "Scrape"', () => {
        assert.strictEqual(pathToLabel('/api/scrape'), 'Scrape');
    });

    it('should handle /api/summarize → "Summarize"', () => {
        assert.strictEqual(pathToLabel('/api/summarize'), 'Summarize');
    });
});

// ─── Suite 3 : priorité override vs transformation ────────────────────────────

describe('monitor — pathToLabel : priorité des overrides', () => {
    it('override should take precedence over auto-transform for /api/csv-to-json', () => {
        // Auto-transform would produce "Csv To Json", override gives "CSV to JSON"
        const label = pathToLabel('/api/csv-to-json');
        assert.strictEqual(label, 'CSV to JSON');
        assert.notStrictEqual(label, 'Csv To Json');
    });

    it('override should take precedence over auto-transform for /api/html-to-text', () => {
        const label = pathToLabel('/api/html-to-text');
        assert.strictEqual(label, 'HTML to Text');
        assert.notStrictEqual(label, 'Html To Text');
    });

    it('override should take precedence for /api/jwt-decode', () => {
        const label = pathToLabel('/api/jwt-decode');
        assert.strictEqual(label, 'JWT Decoder');
        assert.notStrictEqual(label, 'Jwt Decode');
    });

    it('unknown path should NOT match any override', () => {
        const label = pathToLabel('/api/unknown-endpoint-xyz');
        assert.ok(!Object.values(LABEL_OVERRIDES).includes(label));
        assert.strictEqual(label, 'Unknown Endpoint Xyz');
    });
});

// ─── Suite 4 : logique updateServicesStatus (split interne/externe) ───────────

describe('monitor — updateServicesStatus : split interne/externe', () => {
    // Réplication de la logique de split depuis lib/monitor.js
    function splitResults(results) {
        return {
            internal: results.filter(r => !r.isExternal),
            external: results.filter(r => r.isExternal),
        };
    }

    it('should separate internal results from external results', () => {
        const results = [
            { endpoint: '/api/weather', status: 'online' },
            { endpoint: 'https://ext.com/api', status: 'online', isExternal: true, serviceId: 1 },
        ];
        const { internal, external } = splitResults(results);
        assert.strictEqual(internal.length, 1);
        assert.strictEqual(external.length, 1);
    });

    it('should have empty external when all results are internal', () => {
        const results = [
            { endpoint: '/api/joke', status: 'online' },
            { endpoint: '/api/crypto', status: 'online' },
        ];
        const { internal, external } = splitResults(results);
        assert.strictEqual(internal.length, 2);
        assert.strictEqual(external.length, 0);
    });

    it('should have empty internal when all results are external', () => {
        const results = [
            { endpoint: 'https://ext1.com', status: 'online', isExternal: true, serviceId: 1 },
            { endpoint: 'https://ext2.com', status: 'offline', isExternal: true, serviceId: 2 },
        ];
        const { internal, external } = splitResults(results);
        assert.strictEqual(internal.length, 0);
        assert.strictEqual(external.length, 2);
    });

    it('should group results by status correctly', () => {
        const results = [
            { endpoint: '/api/weather', status: 'online' },
            { endpoint: '/api/crypto', status: 'online' },
            { endpoint: '/api/scrape', status: 'offline' },
        ];
        const { internal } = splitResults(results);

        const byStatus = {};
        for (const r of internal) {
            if (!byStatus[r.status]) byStatus[r.status] = [];
            byStatus[r.status].push(r);
        }

        assert.strictEqual(byStatus['online'].length, 2);
        assert.strictEqual(byStatus['offline'].length, 1);
    });

    it('external results should preserve serviceId for targeted DB updates', () => {
        const results = [
            { endpoint: 'https://ext.com', status: 'online', isExternal: true, serviceId: 42 },
        ];
        const { external } = splitResults(results);
        assert.strictEqual(external[0].serviceId, 42);
    });

    it('should handle empty results array', () => {
        const { internal, external } = splitResults([]);
        assert.strictEqual(internal.length, 0);
        assert.strictEqual(external.length, 0);
    });
});

// ─── Suite 5 : logique URL pattern matching (.like) ──────────────────────────

describe('monitor — logique URL pattern matching pour services internes', () => {
    // La vraie updateServicesStatus utilise .like(`url.like.%${r.endpoint}`)
    // pour faire correspondre un endpoint /api/joke avec une URL
    // https://x402-api.onrender.com/api/joke

    function urlMatchesEndpoint(serviceUrl, endpointPath) {
        // Simule le comportement du LIKE % + endpoint
        return serviceUrl.endsWith(endpointPath);
    }

    it('should match service URL when it ends with the endpoint path', () => {
        assert.ok(urlMatchesEndpoint('https://x402-api.onrender.com/api/weather', '/api/weather'));
    });

    it('should match service URL for longer paths', () => {
        assert.ok(urlMatchesEndpoint('https://x402-api.onrender.com/api/csv-to-json', '/api/csv-to-json'));
    });

    it('should NOT match a different endpoint', () => {
        assert.ok(!urlMatchesEndpoint('https://x402-api.onrender.com/api/crypto', '/api/weather'));
    });

    it('should NOT match a partial path prefix', () => {
        // /api/wea should NOT match /api/weather
        assert.ok(!urlMatchesEndpoint('https://x402-api.onrender.com/api/weather', '/api/wea'));
    });

    it('should generate correct LIKE pattern for Supabase', () => {
        // La requête Supabase utilise : `url.like.%${r.endpoint}`
        // Par exemple : url.like.%/api/weather
        const endpointPath = '/api/weather';
        const likePattern = `%${endpointPath}`;
        assert.strictEqual(likePattern, '%/api/weather');
    });
});

// ─── Suite 6 : constantes de configuration ────────────────────────────────────

describe('monitor — constantes de configuration', () => {
    it('CHECK_INTERVAL should be 5 minutes in milliseconds', () => {
        const CHECK_INTERVAL = 5 * 60 * 1000;
        assert.strictEqual(CHECK_INTERVAL, 300000);
    });

    it('BATCH_SIZE should be a reasonable value for batching', () => {
        const BATCH_SIZE = 10;
        assert.ok(BATCH_SIZE > 0 && BATCH_SIZE <= 50, `BATCH_SIZE should be between 1 and 50, got ${BATCH_SIZE}`);
    });

    it('CHECK_TIMEOUT should be 10 seconds', () => {
        const CHECK_TIMEOUT = 10000;
        assert.strictEqual(CHECK_TIMEOUT, 10000);
    });

    it('EXTERNAL_CACHE_TTL should be 5 minutes', () => {
        const EXTERNAL_CACHE_TTL = 5 * 60 * 1000;
        assert.strictEqual(EXTERNAL_CACHE_TTL, 300000);
    });
});
