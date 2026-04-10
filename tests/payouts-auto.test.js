// tests/payouts-auto.test.js — Unit tests for auto-payout + admin payout endpoints
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPayoutManager } = require("../lib/payouts");

// ─── Minimal Supabase mock builder ────────────────────────────────────────────

function makeSupabase(opts = {}) {
  // opts.pendingRows  — rows returned for status=pending fetch
  // opts.updateError  — error returned by update()
  // opts.insertError  — error returned by insert()
  // opts.markData     — rows returned by markPayoutsPaid update
  return {
    from(table) {
      return {
        select(fields) {
          const chain = {
            eq: () => chain,
            neq: () => chain,
            in: () => chain,
            ilike: () => chain,
            order: () => chain,
            limit: () => chain,
            then: (resolve) =>
              resolve({
                data: opts.pendingRows || [],
                error: opts.selectError || null,
              }),
          };
          return chain;
        },
        insert(rows) {
          return {
            select() {
              if (opts.insertError)
                return Promise.resolve({ data: null, error: opts.insertError });
              return Promise.resolve({
                data: Array.isArray(rows)
                  ? rows.map((r, i) => ({ id: `id-${i}`, ...r }))
                  : [{ id: "id-0", ...rows }],
                error: null,
              });
            },
          };
        },
        update(fields) {
          return {
            eq: () => ({
              select: () => Promise.resolve({ data: [fields], error: null }),
            }),
            in(col, ids) {
              return {
                select() {
                  if (opts.updateError)
                    return Promise.resolve({
                      data: null,
                      error: opts.updateError,
                    });
                  const rows = opts.markData || ids.map((id) => ({ id }));
                  return Promise.resolve({ data: rows, error: null });
                },
                then: (resolve) => resolve({ error: opts.updateError || null }),
              };
            },
            then: (resolve) => resolve({ error: opts.updateError || null }),
          };
        },
      };
    },
  };
}

// ─── autoPayout ───────────────────────────────────────────────────────────────

describe("autoPayout", () => {
  it("returns wallets_processed=0 when no rows above threshold", async () => {
    const supabase = makeSupabase({ pendingRows: [] });
    const pm = createPayoutManager(supabase);
    const result = await pm.autoPayout(1);
    assert.strictEqual(result.wallets_processed, 0);
    assert.strictEqual(result.total_usdc, 0);
    assert.deepEqual(result.wallets, []);
  });

  it("groups rows by provider_wallet and returns correct total", async () => {
    const walletA = "0x" + "a".repeat(40);
    const walletB = "0x" + "b".repeat(40);
    const pendingRows = [
      {
        id: "p1",
        provider_wallet: walletA,
        provider_amount: "0.5",
        service_name: "A",
        chain: "base",
        created_at: "2026-01-01",
      },
      {
        id: "p2",
        provider_wallet: walletA,
        provider_amount: "0.7",
        service_name: "A",
        chain: "base",
        created_at: "2026-01-01",
      },
      {
        id: "p3",
        provider_wallet: walletB,
        provider_amount: "2.0",
        service_name: "B",
        chain: "skale",
        created_at: "2026-01-01",
      },
    ];
    const supabase = makeSupabase({ pendingRows });
    const pm = createPayoutManager(supabase);
    const result = await pm.autoPayout(1);
    assert.strictEqual(result.wallets_processed, 2);
    assert.ok(result.total_usdc >= 3.2 - 0.0001);
  });

  it("filters out wallets below threshold", async () => {
    const walletA = "0x" + "a".repeat(40);
    const pendingRows = [
      {
        id: "p1",
        provider_wallet: walletA,
        provider_amount: "0.3",
        service_name: "A",
        chain: "base",
        created_at: "2026-01-01",
      },
    ];
    const supabase = makeSupabase({ pendingRows });
    const pm = createPayoutManager(supabase);
    // threshold = 1 USDC, walletA only has 0.3
    const result = await pm.autoPayout(1);
    assert.strictEqual(result.wallets_processed, 0);
  });

  it("returns error object on DB select failure", async () => {
    const supabase = makeSupabase({
      selectError: { message: "DB unavailable" },
    });
    const pm = createPayoutManager(supabase);
    const result = await pm.autoPayout(1);
    assert.ok(result.error, "should have error key");
  });

  it("skips wallet on update error but continues others", async () => {
    // This tests the continue-on-error path in autoPayout
    const walletA = "0x" + "a".repeat(40);
    const pendingRows = [
      {
        id: "p1",
        provider_wallet: walletA,
        provider_amount: "2.0",
        service_name: "A",
        chain: "base",
        created_at: "2026-01-01",
      },
    ];
    const supabase = makeSupabase({
      pendingRows,
      updateError: { message: "update failed" },
    });
    const pm = createPayoutManager(supabase);
    const result = await pm.autoPayout(1);
    // walletA update failed — should be skipped, not crash
    assert.strictEqual(result.wallets_processed, 0);
  });
});

// ─── markPayoutsPaid ──────────────────────────────────────────────────────────

describe("markPayoutsPaid", () => {
  it("returns updated count on success", async () => {
    const ids = ["id-1", "id-2", "id-3"];
    const supabase = makeSupabase({
      markData: ids.map((id) => ({ id, status: "paid" })),
    });
    const pm = createPayoutManager(supabase);
    const result = await pm.markPayoutsPaid(ids, "0x" + "f".repeat(64));
    assert.ok(typeof result.updated === "number");
  });

  it("returns error on DB failure", async () => {
    const supabase = makeSupabase({
      updateError: { message: "constraint violation" },
    });
    const pm = createPayoutManager(supabase);
    const result = await pm.markPayoutsPaid(["id-1"], "0x" + "f".repeat(64));
    assert.ok(result.error, "should have error key");
  });
});
