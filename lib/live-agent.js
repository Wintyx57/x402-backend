// lib/live-agent.js — Live AI Agent: 2x/day autonomous API consumer with real USDC payments
// Calls 3 space APIs (NASA APOD, ISS Tracker, SpaceX) and stores results + tx hashes.
// Demonstrates the x402 protocol: an AI agent paying for APIs without human intervention.

'use strict';

const { createPublicClient, createWalletClient, http, fallback, parseAbi } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const logger = require('./logger');
const { CHAINS } = require('./chains');
const { notifyAdmin, escapeMarkdown } = require('./telegram-bot');
const { fetchWithTimeout } = require('./payment');

// --- CONFIGURATION ---
const CHAIN_KEY = 'skale';
const CHAIN_CFG = CHAINS[CHAIN_KEY];
const RUN_TIMES_UTC = [8, 20]; // 8h and 20h UTC
const MIN_RUN_INTERVAL = 6 * 60 * 60 * 1000; // 6h cooldown (anti-duplicate)
const WARMUP_DELAY = 3 * 60 * 1000; // 3min after startup
const MIN_BALANCE = 0.05; // Skip if < 0.05 USDC
const TX_TIMEOUT = 15_000;
const API_TIMEOUT = 15_000;

const APIS = [
    { key: 'nasa',   path: '/api/nasa',               price: 0.005, label: 'NASA APOD' },
    { key: 'iss',    path: '/api/iss',                 price: 0.003, label: 'ISS Tracker' },
    { key: 'spacex', path: '/api/spacex?type=upcoming', price: 0.005, label: 'SpaceX Launches' },
];

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// --- STATE ---
let _account = null;
let _publicClient = null;
let _walletClient = null;
let _nonce = null;
let _lastRunAt = 0;
let _timer = null;
let _supabase = null;
let _baseUrl = null;

// --- WALLET ---
function initWallet() {
    const pk = process.env.AGENT_PRIVATE_KEY;
    if (!pk) throw new Error('AGENT_PRIVATE_KEY not set — live agent cannot sign transactions');

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
    logger.info('LiveAgent', `Wallet: ${_account.address.slice(0, 10)}... on ${CHAIN_CFG.label}`);
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

// --- CALL AN API WITH x402 PAYMENT ---
async function callApiWithPayment(api) {
    const url = `${_baseUrl}${api.path}`;
    const start = Date.now();
    const result = { data: null, tx_hash: null, cost: api.price, latency_ms: 0, error: null };

    try {
        // Step 1: GET → expect 402
        const firstRes = await fetchWithTimeout(url, {}, API_TIMEOUT);

        if (firstRes.status === 200) {
            // API returned 200 without payment (free or cached)
            result.data = await firstRes.json().catch(() => null);
            result.latency_ms = Date.now() - start;
            result.cost = 0;
            logger.info('LiveAgent', `${api.label}: got 200 without payment (free/cached)`);
            return result;
        }

        if (firstRes.status !== 402) {
            result.error = `Expected 402, got ${firstRes.status}`;
            result.latency_ms = Date.now() - start;
            return result;
        }

        // Step 2: Parse 402 body for payment details
        const body402 = await firstRes.json().catch(() => ({}));
        const details = body402.payment_details || body402;
        const recipient = details.recipient || details.pay_to || process.env.WALLET_ADDRESS;
        const amountRaw = Math.round(api.price * (10 ** (CHAIN_CFG.usdcDecimals ?? 6)));

        // Step 3: Send USDC payment
        const payResult = await sendUsdcPayment(recipient, amountRaw);
        if (!payResult.success) {
            result.error = `Payment failed: ${payResult.error}`;
            result.latency_ms = Date.now() - start;
            return result;
        }
        result.tx_hash = payResult.txHash;

        // Step 4: Retry with tx hash
        const paidRes = await fetchWithTimeout(url, {
            headers: {
                'X-Payment-TxHash': payResult.txHash,
                'X-Payment-Chain': CHAIN_KEY,
            },
        }, API_TIMEOUT);

        if (paidRes.ok) {
            result.data = await paidRes.json().catch(() => null);
        } else {
            // Retry once more after 2s (receipt propagation)
            await new Promise(r => setTimeout(r, 2000));
            const retryRes = await fetchWithTimeout(url, {
                headers: {
                    'X-Payment-TxHash': payResult.txHash,
                    'X-Payment-Chain': CHAIN_KEY,
                },
            }, API_TIMEOUT);
            if (retryRes.ok) {
                result.data = await retryRes.json().catch(() => null);
            } else {
                result.error = `Paid call returned ${retryRes.status} after retry`;
            }
        }
    } catch (err) {
        result.error = err.message?.slice(0, 200);
    }

    result.latency_ms = Date.now() - start;
    return result;
}

// --- MAIN RUN ---
async function runLiveAgentOnce(supabase) {
    const now = Date.now();
    if (now - _lastRunAt < MIN_RUN_INTERVAL) {
        logger.info('LiveAgent', 'Skipped: cooldown not elapsed');
        return { skipped: true, reason: 'cooldown' };
    }

    logger.info('LiveAgent', '=== Starting Live Agent run ===');
    _lastRunAt = now;

    try {
        if (!_account) initWallet();
        await initNonce();

        const balance = await getUsdcBalance();
        logger.info('LiveAgent', `USDC balance: ${balance.toFixed(6)}`);

        if (balance < MIN_BALANCE) {
            logger.warn('LiveAgent', `Balance too low (${balance} < ${MIN_BALANCE}), skipping`);
            return { skipped: true, reason: 'low_balance', balance };
        }

        // Call all 3 APIs sequentially (need nonce ordering)
        const results = {};
        for (const api of APIS) {
            logger.info('LiveAgent', `Calling ${api.label}...`);
            results[api.key] = await callApiWithPayment(api);
            const r = results[api.key];
            if (r.error) {
                logger.warn('LiveAgent', `${api.label} error: ${r.error}`);
            } else {
                logger.info('LiveAgent', `${api.label} OK (${r.latency_ms}ms, tx: ${r.tx_hash?.slice(0, 10)}...)`);
            }
        }

        // Determine status
        const errors = APIS.filter(a => results[a.key].error);
        const status = errors.length === 0 ? 'success' : errors.length === APIS.length ? 'failed' : 'partial';

        const totalCost = APIS.reduce((sum, a) => sum + (results[a.key].tx_hash ? a.price : 0), 0);

        // Build Supabase row
        const nasa = results.nasa;
        const iss = results.iss;
        const spacex = results.spacex;

        const row = {
            status,
            nasa_title: nasa.data?.title || null,
            nasa_explanation: nasa.data?.explanation || null,
            nasa_date: nasa.data?.date || null,
            nasa_url: nasa.data?.url || null,
            nasa_hdurl: nasa.data?.hdurl || null,
            nasa_media_type: nasa.data?.media_type || null,
            nasa_tx_hash: nasa.tx_hash,
            nasa_cost: nasa.tx_hash ? 0.005 : 0,
            nasa_latency_ms: nasa.latency_ms,
            nasa_error: nasa.error,
            iss_latitude: nasa.data ? (iss.data?.position?.latitude || null) : null,
            iss_longitude: iss.data?.position?.longitude || null,
            iss_crew_count: iss.data?.crew?.count || null,
            iss_crew_members: iss.data?.crew?.members || null,
            iss_tx_hash: iss.tx_hash,
            iss_cost: iss.tx_hash ? 0.003 : 0,
            iss_latency_ms: iss.latency_ms,
            iss_error: iss.error,
            spacex_name: null,
            spacex_date_utc: null,
            spacex_flight_number: null,
            spacex_details: null,
            spacex_rocket: null,
            spacex_links: null,
            spacex_tx_hash: spacex.tx_hash,
            spacex_cost: spacex.tx_hash ? 0.005 : 0,
            spacex_latency_ms: spacex.latency_ms,
            spacex_error: spacex.error,
            total_cost: totalCost,
            agent_wallet: _account.address,
            chain: CHAIN_KEY,
        };

        // Fix ISS latitude (was incorrectly conditioned on nasa.data)
        row.iss_latitude = iss.data?.position?.latitude || null;

        // SpaceX: handle upcoming array or latest single object
        if (spacex.data) {
            if (Array.isArray(spacex.data.launches) && spacex.data.launches.length > 0) {
                const next = spacex.data.launches[0];
                row.spacex_name = next.name;
                row.spacex_date_utc = next.date_utc || null;
                row.spacex_flight_number = next.flight_number || null;
                row.spacex_details = next.details || null;
            } else {
                row.spacex_name = spacex.data.name || null;
                row.spacex_date_utc = spacex.data.date_utc || null;
                row.spacex_flight_number = spacex.data.flight_number || null;
                row.spacex_details = spacex.data.details || null;
                row.spacex_rocket = spacex.data.rocket || null;
                row.spacex_links = spacex.data.links || null;
            }
        }

        // Insert into Supabase
        const { error: dbError } = await (supabase || _supabase)
            .from('agent_reports')
            .insert([row]);

        if (dbError) {
            logger.error('LiveAgent', `DB insert failed: ${dbError.message}`);
        } else {
            logger.info('LiveAgent', `Report saved: status=${status}, cost=${totalCost} USDC`);
        }

        // Telegram notification
        sendTelegramReport(results, status, totalCost, balance).catch(err => {
            logger.warn('LiveAgent', `Telegram report failed: ${err.message}`);
        });

        return { status, totalCost, results };
    } catch (err) {
        logger.error('LiveAgent', `Run failed: ${err.stack || err.message}`);
        return { status: 'failed', error: err.message };
    }
}

// --- TELEGRAM REPORT ---
async function sendTelegramReport(results, status, totalCost, balance) {
    const emoji = status === 'success' ? '🛰️' : status === 'partial' ? '⚠️' : '🔴';
    const lines = [
        `${emoji} *Live AI Agent Report*`,
        '',
        `*Status:* ${status}`,
        `*Chain:* ${CHAIN_CFG.label}`,
        `*Total cost:* ${totalCost.toFixed(4)} USDC`,
        `*Balance:* ${balance.toFixed(4)} USDC`,
        '',
    ];

    for (const api of APIS) {
        const r = results[api.key];
        if (r.error) {
            lines.push(`❌ *${api.label}:* ${escapeMarkdown(r.error.slice(0, 80))}`);
        } else {
            const txShort = r.tx_hash ? r.tx_hash.slice(0, 10) + '...' : 'free';
            lines.push(`✅ *${api.label}:* ${r.latency_ms}ms — \`${txShort}\``);
        }
    }

    if (results.nasa?.data?.title) {
        lines.push('');
        lines.push(`🔭 *NASA:* ${escapeMarkdown(results.nasa.data.title)}`);
    }

    await notifyAdmin(lines.join('\n'));
}

// --- SCHEDULER ---
function getNextRunTime(now, runTimesUtc) {
    const d = new Date(now);
    const candidates = [];

    // Today's run times
    for (const hour of runTimesUtc) {
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0));
        if (t.getTime() > now + 60_000) { // at least 1min in future
            candidates.push(t);
        }
    }

    // Tomorrow's first run time
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
    logger.info('LiveAgent', `Next run scheduled: ${nextStr} (in ${Math.round(delay / 60000)}min)`);

    _timer = setTimeout(async () => {
        await runLiveAgentOnce(_supabase);
        scheduleNextRun();
    }, delay);
    _timer.unref(); // Don't prevent graceful shutdown
}

function startLiveAgent(baseUrl, supabase) {
    if (!process.env.AGENT_PRIVATE_KEY) {
        logger.warn('LiveAgent', 'AGENT_PRIVATE_KEY not set — live agent disabled');
        return;
    }

    _supabase = supabase;
    _baseUrl = baseUrl;
    logger.info('LiveAgent', 'Live AI Agent starting...');

    // First run after warmup, then schedule
    _timer = setTimeout(async () => {
        await runLiveAgentOnce(supabase);
        scheduleNextRun();
    }, WARMUP_DELAY);
    _timer.unref();
}

function stopLiveAgent() {
    if (_timer) {
        clearTimeout(_timer);
        _timer = null;
    }
    logger.info('LiveAgent', 'Stopped');
}

module.exports = {
    startLiveAgent,
    stopLiveAgent,
    runLiveAgentOnce,
};
