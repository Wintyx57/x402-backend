// tests/api-keys.test.js — Unit tests for lib/credits.js (API Key + Credits)
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ─── Load module fresh ───────────────────────────────────────────────────────

function loadCredits() {
  Object.keys(require.cache).forEach((k) => {
    if (k.includes("lib/credits") || k.includes("lib\\credits")) {
      delete require.cache[k];
    }
  });
  return require("../lib/credits");
}

// ─── generateApiKey ───────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns a string starting with x402_sk_", () => {
    const { generateApiKey } = loadCredits();
    const key = generateApiKey();
    assert.ok(key.startsWith("x402_sk_"), `Expected prefix, got: ${key}`);
  });

  it("returns a key of exactly 56 chars (8 prefix + 48 hex)", () => {
    const { generateApiKey } = loadCredits();
    const key = generateApiKey();
    assert.strictEqual(key.length, 8 + 48); // "x402_sk_" = 8, 24 bytes = 48 hex
  });

  it("returns different keys on each call (randomness)", () => {
    const { generateApiKey } = loadCredits();
    const a = generateApiKey();
    const b = generateApiKey();
    assert.notStrictEqual(a, b);
  });

  it("suffix is valid lowercase hex (48 chars)", () => {
    const { generateApiKey } = loadCredits();
    const key = generateApiKey();
    const suffix = key.slice(8);
    assert.match(suffix, /^[0-9a-f]{48}$/);
  });
});

// ─── hashApiKey ───────────────────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("returns a 64-char lowercase hex SHA-256 digest", () => {
    const { hashApiKey } = loadCredits();
    const hash = hashApiKey("x402_sk_" + "a".repeat(48));
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same key", () => {
    const { hashApiKey } = loadCredits();
    const key = "x402_sk_" + "b".repeat(48);
    assert.strictEqual(hashApiKey(key), hashApiKey(key));
  });

  it("produces different hashes for different keys", () => {
    const { hashApiKey } = loadCredits();
    const a = hashApiKey("x402_sk_" + "a".repeat(48));
    const b = hashApiKey("x402_sk_" + "b".repeat(48));
    assert.notStrictEqual(a, b);
  });
});

// ─── keyPrefix ────────────────────────────────────────────────────────────────

describe("keyPrefix", () => {
  it("returns the first 12 characters", () => {
    const { keyPrefix } = loadCredits();
    const key = "x402_sk_abcdef0123456789";
    assert.strictEqual(keyPrefix(key), "x402_sk_abcd");
  });
});

// ─── validateApiKey ───────────────────────────────────────────────────────────

describe("validateApiKey", () => {
  it("returns null for keys not starting with x402_sk_", async () => {
    const { validateApiKey } = loadCredits();
    const supabase = {};
    const result = await validateApiKey(supabase, "sk_invalid_key");
    assert.strictEqual(result, null);
  });

  it("returns null for empty input", async () => {
    const { validateApiKey } = loadCredits();
    const result = await validateApiKey({}, "");
    assert.strictEqual(result, null);
  });

  it("returns null when DB returns no row", async () => {
    const { validateApiKey, hashApiKey } = loadCredits();
    const key = "x402_sk_" + "a".repeat(48);
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: "no rows" },
                    }),
                }),
              }),
            };
          },
        };
      },
    };
    const result = await validateApiKey(supabase, key);
    assert.strictEqual(result, null);
  });

  it("returns key row when DB finds a match", async () => {
    const { validateApiKey, hashApiKey } = loadCredits();
    const key = "x402_sk_" + "c".repeat(48);
    const mockRow = {
      id: "uuid-1",
      key_hash: hashApiKey(key),
      key_prefix: "x402_sk_cccc",
      name: "test-key",
      owner_wallet: "0x" + "a".repeat(40),
      credits_usdc: 10,
      daily_limit_usdc: null,
      daily_spent_usdc: 0,
      daily_reset_at: new Date(Date.now() - 1000).toISOString(), // recent
      last_used_at: null,
      is_active: true,
    };
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: mockRow, error: null }),
                }),
              }),
            };
          },
          update() {
            return {
              eq: () => ({ then: (r) => r({ error: null }) }),
            };
          },
        };
      },
    };
    const result = await validateApiKey(supabase, key);
    assert.ok(result, "should return a row");
    assert.strictEqual(result.name, "test-key");
    assert.strictEqual(result.is_active, true);
  });
});

// ─── deductCredits ────────────────────────────────────────────────────────────

describe("deductCredits", () => {
  it("returns { ok: false, error: insufficient_credits } when balance < amount", async () => {
    const { deductCredits } = loadCredits();
    const supabase = {};
    const result = await deductCredits(supabase, "key-id", 5.0, 2.0);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "insufficient_credits");
  });

  it("returns ok: true and credits_remaining on success", async () => {
    const { deductCredits } = loadCredits();
    const newBalance = 8.0;
    const supabase = {
      from() {
        return {
          update() {
            // eq() must support both the primary path (.gte().select().single())
            // and the fire-and-forget path (.then(null, handler))
            const eqResult = {
              gte: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { credits_usdc: newBalance },
                      error: null,
                    }),
                }),
              }),
              // Support .then(null, handler) — the fire-and-forget daily_spent update
              then: (resolve, _reject) => {
                if (typeof resolve === "function") resolve({ error: null });
              },
            };
            return {
              eq: () => eqResult,
              then: (r) => r({ error: null }),
            };
          },
        };
      },
    };
    const result = await deductCredits(supabase, "key-id", 2.0, 10.0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.credits_remaining, newBalance);
  });

  it("returns ok: false on concurrent deduction (guard failed)", async () => {
    const { deductCredits } = loadCredits();
    const supabase = {
      from() {
        return {
          update() {
            return {
              eq: () => ({
                gte: () => ({
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { message: "no match" },
                      }),
                  }),
                }),
              }),
              then: (r) => r({ error: null }),
            };
          },
        };
      },
    };
    const result = await deductCredits(supabase, "key-id", 1.0, 5.0);
    assert.strictEqual(result.ok, false);
  });
});

// ─── addCredits ───────────────────────────────────────────────────────────────

describe("addCredits", () => {
  it("returns { ok: false, error: key_not_found } when key does not exist", async () => {
    const { addCredits } = loadCredits();
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: "not found" },
                  }),
              }),
            };
          },
        };
      },
    };
    const result = await addCredits(supabase, "bad-id", 5.0);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "key_not_found");
  });

  it("returns updated balance on success", async () => {
    const { addCredits } = loadCredits();
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { credits_usdc: 5.0 }, error: null }),
              }),
            };
          },
          update() {
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { credits_usdc: 10.0 },
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
      },
    };
    const result = await addCredits(supabase, "key-id", 5.0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.credits_usdc, 10.0);
  });
});
