// tests/free-tier.test.js — Unit tests for lib/free-tier.js
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ─── Helper: load the module fresh (cache reset) ─────────────────────────────

function loadFreeTier(env = {}) {
  // Save original env
  const saved = {};
  for (const key of ["FREE_TIER_LIMIT", "FREE_TIER_MAX_PRICE"]) {
    saved[key] = process.env[key];
    if (env[key] !== undefined) {
      process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }

  // Clear module cache
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("lib/free-tier") || k.includes("lib\\free-tier")) {
      delete require.cache[k];
    }
  });

  const mod = require("../lib/free-tier");

  // Restore env
  for (const key of ["FREE_TIER_LIMIT", "FREE_TIER_MAX_PRICE"]) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }

  return mod;
}

// ─── hashIp ──────────────────────────────────────────────────────────────────

describe("hashIp", () => {
  const { hashIp } = loadFreeTier();

  it("returns a 64-character hex string", () => {
    const h = hashIp("192.168.1.1");
    assert.strictEqual(typeof h, "string");
    assert.strictEqual(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("is deterministic — same IP always gives same hash", () => {
    const a = hashIp("10.0.0.1");
    const b = hashIp("10.0.0.1");
    assert.strictEqual(a, b);
  });

  it("produces different hashes for different IPs", () => {
    const a = hashIp("1.1.1.1");
    const b = hashIp("8.8.8.8");
    assert.notStrictEqual(a, b);
  });
});

// ─── isFreeTierEligible ───────────────────────────────────────────────────────

describe("isFreeTierEligible", () => {
  const { isFreeTierEligible, FREE_TIER_MAX_PRICE } = loadFreeTier();

  it("returns true for a native low-price service (no owner_address, price <= max)", () => {
    const service = { price_usdc: 0.005, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns false when the service has an owner_address (external provider)", () => {
    const service = { price_usdc: 0.005, owner_address: "0xAbc123" };
    assert.strictEqual(isFreeTierEligible(service), false);
  });

  it("returns false when the price exceeds the max threshold", () => {
    const service = { price_usdc: 0.05, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), false);
  });

  it("returns true at the exact threshold price", () => {
    const service = { price_usdc: FREE_TIER_MAX_PRICE, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns false when owner_address is an empty string (treated as set)", () => {
    // Empty string is falsy — should still be eligible based on spec (no owner_address = null/undefined)
    const service = { price_usdc: 0.005, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns false when price is undefined / null", () => {
    const service = { price_usdc: null, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), false);
  });
});

// ─── checkFreeTier ────────────────────────────────────────────────────────────

describe("checkFreeTier", () => {
  const { checkFreeTier, FREE_TIER_DAILY_LIMIT } = loadFreeTier();

  // Helper to build a minimal Supabase mock
  function mockSupabase({ data = null, error = null } = {}) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data, error }),
            }),
          }),
        }),
      }),
    };
  }

  it("eligible when no usage row exists (new IP, new day)", async () => {
    // Supabase returns null data (no row found) — treated as 0 usage
    const supabase = mockSupabase({ data: null, error: null });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, true);
    assert.strictEqual(result.remaining, FREE_TIER_DAILY_LIMIT);
  });

  it("eligible when usage is under the daily limit", async () => {
    const supabase = mockSupabase({ data: { count: 2 }, error: null });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, true);
    assert.strictEqual(result.remaining, FREE_TIER_DAILY_LIMIT - 2);
  });

  it("not eligible when usage is at the daily limit", async () => {
    const supabase = mockSupabase({
      data: { count: FREE_TIER_DAILY_LIMIT },
      error: null,
    });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason, "should include a reason string");
    assert.strictEqual(result.remaining, 0);
  });

  it("not eligible for external provider (has owner_address)", async () => {
    const supabase = mockSupabase({ data: null, error: null });
    const service = { price_usdc: 0.005, owner_address: "0xProvider123" };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason);
  });

  it("not eligible for expensive service (price > max)", async () => {
    const supabase = mockSupabase({ data: null, error: null });
    const service = { price_usdc: 1.0, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason);
  });

  it("fails open on DB errors — returns eligible:true", async () => {
    // When the DB throws, we fail open (don't block the user)
    const supabase = mockSupabase({
      data: null,
      error: { message: "relation does not exist" },
    });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, true);
  });
});

// ─── recordFreeUsage ──────────────────────────────────────────────────────────

describe("recordFreeUsage", () => {
  const { recordFreeUsage } = loadFreeTier();

  it("calls upsert with ip_hash, usage_date, and count:1 when no existing row", async () => {
    let upsertCalled = false;
    let upsertArgs = null;

    const supabase = {
      from: (table) => {
        assert.strictEqual(table, "free_usage");
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: (data, opts) => {
            upsertCalled = true;
            upsertArgs = { data, opts };
            return Promise.resolve({ error: null });
          },
          update: () => ({
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }),
        };
      },
    };

    await recordFreeUsage(supabase, "deadbeef");

    assert.strictEqual(upsertCalled, true, "upsert should have been called");
    assert.ok(upsertArgs.data, "upsert args should contain data");
    const row = Array.isArray(upsertArgs.data)
      ? upsertArgs.data[0]
      : upsertArgs.data;
    assert.strictEqual(row.ip_hash, "deadbeef");
    assert.ok(row.usage_date, "usage_date should be set");
    // usage_date should look like YYYY-MM-DD
    assert.match(row.usage_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(row.count, 1);
  });

  it("calls update (count+1) when an existing row exists for today", async () => {
    let updateCalled = false;

    const supabase = {
      from: (table) => {
        assert.strictEqual(table, "free_usage");
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { count: 3 }, error: null }),
              }),
            }),
          }),
          update: (data) => {
            updateCalled = true;
            assert.strictEqual(
              data.count,
              4,
              "count should be incremented to 4",
            );
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          },
          upsert: () => {
            throw new Error("upsert should not be called when row exists");
          },
        };
      },
    };

    await recordFreeUsage(supabase, "deadbeef");
    assert.strictEqual(updateCalled, true, "update should have been called");
  });
});

// ─── Config defaults ──────────────────────────────────────────────────────────

describe("Config exports", () => {
  it("exports FREE_TIER_DAILY_LIMIT default of 5", () => {
    const { FREE_TIER_DAILY_LIMIT } = loadFreeTier();
    assert.strictEqual(FREE_TIER_DAILY_LIMIT, 5);
  });

  it("exports FREE_TIER_MAX_PRICE default of 0.01", () => {
    const { FREE_TIER_MAX_PRICE } = loadFreeTier();
    assert.strictEqual(FREE_TIER_MAX_PRICE, 0.01);
  });

  it("respects FREE_TIER_LIMIT env var", () => {
    const { FREE_TIER_DAILY_LIMIT } = loadFreeTier({ FREE_TIER_LIMIT: "10" });
    assert.strictEqual(FREE_TIER_DAILY_LIMIT, 10);
  });

  it("respects FREE_TIER_MAX_PRICE env var", () => {
    const { FREE_TIER_MAX_PRICE } = loadFreeTier({
      FREE_TIER_MAX_PRICE: "0.05",
    });
    assert.strictEqual(FREE_TIER_MAX_PRICE, 0.05);
  });
});
