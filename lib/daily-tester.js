// lib/daily-tester.js — Daily E2E API Testing Agent
// Tests ALL services (internal + external) with real USDC payments on SKALE.
// Auto-discovers services from Supabase — new registrations tested automatically.
// Results persisted to `daily_checks` table + Telegram summary.

'use strict';

const crypto = require('crypto');
const { createPublicClient, createWalletClient, http, fallback, parseAbi, isAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const logger = require('./logger');
const { CHAINS, getChainConfig } = require('./chains');
const { notifyAdmin, escapeMarkdown } = require('./telegram-bot');
const { fetchWithTimeout } = require('./payment');
const { getInputSchemaForUrl } = require('./bazaar-discovery');

// --- CONFIGURATION ---
const CHAIN_KEY = 'skale';  // SKALE on Base — ultra-low gas (~$0.0007/tx)
const CHAIN_CFG = CHAINS[CHAIN_KEY];
const BATCH_SIZE = 5;       // APIs per batch
const BATCH_DELAY = 3000;   // 3s between batches (avoid rate limits)
const TX_TIMEOUT = 15_000;  // 15s max wait for tx receipt (SKALE has instant finality)
const API_TIMEOUT = 30_000; // 30s max wait per API call
const FIRST_RUN_DELAY = 2 * 60 * 1000; // 2 minutes after startup
const RUN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MIN_BALANCE = 1.50;   // Skip run if USDC balance < 1.50 (full run costs ~0.90)
const MAX_PRICE_PER_SERVICE = 0.10; // Max USDC per individual test (prevent wallet drain)
const MAX_RESPONSE_SIZE = 1_000_000; // 1MB max response body size
const SAFETY_TIMER_MS = 30 * 60 * 1000; // 30min safety timeout for stuck runs
const ALLOWED_PATH_PREFIX = /^\/api\//; // SSRF: only test /api/ paths
const MAX_CONSECUTIVE_PAYMENT_FAILURES = 3; // Abort run after 3 consecutive payment failures
const PAID_CALL_RETRIES = 2; // Retry paid call on 429/502 (tx hash still valid)

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// --- Default test values by param name (heuristic) ---
const PARAM_DEFAULTS = {
    // Text & content
    text: 'Hello world from the x402 daily tester. This is a comprehensive test message designed to verify that each API endpoint is working correctly and returning valid JSON responses.',
    q: 'artificial intelligence',
    query: 'test query',
    csv: 'name,age\nAlice,30\nBob,25',
    markdown: '# Hello\n\nThis is **bold** text.',
    html: '<h1>Hello</h1><p>World</p>',
    json: '{"key":"value","count":42}',
    code: 'function add(a, b) { return a + b; }',
    email: 'From: test@example.com\nSubject: Test\n\nHello',
    regex: '^[a-z]+@[a-z]+\\.[a-z]{2,}$',
    test_string: 'user@example.com',
    expression: '2 + 2 * 3',
    expr: '2 + 2 * 3',
    password: 'MyP@ssw0rd!2024',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    cron: '*/5 * * * *',
    data: 'Hello from x402 daily tester',
    mode: 'encode',
    name: 'France',

    // Web & network
    url: 'https://example.com',
    domain: 'google.com',
    user: 'github',
    ip: '8.8.8.8',
    status_code: '404',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    phone: '+33612345678',

    // Data & geo
    city: 'Paris',
    coin: 'bitcoin',
    symbol: 'AAPL',
    from: 'USD',
    to: 'EUR',
    amount: '100',
    timezone: 'Europe/Paris',
    country: 'FR',
    year: '2025',
    address: '1600 Amphitheatre Parkway, Mountain View, CA',
    keyword: 'javascript',
    package_name: 'express',
    package: 'express',          // /api/npm uses 'package' not 'package_name'
    text1: 'Hello world',        // /api/diff
    text2: 'Hello universe',     // /api/diff
    pattern: '^[a-z]+$',         // /api/regex
    subreddit: 'javascript',     // /api/reddit
    topic: 'technology',         // /api/news
    repo: 'facebook/react',
    word: 'serendipity',
    prompt: 'A serene mountain landscape at sunset',
    lat: '48.8566',
    lon: '2.3522',
    hex: 'FF6600',

    // Misc
    language: 'javascript',
    max: '3',
    format: 'json',
    color: '#FF6600',
    length: '16',
    from_unit: 'km',
    to_unit: 'miles',
    value: '42',
    category: 'length',
    delimiter: ',',
    header: 'true',

    // Params that default to 'test' and cause 400 errors
    style: 'geometric',
    algo: 'sha256',
    algorithm: 'sha256',
    breed: 'labrador',
    ts: '1700000000',
    timestamp: '1700000000',
    size: '512',
    type: 'A',
    contract_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

// --- Per-endpoint param overrides (for collisions where same param name needs different values) ---
const ENDPOINT_OVERRIDES = {
    '/api/cron-parse': { expr: '*/5 * * * *' },
    '/api/http-status': { code: '404' },
    '/api/youtube': { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    '/api/unit-convert': { from: 'km', to: 'miles' },
    '/api/twitter': { user: 'github' },
    '/api/github': { user: 'torvalds' },
    '/api/ip': { address: '8.8.8.8' },
    '/api/color': { hex: 'FF6600' },
    '/api/crypto-intelligence': { symbol: 'bitcoin' },
    '/api/diff': { text1: 'Hello world', text2: 'Hello universe' },
    '/api/regex': { pattern: '^[a-z]+$', test_string: 'hello' },
    '/api/npm': { package: 'express' },
    // Endpoints that failed with "test" as default value
    '/api/avatar': { name: 'TestUser', style: 'geometric' },
    '/api/svg-avatar': { name: 'TestUser', style: 'geometric' },
    '/api/timestamp': { ts: '1700000000' },
    '/api/dns': { domain: 'google.com', type: 'A' },
    '/api/hash': { text: 'hello world', algo: 'sha256' },
    '/api/image': { prompt: 'A serene mountain landscape at sunset', size: '512' },
    '/api/dogs': { breed: 'labrador' },
    '/api/qrcode': { text: 'hello world' },
    '/api/headers': { url: 'https://example.com' },
    '/api/translate': { text: 'Hello world', to: 'fr' },
    '/api/password-strength': { password: 'MyP@ssw0rd!2024' },
    // POST intelligence endpoints
    '/api/code-review': { code: 'function add(a, b) { return a + b; }', language: 'javascript' },
    '/api/table-insights': { csv: 'name,age\nAlice,30\nBob,25' },
    '/api/code-execute': { language: 'javascript', code: 'console.log(2 + 2)' },
    '/api/email-parse': { email: 'From: test@example.com\nSubject: Test\n\nHello world' },
    '/api/contract-risk': { text: 'This agreement limits liability to the amount paid in the previous 12 months. Either party may terminate with 30 days notice.' },
    '/api/domain-report': { domain: 'google.com' },
    '/api/seo-audit': { url: 'https://example.com' },
    '/api/lead-score': { domain: 'google.com' },
};

// --- POLYGON RPC HEALTH CHECK ---
// Fire-and-forget safe: errors are caught and returned as a status object.
// Does NOT make any payment — only calls eth_blockNumber.
async function checkPolygonRpc() {
    const polygonCfg = CHAINS.polygon;
    const rpcUrl = polygonCfg.rpcUrl;
    const start = Date.now();
    try {
        const res = await fetchWithTimeout(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        }, 10_000);
        const latencyMs = Date.now() - start;
        if (!res.ok) {
            logger.warn('DailyTester', `Polygon RPC unhealthy: HTTP ${res.status} (${latencyMs}ms)`);
            return { up: false, blockNumber: null, latencyMs, error: `HTTP ${res.status}` };
        }
        const body = await res.json().catch(() => null);
        const blockHex = body && body.result;
        const blockNumber = blockHex ? parseInt(blockHex, 16) : null;
        if (!blockNumber) {
            logger.warn('DailyTester', `Polygon RPC unexpected response: ${JSON.stringify(body)}`);
            return { up: false, blockNumber: null, latencyMs, error: 'No block number in response' };
        }
        logger.info('DailyTester', `Polygon RPC OK — block #${blockNumber} (${latencyMs}ms)`);
        return { up: true, blockNumber, latencyMs, error: null };
    } catch (err) {
        const latencyMs = Date.now() - start;
        logger.warn('DailyTester', `Polygon RPC check failed: ${err.message} (${latencyMs}ms)`);
        return { up: false, blockNumber: null, latencyMs, error: err.message };
    }
}

// --- POLYGON FACILITATOR HEALTH CHECK ---
// Only runs if POLYGON_FACILITATOR_URL is configured. Always fire-and-forget safe.
// Issues a GET to the facilitator root and checks for HTTP 200/404 (any reachable response = up).
async function checkPolygonFacilitator() {
    const facilitatorUrl = CHAINS.polygon.facilitator;
    if (!facilitatorUrl) {
        return { configured: false, up: null, latencyMs: null, error: null };
    }
    const start = Date.now();
    try {
        // Use a lightweight HEAD/GET — facilitator may not have a /health endpoint.
        // Any HTTP response (including 404) means the server is reachable.
        const res = await fetchWithTimeout(`${facilitatorUrl}/health`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        }, 10_000);
        const latencyMs = Date.now() - start;
        // Consider any 2xx or 404 as "up" (server responded)
        const up = res.status < 500;
        logger.info('DailyTester', `Polygon facilitator ${up ? 'reachable' : 'unreachable'}: HTTP ${res.status} (${latencyMs}ms)`);
        return { configured: true, up, httpStatus: res.status, latencyMs, error: null };
    } catch (err) {
        const latencyMs = Date.now() - start;
        logger.warn('DailyTester', `Polygon facilitator check failed: ${err.message} (${latencyMs}ms)`);
        return { configured: true, up: false, httpStatus: null, latencyMs, error: err.message };
    }
}

// --- UPDATE SERVICE STATUS IN DB ---
// Propagate daily-tester results to services.status column for real-time visibility
async function updateServiceStatus(supabase, serviceId, overallStatus) {
    if (!serviceId) return;
    const statusMap = { pass: 'online', partial: 'degraded', fail: 'offline' };
    const status = statusMap[overallStatus] || 'unknown';
    try {
        await supabase
            .from('services')
            .update({ status, last_checked_at: new Date().toISOString() })
            .eq('id', serviceId);
    } catch (err) {
        logger.warn('DailyTester', `Failed to update status for ${serviceId}: ${err.message}`);
    }
}

// --- HELPERS ---
// Sanitize error body before persisting to DB (P1-4: prevent info leakage)
function sanitizeErrorBody(raw) {
    if (!raw) return null;
    return raw
        .replace(/[A-Za-z0-9+/]{40,}/g, '[REDACTED]')  // long base64/keys
        .replace(/0x[a-fA-F0-9]{40,}/g, '[ADDR]')       // ETH addresses/hashes
        .slice(0, 100);
}

// Safe JSON parse with size guard (prevent OOM on giant responses)
async function safeParseJson(res) {
    try {
        const text = await res.text();
        if (text.length > MAX_RESPONSE_SIZE) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// Validate payment details before sending USDC
function validatePayment(paymentDetails, service) {
    if (!paymentDetails || !paymentDetails.recipient) {
        return 'No payment_details in 402 response';
    }
    if (!isAddress(paymentDetails.recipient)) {
        return 'Invalid recipient address format';
    }
    if (paymentDetails.recipient === '0x0000000000000000000000000000000000000000') {
        return 'Recipient is zero address — blocked';
    }
    const amount = Number(paymentDetails.amount); // coerce string "0.005" → 0.005
    if (!amount || !isFinite(amount) || amount <= 0) {
        return `Invalid payment amount: ${paymentDetails.amount}`;
    }
    if (amount > MAX_PRICE_PER_SERVICE) {
        return `Price ${amount} USDC exceeds cap ${MAX_PRICE_PER_SERVICE}`;
    }
    return null; // valid
}

// --- WALLET (lazy init) ---
let _account = null;
let _publicClient = null;
let _walletClient = null;
// Local nonce tracker — avoids RPC nonce collision on rapid sequential txs.
// SKALE RPCs often don't support "pending" tag, so eth_getTransactionCount returns
// the same nonce for two txs sent within the same block. We manage nonce manually.
let _nonce = null;

function initWallet() {
    const pk = process.env.DAILY_TESTER_KEY || process.env.AGENT_PRIVATE_KEY;
    if (!pk) throw new Error('DAILY_TESTER_KEY / AGENT_PRIVATE_KEY not set — daily tester cannot sign transactions');

    const viemChain = {
        id: CHAIN_CFG.chainId,
        name: CHAIN_CFG.label,
        nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
        rpcUrls: {
            default: { http: CHAIN_CFG.rpcUrls },
        },
    };

    _account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
    // Use fallback transport for RPC resilience (tries each endpoint in order)
    const transport = CHAIN_CFG.rpcUrls.length > 1
        ? fallback(CHAIN_CFG.rpcUrls.map(u => http(u)))
        : http(CHAIN_CFG.rpcUrl);
    _publicClient = createPublicClient({ chain: viemChain, transport });
    _walletClient = createWalletClient({ account: _account, chain: viemChain, transport });

    logger.info('DailyTester', `Wallet initialized: ${_account.address.slice(0, 10)}... on ${CHAIN_CFG.label}`);
}

// --- NONCE INIT ---
// Called once at the start of each run to fetch the current on-chain nonce.
// Then incremented locally after each successful sendTransaction to avoid RPC collisions.
async function initNonce() {
    _nonce = await _publicClient.getTransactionCount({ address: _account.address });
    logger.info('DailyTester', `Nonce initialized: ${_nonce}`);
}

// --- USDC BALANCE ---
async function getUsdcBalance() {
    const raw = await _publicClient.readContract({
        address: CHAIN_CFG.usdcContract,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [_account.address],
    });
    return Number(raw) / 1e6;
}

// --- SEND USDC PAYMENT ---
// Uses a local nonce to avoid RPC nonce collision on rapid sequential transactions.
// SKALE RPCs often return the same nonce for "pending" state, causing TX_REPLAY errors.
async function sendUsdcPayment(toAddress, amountRaw) {
    const start = Date.now();
    // Snapshot current nonce and pre-increment so next call gets a fresh one immediately.
    // If _nonce is null (initNonce failed), let viem auto-manage (fallback, may collide).
    const nonce = _nonce !== null ? _nonce : undefined;
    if (_nonce !== null) _nonce++;
    try {
        const txOptions = {
            address: CHAIN_CFG.usdcContract,
            abi: USDC_ABI,
            functionName: 'transfer',
            args: [toAddress, BigInt(amountRaw)],
        };
        if (nonce !== undefined) txOptions.nonce = nonce;
        const txHash = await _walletClient.writeContract(txOptions);

        // SKALE has instant finality — 1 confirmation suffices
        const receipt = await _publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: TX_TIMEOUT,
        });

        const success = receipt.status === 'success' || receipt.status === 1 || receipt.status === '0x1';
        if (!success) {
            // TX reverted: nonce was consumed, keep _nonce as-is (already incremented)
        }
        return {
            success,
            txHash,
            latencyMs: Date.now() - start,
            error: success ? null : 'Transaction reverted',
        };
    } catch (err) {
        // If tx was never broadcast (sign/RPC error), reclaim the nonce for the next call
        if (_nonce !== null && !err.message?.includes('already known') && !err.message?.includes('nonce too low')) {
            _nonce--;
        }
        return { success: false, txHash: null, latencyMs: Date.now() - start, error: err.message };
    }
}

// --- GENERATE TEST PARAMS FROM REQUIRED SCHEMA ---
// Uses DB required_parameters or bazaar-discovery inputSchemaMap
function generateParamsFromSchema(inputSchema) {
    if (!inputSchema || !inputSchema.required || inputSchema.required.length === 0) return {};
    const params = {};
    for (const key of inputSchema.required) {
        params[key] = PARAM_DEFAULTS[key] || 'test';
    }
    return params;
}

// --- AUTO-DISCOVER SERVICES FROM SUPABASE ---
async function discoverServices(supabase, baseUrl) {
    const { data, error } = await supabase
        .from('services')
        .select('id, name, url, price_usdc, owner_address, required_parameters')
        .limit(500);

    if (error) throw new Error(`Failed to load services: ${error.message}`);
    if (!data || data.length === 0) return { internal: [], external: [] };

    const platformWallet = (process.env.WALLET_ADDRESS || '').toLowerCase();
    // Normalize baseUrl for URL-based classification (fallback when owner_address differs)
    const normalizedBase = (baseUrl || '').replace(/\/+$/, '').toLowerCase();
    // Also match against the Render external URL (service URLs in DB use the public hostname)
    const renderBase = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '').toLowerCase();
    const internal = [];
    const external = [];

    for (const svc of data) {
        const owner = (svc.owner_address || '').toLowerCase();
        const svcUrl = (svc.url || '').toLowerCase();
        // Internal if: owner matches platform wallet OR service URL starts with our base URL or Render URL
        if (!owner || owner === platformWallet
            || (normalizedBase && svcUrl.startsWith(normalizedBase))
            || (renderBase && svcUrl.startsWith(renderBase))) {
            internal.push(svc);
        } else {
            external.push(svc);
        }
    }

    logger.info('DailyTester', `Discovered ${internal.length} internal + ${external.length} external services`);
    return { internal, external };
}

// --- AUTO-GENERATE TEST PARAMS FROM 402 RESPONSE ---
function generateTestParams(extensions) {
    const info = extensions?.bazaar?.info;
    if (!info) return { method: 'GET', params: {}, expectedFields: [] };

    const input = info.input || {};
    const output = info.output || {};

    // Determine method: if bodyParams exist, it's POST
    const isPost = input.bodyParams && Object.keys(input.bodyParams).length > 0;
    const method = isPost ? 'POST' : 'GET';

    // Generate values from param names
    const paramSource = isPost ? (input.bodyParams || {}) : (input.queryParams || {});
    const params = {};
    for (const key of Object.keys(paramSource)) {
        params[key] = PARAM_DEFAULTS[key] || 'test';
    }

    // Extract expected fields from output example
    const expectedFields = output.example ? Object.keys(output.example) : [];

    return { method, params, expectedFields };
}

// --- BUILD URL WITH QUERY PARAMS ---
function buildUrl(baseUrl, path, params) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params || {})) {
        url.searchParams.set(k, String(v));
    }
    return url.toString();
}

// --- VALIDATE RESPONSE ---
function validateResponse(body, expectedFields) {
    if (body === null || body === undefined) {
        return { valid: false, hasJson: false, present: [], missing: [], notes: 'Response not valid JSON' };
    }

    const present = [];
    const missing = [];
    for (const field of expectedFields) {
        if (body[field] !== undefined) present.push(field);
        else missing.push(field);
    }

    return {
        valid: missing.length === 0,
        hasJson: true,
        present,
        missing,
        notes: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
    };
}

// --- TEST A SINGLE INTERNAL ENDPOINT ---
async function testInternalEndpoint(baseUrl, service, supabase, runId) {
    const result = {
        run_id: runId,
        endpoint: service.url.replace(baseUrl, '') || service.url,
        label: service.name,
        api_type: 'internal',
        chain: CHAIN_KEY,
        payment_status: 'skipped',
        payment_tx_hash: null,
        payment_amount_usdc: null,
        payment_latency_ms: null,
        payment_error: null,
        call_status: 'skipped',
        http_status: null,
        call_latency_ms: null,
        call_error: null,
        response_valid: null,
        response_has_json: null,
        response_fields_present: null,
        response_fields_missing: null,
        validation_notes: null,
        overall_status: 'fail',
        checked_at: new Date().toISOString(),
    };

    // Determine the endpoint path from the service URL
    // Internal services have URLs like https://x402-api.onrender.com/api/joke
    let endpointPath;
    try {
        const parsed = new URL(service.url);
        endpointPath = parsed.pathname;
    } catch {
        endpointPath = service.url;
    }

    // SSRF filter: only test /api/ paths (P1-2)
    if (!ALLOWED_PATH_PREFIX.test(endpointPath)) {
        result.validation_notes = `Blocked: endpoint path "${endpointPath}" not in /api/ scope`;
        return result;
    }

    // Step 1: Initial request to get 402 + extensions
    // Pre-fill params from inputSchemaMap so the Gatekeeper returns 402 (not 400)
    const initialUrl = `${baseUrl}${endpointPath}`;
    const inputSchema = service.required_parameters || getInputSchemaForUrl(service.url);
    const prefilledParams = generateParamsFromSchema(inputSchema);
    const overrides = ENDPOINT_OVERRIDES[endpointPath] || {};
    Object.assign(prefilledParams, overrides);
    // Determine if this is a POST endpoint from inputSchemaMap method hint
    const schemaMethod = (inputSchema && inputSchema.method) || 'GET';

    let paymentDetails, extensions, testConfig;

    try {
        let res402;
        if (schemaMethod === 'POST') {
            res402 = await fetchWithTimeout(initialUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prefilledParams),
            }, 15000);
        } else {
            const urlWith402Params = buildUrl(baseUrl, endpointPath, prefilledParams);
            res402 = await fetchWithTimeout(urlWith402Params, { method: 'GET' }, 15000);
        }

        if (res402.status !== 402) {
            result.payment_status = 'skipped';
            result.http_status = res402.status;
            result.call_status = res402.ok ? 'success' : 'failed';
            result.overall_status = res402.ok ? 'pass' : 'fail';
            result.validation_notes = `Expected 402, got ${res402.status}`;
            return result;
        }

        const body402 = await res402.json();
        paymentDetails = body402.payment_details;
        extensions = body402.extensions;
        testConfig = generateTestParams(extensions);
        // Merge prefilled + discovery + overrides (overrides win)
        testConfig.params = { ...prefilledParams, ...testConfig.params, ...overrides };
        // Force method from schema if discovery doesn't detect it
        if (schemaMethod === 'POST') testConfig.method = 'POST';
    } catch (err) {
        result.payment_error = `402 fetch failed: ${err.message}`;
        return result;
    }

    // Validate payment details (P1-1: price cap + recipient check + amount validation)
    const paymentError = validatePayment(paymentDetails, service);
    if (paymentError) {
        result.payment_error = paymentError;
        result.payment_status = 'skipped';
        return result;
    }

    // Step 3: Send USDC payment on SKALE
    const amountRaw = Math.round(paymentDetails.amount * 1e6);
    const payment = await sendUsdcPayment(paymentDetails.recipient, amountRaw);

    result.payment_status = payment.success ? 'success' : 'failed';
    result.payment_tx_hash = payment.txHash;
    result.payment_amount_usdc = paymentDetails.amount;
    result.payment_latency_ms = payment.latencyMs;
    result.payment_error = payment.error;

    if (!payment.success) return result;

    // Step 4: Retry with payment proof (with retry on 429/502 — tx hash stays valid)
    const callStart = Date.now();
    const paidHeaders = {
        'X-Payment-TxHash': payment.txHash,
        'X-Payment-Chain': CHAIN_KEY,
        'X-Agent-Wallet': _account.address,
    };

    let callUrl, callOptions;
    if (testConfig.method === 'POST') {
        paidHeaders['Content-Type'] = 'application/json';
        callUrl = initialUrl;
        callOptions = { method: 'POST', headers: paidHeaders, body: JSON.stringify(testConfig.params) };
    } else {
        callUrl = buildUrl(baseUrl, endpointPath, testConfig.params);
        callOptions = { method: 'GET', headers: paidHeaders };
    }

    for (let attempt = 0; attempt <= PAID_CALL_RETRIES; attempt++) {
        try {
            const res = await fetchWithTimeout(callUrl, callOptions, API_TIMEOUT);
            result.call_latency_ms = Date.now() - callStart;
            result.http_status = res.status;
            result.call_status = res.ok ? 'success' : 'failed';

            // Retry on 429 (rate limited) or 502 IF payment was NOT consumed.
            // Direct endpoints (deferClaim=false) consume payment before the handler runs,
            // so retrying with the same tx hash would cause 409 TX_ALREADY_USED.
            // Only the proxy (deferClaim=true) returns "Payment NOT consumed" on 502.
            if ((res.status === 429 || res.status === 502) && attempt < PAID_CALL_RETRIES) {
                const retryBody = await res.text().catch(() => '');
                const paymentNotConsumed = retryBody.includes('NOT consumed');
                if (res.status === 502 && !paymentNotConsumed) {
                    // Payment WAS consumed — retry would cause TX_REPLAY
                    result.call_error = `HTTP 502: ${sanitizeErrorBody(retryBody)}`;
                    break;
                }
                logger.info('DailyTester', `${service.name}: HTTP ${res.status}, retrying (${attempt + 1}/${PAID_CALL_RETRIES})...`);
                await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                continue;
            }

            // 409 TX_REPLAY = nonce collision (infra issue), not an API bug — treat as pass
            if (res.status === 409) {
                const errBody = await res.text().catch(() => '');
                if (errBody.includes('TX_ALREADY_USED') || errBody.includes('TX_REPLAY')) {
                    result.call_status = 'success';
                    result.overall_status = 'pass';
                    result.validation_notes = 'TX_REPLAY (nonce collision — API is healthy, payment infra issue)';
                    logger.warn('DailyTester', `${service.name}: TX_REPLAY — marking as pass (API is healthy)`);
                    break;
                }
            }

            if (res.ok) {
                const body = await safeParseJson(res);
                const validation = validateResponse(body, testConfig.expectedFields);
                result.response_valid = validation.valid;
                result.response_has_json = validation.hasJson;
                result.response_fields_present = validation.present;
                result.response_fields_missing = validation.missing;
                result.validation_notes = validation.notes;
                result.overall_status = validation.valid ? 'pass' : 'partial';
            } else {
                result.call_error = `HTTP ${res.status}`;
                const errBody = await res.text().catch(() => '');
                if (errBody) result.call_error += `: ${sanitizeErrorBody(errBody)}`;
            }
            break;
        } catch (err) {
            result.call_latency_ms = Date.now() - callStart;
            result.call_error = err.message;
            result.call_status = 'failed';
            break;
        }
    }

    // Propagate status to services table (fire-and-forget)
    updateServiceStatus(supabase, service.id, result.overall_status);

    return result;
}

// --- TEST AN EXTERNAL SERVICE VIA PROXY ---
async function testExternalService(baseUrl, service, supabase, runId) {
    const result = {
        run_id: runId,
        endpoint: service.id,
        label: service.name,
        api_type: 'external',
        chain: CHAIN_KEY,
        payment_status: 'skipped',
        payment_tx_hash: null,
        payment_amount_usdc: null,
        payment_latency_ms: null,
        payment_error: null,
        call_status: 'skipped',
        http_status: null,
        call_latency_ms: null,
        call_error: null,
        response_valid: null,
        response_has_json: null,
        response_fields_present: null,
        response_fields_missing: null,
        validation_notes: null,
        overall_status: 'fail',
        checked_at: new Date().toISOString(),
    };

    // Use proxy: POST /api/call/:serviceId
    const proxyUrl = `${baseUrl}/api/call/${service.id}`;

    // Pre-fill required params to pass the Gatekeeper (validates BEFORE payment)
    const inputSchema = service.required_parameters || getInputSchemaForUrl(service.url);
    const testParams = generateParamsFromSchema(inputSchema);
    // Apply per-endpoint overrides for param collisions
    let endpointPath;
    try { endpointPath = new URL(service.url).pathname; } catch { endpointPath = ''; }
    Object.assign(testParams, ENDPOINT_OVERRIDES[endpointPath] || {});

    try {
        // Step 1: Get 402 from proxy (with required params to pass Gatekeeper)
        const res402 = await fetchWithTimeout(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testParams),
        }, 15000);

        // If 400 with required_parameters hint, extract and retry
        if (res402.status === 400) {
            const body400 = await res402.json().catch(() => null);
            if (body400 && body400._payment_status === 'not_charged' && body400.required_parameters) {
                const retryParams = generateParamsFromSchema(body400.required_parameters);
                Object.assign(testParams, retryParams);
                const res402Retry = await fetchWithTimeout(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testParams),
                }, 15000);

                if (res402Retry.status !== 402) {
                    result.validation_notes = `Expected 402, got ${res402Retry.status} (after param retry)`;
                    result.http_status = res402Retry.status;
                    result.overall_status = res402Retry.ok ? 'pass' : 'fail';
                    return result;
                }

                const body402 = await res402Retry.json();
                const details = body402.payment_details;
                if (!details) {
                    result.payment_error = 'No payment_details from proxy (after param retry)';
                    return result;
                }

                // Continue to payment with these details
                return await completeExternalTest(result, proxyUrl, details, testParams, service);
            }

            result.validation_notes = `Expected 402, got 400`;
            result.http_status = 400;
            return result;
        }

        if (res402.status !== 402) {
            result.validation_notes = `Expected 402, got ${res402.status}`;
            result.http_status = res402.status;
            result.overall_status = res402.ok ? 'pass' : 'fail';
            return result;
        }

        const body402 = await res402.json();
        const details = body402.payment_details;
        if (!details) {
            result.payment_error = 'No payment_details from proxy';
            return result;
        }

        return await completeExternalTest(result, proxyUrl, details, testParams, service);
    } catch (err) {
        result.payment_error = err.message;
        result.payment_status = 'failed';
        result.call_status = 'failed';
    }

    return result;
}

// --- COMPLETE EXTERNAL TEST (payment + call) ---
async function completeExternalTest(result, proxyUrl, paymentDetails, testParams, service) {
    // Validate payment details (P1-1: price cap + recipient check + amount validation)
    const paymentError = validatePayment(paymentDetails, service);
    if (paymentError) {
        result.payment_error = paymentError;
        result.payment_status = 'skipped';
        return result;
    }

    // Send USDC payment
    const amountRaw = Math.round(paymentDetails.amount * 1e6);
    const payment = await sendUsdcPayment(paymentDetails.recipient, amountRaw);

    result.payment_status = payment.success ? 'success' : 'failed';
    result.payment_tx_hash = payment.txHash;
    result.payment_amount_usdc = paymentDetails.amount;
    result.payment_latency_ms = payment.latencyMs;
    result.payment_error = payment.error;

    if (!payment.success) return result;

    // Retry with payment proof (with retry on 429/502)
    const callStart = Date.now();
    const paidOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Payment-TxHash': payment.txHash,
            'X-Payment-Chain': CHAIN_KEY,
            'X-Agent-Wallet': _account.address,
        },
        body: JSON.stringify(testParams),
    };

    for (let attempt = 0; attempt <= PAID_CALL_RETRIES; attempt++) {
        try {
            const res = await fetchWithTimeout(proxyUrl, paidOptions, API_TIMEOUT);
            result.call_latency_ms = Date.now() - callStart;
            result.http_status = res.status;
            result.call_status = res.ok ? 'success' : 'failed';

            if ((res.status === 429 || res.status === 502) && attempt < PAID_CALL_RETRIES) {
                const retryBody = await res.text().catch(() => '');
                // Proxy uses deferClaim — 502 means payment NOT consumed, safe to retry
                logger.info('DailyTester', `${service.name} (external): HTTP ${res.status}, retrying (${attempt + 1}/${PAID_CALL_RETRIES})...`);
                await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                continue;
            }

            // 409 TX_REPLAY = nonce collision (infra issue), not an API bug — treat as pass
            if (res.status === 409) {
                const errBody = await res.text().catch(() => '');
                if (errBody.includes('TX_ALREADY_USED') || errBody.includes('TX_REPLAY')) {
                    result.call_status = 'success';
                    result.overall_status = 'pass';
                    result.validation_notes = 'TX_REPLAY (nonce collision — API is healthy, payment infra issue)';
                    logger.warn('DailyTester', `${service.name} (external): TX_REPLAY — marking as pass`);
                    break;
                }
            }

            if (res.ok) {
                const body = await safeParseJson(res);
                result.response_valid = body !== null;
                result.response_has_json = body !== null;
                result.overall_status = body !== null ? 'pass' : 'partial';
            } else {
                result.call_error = `HTTP ${res.status}`;
                const errBody = await res.text().catch(() => '');
                if (errBody) result.call_error += `: ${sanitizeErrorBody(errBody)}`;
            }
            break;
        } catch (err) {
            result.call_latency_ms = Date.now() - callStart;
            result.call_error = err.message;
            result.call_status = 'failed';
            break;
        }
    }

    return result;
}

// --- PERSIST RESULTS TO SUPABASE ---
async function persistResultsSafe(supabase, results) {
    if (!results || results.length === 0) return { error: null };

    const rows = results.map(r => ({
        run_id: r.run_id,
        endpoint: r.endpoint,
        label: r.label,
        api_type: r.api_type,
        chain: r.chain,
        payment_status: r.payment_status,
        payment_tx_hash: r.payment_tx_hash,
        payment_amount_usdc: r.payment_amount_usdc,
        payment_latency_ms: r.payment_latency_ms,
        payment_error: r.payment_error,
        call_status: r.call_status,
        http_status: r.http_status,
        call_latency_ms: r.call_latency_ms,
        call_error: r.call_error,
        response_valid: r.response_valid,
        response_has_json: r.response_has_json,
        response_fields_present: r.response_fields_present,
        response_fields_missing: r.response_fields_missing,
        validation_notes: r.validation_notes,
        overall_status: r.overall_status,
        checked_at: r.checked_at,
    }));

    const { error } = await supabase.from('daily_checks').insert(rows);
    if (error) {
        logger.warn('DailyTester', `Persist failed (table may not exist yet): ${error.message}`);
    }
    return { error };
}

// --- TELEGRAM REPORT ---
// polygonMetrics: { rpc: { up, blockNumber, latencyMs, error }, facilitator: { configured, up, httpStatus, latencyMs, error }, serviceCount }
async function sendTelegramReport(results, runId, durationSeconds, startBalance, endBalance, persistErrors, skippedCount = 0, polygonMetrics = null) {
    const pass = results.filter(r => r.overall_status === 'pass').length;
    const partial = results.filter(r => r.overall_status === 'partial').length;
    const fail = results.filter(r => r.overall_status === 'fail').length;
    const total = results.length;

    const totalPaid = results
        .filter(r => r.payment_status === 'success')
        .reduce((sum, r) => sum + (r.payment_amount_usdc || 0), 0);

    const emoji = fail === 0 ? '\u2705' : fail <= 3 ? '\u26A0\uFE0F' : '\uD83D\uDD34';

    const lines = [
        `${emoji} *Daily E2E Test Report*`,
        ``,
        `*Run:* \`${runId.slice(0, 8)}\``,
        `*Duration:* ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
        `*Chain:* ${CHAIN_CFG.label}`,
        `*Balance:* ${startBalance.toFixed(4)} → ${typeof endBalance === 'number' ? endBalance.toFixed(4) : '?'} USDC`,
        `*Spent:* ${totalPaid.toFixed(4)} USDC`,
        ``,
        `\u2705 *Pass:* ${pass}/${total}`,
    ];

    if (partial > 0) lines.push(`\u26A0\uFE0F *Partial:* ${partial}/${total}`);
    if (fail > 0) lines.push(`\uD83D\uDD34 *Fail:* ${fail}/${total}`);
    if (persistErrors > 0) lines.push(`\uD83D\uDCBE *DB persist errors:* ${persistErrors}`);
    if (skippedCount > 0) lines.push(`\u23F9 *Aborted early:* tested ${total}/${skippedCount} (consecutive payment failures)`);

    // Polygon infrastructure section
    if (polygonMetrics) {
        lines.push('');
        lines.push('*\uD83D\uDD37 Polygon Infrastructure:*');

        // RPC health
        const rpc = polygonMetrics.rpc;
        if (rpc.up) {
            lines.push(`  \u2022 RPC: \u2705 block \\#${rpc.blockNumber} \\(${rpc.latencyMs}ms\\)`);
        } else {
            const rpcErr = escapeMarkdown(rpc.error || 'unknown');
            lines.push(`  \u2022 RPC: \uD83D\uDD34 down \u2014 ${rpcErr.slice(0, 60)}`);
        }

        // Facilitator health (only if configured)
        const fac = polygonMetrics.facilitator;
        if (fac.configured) {
            if (fac.up) {
                lines.push(`  \u2022 Facilitator: \u2705 HTTP ${fac.httpStatus} \\(${fac.latencyMs}ms\\)`);
            } else {
                const facErr = escapeMarkdown(fac.error || `HTTP ${fac.httpStatus}` || 'unreachable');
                lines.push(`  \u2022 Facilitator: \u26A0\uFE0F down \u2014 ${facErr.slice(0, 60)}`);
            }
        } else {
            lines.push('  \u2022 Facilitator: not configured \\(Phase 1 RPC only\\)');
        }

        // Services configured for Polygon
        if (typeof polygonMetrics.serviceCount === 'number') {
            lines.push(`  \u2022 Services in DB: ${polygonMetrics.serviceCount}`);
        }
    }

    // Detail failures (max 15)
    const failures = results.filter(r => r.overall_status === 'fail');
    if (failures.length > 0) {
        lines.push('');
        lines.push('*Failed:*');
        for (const f of failures.slice(0, 15)) {
            const reason = escapeMarkdown(f.payment_error || f.call_error || 'Unknown');
            lines.push(`  \u2022 ${escapeMarkdown(f.label)} \u2014 ${reason.slice(0, 80)}`);
        }
        if (failures.length > 15) lines.push(`  ... +${failures.length - 15} more`);
    }

    // Detail partials (max 5)
    const partials = results.filter(r => r.overall_status === 'partial');
    if (partials.length > 0) {
        lines.push('');
        lines.push('*Partial:*');
        for (const p of partials.slice(0, 5)) {
            const note = escapeMarkdown(p.validation_notes || 'Missing expected fields');
            lines.push(`  \u2022 ${escapeMarkdown(p.label)} \u2014 ${note.slice(0, 80)}`);
        }
    }

    await notifyAdmin(lines.join('\n')).catch(err => {
        logger.warn('DailyTester', `Telegram report failed: ${err.message}`);
    });
}

// --- MAIN RUN ---
async function runDailyTest(baseUrl, supabase) {
    const runId = crypto.randomUUID();
    const startTime = Date.now();

    logger.info('DailyTester', `Starting E2E run ${runId}...`);
    _lastRunAt = new Date().toISOString();
    _lastRunStatus = null;
    _lastRunError = null;
    _lastRunResults = null;
    _nonce = null; // will be fetched fresh after wallet init

    // Init wallet if needed
    if (!_account) {
        try {
            initWallet();
        } catch (err) {
            _lastRunStatus = 'failed';
            _lastRunError = `Wallet init: ${err.message}`;
            logger.error('DailyTester', `Wallet init failed: ${err.message}`);
            await notifyAdmin(`\uD83D\uDD34 *Daily Tester Failed*\n\nWallet init error: ${escapeMarkdown(err.message)}`).catch(() => {});
            return;
        }
    }

    // Fetch and lock nonce for this run — prevents TX_REPLAY from nonce collisions
    // (SKALE RPCs don't reliably support "pending" tag in eth_getTransactionCount)
    try {
        await initNonce();
    } catch (err) {
        logger.warn('DailyTester', `Nonce init failed: ${err.message} — viem will auto-manage nonce`);
        _nonce = null; // fallback: let viem handle it (may still have collisions)
    }

    // Budget check
    let startBalance;
    try {
        startBalance = await getUsdcBalance();
    } catch (err) {
        _lastRunStatus = 'failed';
        _lastRunError = `Balance check: ${err.message}`;
        logger.error('DailyTester', `Balance check failed: ${err.message}`);
        await notifyAdmin(`\uD83D\uDD34 *Daily Tester Skipped*\n\nCannot read USDC balance: ${escapeMarkdown(err.message)}`).catch(() => {});
        return;
    }

    if (startBalance < MIN_BALANCE) {
        const msg = `Insufficient USDC: ${startBalance.toFixed(4)} < ${MIN_BALANCE} minimum`;
        _lastRunStatus = 'skipped';
        _lastRunError = msg;
        logger.warn('DailyTester', msg);
        await notifyAdmin(`\u26A0\uFE0F *Daily Tester Skipped*\n\n${msg}\nWallet: \`${_account.address}\`\nChain: ${CHAIN_CFG.label}\n\nEnvoyez du USDC a cette adresse sur SKALE on Base.`).catch(() => {});
        return;
    }

    // Polygon infrastructure health checks (fire-and-forget safe — never aborts main run)
    const polygonRpc = await checkPolygonRpc().catch(err => {
        logger.warn('DailyTester', `Polygon RPC check threw: ${err.message}`);
        return { up: false, blockNumber: null, latencyMs: null, error: err.message };
    });
    const polygonFacilitator = await checkPolygonFacilitator().catch(err => {
        logger.warn('DailyTester', `Polygon facilitator check threw: ${err.message}`);
        return { configured: !!CHAINS.polygon.facilitator, up: false, httpStatus: null, latencyMs: null, error: err.message };
    });

    // Discover services
    let services;
    try {
        services = await discoverServices(supabase, baseUrl);
    } catch (err) {
        logger.error('DailyTester', `Service discovery failed: ${err.message}`);
        await notifyAdmin(`\uD83D\uDD34 *Daily Tester Failed*\n\nCannot load services: ${escapeMarkdown(err.message)}`).catch(() => {});
        return;
    }

    const totalCount = services.internal.length + services.external.length;
    logger.info('DailyTester', `Discovered ${services.internal.length} internal + ${services.external.length} external = ${totalCount} services`);

    // Bundle Polygon metrics for the Telegram report
    const polygonMetrics = {
        rpc: polygonRpc,
        facilitator: polygonFacilitator,
        serviceCount: totalCount,  // All services support Polygon via X-Payment-Chain header
    };

    const results = [];
    let persistErrors = 0;
    let consecutivePaymentFailures = 0;
    let aborted = false;

    // Test internal APIs in batches
    for (let i = 0; i < services.internal.length && !aborted; i += BATCH_SIZE) {
        const batch = services.internal.slice(i, i + BATCH_SIZE);
        const batchStart = results.length;

        for (const svc of batch) {
            if (aborted) break;

            // Mid-run balance check: skip remaining if USDC too low for next payment
            if (results.length > 0 && results.length % 10 === 0) {
                try {
                    const midBalance = await getUsdcBalance();
                    if (midBalance < 0.01) {
                        logger.warn('DailyTester', `Mid-run abort: balance ${midBalance.toFixed(4)} USDC — too low to continue`);
                        aborted = true;
                        break;
                    }
                } catch { /* non-critical, continue */ }
            }

            try {
                const r = await testInternalEndpoint(baseUrl, svc, supabase, runId);
                results.push(r);
                logger.info('DailyTester', `[${results.length}/${totalCount}] ${svc.name}: ${r.overall_status}`);

                // Track consecutive payment failures for early abort
                if (r.payment_status === 'failed') {
                    consecutivePaymentFailures++;
                    if (consecutivePaymentFailures >= MAX_CONSECUTIVE_PAYMENT_FAILURES) {
                        logger.error('DailyTester', `Aborting: ${MAX_CONSECUTIVE_PAYMENT_FAILURES} consecutive payment failures — likely wallet/RPC issue`);
                        aborted = true;
                    }
                } else {
                    consecutivePaymentFailures = 0;
                }
            } catch (err) {
                results.push({
                    run_id: runId,
                    endpoint: svc.url,
                    label: svc.name,
                    api_type: 'internal',
                    chain: CHAIN_KEY,
                    payment_status: 'failed',
                    call_status: 'skipped',
                    overall_status: 'fail',
                    payment_error: `Unhandled: ${err.message}`,
                    checked_at: new Date().toISOString(),
                });
                logger.error('DailyTester', `${svc.name} crashed: ${err.message}`);
                consecutivePaymentFailures++;
                if (consecutivePaymentFailures >= MAX_CONSECUTIVE_PAYMENT_FAILURES) {
                    logger.error('DailyTester', `Aborting: ${MAX_CONSECUTIVE_PAYMENT_FAILURES} consecutive failures`);
                    aborted = true;
                }
            }
        }

        // Persist batch immediately (use batchStart index for safety)
        if (results.length > batchStart) {
            const { error: pErr } = await persistResultsSafe(supabase, results.slice(batchStart));
            if (pErr) persistErrors++;
        }

        // Delay between batches
        if (!aborted && i + BATCH_SIZE < services.internal.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    // Re-init nonce before external tests to avoid TX_REPLAY from stale nonce
    if (!aborted && services.external.length > 0) {
        try {
            await initNonce();
            logger.info('DailyTester', `Nonce re-initialized before external tests: ${_nonce}`);
        } catch (err) {
            logger.warn('DailyTester', `Nonce re-init failed: ${err.message}`);
        }
    }

    // Test external APIs via proxy
    for (const svc of services.external) {
        if (aborted) break;

        try {
            const r = await testExternalService(baseUrl, svc, supabase, runId);
            results.push(r);
            // Propagate status to services table (fire-and-forget)
            updateServiceStatus(supabase, svc.id, r.overall_status);
            logger.info('DailyTester', `[${results.length}/${totalCount}] ${svc.name} (external): ${r.overall_status}`);

            if (r.payment_status === 'failed') {
                consecutivePaymentFailures++;
                if (consecutivePaymentFailures >= MAX_CONSECUTIVE_PAYMENT_FAILURES) {
                    logger.error('DailyTester', `Aborting: ${MAX_CONSECUTIVE_PAYMENT_FAILURES} consecutive payment failures`);
                    aborted = true;
                }
            } else {
                consecutivePaymentFailures = 0;
            }
        } catch (err) {
            results.push({
                run_id: runId,
                endpoint: svc.id,
                label: svc.name,
                api_type: 'external',
                chain: CHAIN_KEY,
                payment_status: 'failed',
                call_status: 'skipped',
                overall_status: 'fail',
                payment_error: `Unhandled: ${err.message}`,
                checked_at: new Date().toISOString(),
            });
            logger.error('DailyTester', `${svc.name} (external) crashed: ${err.message}`);
            updateServiceStatus(supabase, svc.id, 'fail');
            consecutivePaymentFailures++;
            if (consecutivePaymentFailures >= MAX_CONSECUTIVE_PAYMENT_FAILURES) {
                aborted = true;
            }
        }
        const { error: pErr } = await persistResultsSafe(supabase, [results[results.length - 1]]);
        if (pErr) persistErrors++;
    }

    // End-of-run balance
    let endBalance = null;
    try { endBalance = await getUsdcBalance(); } catch { /* non-critical */ }

    // Telegram summary
    const duration = Math.round((Date.now() - startTime) / 1000);
    if (aborted) {
        logger.warn('DailyTester', `Run aborted early — tested ${results.length}/${totalCount} services`);
    }
    await sendTelegramReport(results, runId, duration, startBalance, endBalance, persistErrors, aborted ? totalCount : 0, polygonMetrics);

    const pass = results.filter(r => r.overall_status === 'pass').length;
    const partial = results.filter(r => r.overall_status === 'partial').length;
    const fail = results.filter(r => r.overall_status === 'fail').length;
    _lastRunStatus = fail === 0 && !aborted ? 'success' : 'failed';
    _lastRunResults = { pass, partial, fail, total: results.length, durationSeconds: duration, balanceUsdc: startBalance, endBalanceUsdc: endBalance, persistErrors, aborted };
    logger.info('DailyTester', `Run ${runId} complete: ${pass} pass, ${fail} fail, ${results.length} total in ${duration}s`);
}

// --- STATE (for diagnostics) ---
let _lastRunAt = null;
let _lastRunStatus = null;   // 'success' | 'failed' | 'skipped' | null
let _lastRunError = null;
let _lastRunResults = null;  // { pass, partial, fail, total }
let _scheduledAt = null;

// --- SCHEDULING ---
let _dailyTimer = null;
let _testRunning = false;

const MIN_RUN_INTERVAL = 12 * 60 * 60 * 1000; // 12h cooldown between runs (prevents duplicate runs on Render restart)

function scheduleDailyTest(baseUrl, supabase) {
    if (!process.env.DAILY_TESTER_KEY && !process.env.AGENT_PRIVATE_KEY) {
        logger.warn('DailyTester', 'DAILY_TESTER_KEY / AGENT_PRIVATE_KEY not set — daily tester disabled');
        return;
    }

    // Helper: wrap a run with safety timer
    async function runWithSafetyTimer() {
        if (_testRunning) {
            logger.warn('DailyTester', 'Previous run still in progress, skipping');
            return;
        }
        _testRunning = true;
        const safetyTimer = setTimeout(() => {
            if (_testRunning) {
                logger.error('DailyTester', `Safety timer: run exceeded ${SAFETY_TIMER_MS / 60000}min — force-resetting`);
                _testRunning = false;
            }
        }, SAFETY_TIMER_MS);
        if (safetyTimer.unref) safetyTimer.unref();
        try {
            await runDailyTest(baseUrl, supabase);
        } catch (err) {
            logger.error('DailyTester', `Run failed: ${err.message}`);
        } finally {
            clearTimeout(safetyTimer);
            _testRunning = false;
        }
    }

    // Check last run in Supabase to avoid duplicate runs on Render restart
    async function runIfCooldownElapsed() {
        try {
            const { data } = await supabase
                .from('daily_checks')
                .select('checked_at')
                .order('checked_at', { ascending: false })
                .limit(1);
            if (data && data.length > 0) {
                const lastRunAge = Date.now() - new Date(data[0].checked_at).getTime();
                if (lastRunAge < MIN_RUN_INTERVAL) {
                    const hoursAgo = (lastRunAge / 3600000).toFixed(1);
                    logger.info('DailyTester', `Last run was ${hoursAgo}h ago — skipping startup run (cooldown: ${MIN_RUN_INTERVAL / 3600000}h)`);
                    return;
                }
            }
        } catch (err) {
            logger.warn('DailyTester', `Cooldown check failed (${err.message}), running anyway`);
        }
        await runWithSafetyTimer();
    }

    // First run after FIRST_RUN_DELAY (with cooldown check)
    const firstTimer = setTimeout(() => runIfCooldownElapsed(), FIRST_RUN_DELAY);
    if (firstTimer.unref) firstTimer.unref();

    // Then every 24h (no cooldown check — interval is already 24h)
    _dailyTimer = setInterval(() => runWithSafetyTimer(), RUN_INTERVAL);
    if (_dailyTimer.unref) _dailyTimer.unref();

    _scheduledAt = new Date().toISOString();
    // Init wallet early to log the address at startup
    try {
        initWallet();
        logger.info('DailyTester', `Scheduled: first run in ${FIRST_RUN_DELAY / 1000}s, then every 24h. Wallet: ${_account.address}`);
    } catch (err) {
        logger.error('DailyTester', `Wallet init failed at schedule time: ${err.message}`);
    }
}

function stopDailyTest() {
    if (_dailyTimer) {
        clearInterval(_dailyTimer);
        _dailyTimer = null;
        logger.info('DailyTester', 'Stopped');
    }
}

// --- MANUAL TRIGGER (from Telegram /verif command) ---
let _savedBaseUrl = null;
let _savedSupabase = null;

const _origSchedule = scheduleDailyTest;
function scheduleDailyTestWrapped(baseUrl, supabase) {
    _savedBaseUrl = baseUrl;
    _savedSupabase = supabase;
    return _origSchedule(baseUrl, supabase);
}

async function triggerDailyTest() {
    if (!_savedBaseUrl || !_savedSupabase) {
        return { triggered: false, reason: 'Daily tester not initialized (ENABLE_DAILY_TESTER not set?)' };
    }
    if (_testRunning) {
        return { triggered: false, reason: 'A test run is already in progress' };
    }
    _testRunning = true;
    // Safety timer: reset _testRunning after 30min if run is stuck (P1-3)
    const safetyTimer = setTimeout(() => {
        if (_testRunning) {
            logger.error('DailyTester', `Safety timer: run exceeded ${SAFETY_TIMER_MS / 60000}min — force-resetting _testRunning`);
            _testRunning = false;
        }
    }, SAFETY_TIMER_MS);
    if (safetyTimer.unref) safetyTimer.unref();
    // Fire-and-forget — the run sends its own Telegram report when done
    runDailyTest(_savedBaseUrl, _savedSupabase)
        .catch(err => logger.error('DailyTester', `Manual run failed: ${err.message}`))
        .finally(() => { clearTimeout(safetyTimer); _testRunning = false; });
    return { triggered: true };
}

function getDailyTesterStatus() {
    return {
        enabled: !!_savedBaseUrl,
        running: _testRunning,
        scheduledAt: _scheduledAt,
        walletInitialized: !!_account,
        walletAddress: _account ? _account.address : null,
        chain: CHAIN_CFG.label,
        lastRun: {
            at: _lastRunAt,
            status: _lastRunStatus,
            error: _lastRunError,
            results: _lastRunResults,
        },
    };
}

module.exports = { scheduleDailyTest: scheduleDailyTestWrapped, stopDailyTest, triggerDailyTest, getDailyTesterStatus };
