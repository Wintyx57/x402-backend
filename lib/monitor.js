// lib/monitor.js — Monitoring engine for all x402 endpoints (internal + external)
// Checks every 5 min, detects transitions, alerts via Telegram, persists to Supabase
// Internal endpoints auto-derived from bazaar-discovery.js.
// External endpoints auto-fetched from Supabase services table.

const logger = require("./logger");
const logEmitter = require("./log-emitter");
const { discoveryMap, getMethodForUrl } = require("./bazaar-discovery");
const { decryptCredentials, injectCredentials } = require("./credentials");
const { normalize402 } = require("./protocolAdapter");
const { isRelayConfigured, getRelayBalance } = require("./upstreamPayer");

// Relay balance alert rate limiting (max 3 alerts per chain per day)
const _relayAlertState = { date: "", counts: {} };

// --- Auto-derive endpoints from discoveryMap (single source of truth) ---
// Label overrides for endpoints where the auto-generated label isn't ideal
const LABEL_OVERRIDES = {
  "/api/ip": "IP Geolocation",
  "/api/hn": "Hacker News",
  "/api/dns": "DNS Lookup",
  "/api/npm": "NPM Registry",
  "/api/csv-to-json": "CSV to JSON",
  "/api/html-to-text": "HTML to Text",
  "/api/qrcode-gen": "QR Code Generator",
  "/api/ssl-check": "SSL Check",
  "/api/http-status": "HTTP Status",
  "/api/jwt-decode": "JWT Decoder",
  "/api/uuid": "UUID Generator",
};

// A dummy base URL — only the pathname matters for getMethodForUrl
const _BASE = "https://x402-api.onrender.com";

/**
 * Convert path to human-readable label.
 * /api/contract-risk → "Contract Risk"
 * /api/csv-to-json   → "Csv To Json" → override → "CSV to JSON"
 */
function pathToLabel(path) {
  if (LABEL_OVERRIDES[path]) return LABEL_OVERRIDES[path];
  return path
    .replace("/api/", "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ENDPOINTS = Object.keys(discoveryMap)
  .sort()
  .map((path) => ({
    path,
    method: getMethodForUrl(`${_BASE}${path}`),
    label: pathToLabel(path),
  }));

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 10;
const CHECK_TIMEOUT = 10000; // 10s per endpoint
const EXTERNAL_CACHE_TTL = 5 * 60 * 1000; // Cache external services list for 5 min

// --- External services cache ---
let _externalServicesCache = [];
let _externalServicesCacheTime = 0;

/**
 * Fetch external services from Supabase (cached for 5 min).
 * Returns array of { id, path (full URL), method, label, isExternal }.
 */
async function fetchExternalServices(supabase) {
  if (!supabase) return [];

  // Return cache if still valid
  if (
    Date.now() - _externalServicesCacheTime < EXTERNAL_CACHE_TTL &&
    _externalServicesCache.length > 0
  ) {
    return _externalServicesCache;
  }

  try {
    const platformWallet = (process.env.WALLET_ADDRESS || "").toLowerCase();
    const { data, error } = await supabase
      .from("services")
      .select(
        "id, name, url, owner_address, encrypted_credentials, credential_type",
      )
      .limit(500);

    if (error) {
      logger.error(
        "Monitor",
        `Failed to fetch external services: ${error.message}`,
      );
      return _externalServicesCache; // Return stale cache on error
    }

    // Exclude internal services: either owned by platform wallet OR hosted on our backend
    const backendUrl = (process.env.RENDER_EXTERNAL_URL || "").toLowerCase();
    const external = (data || []).filter((svc) => {
      const owner = (svc.owner_address || "").toLowerCase();
      const url = (svc.url || "").toLowerCase();
      // Skip platform-owned services
      if (owner === platformWallet) return false;
      // Skip services hosted on our own backend (already checked internally)
      if (backendUrl && url.startsWith(backendUrl)) return false;
      return owner !== "";
    });

    _externalServicesCache = external.map((svc) => ({
      id: svc.id,
      path: svc.url, // Full URL for external services
      method: "GET", // Simple GET health-check (expect 402)
      label: svc.name || svc.url,
      isExternal: true,
      encryptedCredentials: svc.encrypted_credentials || null,
      credentialType: svc.credential_type || null,
    }));

    _externalServicesCacheTime = Date.now();
    if (_externalServicesCache.length > 0) {
      logger.info(
        "Monitor",
        `Loaded ${_externalServicesCache.length} external services for monitoring`,
      );
    }
    return _externalServicesCache;
  } catch (err) {
    logger.error("Monitor", `fetchExternalServices error: ${err.message}`);
    return _externalServicesCache; // Return stale cache on error
  }
}

// In-memory status (latest check results)
let currentStatus = {
  lastCheck: null,
  overall: "unknown",
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
      .from("monitoring_checks")
      .select("endpoint, status")
      .order("checked_at", { ascending: false })
      .limit(500);

    if (error) {
      logger.error(
        "Monitor",
        `Failed to load previous statuses: ${error.message}`,
      );
      return;
    }

    // Deduplicate by endpoint — keep only the most recent row per endpoint
    const seen = new Set();
    for (const row of data || []) {
      if (!seen.has(row.endpoint)) {
        seen.add(row.endpoint);
        previousStatuses.set(row.endpoint, row.status);
      }
    }

    logger.info(
      "Monitor",
      `Loaded ${previousStatuses.size} previous statuses from Supabase`,
    );
    previousStatusesLoaded = true;
  } catch (err) {
    logger.error(
      "Monitor",
      `loadPreviousStatuses error: ${err.message} — transition detection skipped for first cycle`,
    );
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
      headers: { "X-Monitor": "internal" },
      signal: controller.signal,
    };

    // Admin-protected endpoints need the admin token
    if (endpoint.needsAdminToken && process.env.ADMIN_TOKEN) {
      options.headers["X-Admin-Token"] = process.env.ADMIN_TOKEN;
    }

    // POST endpoints need a body
    if (endpoint.method === "POST") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ test: true });
    }

    const res = await fetch(url, options);
    clearTimeout(timeoutId);

    const latency = Date.now() - start;
    const httpStatus = res.status;

    // 402 = payment required (endpoint alive), 400 = missing param (endpoint alive)
    // 200 = free endpoint or unexpected, still alive
    const isOnline =
      httpStatus === 402 ||
      httpStatus === 400 ||
      httpStatus === 200 ||
      httpStatus === 429;

    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: isOnline ? "online" : "offline",
      latency,
      httpStatus,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: "offline",
      latency,
      httpStatus: 0,
      checkedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

// --- Check a single external endpoint (full URL, no baseUrl prefix) ---
async function checkExternalEndpoint(endpoint) {
  let url = endpoint.path; // Full URL already
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

    const headers = { "X-Monitor": "external" };

    // Inject provider credentials if available (e.g. RapidAPI X-RapidAPI-Key)
    if (endpoint.encryptedCredentials) {
      const creds = decryptCredentials(endpoint.encryptedCredentials);
      if (creds) {
        const injected = injectCredentials(headers, url, creds);
        url = injected.url;
        // Copy injected headers (injectCredentials mutates in-place + may update url for query params)
      }
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency = Date.now() - start;
    const httpStatus = res.status;

    // Protocol sniffing on 402 responses
    let detectedProtocol = null;
    if (httpStatus === 402) {
      try {
        let headers402 = {};
        try {
          headers402 = Object.fromEntries(res.headers);
        } catch {
          /* empty */
        }
        let body402 = {};
        try {
          body402 = await res.clone().json();
        } catch {
          /* not JSON */
        }
        const normalized = normalize402(402, headers402, body402);
        if (normalized.format !== "unknown") {
          detectedProtocol = normalized.format;
        }
      } catch {
        /* sniffing is best-effort */
      }
    }

    // 402 = payment required (alive), 400 = missing param (alive), 200 = OK, 429 = rate limited (alive)
    // 401/403 = auth failed but server responded (alive — treat as online for credential-based services)
    const hasCredentials = !!endpoint.encryptedCredentials;
    const isOnline =
      httpStatus === 402 ||
      httpStatus === 400 ||
      httpStatus === 200 ||
      httpStatus === 429 ||
      (hasCredentials && (httpStatus === 401 || httpStatus === 403));

    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: isOnline ? "online" : "offline",
      latency,
      httpStatus,
      checkedAt: new Date().toISOString(),
      isExternal: true,
      serviceId: endpoint.id,
      detectedProtocol,
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      endpoint: endpoint.path,
      label: endpoint.label,
      status: "offline",
      latency,
      httpStatus: 0,
      checkedAt: new Date().toISOString(),
      error: err.message,
      isExternal: true,
      serviceId: endpoint.id,
    };
  }
}

// --- Check all endpoints in batches (all batches run in parallel) ---
async function checkAllEndpoints(baseUrl) {
  const batches = [];
  for (let i = 0; i < ENDPOINTS.length; i += BATCH_SIZE) {
    batches.push(ENDPOINTS.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map((batch) =>
      Promise.all(batch.map((ep) => checkEndpoint(baseUrl, ep))),
    ),
  );

  return batchResults.flat();
}

// --- Detect transitions and send Telegram alerts ---
async function detectTransitions(results, supabase) {
  const transitions = [];

  // If previousStatuses was not seeded from Supabase (Supabase was unreachable at boot),
  // populate the map silently on first run to avoid false-positive alerts.
  if (!previousStatusesLoaded) {
    for (const result of results) {
      previousStatuses.set(result.endpoint, result.status);
    }
    previousStatusesLoaded = true;
    logger.info(
      "Monitor",
      "First-cycle baseline set from live check — transition detection active from next cycle",
    );
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
        serviceId: result.serviceId || null,
      });
    }
    previousStatuses.set(result.endpoint, result.status);
  }

  if (transitions.length > 0) {
    await sendTelegramAlerts(transitions);
    // Fire provider webhooks (fire-and-forget, non-blocking)
    fireWebhooks(transitions, supabase).catch((err) =>
      logger.warn("Monitor", "fireWebhooks error: " + err.message),
    );
    // Emit to SSE stream
    for (const t of transitions) {
      try {
        logEmitter.emit("monitor-transition", t);
      } catch {
        /* intentionally silent — SSE emit is fire-and-forget */
      }
    }
  }

  return transitions;
}

// --- Provider webhook notifications ---
// Fire-and-forget POST to alert_webhook_url for services with a transition.
// Only fires for external services (those that have a serviceId).
// SECURITY: webhook URLs are validated via safeUrl() to prevent SSRF.
const { safeUrl } = require("./safe-url");

async function fireWebhooks(transitions, supabase) {
  if (!supabase || transitions.length === 0) return;

  // Only external transitions carry a serviceId
  const externalTransitions = transitions.filter((t) => t.serviceId);
  if (externalTransitions.length === 0) return;

  const serviceIds = [...new Set(externalTransitions.map((t) => t.serviceId))];

  // Fetch webhook URLs for affected services
  const webhookMap = {};
  try {
    const { data, error } = await supabase
      .from("services")
      .select("id, alert_webhook_url")
      .in("id", serviceIds)
      .not("alert_webhook_url", "is", null);

    if (error) {
      logger.warn(
        "Monitor",
        "fireWebhooks: failed to fetch webhook URLs: " + error.message,
      );
      return;
    }

    for (const row of data || []) {
      if (row.alert_webhook_url) webhookMap[row.id] = row.alert_webhook_url;
    }
  } catch (err) {
    logger.warn("Monitor", "fireWebhooks fetch error: " + err.message);
    return;
  }

  for (const t of externalTransitions) {
    const webhookUrl = webhookMap[t.serviceId];
    if (!webhookUrl) continue;

    // SSRF protection — skip unsafe URLs (internal IPs, metadata endpoints)
    try {
      await safeUrl(webhookUrl);
    } catch {
      logger.warn("Monitor", "Webhook URL blocked (SSRF): " + webhookUrl);
      continue;
    }

    const payload = {
      event: "status_change",
      service_id: t.serviceId,
      service_name: t.label,
      old_status: t.from,
      new_status: t.to,
      checked_at: new Date().toISOString(),
      latency_ms: t.latency,
    };

    // Fire-and-forget — 5s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeoutId);
        logger.info(
          "Monitor",
          "Webhook fired for " +
            t.label +
            " (" +
            t.from +
            " -> " +
            t.to +
            "): HTTP " +
            res.status,
        );
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        logger.warn(
          "Monitor",
          "Webhook failed for " + t.label + ": " + err.message,
        );
      });
  }
}

// --- Telegram alerts ---
async function sendTelegramAlerts(transitions) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  for (const t of transitions) {
    const emoji = t.to === "online" ? "\u2705" : "\uD83D\uDD34";
    const action = t.to === "online" ? "RECOVERED" : "DOWN";
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

    const text = [
      `${emoji} *x402 Bazaar — ${action}*`,
      ``,
      `*Service:* ${t.label}`,
      `*Endpoint:* \`${t.endpoint}\``,
      `*Transition:* ${t.from} → ${t.to}`,
      `*Latency:* ${t.latency}ms`,
      `*Time:* ${timestamp} UTC`,
    ].join("\n");

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
      });
    } catch (err) {
      logger.error("Monitor", `Telegram alert failed: ${err.message}`);
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
    const { error } = await supabase.from("monitoring_checks").insert(rows);
    if (error) {
      logger.error("Monitor", `Supabase persist failed: ${error.message}`);
    }
  } catch (err) {
    logger.error("Monitor", `Supabase persist error: ${err.message}`);
  }
}

// --- Propagate status to services table ---
// Update services.status based on monitoring results (internal by URL pattern, external by ID)
async function updateServicesStatus(supabase, results) {
  if (!supabase) return;

  const now = new Date().toISOString();
  const internalResults = results.filter((r) => !r.isExternal);
  const externalResults = results.filter((r) => r.isExternal);

  try {
    // Internal: group by status, one update per status group (max 3: online, offline, degraded)
    const byStatus = {};
    for (const r of internalResults) {
      if (!byStatus[r.status]) byStatus[r.status] = [];
      byStatus[r.status].push(r);
    }
    await Promise.all(
      Object.entries(byStatus).map(([status, statusResults]) =>
        supabase
          .from("services")
          .update({ status, last_checked_at: now })
          .or(statusResults.map((r) => `url.like.%${r.endpoint}`).join(",")),
      ),
    );

    // External: direct update by service ID (more precise) — grouped by status as well
    const byStatusExt = {};
    for (const r of externalResults) {
      if (!r.serviceId) continue;
      if (!byStatusExt[r.status]) byStatusExt[r.status] = [];
      byStatusExt[r.status].push(r);
    }
    await Promise.all(
      Object.entries(byStatusExt).map(([status, statusResults]) =>
        supabase
          .from("services")
          .update({ status, last_checked_at: now })
          .in(
            "id",
            statusResults.map((r) => r.serviceId),
          ),
      ),
    );
    // Protocol re-sniffing: update payment_protocol if detected
    const protocolUpdates = externalResults.filter(
      (r) => r.serviceId && r.detectedProtocol,
    );
    for (const r of protocolUpdates) {
      supabase
        .from("services")
        .update({ payment_protocol: r.detectedProtocol })
        .eq("id", r.serviceId)
        .then(null, () => {
          /* intentionally silent */
        });
    }
    if (protocolUpdates.length > 0) {
      logger.info(
        "Monitor",
        `Protocol re-sniffed: ${protocolUpdates.length} services updated (${protocolUpdates.map((r) => `${r.label}:${r.detectedProtocol}`).join(", ")})`,
      );
    }
  } catch (err) {
    logger.warn("Monitor", `Failed to update services status: ${err.message}`);
  }
}

// --- Update in-memory status ---
function updateCurrentStatus(results) {
  const onlineCount = results.filter((r) => r.status === "online").length;
  const total = results.length;

  let overall = "operational";
  if (onlineCount === 0) overall = "major_outage";
  else if (onlineCount < total) overall = "degraded";

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

// --- Check external services in batches (all batches run in parallel) ---
async function checkExternalEndpoints(supabase) {
  const externalServices = await fetchExternalServices(supabase);
  if (externalServices.length === 0) return [];

  const batches = [];
  for (let i = 0; i < externalServices.length; i += BATCH_SIZE) {
    batches.push(externalServices.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map((batch) =>
      Promise.all(batch.map((ep) => checkExternalEndpoint(ep))),
    ),
  );

  return batchResults.flat();
}

// --- Run one monitoring round ---
async function runCheck(baseUrl, supabase) {
  logger.info("Monitor", "Starting monitoring check...");

  try {
    // Check internal endpoints (from bazaar-discovery)
    const internalResults = await checkAllEndpoints(baseUrl);

    // Check external endpoints (from Supabase services table)
    const externalResults = await checkExternalEndpoints(supabase);

    const allResults = [...internalResults, ...externalResults];

    updateCurrentStatus(allResults);
    await detectTransitions(allResults, supabase);
    await persistResults(supabase, allResults);
    // Propagate status to services table (fire-and-forget, non-blocking)
    updateServicesStatus(supabase, allResults).catch((err) =>
      logger.warn("Monitor", `Services status update failed: ${err.message}`),
    );

    // Check relay wallet balance (if configured)
    // Rate-limited: max 3 Telegram alerts per chain per day
    if (isRelayConfigured()) {
      const RELAY_LOW_THRESHOLD = 10; // $10 USDC
      const MAX_RELAY_ALERTS_PER_DAY = 3;
      const today = new Date().toISOString().slice(0, 10);
      if (_relayAlertState.date !== today) {
        _relayAlertState.date = today;
        _relayAlertState.counts = {};
      }
      for (const chainKey of ["base", "polygon", "skale"]) {
        const bal = await getRelayBalance(chainKey).catch(() => null);
        if (bal && bal.balance < RELAY_LOW_THRESHOLD) {
          logger.warn(
            "Monitor",
            `Relay wallet LOW on ${chainKey}: $${bal.balance.toFixed(2)} USDC (threshold: $${RELAY_LOW_THRESHOLD})`,
          );
          const alertCount = _relayAlertState.counts[chainKey] || 0;
          if (alertCount >= MAX_RELAY_ALERTS_PER_DAY) continue;
          _relayAlertState.counts[chainKey] = alertCount + 1;
          const token = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_CHAT_ID;
          if (token && chatId) {
            const text = [
              `\uD83D\uDD34 *RELAY WALLET LOW*`,
              ``,
              `*Chain:* ${chainKey}`,
              `*Balance:* $${bal.balance.toFixed(2)} USDC`,
              `*Threshold:* $${RELAY_LOW_THRESHOLD}`,
              `*Address:* \`${bal.address.slice(0, 10)}...\``,
              `*Action:* Top up manually`,
              `_(alert ${alertCount + 1}/${MAX_RELAY_ALERTS_PER_DAY} today)_`,
            ].join("\n");
            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
              }),
            }).catch(() => {
              /* best-effort */
            });
          }
        }
      }
    }

    const onlineInternal = internalResults.filter(
      (r) => r.status === "online",
    ).length;
    const onlineExternal = externalResults.filter(
      (r) => r.status === "online",
    ).length;
    const total = allResults.length;
    logger.info(
      "Monitor",
      `Check complete: ${onlineInternal + onlineExternal}/${total} online (${internalResults.length} internal + ${externalResults.length} external)`,
    );
  } catch (err) {
    logger.error("Monitor", `Check failed: ${err.message}`);
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
    intervalId = setInterval(
      () => runCheck(baseUrl, supabase),
      CHECK_INTERVAL,
    ).unref();
  }, 30000);
  startupTimerId.unref();

  logger.info(
    "Monitor",
    `Monitoring scheduled: first check in 30s, then every ${CHECK_INTERVAL / 60000}min`,
  );
}

function stopMonitor() {
  if (startupTimerId) {
    clearTimeout(startupTimerId);
    startupTimerId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Monitor", "Monitoring stopped");
  }
}

function getStatus() {
  return currentStatus;
}

function getEndpoints() {
  return ENDPOINTS;
}

module.exports = { startMonitor, stopMonitor, getStatus, getEndpoints };
