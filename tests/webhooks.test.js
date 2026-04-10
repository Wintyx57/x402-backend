// tests/webhooks.test.js — Unit tests for lib/webhooks.js
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ─── Load module fresh (clear require cache) ────────────────────────────────
function loadWebhooks({ stubSafeUrl = false } = {}) {
  // Clear webhooks module so it re-requires its deps fresh
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("lib/webhooks") || k.includes("lib\\webhooks")) {
      delete require.cache[k];
    }
  });

  if (stubSafeUrl) {
    // Replace safe-url in cache with a no-op stub so DNS lookups don't fail in CI
    Object.keys(require.cache).forEach((k) => {
      if (k.includes("lib/safe-url") || k.includes("lib\\safe-url")) {
        delete require.cache[k];
      }
    });
    require.cache[require.resolve("../lib/safe-url")] = {
      id: require.resolve("../lib/safe-url"),
      filename: require.resolve("../lib/safe-url"),
      loaded: true,
      exports: { safeUrl: async () => {}, _clearDnsCache: () => {} },
    };
  }

  return require("../lib/webhooks");
}

// ─── signWebhook ─────────────────────────────────────────────────────────────

describe("signWebhook", () => {
  it("returns a 64-char hex HMAC-SHA256 digest", () => {
    const { signWebhook } = loadWebhooks();
    const sig = signWebhook("0xabc123", '{"event":"payment.completed"}');
    assert.strictEqual(typeof sig, "string");
    assert.strictEqual(sig.length, 64);
    assert.match(sig, /^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const { signWebhook } = loadWebhooks();
    const body = '{"event":"test"}';
    const a = signWebhook("0xOwner", body);
    const b = signWebhook("0xOwner", body);
    assert.strictEqual(a, b);
  });

  it("produces different signatures for different secrets", () => {
    const { signWebhook } = loadWebhooks();
    const body = '{"event":"test"}';
    const a = signWebhook("0xAAA", body);
    const b = signWebhook("0xBBB", body);
    assert.notStrictEqual(a, b);
  });

  it("normalises secret to lowercase before signing", () => {
    const { signWebhook } = loadWebhooks();
    const body = '{"event":"test"}';
    const lower = signWebhook("0xabcDEF", body);
    const upper = signWebhook("0xABCDEF", body);
    // Both should be identical because the secret is lowercased internally
    assert.strictEqual(lower, upper);
  });
});

// ─── deliverWebhook ───────────────────────────────────────────────────────────

describe("deliverWebhook", () => {
  // We patch the global fetch for each test
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it("returns true on HTTP 200", async () => {
    global.fetch = async () => ({ status: 200 });
    const { deliverWebhook } = loadWebhooks();
    const ok = await deliverWebhook(
      "https://example.com/hook",
      '{"event":"payment.completed"}',
      "abc",
    );
    global.fetch = originalFetch;
    assert.strictEqual(ok, true);
  });

  it("returns true on HTTP 201", async () => {
    global.fetch = async () => ({ status: 201 });
    const { deliverWebhook } = loadWebhooks();
    const ok = await deliverWebhook("https://example.com/hook", "{}", "sig");
    global.fetch = originalFetch;
    assert.strictEqual(ok, true);
  });

  it("returns false on HTTP 4xx", async () => {
    global.fetch = async () => ({ status: 404 });
    const { deliverWebhook } = loadWebhooks();
    const ok = await deliverWebhook("https://example.com/hook", "{}", "sig");
    global.fetch = originalFetch;
    assert.strictEqual(ok, false);
  });

  it("returns false on network error (throws)", async () => {
    global.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const { deliverWebhook } = loadWebhooks();
    const ok = await deliverWebhook("https://example.com/hook", "{}", "sig");
    global.fetch = originalFetch;
    assert.strictEqual(ok, false);
  });

  it("sends X-Webhook-Signature header with sha256= prefix", async () => {
    let capturedHeaders = null;
    global.fetch = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return { status: 200 };
    };
    const { deliverWebhook } = loadWebhooks();
    await deliverWebhook("https://example.com/hook", "{}", "deadbeef");
    global.fetch = originalFetch;
    assert.ok(capturedHeaders);
    assert.strictEqual(
      capturedHeaders["X-Webhook-Signature"],
      "sha256=deadbeef",
    );
  });
});

// ─── notifyWebhook ────────────────────────────────────────────────────────────

describe("notifyWebhook", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it("skips silently when webhook_url is null", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { status: 200 };
    };
    const { notifyWebhook } = loadWebhooks();
    const service = {
      id: "svc-1",
      name: "Test",
      owner_address: "0x" + "a".repeat(40),
      webhook_url: null,
    };
    await notifyWebhook(service, {
      amount_usdc: 0.01,
      caller_wallet: null,
      tx_hash: null,
      chain: "skale",
    });
    global.fetch = originalFetch;
    // Small delay to ensure fire-and-forget did not run
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(fetchCalled, false);
  });

  it("skips silently when webhook_url is undefined", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { status: 200 };
    };
    const { notifyWebhook } = loadWebhooks();
    const service = {
      id: "svc-2",
      name: "Test",
      owner_address: "0x" + "a".repeat(40),
    };
    await notifyWebhook(service, { amount_usdc: 0.01, chain: "base" });
    global.fetch = originalFetch;
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(fetchCalled, false);
  });

  it("blocks SSRF: does not fetch internal URLs", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { status: 200 };
    };
    const { notifyWebhook } = loadWebhooks();
    const service = {
      id: "svc-3",
      name: "Test",
      owner_address: "0x" + "a".repeat(40),
      webhook_url: "https://localhost/hook",
    };
    await notifyWebhook(service, {
      amount_usdc: 0.01,
      chain: "base",
    });
    global.fetch = originalFetch;
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(fetchCalled, false);
  });

  it("payload shape matches the spec", async () => {
    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { status: 200 };
    };
    // stubSafeUrl: bypass DNS lookup so this test works in offline/CI environments
    const { notifyWebhook } = loadWebhooks({ stubSafeUrl: true });
    const service = {
      id: "svc-uuid-123",
      name: "My API",
      owner_address: "0x" + "b".repeat(40),
      webhook_url: "https://hooks.example.com/payment",
    };
    await notifyWebhook(service, {
      amount_usdc: 0.005,
      caller_wallet: "0x" + "c".repeat(40),
      tx_hash: "0x" + "d".repeat(64),
      chain: "base",
    });
    // Give the fire-and-forget a tick to run
    await new Promise((r) => setTimeout(r, 200));
    global.fetch = originalFetch;

    assert.ok(capturedBody, "fetch should have been called");
    assert.strictEqual(capturedBody.event, "payment.completed");
    assert.strictEqual(capturedBody.service_id, "svc-uuid-123");
    assert.strictEqual(capturedBody.service_name, "My API");
    assert.strictEqual(capturedBody.amount_usdc, "0.005");
    assert.strictEqual(capturedBody.chain, "base");
    assert.ok(capturedBody.timestamp);
  });
});
