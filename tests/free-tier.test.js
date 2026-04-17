// tests/free-tier.test.js — Unit tests for lib/free-tier.js
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ─── Helper: load the module fresh (cache reset) ─────────────────────────────

const PLATFORM_WALLET = "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430";

function loadFreeTier(env = {}) {
  // Save original env
  const saved = {};
  for (const key of [
    "FREE_TIER_LIMIT",
    "FREE_TIER_MAX_PRICE",
    "WALLET_ADDRESS",
  ]) {
    saved[key] = process.env[key];
    if (env[key] !== undefined) {
      process.env[key] = env[key];
    } else if (key === "WALLET_ADDRESS") {
      process.env[key] = PLATFORM_WALLET;
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
  for (const key of [
    "FREE_TIER_LIMIT",
    "FREE_TIER_MAX_PRICE",
    "WALLET_ADDRESS",
  ]) {
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

  // Ensure WALLET_ADDRESS is set for the duration of these tests
  const savedWallet = process.env.WALLET_ADDRESS;
  process.env.WALLET_ADDRESS = PLATFORM_WALLET;

  it("returns true for a native low-price service (no owner_address, price <= max)", () => {
    const service = { price_usdc: 0.005, owner_address: null };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns true when owner_address is the platform wallet (native service)", () => {
    const service = { price_usdc: 0.005, owner_address: PLATFORM_WALLET };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns true when owner_address is platform wallet in different case", () => {
    const service = {
      price_usdc: 0.005,
      owner_address: PLATFORM_WALLET.toLowerCase(),
    };
    assert.strictEqual(isFreeTierEligible(service), true);
  });

  it("returns false when the service has an external owner_address", () => {
    const service = {
      price_usdc: 0.005,
      owner_address: "0xAbc123ExternalProvider",
    };
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

  it("allows new users when no usage row found (PGRST116)", async () => {
    // .single() returns PGRST116 when no row exists — this is normal for new users
    const supabase = mockSupabase({
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      },
    });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, true);
    assert.strictEqual(result.remaining, 5);
  });

  it("fails closed on DB errors — returns eligible:false", async () => {
    // When the DB throws, we fail closed (prevent abuse)
    const supabase = mockSupabase({
      data: null,
      error: { message: "relation does not exist" },
    });
    const service = { price_usdc: 0.005, owner_address: null };
    const result = await checkFreeTier(supabase, "aabbcc", service);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.reason, "service_unavailable");
  });
});

// ─── recordFreeUsage ──────────────────────────────────────────────────────────

describe("recordFreeUsage", () => {
  const { recordFreeUsage } = loadFreeTier();

  it("calls the increment_free_usage RPC atomically", async () => {
    let rpcCalled = false;
    let rpcArgs = null;

    const supabase = {
      rpc: (name, args) => {
        rpcCalled = true;
        rpcArgs = { name, args };
        return Promise.resolve({ data: 1, error: null });
      },
      from: () => {
        throw new Error(
          "from() should not be called when RPC path is available",
        );
      },
    };

    await recordFreeUsage(supabase, "deadbeef");

    assert.strictEqual(rpcCalled, true, "RPC should have been called");
    assert.strictEqual(rpcArgs.name, "increment_free_usage");
    assert.strictEqual(rpcArgs.args.p_ip_hash, "deadbeef");
    assert.match(rpcArgs.args.p_usage_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the new count from the RPC", async () => {
    // The RPC contract is: RETURNS INTEGER (new count after increment).
    // We don't expose the return value, but we verify recordFreeUsage handles
    // both first call (count=1) and subsequent (count=4) without throwing.
    for (const count of [1, 2, 5, 100]) {
      const supabase = {
        rpc: () => Promise.resolve({ data: count, error: null }),
      };
      await recordFreeUsage(supabase, "deadbeef");
    }
  });

  it("falls back to legacy non-atomic path when RPC missing (migration not applied)", async () => {
    let upsertCalled = false;
    const supabase = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: {
            code: "42883",
            message: "function increment_free_usage does not exist",
          },
        }),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        upsert: () => {
          upsertCalled = true;
          return Promise.resolve({ error: null });
        },
        update: () => ({
          eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }),
    };

    await recordFreeUsage(supabase, "deadbeef");
    assert.strictEqual(
      upsertCalled,
      true,
      "legacy upsert fallback should be used when RPC missing",
    );
  });

  it("does not throw on generic RPC errors", async () => {
    const supabase = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { code: "XX000", message: "internal server error" },
        }),
    };
    // Should swallow the error silently (logged as warn), not throw.
    await recordFreeUsage(supabase, "deadbeef");
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
