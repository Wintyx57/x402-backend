// tests/credentialValidator.test.js — Unit + integration tests for credential validation at registration
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ─── Test HTTP Server ────────────────────────────────────────────────────────
// Spins up a real HTTP server to test credential validation against

let testServer;
let testPort;

function startServer(handler) {
    return new Promise((resolve) => {
        testServer = http.createServer(handler);
        testServer.listen(0, '127.0.0.1', () => {
            testPort = testServer.address().port;
            resolve();
        });
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (testServer) {
            testServer.close(resolve);
            testServer = null;
        } else {
            resolve();
        }
    });
}

// ─── Module under test ──────────────────────────────────────────────────────

// We need to require after setting up env to avoid SSRF blocking localhost.
// The validator uses safeUrl which blocks 127.0.0.1 — we'll mock safeUrl for unit tests.

// ─── Unit Tests: validateCredentials ────────────────────────────────────────

describe('validateCredentials', () => {

    // For unit tests, we test the core logic by creating a mock HTTP server
    // and bypassing SSRF checks (since we test on localhost).

    it('no credentials provided → skip, { valid: true }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials('https://api.example.com', null);
        assert.deepEqual(result, { valid: true });
    });

    it('no credentials (undefined) → skip, { valid: true }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials('https://api.example.com', undefined);
        assert.deepEqual(result, { valid: true });
    });

    it('empty credentials object → skip, { valid: true }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials('https://api.example.com', {});
        assert.deepEqual(result, { valid: true });
    });
});

describe('validateCredentials with mock upstream', () => {

    afterEach(async () => {
        await stopServer();
    });

    it('upstream 200 with bearer → { valid: true }', async () => {
        await startServer((req, res) => {
            if (req.headers['authorization'] === 'Bearer valid-token') {
                res.writeHead(200);
                res.end('OK');
            } else {
                res.writeHead(401);
                res.end('Unauthorized');
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'valid-token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.equal(result.warning, undefined);
        assert.equal(result.error, undefined);
    });

    it('upstream 200 with api-key header → { valid: true }', async () => {
        await startServer((req, res) => {
            if (req.headers['x-api-key'] === 'my-secret-key') {
                res.writeHead(200);
                res.end('OK');
            } else {
                res.writeHead(401);
                res.end('Unauthorized');
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'header', credentials: [{ key: 'X-API-Key', value: 'my-secret-key' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
    });

    it('upstream 200 with basic auth → { valid: true }', async () => {
        await startServer((req, res) => {
            const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
            if (req.headers['authorization'] === expected) {
                res.writeHead(200);
                res.end('OK');
            } else {
                res.writeHead(401);
                res.end('Unauthorized');
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'basic', credentials: [{ key: 'credentials', value: 'user:pass' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
    });

    it('upstream 200 with query param → { valid: true }', async () => {
        await startServer((req, res) => {
            const url = new URL(req.url, `http://127.0.0.1:${testPort}`);
            if (url.searchParams.get('api_key') === 'qsecret') {
                res.writeHead(200);
                res.end('OK');
            } else {
                res.writeHead(401);
                res.end('Unauthorized');
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'query', credentials: [{ key: 'api_key', value: 'qsecret' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
    });

    it('upstream 401 → { valid: false, error with 401 }', async () => {
        await startServer((req, res) => {
            res.writeHead(401);
            res.end('Unauthorized');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'bad-token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('401'));
    });

    it('upstream 403 → { valid: false, error with 403 }', async () => {
        await startServer((req, res) => {
            res.writeHead(403);
            res.end('Forbidden');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'bad-token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('403'));
    });

    it('upstream 500 → { valid: true, warning }', async () => {
        await startServer((req, res) => {
            res.writeHead(500);
            res.end('Internal Server Error');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.ok(result.warning);
        assert.ok(result.warning.includes('500'));
    });

    it('upstream 404 → { valid: true, warning about URL }', async () => {
        await startServer((req, res) => {
            res.writeHead(404);
            res.end('Not Found');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/nonexistent`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.ok(result.warning);
        assert.ok(result.warning.includes('404'));
    });

    it('HEAD 405 → falls back to GET', async () => {
        let methods = [];
        await startServer((req, res) => {
            methods.push(req.method);
            if (req.method === 'HEAD') {
                res.writeHead(405);
                res.end();
            } else {
                // GET should succeed with valid credentials
                if (req.headers['authorization'] === 'Bearer good-token') {
                    res.writeHead(200);
                    res.end('OK');
                } else {
                    res.writeHead(401);
                    res.end('Unauthorized');
                }
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'good-token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.ok(methods.includes('HEAD'), 'should have tried HEAD first');
        assert.ok(methods.includes('GET'), 'should have fallen back to GET');
    });

    it('HEAD 405 → GET 401 → { valid: false }', async () => {
        await startServer((req, res) => {
            if (req.method === 'HEAD') {
                res.writeHead(405);
                res.end();
            } else {
                res.writeHead(401);
                res.end('Unauthorized');
            }
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'bad-token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('401'));
    });

    it('upstream timeout → { valid: true, warning }', async () => {
        await startServer((req, res) => {
            // Never respond — simulate timeout
            // The validator has a short timeout, so this will trigger
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] },
            { skipSsrf: true, timeoutMs: 500 } // short timeout for tests
        );
        assert.equal(result.valid, true);
        assert.ok(result.warning);
        assert.ok(result.warning.toLowerCase().includes('unreachable') || result.warning.toLowerCase().includes('timeout'));
    });

    it('DNS failure (invalid hostname) → { valid: true, warning }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            'http://this-domain-does-not-exist-at-all-xyz123.invalid/api',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.ok(result.warning);
    });

    it('connection refused → { valid: true, warning }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        // Port 1 is almost certainly not listening
        const result = await validateCredentials(
            'http://127.0.0.1:1/api/test',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] },
            { skipSsrf: true }
        );
        assert.equal(result.valid, true);
        assert.ok(result.warning);
    });
});

// ─── SSRF Protection Tests ──────────────────────────────────────────────────

describe('validateCredentials SSRF protection', () => {

    it('localhost URL → { valid: false, error SSRF }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            'http://localhost:8080/api/test',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
            // NO skipSsrf — SSRF check active
        );
        assert.equal(result.valid, false);
        assert.ok(result.error.toLowerCase().includes('blocked') || result.error.toLowerCase().includes('security') || result.error.toLowerCase().includes('ssrf') || result.error.toLowerCase().includes('internal'));
    });

    it('169.254.x.x (metadata) URL → { valid: false, error }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            'http://169.254.169.254/latest/meta-data/',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
        );
        assert.equal(result.valid, false);
        assert.ok(result.error);
    });

    it('10.x.x.x private IP → { valid: false, error }', async () => {
        const { validateCredentials } = require('../lib/credentialValidator');
        const result = await validateCredentials(
            'http://10.0.0.1/api/test',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
        );
        assert.equal(result.valid, false);
        assert.ok(result.error);
    });
});

// ─── Credential Injection Accuracy ──────────────────────────────────────────

describe('validateCredentials injects credentials correctly', () => {

    afterEach(async () => {
        await stopServer();
    });

    it('bearer: Authorization header has "Bearer <value>"', async () => {
        let receivedAuth;
        await startServer((req, res) => {
            receivedAuth = req.headers['authorization'];
            res.writeHead(200);
            res.end('OK');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'my-token-123' }] },
            { skipSsrf: true }
        );
        assert.equal(receivedAuth, 'Bearer my-token-123');
    });

    it('header: custom header is set exactly', async () => {
        let receivedHeader;
        await startServer((req, res) => {
            receivedHeader = req.headers['x-api-key'];
            res.writeHead(200);
            res.end('OK');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'header', credentials: [{ key: 'X-API-Key', value: 'secret-key-456' }] },
            { skipSsrf: true }
        );
        assert.equal(receivedHeader, 'secret-key-456');
    });

    it('basic: Authorization header has "Basic <base64>"', async () => {
        let receivedAuth;
        await startServer((req, res) => {
            receivedAuth = req.headers['authorization'];
            res.writeHead(200);
            res.end('OK');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'basic', credentials: [{ key: 'credentials', value: 'admin:secret' }] },
            { skipSsrf: true }
        );
        const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
        assert.equal(receivedAuth, expected);
    });

    it('query: parameter is appended to URL', async () => {
        let receivedUrl;
        await startServer((req, res) => {
            receivedUrl = req.url;
            res.writeHead(200);
            res.end('OK');
        });

        const { validateCredentials } = require('../lib/credentialValidator');
        await validateCredentials(
            `http://127.0.0.1:${testPort}/api/test`,
            { type: 'query', credentials: [{ key: 'token', value: 'abc123' }] },
            { skipSsrf: true }
        );
        assert.ok(receivedUrl.includes('token=abc123'), `Expected token param in URL, got: ${receivedUrl}`);
    });
});
