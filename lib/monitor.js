// lib/monitor.js — Monitoring engine for all 69 x402 native endpoints
// Checks every 5 min, detects transitions, alerts via Telegram, persists to Supabase

const logger = require('./logger');
const logEmitter = require('./log-emitter');

// --- 69 endpoints to monitor ---
const ENDPOINTS = [
  { path: '/api/weather', method: 'GET', label: 'Weather' },
  { path: '/api/crypto', method: 'GET', label: 'Crypto Price' },
  { path: '/api/joke', method: 'GET', label: 'Random Joke' },
  { path: '/api/search', method: 'GET', label: 'Web Search' },
  { path: '/api/scrape', method: 'GET', label: 'Universal Scraper' },
  { path: '/api/twitter', method: 'GET', label: 'Twitter/X Data' },
  { path: '/api/image', method: 'GET', label: 'Image Generation' },
  { path: '/api/wikipedia', method: 'GET', label: 'Wikipedia Summary' },
  { path: '/api/dictionary', method: 'GET', label: 'Dictionary' },
  { path: '/api/countries', method: 'GET', label: 'Countries' },
  { path: '/api/github', method: 'GET', label: 'GitHub' },
  { path: '/api/npm', method: 'GET', label: 'NPM Registry' },
  { path: '/api/ip', method: 'GET', label: 'IP Geolocation' },
  { path: '/api/qrcode', method: 'GET', label: 'QR Code' },
  { path: '/api/time', method: 'GET', label: 'World Time' },
  { path: '/api/holidays', method: 'GET', label: 'Public Holidays' },
  { path: '/api/geocoding', method: 'GET', label: 'Geocoding' },
  { path: '/api/airquality', method: 'GET', label: 'Air Quality' },
  { path: '/api/quote', method: 'GET', label: 'Random Quote' },
  { path: '/api/facts', method: 'GET', label: 'Random Facts' },
  { path: '/api/dogs', method: 'GET', label: 'Random Dog Image' },
  { path: '/api/translate', method: 'GET', label: 'Translation' },
  { path: '/api/summarize', method: 'GET', label: 'Summarize' },
  { path: '/api/dns', method: 'GET', label: 'DNS Lookup' },
  { path: '/api/qrcode-gen', method: 'GET', label: 'QR Code Generator' },
  { path: '/api/readability', method: 'GET', label: 'Readability' },
  { path: '/api/sentiment', method: 'GET', label: 'Sentiment Analysis' },
  { path: '/api/validate-email', method: 'GET', label: 'Email Validation' },
  { path: '/api/hash', method: 'GET', label: 'Hash Generator' },
  { path: '/api/uuid', method: 'GET', label: 'UUID Generator' },
  { path: '/api/base64', method: 'GET', label: 'Base64' },
  { path: '/api/password', method: 'GET', label: 'Password Generator' },
  { path: '/api/currency', method: 'GET', label: 'Currency Converter' },
  { path: '/api/timestamp', method: 'GET', label: 'Timestamp Converter' },
  { path: '/api/lorem', method: 'GET', label: 'Lorem Ipsum' },
  { path: '/api/headers', method: 'GET', label: 'HTTP Headers' },
  { path: '/api/markdown', method: 'GET', label: 'Markdown to HTML' },
  { path: '/api/color', method: 'GET', label: 'Color Converter' },
  { path: '/api/useragent', method: 'GET', label: 'User Agent Parser' },
  { path: '/api/code', method: 'POST', label: 'Code Execution' },
  { path: '/api/json-validate', method: 'POST', label: 'JSON Validator' },
  // Batch 3 — Data & Social (session 21)
  { path: '/api/news', method: 'GET', label: 'News Feed' },
  { path: '/api/stocks', method: 'GET', label: 'Stock Price' },
  { path: '/api/reddit', method: 'GET', label: 'Reddit Data' },
  { path: '/api/hn', method: 'GET', label: 'Hacker News' },
  { path: '/api/youtube', method: 'GET', label: 'YouTube Info' },
  { path: '/api/whois', method: 'GET', label: 'WHOIS Lookup' },
  { path: '/api/ssl-check', method: 'GET', label: 'SSL Check' },
  { path: '/api/regex', method: 'GET', label: 'Regex Tester' },
  { path: '/api/diff', method: 'GET', label: 'Text Diff' },
  { path: '/api/math', method: 'GET', label: 'Math Expression' },
  // Batch 4 — Utility (session 21)
  { path: '/api/unit-convert', method: 'GET', label: 'Unit Converter' },
  { path: '/api/csv-to-json', method: 'GET', label: 'CSV to JSON' },
  { path: '/api/jwt-decode', method: 'GET', label: 'JWT Decoder' },
  { path: '/api/cron-parse', method: 'GET', label: 'Cron Parser' },
  { path: '/api/password-strength', method: 'GET', label: 'Password Strength' },
  { path: '/api/phone-validate', method: 'GET', label: 'Phone Validator' },
  { path: '/api/url-parse', method: 'GET', label: 'URL Parser' },
  { path: '/api/url-shorten', method: 'GET', label: 'URL Shortener' },
  { path: '/api/html-to-text', method: 'GET', label: 'HTML to Text' },
  { path: '/api/http-status', method: 'GET', label: 'HTTP Status' },
  // Intelligence APIs (session 22)
  { path: '/api/contract-risk', method: 'GET', label: 'Contract Risk Analyzer' },
  { path: '/api/code-review', method: 'GET', label: 'AI Code Review' },
  { path: '/api/crypto-intelligence', method: 'GET', label: 'Crypto Intelligence' },
  { path: '/api/domain-report', method: 'GET', label: 'Domain Intelligence Report' },
  { path: '/api/email-parse', method: 'GET', label: 'Email CRM Parser' },
  { path: '/api/lead-score', method: 'GET', label: 'Lead Scoring' },
  { path: '/api/seo-audit', method: 'GET', label: 'SEO Audit' },
  { path: '/api/table-insights', method: 'GET', label: 'Table & CSV Insights' },
];

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 10;
const CHECK_TIMEOUT = 10000; // 10s per endpoint
const CLEANUP_DAYS = 30;

// In-memory status (latest check results)
let currentStatus = {
  lastCheck: null,
  overall: 'unknown',
  endpoints: [],
  uptime24h: null,
};

// Previous statuses for transition detection
const previousStatuses = new Map();

// Set to true once previousStatuses has been successfully seeded from Supabase.
// If the initial load fails (Supabase unreachable at boot), skip transition detection
// on the first check to avoid sending up to 81 false-positive "recovered" alerts.
let previousStatusesLoaded = false;

let intervalId = null;

// --- Pre-load previous statuses from Supabase to avoid false-positive alerts on restart ---
async function loadPreviousStatuses(supabase) {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('monitoring_checks')
      .select('endpoint, status')
      .order('checked_at', { ascending: false });

    if (error) {
      logger.error('Monitor', `Failed to load previous statuses: ${error.message}`);
      return;
    }

    // Deduplicate by endpoint — keep only the most recent row per endpoint
    const seen = new Set();
    for (const row of (data || [])) {
      if (!seen.has(row.endpoint)) {
        seen.add(row.endpoint);
        previousStatuses.set(row.endpoint, row.status);
      }
    }

    logger.info('Monitor', `Loaded ${previousStatuses.size} previous statuses from Supabase`);
    previousStatusesLoaded = true;
  } catch (err) {
    logger.error('Monitor', `loadPreviousStatuses error: ${err.message} — transition detection skipped for first cycle`);
  }
}

// --- Check a single endpoint ---
async function checkEndpoint(baseUrl, endpoint) {
  const url = `${baseUrl}${endpoint.path}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

    const options = {
      method: endpoint.method,
      headers: { 'X-Monitor': 'internal' },
      signal: controller.signal,
    };

    // Admin-protected endpoints need the admin token
    if (endpoint.needsAdminToken && process.env.ADMIN_TOKEN) {
      options.headers['X-Admin-Token'] = process.env.ADMIN_TOKEN;
    }

    // POST endpoints need a body
    if (endpoint.method === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ test: true });
    }

    const res = await fetch(url, options);
    clearTimeout(timeoutId);

    const latency = Date.now() - start;
    const httpStatus = res.status;

    // 402 = payment required (endpoint alive), 400 = missing param (endpoint alive)
    // 200 = free endpoint or unexpected, still alive
    const isOnline = httpStatus === 402 || httpStatus === 400 || httpStatus === 200 || httpStatus === 429;

    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: isOnline ? 'online' : 'offline',
      latency,
      httpStatus,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: 'offline',
      latency,
      httpStatus: 0,
      checkedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

// --- Check all endpoints in batches ---
async function checkAllEndpoints(baseUrl) {
  const results = [];

  for (let i = 0; i < ENDPOINTS.length; i += BATCH_SIZE) {
    const batch = ENDPOINTS.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((ep) => checkEndpoint(baseUrl, ep))
    );
    results.push(...batchResults);
  }

  return results;
}

// --- Detect transitions and send Telegram alerts ---
async function detectTransitions(results) {
  const transitions = [];

  // If previousStatuses was not seeded from Supabase (Supabase was unreachable at boot),
  // populate the map silently on first run to avoid false-positive alerts.
  if (!previousStatusesLoaded) {
    for (const result of results) {
      previousStatuses.set(result.endpoint, result.status);
    }
    previousStatusesLoaded = true;
    logger.info('Monitor', 'First-cycle baseline set from live check — transition detection active from next cycle');
    return transitions;
  }

  for (const result of results) {
    const prev = previousStatuses.get(result.endpoint);
    if (prev && prev !== result.status) {
      transitions.push({
        endpoint: result.endpoint,
        label: result.label,
        from: prev,
        to: result.status,
        latency: result.latency,
      });
    }
    previousStatuses.set(result.endpoint, result.status);
  }

  if (transitions.length > 0) {
    await sendTelegramAlerts(transitions);
    // Emit to SSE stream
    for (const t of transitions) {
      try { logEmitter.emit('monitor-transition', t); } catch { /* intentionally silent — SSE emit is fire-and-forget */ }
    }
  }

  return transitions;
}

// --- Telegram alerts ---
async function sendTelegramAlerts(transitions) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  for (const t of transitions) {
    const emoji = t.to === 'online' ? '\u2705' : '\uD83D\uDD34';
    const action = t.to === 'online' ? 'RECOVERED' : 'DOWN';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const text = [
      `${emoji} *x402 Bazaar — ${action}*`,
      ``,
      `*Service:* ${t.label}`,
      `*Endpoint:* \`${t.endpoint}\``,
      `*Transition:* ${t.from} → ${t.to}`,
      `*Latency:* ${t.latency}ms`,
      `*Time:* ${timestamp} UTC`,
    ].join('\n');

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (err) {
      logger.error('Monitor', `Telegram alert failed: ${err.message}`);
    }
  }
}

// --- Persist to Supabase ---
async function persistResults(supabase, results) {
  if (!supabase) return;

  const rows = results.map((r) => ({
    endpoint: r.endpoint,
    label: r.label,
    status: r.status,
    latency: r.latency,
    http_status: r.httpStatus,
    checked_at: r.checkedAt,
  }));

  try {
    const { error } = await supabase.from('monitoring_checks').insert(rows);
    if (error) {
      logger.error('Monitor', `Supabase persist failed: ${error.message}`);
    }
  } catch (err) {
    logger.error('Monitor', `Supabase persist error: ${err.message}`);
  }
}

// --- Cleanup old records (> 30 days) ---
async function cleanupOldRecords(supabase) {
  if (!supabase) return;

  const cutoff = new Date(Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { error } = await supabase
      .from('monitoring_checks')
      .delete()
      .lt('checked_at', cutoff);

    if (error) {
      logger.error('Monitor', `Cleanup failed: ${error.message}`);
    }
  } catch (err) {
    logger.error('Monitor', `Cleanup error: ${err.message}`);
  }
}

// --- Update in-memory status ---
function updateCurrentStatus(results) {
  const onlineCount = results.filter((r) => r.status === 'online').length;
  const total = results.length;

  let overall = 'operational';
  if (onlineCount === 0) overall = 'major_outage';
  else if (onlineCount < total) overall = 'degraded';

  currentStatus = {
    lastCheck: new Date().toISOString(),
    overall,
    onlineCount,
    totalCount: total,
    endpoints: results.map((r) => ({
      endpoint: r.endpoint,
      label: r.label,
      status: r.status,
      latency: r.latency,
      httpStatus: r.httpStatus,
    })),
  };
}

// --- Run one monitoring round ---
async function runCheck(baseUrl, supabase) {
  logger.info('Monitor', 'Starting monitoring check...');

  try {
    const results = await checkAllEndpoints(baseUrl);
    updateCurrentStatus(results);
    await detectTransitions(results);
    await persistResults(supabase, results);
    // Note: old-records cleanup is handled by lib/retention.js (runs every 24h)
    // cleanupOldRecords() was removed here to avoid double-purge.

    const online = results.filter((r) => r.status === 'online').length;
    logger.info('Monitor', `Check complete: ${online}/${results.length} online`);
  } catch (err) {
    logger.error('Monitor', `Check failed: ${err.message}`);
  }
}

// --- Public API ---
function startMonitor(baseUrl, supabase) {
  // First check after 30s (let server fully boot)
  // Pre-load previous statuses before first run to avoid false-positive alerts
  setTimeout(async () => {
    await loadPreviousStatuses(supabase);
    runCheck(baseUrl, supabase);

    // Then every 5 minutes
    intervalId = setInterval(() => runCheck(baseUrl, supabase), CHECK_INTERVAL);
  }, 30000);

  logger.info('Monitor', `Monitoring scheduled: first check in 30s, then every ${CHECK_INTERVAL / 60000}min`);
}

function stopMonitor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Monitor', 'Monitoring stopped');
  }
}

function getStatus() {
  return currentStatus;
}

function getEndpoints() {
  return ENDPOINTS;
}

module.exports = { startMonitor, stopMonitor, getStatus, getEndpoints };
