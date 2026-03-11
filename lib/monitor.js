// lib/monitor.js — Monitoring engine for all x402 native endpoints
// Checks every 5 min, detects transitions, alerts via Telegram, persists to Supabase
// Endpoints auto-derived from bazaar-discovery.js — no manual maintenance needed.

const logger = require('./logger');
const logEmitter = require('./log-emitter');
const { discoveryMap, getMethodForUrl } = require('./bazaar-discovery');

// --- Auto-derive endpoints from discoveryMap (single source of truth) ---
// Label overrides for endpoints where the auto-generated label isn't ideal
const LABEL_OVERRIDES = {
  '/api/ip':          'IP Geolocation',
  '/api/hn':          'Hacker News',
  '/api/dns':         'DNS Lookup',
  '/api/npm':         'NPM Registry',
  '/api/csv-to-json': 'CSV to JSON',
  '/api/html-to-text':'HTML to Text',
  '/api/qrcode-gen':  'QR Code Generator',
  '/api/ssl-check':   'SSL Check',
  '/api/http-status': 'HTTP Status',
  '/api/jwt-decode':  'JWT Decoder',
  '/api/uuid':        'UUID Generator',
};

// A dummy base URL — only the pathname matters for getMethodForUrl
const _BASE = 'https://x402-api.onrender.com';

/**
 * Convert path to human-readable label.
 * /api/contract-risk → "Contract Risk"
 * /api/csv-to-json   → "Csv To Json" → override → "CSV to JSON"
 */
function pathToLabel(path) {
  if (LABEL_OVERRIDES[path]) return LABEL_OVERRIDES[path];
  return path
    .replace('/api/', '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const ENDPOINTS = Object.keys(discoveryMap)
  .sort()
  .map(path => ({
    path,
    method: getMethodForUrl(`${_BASE}${path}`),
    label: pathToLabel(path),
  }));

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
      .order('checked_at', { ascending: false })
      .limit(500);

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

// --- Propagate status to services table ---
// Batch-update services.status based on monitoring results (internal endpoints only)
async function updateServicesStatus(supabase, results) {
  if (!supabase) return;

  const now = new Date().toISOString();
  // Group by status to minimize DB calls (2 UPDATEs instead of 81)
  const onlinePaths = results.filter(r => r.status === 'online').map(r => r.endpoint);
  const offlinePaths = results.filter(r => r.status === 'offline').map(r => r.endpoint);

  try {
    // Build URL patterns: /api/joke → %/api/joke (matches any base URL)
    if (onlinePaths.length > 0) {
      for (const path of onlinePaths) {
        await supabase
          .from('services')
          .update({ status: 'online', last_checked_at: now })
          .like('url', `%${path}`);
      }
    }
    if (offlinePaths.length > 0) {
      for (const path of offlinePaths) {
        await supabase
          .from('services')
          .update({ status: 'offline', last_checked_at: now })
          .like('url', `%${path}`);
      }
    }
  } catch (err) {
    logger.warn('Monitor', `Failed to update services status: ${err.message}`);
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
    // Propagate status to services table (fire-and-forget, non-blocking)
    updateServicesStatus(supabase, results).catch(err =>
      logger.warn('Monitor', `Services status update failed: ${err.message}`)
    );

    const online = results.filter((r) => r.status === 'online').length;
    logger.info('Monitor', `Check complete: ${online}/${results.length} online`);
  } catch (err) {
    logger.error('Monitor', `Check failed: ${err.message}`);
  }
}

// --- Public API ---
let startupTimerId = null;

function startMonitor(baseUrl, supabase) {
  // First check after 30s (let server fully boot)
  // Pre-load previous statuses before first run to avoid false-positive alerts
  startupTimerId = setTimeout(async () => {
    startupTimerId = null;
    await loadPreviousStatuses(supabase);
    runCheck(baseUrl, supabase);

    // Then every 5 minutes
    intervalId = setInterval(() => runCheck(baseUrl, supabase), CHECK_INTERVAL).unref();
  }, 30000);
  startupTimerId.unref();

  logger.info('Monitor', `Monitoring scheduled: first check in 30s, then every ${CHECK_INTERVAL / 60000}min`);
}

function stopMonitor() {
  if (startupTimerId) {
    clearTimeout(startupTimerId);
    startupTimerId = null;
  }
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
