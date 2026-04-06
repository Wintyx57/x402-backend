// tests/proxy-supertest.test.js — Integration tests for routes/proxy.js
//
// Strategy: mount createProxyRouter on a minimal Express app, backed by a mock
// Supabase and a real upstream HTTP server (http.createServer). No supertest
// dependency — uses node:http for requests (consistent with the rest of the suite).
//
// Covered paths (all exercised without a real blockchain):
//   1. Invalid serviceId format            → 400
//   2. Unknown serviceId                   → 404
//   3. Missing required parameters         → 400 + _payment_status: not_charged
//   4. Unpayable upstream protocol         → 502 UPSTREAM_PROTOCOL_UNSUPPORTED
//   5. Full proxy flow via free tier       → 200 + upstream JSON body forwarded
//   6. Upstream returns 5xx               → 502 Bad Gateway
//
// SSRF bypass: safeUrl is patched to allow 127.0.0.1 so that the mock upstream
// server (which listens on localhost) is reachable from the proxy during tests.
// The patch is applied before require('routes/proxy') and undone on process exit.
"use strict";

// ─── SSRF bypass (must happen before routes/proxy is required) ────────────────
const safeUrlModule = require("../lib/safe-url");
const _origSafeUrl = safeUrlModule.safeUrl;
safeUrlModule.safeUrl = async (url) => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP/HTTPS URLs allowed");
  }
  return parsed;
};
process.on("exit", () => {
  safeUrlModule.safeUrl = _origSafeUrl;
});

// ─── Modules under test ───────────────────────────────────────────────────────
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const rateLimit = require("express-rate-limit");
const createProxyRouter = require("../routes/proxy");

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Make an HTTP POST request and resolve with { status, headers, body }. */
function request(port, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(extraHeaders || {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Start a real HTTP server on a random port and resolve with { server, port }. */
function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
    server.on("error", reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

// ─── Mock Supabase ────────────────────────────────────────────────────────────

function makeMockSupabase(serviceRow) {
  function makeChain(tableName) {
    const chain = {
      _table: tableName,
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      neq() {
        return chain;
      },
      in() {
        return chain;
      },
      limit() {
        return chain;
      },
      order() {
        return chain;
      },
      range() {
        return chain;
      },
      contains() {
        return chain;
      },
      lte() {
        return chain;
      },
      or() {
        return chain;
      },
      update() {
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      upsert() {
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        return { eq: () => Promise.resolve({ error: null }) };
      },
      single() {
        if (chain._table === "services") {
          if (serviceRow)
            return Promise.resolve({ data: serviceRow, error: null });
          return Promise.resolve({
            data: null,
            error: { message: "not found", code: "PGRST116" },
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(onFulfilled) {
        onFulfilled({ data: [], count: 0, error: null });
      },
    };
    return chain;
  }
  return { from: (table) => makeChain(table) };
}

// ─── Payment middleware stub ──────────────────────────────────────────────────

function makePaymentMiddleware() {
  return function () {
    return function (_req, _res, next) {
      next();
    };
  };
}

// ─── App factory ─────────────────────────────────────────────────────────────

function buildApp(serviceRow) {
  const app = express();
  app.set("trust proxy", 0);
  app.use(express.json());

  const paidLimiter = rateLimit({
    windowMs: 60_000,
    max: 10_000,
    standardHeaders: false,
    legacyHeaders: false,
  });

  app.use(
    createProxyRouter(
      makeMockSupabase(serviceRow),
      () => {},
      makePaymentMiddleware(),
      paidLimiter,
      { queuePayout: async () => {}, processPending: async () => {} },
      { verifySplitPayment: async () => ({ valid: false }) },
      null,
    ),
  );

  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

function startApp(serviceRow) {
  return new Promise((resolve, reject) => {
    const server = buildApp(serviceRow).listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
    server.on("error", reject);
  });
}

// ─── Shared constants ─────────────────────────────────────────────────────────

const VALID_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const VALID_OWNER = "0x" + "a".repeat(40);

// ─── Suite 1: UUID / serviceId validation ─────────────────────────────────────

describe("proxy integration — serviceId validation", () => {
  let server;
  let port;

  before(async () => {
    ({ server, port } = await startApp(null));
  });
  after(async () => {
    await stopServer(server);
  });

  it("should return 400 for a clearly invalid UUID", async () => {
    const res = await request(port, "/api/call/not-a-uuid");
    assert.equal(res.status, 400);
    assert.ok(res.body.error, "should include an error field");
  });

  it("should return 400 for a 32-char hex string (no dashes)", async () => {
    const res = await request(port, "/api/call/" + "a".repeat(32));
    assert.equal(res.status, 400);
  });

  it("should return 400 for an empty serviceId placeholder", async () => {
    const res = await request(port, "/api/call/%20");
    assert.equal(res.status, 400);
  });
});

// ─── Suite 2: Service not found ───────────────────────────────────────────────

describe("proxy integration — service not found", () => {
  let server;
  let port;

  before(async () => {
    ({ server, port } = await startApp(null));
  });
  after(async () => {
    await stopServer(server);
  });

  it("should return 404 when the serviceId is valid but not in DB", async () => {
    const res = await request(port, `/api/call/${VALID_UUID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Service not found");
  });
});

// ─── Suite 3: Parameter Gatekeeper ───────────────────────────────────────────
//
// The gatekeeper rejects missing required params BEFORE any payment attempt.
// "Gatekeeper fired" = status 400 + _payment_status: not_charged + missing array.

describe("proxy integration — parameter gatekeeper (pre-payment)", () => {
  let server;
  let port;

  before(async () => {
    const service = {
      id: VALID_UUID,
      name: "Weather API",
      url: "https://x402-api.onrender.com/api/weather",
      price_usdc: 0.005,
      owner_address: null,
      tags: [],
      description: "",
      required_parameters: {
        required: ["city"],
        properties: { city: { type: "string", description: "City name" } },
      },
      encrypted_credentials: null,
      payment_protocol: null,
    };
    ({ server, port } = await startApp(service));
  });

  after(async () => {
    await stopServer(server);
  });

  it("should return 400 with _payment_status:not_charged when required param is absent", async () => {
    const res = await request(port, `/api/call/${VALID_UUID}`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body._payment_status, "not_charged");
    assert.ok(
      Array.isArray(res.body.missing),
      "missing field should be an array",
    );
    assert.ok(
      res.body.missing.includes("city"),
      "missing array should name 'city'",
    );
  });

  it("should NOT return a gatekeeper 400 when the required param is provided", async () => {
    // With 'city' present the gatekeeper passes. Downstream may still return
    // 402/5xx/403 — what matters is the absence of the gatekeeper signature.
    const res = await request(port, `/api/call/${VALID_UUID}`, {
      city: "Paris",
    });
    const isGatekeeperError =
      res.status === 400 &&
      res.body._payment_status === "not_charged" &&
      Array.isArray(res.body.missing);
    assert.ok(
      !isGatekeeperError,
      "gatekeeper must not fire when params are present",
    );
  });
});

// ─── Suite 4: Unpayable upstream protocol ─────────────────────────────────────

describe("proxy integration — unpayable upstream protocol", () => {
  it("should return 502 UPSTREAM_PROTOCOL_UNSUPPORTED for l402 services", async () => {
    const service = {
      id: VALID_UUID,
      name: "L402 Service",
      url: "https://api.example.com/data",
      price_usdc: 0.01,
      owner_address: VALID_OWNER,
      tags: [],
      description: "",
      required_parameters: null,
      encrypted_credentials: null,
      payment_protocol: "l402",
    };
    const { server, port } = await startApp(service);
    try {
      const res = await request(port, `/api/call/${VALID_UUID}`, {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error, "UPSTREAM_PROTOCOL_UNSUPPORTED");
      assert.equal(res.body._payment_status, "not_charged");
      assert.ok(
        res.body.upstream_protocol,
        "should include upstream_protocol field",
      );
    } finally {
      await stopServer(server);
    }
  });

  it("should return 502 UPSTREAM_PROTOCOL_UNSUPPORTED for stripe402 services", async () => {
    const service = {
      id: VALID_UUID,
      name: "Stripe402 Service",
      url: "https://api.example.com/data",
      price_usdc: 0.01,
      owner_address: VALID_OWNER,
      tags: [],
      description: "",
      required_parameters: null,
      encrypted_credentials: null,
      payment_protocol: "stripe402",
    };
    const { server, port } = await startApp(service);
    try {
      const res = await request(port, `/api/call/${VALID_UUID}`, {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error, "UPSTREAM_PROTOCOL_UNSUPPORTED");
    } finally {
      await stopServer(server);
    }
  });
});

// ─── Suite 5: Full upstream call via free tier ───────────────────────────────
//
// Service: price_usdc = 0, owner_address = null → isFreeTierEligible() = true.
// The proxy calls the mock upstream directly (free-tier path, no payment).
// The SSRF bypass at the top of this file allows 127.0.0.1 connections.

describe("proxy integration — full upstream call (free tier)", () => {
  let upstream;
  let upstreamPort;
  let app;
  let appPort;

  before(async () => {
    ({ server: upstream, port: upstreamPort } = await startServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ temperature: 22, city: "Paris", unit: "C" }));
      },
    ));

    const service = {
      id: VALID_UUID,
      name: "Free Weather",
      url: `http://127.0.0.1:${upstreamPort}/weather`,
      price_usdc: 0,
      owner_address: null,
      tags: [],
      description: "",
      required_parameters: null,
      encrypted_credentials: null,
      payment_protocol: null,
    };
    ({ server: app, port: appPort } = await startApp(service));
  });

  after(async () => {
    await stopServer(app);
    await stopServer(upstream);
  });

  it("should return 200 and forward the upstream JSON body", async () => {
    const res = await request(appPort, `/api/call/${VALID_UUID}`, {});
    assert.equal(
      res.status,
      200,
      `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const bodyStr = JSON.stringify(res.body);
    assert.ok(
      bodyStr.includes("22") || bodyStr.includes("Paris"),
      "upstream data should appear in response",
    );
  });

  it("should set X-Free-Tier: true response header", async () => {
    const res = await request(appPort, `/api/call/${VALID_UUID}`, {});
    assert.equal(res.headers["x-free-tier"], "true");
  });

  it("should include _x402 metadata in the response", async () => {
    const res = await request(appPort, `/api/call/${VALID_UUID}`, {});
    assert.equal(res.status, 200);
    assert.ok(res.body._x402, "response should include _x402 metadata");
    assert.ok(res.body.service, "response should include service metadata");
    assert.equal(res.body.service.name, "Free Weather");
  });
});

// ─── Suite 6: Upstream 5xx error ─────────────────────────────────────────────
//
// When the upstream returns a 5xx, the proxy must not charge the user and must
// return 502 Bad Gateway. The SSRF bypass allows the mock upstream on 127.0.0.1.

describe("proxy integration — upstream 5xx error", () => {
  let upstream;
  let app;
  let appPort;

  before(async () => {
    const { server: upServer, port: upPort } = await startServer(
      (_req, res) => {
        res.writeHead(500);
        res.end("Internal Server Error");
      },
    );
    upstream = upServer;

    const service = {
      id: VALID_UUID,
      name: "Failing API",
      url: `http://127.0.0.1:${upPort}/api`,
      price_usdc: 0,
      owner_address: null,
      tags: [],
      description: "",
      required_parameters: null,
      encrypted_credentials: null,
      payment_protocol: null,
    };
    ({ server: app, port: appPort } = await startApp(service));
  });

  after(async () => {
    await stopServer(app);
    await stopServer(upstream);
  });

  it("should return 502 when upstream returns a 5xx status", async () => {
    const res = await request(appPort, `/api/call/${VALID_UUID}`, {});
    assert.equal(
      res.status,
      502,
      `expected 502 bad gateway, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });
});
