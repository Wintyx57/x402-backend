// lib/ai-quality-agent.js — AI Quality Audit Agent
// Semantic quality evaluation using Gemini, complementary to the daily tester.
// Runs 2x/day (06h + 18h UTC), samples 15 APIs per run, scores 5 dimensions.

'use strict';

const crypto = require('crypto');
const { createPublicClient, createWalletClient, http, fallback, parseAbi } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const logger = require('./logger');
const { CHAINS } = require('./chains');
const { notifyAdmin, escapeMarkdown } = require('./telegram-bot');
const { fetchWithTimeout } = require('./payment');
const { openaiRetry } = require('./openai-retry');
const {
    discoverServices, PARAM_DEFAULTS, ENDPOINT_OVERRIDES,
    inferParamValue, generateParamsFromSchema,
} = require('./daily-tester');

// --- CONFIGURATION ---
const CHAIN_KEY = 'skale';
const CHAIN_CFG = CHAINS[CHAIN_KEY];
const RUN_TIMES_UTC = [6, 18]; // 2h offset from live-agent [8, 20]
const MIN_RUN_INTERVAL = 8 * 60 * 60 * 1000; // 8h cooldown
const WARMUP_DELAY = 5 * 60 * 1000; // 5min after startup
const SAMPLE_SIZE = 15;
const MIN_BALANCE = 0.10; // Skip if < 0.10 USDC
const MAX_PRICE_PER_SERVICE = 0.10; // Cap per individual test
const TX_TIMEOUT = 15_000;
const API_TIMEOUT = 30_000;
const MAX_RESPONSE_SIZE = 500_000; // 500KB for Gemini input truncation
const GEMINI_TIMEOUT = 15_000;

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// Severity thresholds
const SEVERITY_THRESHOLDS = [
    { min: 80, label: 'good', emoji: '\u2705' },
    { min: 50, label: 'acceptable', emoji: '\u26A0\uFE0F' },
    { min: 25, label: 'concerning', emoji: '\uD83D\uDFE0' },
    { min: 0, label: 'critical', emoji: '\uD83D\uDD34' },
];

function getSeverity(score) {
    for (const t of SEVERITY_THRESHOLDS) {
        if (score >= t.min) return t;
    }
    return SEVERITY_THRESHOLDS[SEVERITY_THRESHOLDS.length - 1];
}

// --- STATE ---
let _account = null;
let _publicClient = null;
let _walletClient = null;
let _nonce = null;
let _lastRunAt = 0;
let _timer = null;
let _supabase = null;
let _baseUrl = null;
let _getGemini = null;
let _lastRunStatus = null;
let _lastRunError = null;
let _running = false;

// --- WALLET (same pattern as live-agent.js) ---
function initWallet() {
    const pk = process.env.AGENT_PRIVATE_KEY;
    if (!pk) throw new Error('AGENT_PRIVATE_KEY not set');

    const viemChain = {
        id: CHAIN_CFG.chainId,
        name: CHAIN_CFG.label,
        nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
        rpcUrls: { default: { http: CHAIN_CFG.rpcUrls } },
    };

    _account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
    const transport = CHAIN_CFG.rpcUrls.length > 1
        ? fallback(CHAIN_CFG.rpcUrls.map(u => http(u)))
        : http(CHAIN_CFG.rpcUrl);
    _publicClient = createPublicClient({ chain: viemChain, transport });
    _walletClient = createWalletClient({ account: _account, chain: viemChain, transport });
    logger.info('QualityAgent', `Wallet: ${_account.address.slice(0, 10)}... on ${CHAIN_CFG.label}`);
}

async function initNonce() {
    _nonce = await _publicClient.getTransactionCount({ address: _account.address });
}

async function getUsdcBalance() {
    const raw = await _publicClient.readContract({
        address: CHAIN_CFG.usdcContract,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [_account.address],
    });
    return Number(raw) / (10 ** (CHAIN_CFG.usdcDecimals ?? 6));
}

async function sendUsdcPayment(toAddress, amountRaw) {
    const start = Date.now();
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

        const receipt = await _publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: TX_TIMEOUT,
        });
        const success = receipt.status === 'success' || receipt.status === 1 || receipt.status === '0x1';
        return { success, txHash, latencyMs: Date.now() - start, error: success ? null : 'reverted' };
    } catch (err) {
        if (_nonce !== null && !err.message?.includes('already known') && !err.message?.includes('nonce too low')) {
            _nonce--;
        }
        return { success: false, txHash: null, latencyMs: Date.now() - start, error: err.message };
    }
}

// --- SAMPLE SELECTION (priority-based) ---
async function selectSample(supabase, baseUrl) {
    const { internal } = await discoverServices(supabase, baseUrl);
    if (internal.length === 0) return [];

    // Filter: only services with price <= MAX_PRICE_PER_SERVICE and valid /api/ path
    const candidates = internal.filter(svc => {
        const price = Number(svc.price_usdc) || 0;
        if (price <= 0 || price > MAX_PRICE_PER_SERVICE) return false;
        try {
            const path = new URL(svc.url).pathname;
            return /^\/api\//.test(path);
        } catch { return false; }
    });

    if (candidates.length === 0) return [];

    // Get last audit dates for priority scoring
    let lastAudits = {};
    try {
        const { data } = await supabase
            .from('quality_audits')
            .select('service_id, overall_score, checked_at')
            .order('checked_at', { ascending: false });
        if (data) {
            for (const row of data) {
                if (!lastAudits[row.service_id]) {
                    lastAudits[row.service_id] = row;
                }
            }
        }
    } catch (err) {
        logger.warn('QualityAgent', `Failed to load audit history: ${err.message}`);
    }

    // Get service statuses
    let serviceStatuses = {};
    try {
        const { data } = await supabase
            .from('services')
            .select('id, status')
            .in('id', candidates.map(c => c.id));
        if (data) {
            for (const row of data) {
                serviceStatuses[row.id] = row.status;
            }
        }
    } catch (err) {
        logger.warn('QualityAgent', `Failed to load service statuses: ${err.message}`);
    }

    const now = Date.now();
    const scored = candidates.map(svc => {
        let priority = 0;
        const lastAudit = lastAudits[svc.id];

        if (!lastAudit) {
            // Never audited — max priority
            priority += 100;
        } else {
            const daysSince = (now - new Date(lastAudit.checked_at).getTime()) / (86400 * 1000);
            priority += daysSince * 10;
            if (lastAudit.overall_score !== null && lastAudit.overall_score < 50) {
                priority += 30; // Re-check problematic APIs
            }
        }

        const status = serviceStatuses[svc.id];
        if (status === 'degraded' || status === 'partial') {
            priority += 20;
        }

        // Jitter for diversity
        priority += Math.random() * 5;

        return { ...svc, _priority: priority };
    });

    scored.sort((a, b) => b._priority - a._priority);
    return scored.slice(0, SAMPLE_SIZE);
}

// --- CALL API WITH PAYMENT ---
async function callApiWithPayment(service, baseUrl) {
    const start = Date.now();
    const result = {
        data: null, tx_hash: null, cost: 0,
        latency_ms: 0, http_status: null, error: null, test_params: {},
    };

    try {
        const svcUrl = new URL(service.url);
        const endpointPath = svcUrl.pathname;
        const price = Number(service.price_usdc) || 0;

        // Generate test params (same logic as daily-tester)
        let testParams = {};
        if (service.required_parameters) {
            testParams = generateParamsFromSchema(service.required_parameters);
        }
        Object.assign(testParams, ENDPOINT_OVERRIDES[endpointPath] || {});
        result.test_params = testParams;

        // Build URL with query params
        const callUrl = new URL(endpointPath, baseUrl);
        for (const [k, v] of Object.entries(testParams)) {
            callUrl.searchParams.set(k, v);
        }

        // Step 1: GET → expect 402
        const firstRes = await fetchWithTimeout(callUrl.toString(), {}, API_TIMEOUT);
        if (firstRes.status === 200) {
            // Free endpoint
            const body = await firstRes.text().catch(() => '');
            try { result.data = JSON.parse(body); } catch { result.data = body; }
            result.http_status = 200;
            result.latency_ms = Date.now() - start;
            return result;
        }

        if (firstRes.status !== 402) {
            result.http_status = firstRes.status;
            result.error = `Expected 402, got ${firstRes.status}`;
            result.latency_ms = Date.now() - start;
            return result;
        }

        // Step 2: Parse 402 for payment details
        const body402 = await firstRes.json().catch(() => ({}));
        const details = body402.payment_details || body402;
        const recipient = details.recipient || details.pay_to || process.env.WALLET_ADDRESS;
        const amountRaw = Math.round(price * (10 ** (CHAIN_CFG.usdcDecimals ?? 6)));

        // Step 3: Send USDC payment
        const payResult = await sendUsdcPayment(recipient, amountRaw);
        if (!payResult.success) {
            result.error = `Payment failed: ${payResult.error}`;
            result.latency_ms = Date.now() - start;
            return result;
        }
        result.tx_hash = payResult.txHash;
        result.cost = price;

        // Step 4: Call with tx hash
        const paidRes = await fetchWithTimeout(callUrl.toString(), {
            headers: {
                'X-Payment-TxHash': payResult.txHash,
                'X-Payment-Chain': CHAIN_KEY,
            },
        }, API_TIMEOUT);

        result.http_status = paidRes.status;

        const paidBody = await paidRes.text().catch(() => '');
        try { result.data = JSON.parse(paidBody); } catch { result.data = paidBody; }

        if (!paidRes.ok) {
            result.error = `Paid call returned ${paidRes.status}`;
        }
    } catch (err) {
        result.error = err.message?.slice(0, 200);
    }

    result.latency_ms = Date.now() - start;
    return result;
}

// --- GEMINI EVALUATION ---
const GEMINI_SYSTEM = `You are an API response quality auditor. Evaluate the response on 5 dimensions (0-100 each):
1. SEMANTIC_CORRECTNESS: Does the data make logical sense? Plausible values?
2. DATA_FRESHNESS: Is the data current, not stale? (If freshness is not applicable, score 80)
3. LOCALE_ACCURACY: Correct units, formats, localizations?
4. CONTENT_QUALITY: Useful, complete, not placeholder/truncated?
5. SCHEMA_COMPLIANCE: Matches expected output schema?

Respond ONLY with JSON:
{"overall_score":0-100,"dimensions":{"semantic_correctness":0-100,"data_freshness":0-100,"locale_accuracy":0-100,"content_quality":0-100,"schema_compliance":0-100},"issues":["..."],"summary":"1-2 sentences","severity":"good|acceptable|concerning|critical"}`;

async function evaluateWithGemini(service, responseData, testParams) {
    if (!_getGemini) {
        logger.warn('QualityAgent', 'Gemini not available (_getGemini is null)');
        return { _error: 'gemini_not_configured' };
    }

    try {
        const gemini = _getGemini();
        const model = gemini.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: GEMINI_SYSTEM,
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                maxOutputTokens: 300,
            },
        });

        // Truncate response for Gemini input
        const responseStr = typeof responseData === 'string'
            ? responseData.slice(0, 2000)
            : JSON.stringify(responseData).slice(0, 2000);

        const userContent = [
            `Service: ${service.name}`,
            service.description ? `Description: ${service.description}` : '',
            `Test params: ${JSON.stringify(testParams)}`,
            `Response:\n${responseStr}`,
        ].filter(Boolean).join('\n');

        const result = await openaiRetry(
            () => model.generateContent(userContent),
            'QualityAudit'
        );

        let text = '';
        try {
            text = result.response.text();
        } catch (textErr) {
            logger.warn('QualityAgent', `response.text() failed for ${service.name}: ${textErr.message}`);
            return { _error: `text_extract: ${textErr.message?.slice(0, 100)}` };
        }

        // Extract JSON from response (Gemini sometimes wraps in markdown or text)
        let jsonStr = text.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        if (!jsonStr.startsWith('{')) {
            const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (braceMatch) jsonStr = braceMatch[0];
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
            logger.warn('QualityAgent', `JSON parse failed for ${service.name}: raw=${text.slice(0, 150)}`);
            return { _error: `${parseErr.message?.slice(0, 50)} | raw: ${text.slice(0, 100)}` };
        }

        // Validate structure
        if (typeof parsed.overall_score !== 'number' || !parsed.dimensions) {
            logger.warn('QualityAgent', `Invalid Gemini structure for ${service.name}: ${jsonStr.slice(0, 200)}`);
            return { _error: `invalid_structure: ${jsonStr.slice(0, 100)}` };
        }

        return parsed;
    } catch (err) {
        logger.error('QualityAgent', `Gemini eval failed for ${service.name}: ${err.stack || err.message}`);
        return { _error: err.message?.slice(0, 200) };
    }
}

// --- MAIN RUN ---
async function runQualityAuditOnce() {
    const now = Date.now();
    if (now - _lastRunAt < MIN_RUN_INTERVAL) {
        logger.info('QualityAgent', 'Skipped: cooldown not elapsed');
        return { skipped: true, reason: 'cooldown' };
    }
    if (_running) {
        logger.info('QualityAgent', 'Skipped: already running');
        return { skipped: true, reason: 'already_running' };
    }

    _running = true;
    _lastRunAt = now;
    const runId = crypto.randomUUID();
    const runStart = Date.now();
    logger.info('QualityAgent', `=== Starting AI Quality Audit run ${runId.slice(0, 8)} ===`);

    try {
        if (!_account) initWallet();
        await initNonce();

        const balance = await getUsdcBalance();
        logger.info('QualityAgent', `USDC balance: ${balance.toFixed(6)}`);

        if (balance < MIN_BALANCE) {
            logger.warn('QualityAgent', `Balance too low (${balance} < ${MIN_BALANCE}), skipping`);
            _lastRunStatus = 'skipped';
            _lastRunError = 'low_balance';
            _running = false;
            return { skipped: true, reason: 'low_balance', balance };
        }

        // Select sample
        const sample = await selectSample(_supabase, _baseUrl);
        if (sample.length === 0) {
            logger.warn('QualityAgent', 'No eligible services found');
            _lastRunStatus = 'skipped';
            _lastRunError = 'no_services';
            _running = false;
            return { skipped: true, reason: 'no_services' };
        }

        logger.info('QualityAgent', `Selected ${sample.length} APIs for audit`);

        const results = [];
        let totalSpent = 0;

        // Process sequentially (nonce ordering) with delay between calls
        for (let i = 0; i < sample.length; i++) {
            const service = sample[i];
            if (i > 0) await new Promise(r => setTimeout(r, 2000)); // 2s between calls
            logger.info('QualityAgent', `Testing ${service.name} (${i + 1}/${sample.length})...`);
            const callResult = await callApiWithPayment(service, _baseUrl);
            totalSpent += callResult.cost;

            // Evaluate with Gemini (only if we got data)
            let evaluation = null;
            let geminiError = null;
            if (callResult.data && !callResult.error) {
                evaluation = await evaluateWithGemini(service, callResult.data, callResult.test_params);
                if (evaluation?._error) {
                    geminiError = evaluation._error;
                    evaluation = null;
                }
            }

            const row = {
                run_id: runId,
                service_id: service.id,
                service_name: service.name,
                service_url: service.url,
                chain: CHAIN_KEY,
                payment_tx_hash: callResult.tx_hash,
                payment_amount_usdc: callResult.cost,
                http_status: callResult.http_status,
                response_latency_ms: callResult.latency_ms,
                test_params: callResult.test_params,
                overall_score: evaluation?.overall_score ?? null,
                semantic_correctness: evaluation?.dimensions?.semantic_correctness ?? null,
                data_freshness: evaluation?.dimensions?.data_freshness ?? null,
                locale_accuracy: evaluation?.dimensions?.locale_accuracy ?? null,
                content_quality: evaluation?.dimensions?.content_quality ?? null,
                schema_compliance: evaluation?.dimensions?.schema_compliance ?? null,
                severity: evaluation?.severity ?? null,
                issues: evaluation?.issues ?? [],
                gemini_summary: evaluation?.summary ?? null,
                gemini_raw: evaluation,
                error: callResult.error || (geminiError ? `gemini: ${geminiError}` : null),
            };

            // Insert into Supabase
            const { error: dbError } = await _supabase
                .from('quality_audits')
                .insert([row]);

            if (dbError) {
                logger.warn('QualityAgent', `DB insert failed for ${service.name}: ${dbError.message}`);
            }

            results.push(row);

            const scoreStr = evaluation ? `score=${evaluation.overall_score}` : 'no-eval';
            if (callResult.error) {
                logger.warn('QualityAgent', `${service.name}: ERROR — ${callResult.error}`);
            } else {
                logger.info('QualityAgent', `${service.name}: ${scoreStr} (${callResult.latency_ms}ms)`);
            }
        }

        const duration = Date.now() - runStart;
        _lastRunStatus = 'success';
        _lastRunError = null;

        // Send Telegram report
        const scoredCount = results.filter(r => r.overall_score !== null).length;
        const errCount = results.filter(r => r.error).length;
        sendQualityReport(results, runId, duration, totalSpent, balance).catch(err => {
            logger.error('QualityAgent', `Telegram report failed: ${err.stack || err.message}`);
            // Fallback: send minimal plain text
            notifyAdmin(`AI Quality Audit done: ${results.length} APIs, ${scoredCount} scored, ${errCount} errors, spent=${totalSpent.toFixed(4)} USDC`).catch(() => {});
        });

        logger.info('QualityAgent', `=== Audit complete: ${results.length} APIs, ${totalSpent.toFixed(4)} USDC, ${Math.round(duration / 1000)}s ===`);
        _running = false;
        return { status: 'success', runId, count: results.length, totalSpent, duration };
    } catch (err) {
        logger.error('QualityAgent', `Run failed: ${err.stack || err.message}`);
        _lastRunStatus = 'failed';
        _lastRunError = err.message;
        _running = false;
        return { status: 'failed', error: err.message };
    }
}

// --- TELEGRAM REPORT ---
async function sendQualityReport(results, runId, durationMs, totalSpent, balance) {
    const scored = results.filter(r => r.overall_score !== null);
    const errors = results.filter(r => r.error && r.overall_score === null);

    const counts = { good: 0, acceptable: 0, concerning: 0, critical: 0 };
    for (const r of scored) {
        const sev = getSeverity(r.overall_score);
        counts[sev.label]++;
    }

    const avgScore = scored.length > 0
        ? Math.round(scored.reduce((s, r) => s + r.overall_score, 0) / scored.length)
        : 0;

    const durationStr = durationMs < 60000
        ? `${Math.round(durationMs / 1000)}s`
        : `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`;

    // Coverage: count unique services audited in last 7 days
    let coverage = 0;
    try {
        const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
        const { data } = await _supabase
            .from('quality_audits')
            .select('service_id')
            .gte('checked_at', since);
        if (data) {
            coverage = new Set(data.map(d => d.service_id)).size;
        }
    } catch { /* ignore */ }

    const lines = [
        `\uD83E\uDD16 *AI Quality Audit Report*`,
        '',
        `*Run:* \`${runId.slice(0, 8)}\`  |  *Duration:* ${durationStr}`,
        `*Chain:* ${CHAIN_CFG.label}  |  *Spent:* ${totalSpent.toFixed(4)} USDC`,
        `*APIs tested:* ${results.length}`,
        '',
        `\uD83D\uDCCA *Scores:*`,
        `\u2705 Good (80+): ${counts.good}`,
        `\u26A0\uFE0F Acceptable (50-79): ${counts.acceptable}`,
        `\uD83D\uDFE0 Concerning (25-49): ${counts.concerning}`,
        `\uD83D\uDD34 Critical (<25): ${counts.critical}`,
    ];

    if (errors.length > 0) {
        lines.push(`\u274C Errors: ${errors.length}`);
    }
    if (scored.length > 0) {
        lines.push(`*Average:* ${avgScore}/100`);
    }

    // Show issues (concerning + critical)
    const issues = scored
        .filter(r => r.overall_score < 50)
        .sort((a, b) => a.overall_score - b.overall_score);

    if (issues.length > 0) {
        lines.push('');
        lines.push(`\uD83D\uDD0D *Issues:*`);
        for (const r of issues.slice(0, 5)) {
            const sev = getSeverity(r.overall_score);
            const issueText = r.issues && r.issues.length > 0 ? r.issues[0] : (r.gemini_summary || 'Low quality');
            lines.push(`${sev.emoji} ${escapeMarkdown(r.service_name)} \u2014 ${escapeMarkdown(String(issueText).slice(0, 60))}, score=${r.overall_score}`);
        }
    }

    if (coverage > 0) {
        lines.push('');
        lines.push(`\uD83D\uDCC8 *Coverage:* ${coverage} APIs audited in last 7 days`);
    }

    await notifyAdmin(lines.join('\n'));
}

// --- SCHEDULER (same pattern as live-agent.js) ---
function getNextRunTime(now, runTimesUtc) {
    const d = new Date(now);
    const candidates = [];

    for (const hour of runTimesUtc) {
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0));
        if (t.getTime() > now + 60_000) {
            candidates.push(t);
        }
    }

    if (candidates.length === 0) {
        const tomorrow = new Date(d);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const minHour = Math.min(...runTimesUtc);
        candidates.push(new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), minHour, 0, 0)));
    }

    return candidates[0];
}

function scheduleNextRun() {
    const now = Date.now();
    const nextRun = getNextRunTime(now, RUN_TIMES_UTC);
    const delay = nextRun.getTime() - now;
    const nextStr = nextRun.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    logger.info('QualityAgent', `Next audit scheduled: ${nextStr} (in ${Math.round(delay / 60000)}min)`);

    _timer = setTimeout(async () => {
        await runQualityAuditOnce();
        scheduleNextRun();
    }, delay);
    _timer.unref();
}

function startQualityAudit(baseUrl, supabase, getGemini) {
    if (!process.env.AGENT_PRIVATE_KEY) {
        logger.warn('QualityAgent', 'AGENT_PRIVATE_KEY not set — quality audit disabled');
        return;
    }
    if (!getGemini) {
        logger.warn('QualityAgent', 'Gemini not available — quality audit disabled');
        return;
    }

    _supabase = supabase;
    _baseUrl = baseUrl;
    _getGemini = getGemini;
    logger.info('QualityAgent', 'AI Quality Audit Agent starting...');

    // First run after warmup, then schedule
    _timer = setTimeout(async () => {
        await runQualityAuditOnce();
        scheduleNextRun();
    }, WARMUP_DELAY);
    _timer.unref();
}

function stopQualityAudit() {
    if (_timer) {
        clearTimeout(_timer);
        _timer = null;
    }
    _running = false;
    logger.info('QualityAgent', 'Stopped');
}

function getQualityAuditStatus() {
    return {
        enabled: !!_supabase && !!_getGemini,
        running: _running,
        walletInitialized: !!_account,
        walletAddress: _account ? _account.address : null,
        chain: CHAIN_CFG.label,
        lastRun: {
            at: _lastRunAt || null,
            status: _lastRunStatus,
            error: _lastRunError,
        },
        schedule: RUN_TIMES_UTC.map(h => `${String(h).padStart(2, '0')}:00 UTC`),
    };
}

module.exports = { startQualityAudit, stopQualityAudit, runQualityAuditOnce, getQualityAuditStatus };
