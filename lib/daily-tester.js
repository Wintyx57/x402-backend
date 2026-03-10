// lib/daily-tester.js — Daily E2E API Testing Agent
// Tests ALL services (internal + external) with real USDC payments on SKALE.
// Auto-discovers services from Supabase — new registrations tested automatically.
// Results persisted to `daily_checks` table + Telegram summary.

'use strict';

const crypto = require('crypto');
const { createPublicClient, createWalletClient, http, parseAbi } = require('viem');
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
const TX_TIMEOUT = 60_000;  // 60s max wait for tx receipt
const API_TIMEOUT = 30_000; // 30s max wait per API call
const FIRST_RUN_DELAY = 2 * 60 * 1000; // 2 minutes after startup
const RUN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MIN_BALANCE = 0.20;   // Skip run if USDC balance < 0.20

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// --- Default test values by param name (heuristic) ---
const PARAM_DEFAULTS = {
    // Text & content
    text: 'Hello world from x402 daily tester',
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
    password: 'MyP@ssw0rd!2024',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    cron: '*/5 * * * *',

    // Web & network
    url: 'https://example.com',
    domain: 'google.com',
    user: 'github',
    ip: '8.8.8.8',
    status_code: '404',

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
    repo: 'facebook/react',
    word: 'serendipity',
    prompt: 'A serene mountain landscape at sunset',

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
};

// --- WALLET (lazy init) ---
let _account = null;
let _publicClient = null;
let _walletClient = null;

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
    _publicClient = createPublicClient({ chain: viemChain, transport: http(CHAIN_CFG.rpcUrl) });
    _walletClient = createWalletClient({ account: _account, chain: viemChain, transport: http(CHAIN_CFG.rpcUrl) });

    logger.info('DailyTester', `Wallet initialized: ${_account.address.slice(0, 10)}... on ${CHAIN_CFG.label}`);
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
async function sendUsdcPayment(toAddress, amountRaw) {
    const start = Date.now();
    try {
        const txHash = await _walletClient.writeContract({
            address: CHAIN_CFG.usdcContract,
            abi: USDC_ABI,
            functionName: 'transfer',
            args: [toAddress, BigInt(amountRaw)],
        });

        // SKALE has instant finality — 1 confirmation suffices
        const receipt = await _publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: TX_TIMEOUT,
        });

        const success = receipt.status === 'success' || receipt.status === 1 || receipt.status === '0x1';
        return {
            success,
            txHash,
            latencyMs: Date.now() - start,
            error: success ? null : 'Transaction reverted',
        };
    } catch (err) {
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
async function discoverServices(supabase) {
    const { data, error } = await supabase
        .from('services')
        .select('id, name, url, price_usdc, owner_address, required_parameters');

    if (error) throw new Error(`Failed to load services: ${error.message}`);
    if (!data || data.length === 0) return { internal: [], external: [] };

    const platformWallet = (process.env.WALLET_ADDRESS || '').toLowerCase();
    const internal = [];
    const external = [];

    for (const svc of data) {
        const owner = (svc.owner_address || '').toLowerCase();
        if (!owner || owner === platformWallet) {
            internal.push(svc);
        } else {
            external.push(svc);
        }
    }

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

    // Step 1: Initial request to get 402 + extensions
    const initialUrl = `${baseUrl}${endpointPath}`;
    let paymentDetails, extensions, testConfig;

    try {
        const res402 = await fetchWithTimeout(initialUrl, { method: 'GET' }, 15000);

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
    } catch (err) {
        result.payment_error = `402 fetch failed: ${err.message}`;
        return result;
    }

    // Step 2: If POST endpoint, redo the initial request with POST to confirm 402
    if (testConfig.method === 'POST') {
        try {
            const res402Post = await fetchWithTimeout(initialUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testConfig.params),
            }, 15000);

            if (res402Post.status === 402) {
                const body402 = await res402Post.json();
                paymentDetails = body402.payment_details;
            }
        } catch {
            // If POST 402 fails, continue with GET 402 payment details
        }
    }

    if (!paymentDetails || !paymentDetails.recipient) {
        result.payment_error = 'No payment_details in 402 response';
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

    // Step 4: Retry with payment proof
    const callStart = Date.now();
    try {
        const headers = {
            'X-Payment-TxHash': payment.txHash,
            'X-Payment-Chain': CHAIN_KEY,
            'X-Agent-Wallet': _account.address,
        };

        let callUrl, callOptions;
        if (testConfig.method === 'POST') {
            headers['Content-Type'] = 'application/json';
            callUrl = initialUrl;
            callOptions = { method: 'POST', headers, body: JSON.stringify(testConfig.params) };
        } else {
            callUrl = buildUrl(baseUrl, endpointPath, testConfig.params);
            callOptions = { method: 'GET', headers };
        }

        const res = await fetchWithTimeout(callUrl, callOptions, API_TIMEOUT);
        result.call_latency_ms = Date.now() - callStart;
        result.http_status = res.status;
        result.call_status = res.ok ? 'success' : 'failed';

        if (res.ok) {
            const body = await res.json().catch(() => null);
            const validation = validateResponse(body, testConfig.expectedFields);
            result.response_valid = validation.valid;
            result.response_has_json = validation.hasJson;
            result.response_fields_present = validation.present;
            result.response_fields_missing = validation.missing;
            result.validation_notes = validation.notes;
            result.overall_status = validation.valid ? 'pass' : 'partial';
        } else {
            result.call_error = `HTTP ${res.status}`;
            // Try to get error body
            const errBody = await res.text().catch(() => '');
            if (errBody) result.call_error += `: ${errBody.slice(0, 200)}`;
        }
    } catch (err) {
        result.call_latency_ms = Date.now() - callStart;
        result.call_error = err.message;
        result.call_status = 'failed';
    }

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
                return await completeExternalTest(result, proxyUrl, details, testParams);
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

        return await completeExternalTest(result, proxyUrl, details, testParams);
    } catch (err) {
        result.payment_error = err.message;
    }

    return result;
}

// --- COMPLETE EXTERNAL TEST (payment + call) ---
async function completeExternalTest(result, proxyUrl, paymentDetails, testParams) {
    // Send USDC payment
    const amountRaw = Math.round(paymentDetails.amount * 1e6);
    const payment = await sendUsdcPayment(paymentDetails.recipient, amountRaw);

    result.payment_status = payment.success ? 'success' : 'failed';
    result.payment_tx_hash = payment.txHash;
    result.payment_amount_usdc = paymentDetails.amount;
    result.payment_latency_ms = payment.latencyMs;
    result.payment_error = payment.error;

    if (!payment.success) return result;

    // Retry with payment proof
    const callStart = Date.now();
    try {
        const res = await fetchWithTimeout(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Payment-TxHash': payment.txHash,
                'X-Payment-Chain': CHAIN_KEY,
                'X-Agent-Wallet': _account.address,
            },
            body: JSON.stringify(testParams),
        }, API_TIMEOUT);

        result.call_latency_ms = Date.now() - callStart;
        result.http_status = res.status;
        result.call_status = res.ok ? 'success' : 'failed';

        if (res.ok) {
            const body = await res.json().catch(() => null);
            result.response_valid = body !== null;
            result.response_has_json = body !== null;
            result.overall_status = body !== null ? 'pass' : 'partial';
        } else {
            result.call_error = `HTTP ${res.status}`;
            const errBody = await res.text().catch(() => '');
            if (errBody) result.call_error += `: ${errBody.slice(0, 200)}`;
        }
    } catch (err) {
        result.call_latency_ms = Date.now() - callStart;
        result.call_error = err.message;
        result.call_status = 'failed';
    }

    return result;
}

// --- PERSIST RESULTS TO SUPABASE ---
async function persistResults(supabase, results) {
    if (!results || results.length === 0) return;

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
}

// --- TELEGRAM REPORT ---
async function sendTelegramReport(results, runId, durationSeconds, startBalance) {
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
        `*Balance:* ${startBalance.toFixed(4)} USDC`,
        `*Paid:* ${totalPaid.toFixed(4)} USDC`,
        ``,
        `\u2705 *Pass:* ${pass}/${total}`,
    ];

    if (partial > 0) lines.push(`\u26A0\uFE0F *Partial:* ${partial}/${total}`);
    if (fail > 0) lines.push(`\uD83D\uDD34 *Fail:* ${fail}/${total}`);

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

    // Discover services
    let services;
    try {
        services = await discoverServices(supabase);
    } catch (err) {
        logger.error('DailyTester', `Service discovery failed: ${err.message}`);
        await notifyAdmin(`\uD83D\uDD34 *Daily Tester Failed*\n\nCannot load services: ${escapeMarkdown(err.message)}`).catch(() => {});
        return;
    }

    const totalCount = services.internal.length + services.external.length;
    logger.info('DailyTester', `Discovered ${services.internal.length} internal + ${services.external.length} external = ${totalCount} services`);

    const results = [];

    // Test internal APIs in batches
    for (let i = 0; i < services.internal.length; i += BATCH_SIZE) {
        const batch = services.internal.slice(i, i + BATCH_SIZE);

        for (const svc of batch) {
            try {
                const r = await testInternalEndpoint(baseUrl, svc, supabase, runId);
                results.push(r);
                logger.info('DailyTester', `[${results.length}/${totalCount}] ${svc.name}: ${r.overall_status}`);
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
            }
        }

        // Persist batch immediately
        await persistResults(supabase, results.slice(-batch.length));

        // Delay between batches
        if (i + BATCH_SIZE < services.internal.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    // Test external APIs via proxy
    for (const svc of services.external) {
        try {
            const r = await testExternalService(baseUrl, svc, supabase, runId);
            results.push(r);
            logger.info('DailyTester', `[${results.length}/${totalCount}] ${svc.name} (external): ${r.overall_status}`);
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
        }
        await persistResults(supabase, [results[results.length - 1]]);
    }

    // Telegram summary
    const duration = Math.round((Date.now() - startTime) / 1000);
    await sendTelegramReport(results, runId, duration, startBalance);

    const pass = results.filter(r => r.overall_status === 'pass').length;
    const partial = results.filter(r => r.overall_status === 'partial').length;
    const fail = results.filter(r => r.overall_status === 'fail').length;
    _lastRunStatus = fail === 0 ? 'success' : 'failed';
    _lastRunResults = { pass, partial, fail, total: results.length, durationSeconds: duration, balanceUsdc: startBalance };
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

function scheduleDailyTest(baseUrl, supabase) {
    if (!process.env.DAILY_TESTER_KEY && !process.env.AGENT_PRIVATE_KEY) {
        logger.warn('DailyTester', 'DAILY_TESTER_KEY / AGENT_PRIVATE_KEY not set — daily tester disabled');
        return;
    }

    // First run after FIRST_RUN_DELAY
    const firstTimer = setTimeout(async () => {
        if (_testRunning) return;
        _testRunning = true;
        try {
            await runDailyTest(baseUrl, supabase);
        } catch (err) {
            logger.error('DailyTester', `Run failed: ${err.message}`);
        } finally {
            _testRunning = false;
        }
    }, FIRST_RUN_DELAY);
    if (firstTimer.unref) firstTimer.unref();

    // Then every 24h
    _dailyTimer = setInterval(async () => {
        if (_testRunning) {
            logger.warn('DailyTester', 'Previous run still in progress, skipping');
            return;
        }
        _testRunning = true;
        try {
            await runDailyTest(baseUrl, supabase);
        } catch (err) {
            logger.error('DailyTester', `Run failed: ${err.message}`);
        } finally {
            _testRunning = false;
        }
    }, RUN_INTERVAL);
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
    // Fire-and-forget — the run sends its own Telegram report when done
    runDailyTest(_savedBaseUrl, _savedSupabase)
        .catch(err => logger.error('DailyTester', `Manual run failed: ${err.message}`))
        .finally(() => { _testRunning = false; });
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
