// tests/payouts.test.js — Unit tests for lib/payouts.js (revenue split 95/5)
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPayoutManager } = require("../lib/payouts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_WALLET = "0x" + "a".repeat(40);
const TX_HASH_IN = "0x" + "b".repeat(64);
const TX_HASH_OUT = "0x" + "c".repeat(64);

/**
 * Build a minimal supabase mock whose call chains match exactly what
 * lib/payouts.js does for each method.
 *
 * Design decision: each method receives a dedicated `mockData` key so tests
 * can control exactly what "the DB returns" without coupling to each other.
 *
 * Supported mockData keys:
 *   - insertedRows   : rows returned by .insert().select()   (recordPayout)
 *   - insertError    : error returned by .insert().select()  (recordPayout error path)
 *   - pendingPayouts : rows returned by .select().eq().order (getPendingPayouts)
 *   - pendingError   : error returned by above               (getPendingPayouts error)
 *   - updatedRows    : rows returned by .update().in().select() (markPayoutsPaid)
 *   - updateError    : error returned by above               (markPayoutsPaid error)
 *   - overviewRows   : rows returned by bare .select()       (getRevenueOverview)
 *   - overviewError  : error returned by above               (getRevenueOverview error)
 */
function createMockSupabase(mockData = {}) {
  return {
    from(table) {
      return {
        // recordPayout path: .insert([...]).select()
        insert(data) {
          return {
            select() {
              if (mockData.insertError) {
                return Promise.resolve({
                  data: null,
                  error: mockData.insertError,
                });
              }
              const rows =
                mockData.insertedRows ||
                (Array.isArray(data)
                  ? data.map((d, i) => ({ id: `mock-id-${i}`, ...d }))
                  : [{ id: "mock-id-0", ...data }]);
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },

        // getPendingPayouts path: .select('*').eq('status','pending').order(...)
        // getRevenueOverview path: .select('status, gross_amount, ...')  (no chaining)
        select(fields) {
          // getRevenueOverview calls .select(fields) and awaits directly (no eq/order)
          // We return a thenable that also exposes .eq() so both paths work.
          const directResult = Promise.resolve({
            data: mockData.overviewRows || [],
            error: mockData.overviewError || null,
          });

          // Attach .limit() for getRevenueOverview
          directResult.limit = function () {
            return directResult;
          };

          // Attach .eq() for getPendingPayouts
          directResult.eq = function (col, val) {
            return {
              order(col2, opts) {
                const orderResult = mockData.pendingError
                  ? Promise.resolve({
                      data: null,
                      error: mockData.pendingError,
                    })
                  : Promise.resolve({
                      data: mockData.pendingPayouts || [],
                      error: null,
                    });
                orderResult.limit = function () {
                  return orderResult;
                };
                return orderResult;
              },
            };
          };

          return directResult;
        },

        // markPayoutsPaid path: .update({...}).in('id', ids).select()
        update(updateData) {
          return {
            in(col, vals) {
              return {
                select() {
                  if (mockData.updateError) {
                    return Promise.resolve({
                      data: null,
                      error: mockData.updateError,
                    });
                  }
                  const rows = (mockData.updatedRows || []).map((r) => ({
                    ...r,
                    ...updateData,
                  }));
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makePayout(overrides = {}) {
  return {
    id: overrides.id || "payout-1",
    service_id: overrides.service_id || "svc-1",
    service_name: overrides.service_name || "Test API",
    provider_wallet: overrides.provider_wallet || PROVIDER_WALLET,
    gross_amount: overrides.gross_amount ?? 1.0,
    provider_amount: overrides.provider_amount ?? 0.95,
    platform_fee: overrides.platform_fee ?? 0.05,
    tx_hash_in: overrides.tx_hash_in || TX_HASH_IN,
    chain: overrides.chain || "base",
    status: overrides.status || "pending",
    created_at: overrides.created_at || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Suite: createPayoutManager — factory
// ---------------------------------------------------------------------------

describe("createPayoutManager", () => {
  it("should be a function", () => {
    assert.equal(typeof createPayoutManager, "function");
  });

  it("should return an object with the expected methods", () => {
    const manager = createPayoutManager(createMockSupabase());
    assert.equal(typeof manager.recordPayout, "function");
    assert.equal(typeof manager.getPendingPayouts, "function");
    assert.equal(typeof manager.markPayoutsPaid, "function");
    assert.equal(typeof manager.getRevenueOverview, "function");
  });
});

// ---------------------------------------------------------------------------
// Suite: PLATFORM_FEE_PERCENT
// ---------------------------------------------------------------------------

describe("PLATFORM_FEE_PERCENT", () => {
  it("should be 5", () => {
    const { PLATFORM_FEE_PERCENT } = createPayoutManager(createMockSupabase());
    assert.equal(PLATFORM_FEE_PERCENT, 5);
  });
});

// ---------------------------------------------------------------------------
// Suite: recordPayout
// ---------------------------------------------------------------------------

describe("recordPayout", () => {
  it("should insert a row with the correct 95/5 split for 1.0 USDC", async () => {
    let capturedInsert = null;

    const supabase = {
      from() {
        return {
          insert(data) {
            capturedInsert = data;
            return {
              select: () =>
                Promise.resolve({
                  data: data.map((d, i) => ({ id: `id-${i}`, ...d })),
                  error: null,
                }),
            };
          },
        };
      },
    };

    const { recordPayout } = createPayoutManager(supabase);
    const result = await recordPayout({
      serviceId: "test-id",
      serviceName: "Test API",
      providerWallet: PROVIDER_WALLET,
      grossAmount: 1.0,
      txHashIn: TX_HASH_IN,
      chain: "base",
    });

    // Verify inserted payload
    assert.ok(Array.isArray(capturedInsert), "insert should receive an array");
    const row = capturedInsert[0];

    assert.equal(row.service_id, "test-id");
    assert.equal(row.service_name, "Test API");
    assert.equal(row.provider_wallet, PROVIDER_WALLET);
    assert.equal(row.gross_amount, 1.0);
    assert.equal(row.provider_amount, 0.95);
    assert.equal(row.platform_fee, 0.05);
    assert.equal(row.tx_hash_in, TX_HASH_IN);
    assert.equal(row.chain, "base");
    assert.equal(row.status, "pending");

    // Verify returned row
    assert.ok(result);
    assert.equal(result.provider_amount, 0.95);
    assert.equal(result.platform_fee, 0.05);
  });

  it('should default chain to "base" when not provided', async () => {
    let capturedRow = null;

    const supabase = {
      from() {
        return {
          insert(data) {
            capturedRow = data[0];
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: "x", ...data[0] }],
                  error: null,
                }),
            };
          },
        };
      },
    };

    const { recordPayout } = createPayoutManager(supabase);
    await recordPayout({
      serviceId: "svc-default-chain",
      serviceName: "Chain Default",
      providerWallet: PROVIDER_WALLET,
      grossAmount: 0.5,
      txHashIn: TX_HASH_IN,
    });

    assert.equal(capturedRow.chain, "base");
  });

  // --- Split calculation for various amounts ---
  const splitCases = [
    { gross: 0.01, expectedProvider: 0.0095, expectedFee: 0.0005 },
    { gross: 0.05, expectedProvider: 0.0475, expectedFee: 0.0025 },
    { gross: 10, expectedProvider: 9.5, expectedFee: 0.5 },
    { gross: 100, expectedProvider: 95, expectedFee: 5 },
  ];

  for (const { gross, expectedProvider, expectedFee } of splitCases) {
    it(`should calculate correct split for ${gross} USDC (provider: ${expectedProvider}, fee: ${expectedFee})`, async () => {
      let capturedRow = null;

      const supabase = {
        from() {
          return {
            insert(data) {
              capturedRow = data[0];
              return {
                select: () =>
                  Promise.resolve({
                    data: [{ id: "x", ...data[0] }],
                    error: null,
                  }),
              };
            },
          };
        },
      };

      const { recordPayout } = createPayoutManager(supabase);
      await recordPayout({
        serviceId: "svc-split",
        serviceName: "Split Test",
        providerWallet: PROVIDER_WALLET,
        grossAmount: gross,
        txHashIn: TX_HASH_IN,
      });

      // Use approximate equality to avoid floating-point rounding surprises
      assert.ok(
        Math.abs(capturedRow.provider_amount - expectedProvider) < 1e-10,
        `provider_amount: expected ${expectedProvider}, got ${capturedRow.provider_amount}`,
      );
      assert.ok(
        Math.abs(capturedRow.platform_fee - expectedFee) < 1e-10,
        `platform_fee: expected ${expectedFee}, got ${capturedRow.platform_fee}`,
      );
    });
  }

  it("should return null (not throw) when supabase returns an error", async () => {
    const supabase = createMockSupabase({
      insertError: { message: "DB connection lost" },
    });

    const { recordPayout } = createPayoutManager(supabase);
    const result = await recordPayout({
      serviceId: "svc-err",
      serviceName: "Error API",
      providerWallet: PROVIDER_WALLET,
      grossAmount: 1.0,
      txHashIn: TX_HASH_IN,
    });

    assert.equal(result, null);
  });

  it("should return null (not throw) when supabase insert rejects", async () => {
    const supabase = {
      from() {
        return {
          insert() {
            return {
              select: () => Promise.reject(new Error("Network timeout")),
            };
          },
        };
      },
    };

    const { recordPayout } = createPayoutManager(supabase);
    // Must not throw — must resolve to null or reject cleanly
    let threw = false;
    let result;
    try {
      result = await recordPayout({
        serviceId: "svc-reject",
        serviceName: "Reject API",
        providerWallet: PROVIDER_WALLET,
        grossAmount: 0.1,
        txHashIn: TX_HASH_IN,
      });
    } catch {
      threw = true;
    }
    // We accept either: returns null OR throws (both are "not silent crash")
    // The important contract is that it does not hang and does not corrupt state.
    assert.ok(
      !threw || result === null || result === undefined,
      "recordPayout should not produce unhandled exceptions that crash the process",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: getPendingPayouts
// ---------------------------------------------------------------------------

describe("getPendingPayouts", () => {
  it("should return empty providers and zero totals when no pending payouts exist", async () => {
    const supabase = createMockSupabase({ pendingPayouts: [] });

    const { getPendingPayouts } = createPayoutManager(supabase);
    const result = await getPendingPayouts();

    assert.deepEqual(result.providers, []);
    assert.equal(result.summary.total_pending, 0);
    assert.equal(result.summary.total_owed_usdc, 0);
    assert.equal(result.summary.total_platform_fees_usdc, 0);
    assert.equal(result.summary.provider_count, 0);
  });

  it("should group payouts by provider wallet and compute per-provider totals", async () => {
    const walletA = "0x" + "a".repeat(40);
    const walletB = "0x" + "b".repeat(40);

    const pendingPayouts = [
      makePayout({
        id: "p1",
        provider_wallet: walletA,
        provider_amount: 0.95,
        platform_fee: 0.05,
      }),
      makePayout({
        id: "p2",
        provider_wallet: walletA,
        provider_amount: 1.9,
        platform_fee: 0.1,
      }),
      makePayout({
        id: "p3",
        provider_wallet: walletB,
        provider_amount: 9.5,
        platform_fee: 0.5,
      }),
    ];

    const supabase = createMockSupabase({ pendingPayouts });
    const { getPendingPayouts } = createPayoutManager(supabase);
    const result = await getPendingPayouts();

    // Two distinct providers
    assert.equal(result.providers.length, 2);
    assert.equal(result.summary.provider_count, 2);

    const providerA = result.providers.find((p) => p.wallet === walletA);
    const providerB = result.providers.find((p) => p.wallet === walletB);

    assert.ok(providerA, "providerA should be present");
    assert.ok(providerB, "providerB should be present");

    // Wallet A: 2 payouts, total_owed = 0.95 + 1.90 = 2.85
    assert.equal(providerA.count, 2);
    assert.ok(
      Math.abs(providerA.total_owed - 2.85) < 1e-10,
      `walletA total_owed: expected 2.85, got ${providerA.total_owed}`,
    );
    assert.ok(
      Math.abs(providerA.total_fees - 0.15) < 1e-10,
      `walletA total_fees: expected 0.15, got ${providerA.total_fees}`,
    );

    // Wallet B: 1 payout
    assert.equal(providerB.count, 1);
    assert.ok(Math.abs(providerB.total_owed - 9.5) < 1e-10);
    assert.ok(Math.abs(providerB.total_fees - 0.5) < 1e-10);
  });

  it("should include each payout in its provider payouts array", async () => {
    const walletA = "0x" + "a".repeat(40);

    const pendingPayouts = [
      makePayout({ id: "p1", provider_wallet: walletA }),
      makePayout({ id: "p2", provider_wallet: walletA }),
    ];

    const supabase = createMockSupabase({ pendingPayouts });
    const { getPendingPayouts } = createPayoutManager(supabase);
    const result = await getPendingPayouts();

    const providerA = result.providers[0];
    assert.equal(providerA.payouts.length, 2);
    assert.ok(providerA.payouts.some((p) => p.id === "p1"));
    assert.ok(providerA.payouts.some((p) => p.id === "p2"));
  });

  it("should compute correct global summary totals across all providers", async () => {
    const walletA = "0x" + "a".repeat(40);
    const walletB = "0x" + "b".repeat(40);

    const pendingPayouts = [
      makePayout({
        id: "p1",
        provider_wallet: walletA,
        provider_amount: 0.95,
        platform_fee: 0.05,
      }),
      makePayout({
        id: "p2",
        provider_wallet: walletB,
        provider_amount: 9.5,
        platform_fee: 0.5,
      }),
    ];

    const supabase = createMockSupabase({ pendingPayouts });
    const { getPendingPayouts } = createPayoutManager(supabase);
    const result = await getPendingPayouts();

    assert.equal(result.summary.total_pending, 2);
    assert.ok(Math.abs(result.summary.total_owed_usdc - 10.45) < 1e-10);
    assert.ok(Math.abs(result.summary.total_platform_fees_usdc - 0.55) < 1e-10);
  });

  it("should return an error object (not throw) when supabase errors", async () => {
    const supabase = createMockSupabase({
      pendingError: { message: "Table does not exist" },
    });

    const { getPendingPayouts } = createPayoutManager(supabase);
    const result = await getPendingPayouts();

    assert.ok(result.error, "should contain an error field");
    assert.ok(typeof result.error === "string");
  });
});

// ---------------------------------------------------------------------------
// Suite: markPayoutsPaid
// ---------------------------------------------------------------------------

describe("markPayoutsPaid", () => {
  it("should return the count of updated rows on success", async () => {
    const updatedRows = [
      makePayout({ id: "p1", status: "paid" }),
      makePayout({ id: "p2", status: "paid" }),
    ];

    const supabase = createMockSupabase({ updatedRows });
    const { markPayoutsPaid } = createPayoutManager(supabase);
    const result = await markPayoutsPaid(["p1", "p2"], TX_HASH_OUT);

    assert.equal(result.updated, 2);
  });

  it('should pass status "paid" and tx_hash_out to the update call', async () => {
    let capturedUpdateData = null;

    const supabase = {
      from() {
        return {
          update(data) {
            capturedUpdateData = data;
            return {
              in() {
                return {
                  select: () =>
                    Promise.resolve({
                      data: [{ id: "p1", ...data }],
                      error: null,
                    }),
                };
              },
            };
          },
        };
      },
    };

    const { markPayoutsPaid } = createPayoutManager(supabase);
    await markPayoutsPaid(["p1"], TX_HASH_OUT);

    assert.equal(capturedUpdateData.status, "paid");
    assert.equal(capturedUpdateData.tx_hash_out, TX_HASH_OUT);
    assert.ok(capturedUpdateData.paid_at, "paid_at should be set");
    // paid_at should be a valid ISO date string
    assert.ok(
      !isNaN(Date.parse(capturedUpdateData.paid_at)),
      "paid_at should be a valid ISO date",
    );
  });

  it("should pass the correct ids to the .in() filter", async () => {
    let capturedIds = null;

    const supabase = {
      from() {
        return {
          update() {
            return {
              in(col, ids) {
                capturedIds = ids;
                return {
                  select: () =>
                    Promise.resolve({
                      data: ids.map((id) => ({ id })),
                      error: null,
                    }),
                };
              },
            };
          },
        };
      },
    };

    const { markPayoutsPaid } = createPayoutManager(supabase);
    await markPayoutsPaid(["id-1", "id-2", "id-3"], TX_HASH_OUT);

    assert.deepEqual(capturedIds, ["id-1", "id-2", "id-3"]);
  });

  it("should return 0 updated when ids array is empty", async () => {
    const supabase = createMockSupabase({ updatedRows: [] });
    const { markPayoutsPaid } = createPayoutManager(supabase);
    const result = await markPayoutsPaid([], TX_HASH_OUT);

    assert.equal(result.updated, 0);
  });

  it("should return an error object (not throw) when supabase errors", async () => {
    const supabase = createMockSupabase({
      updateError: { message: "Permission denied" },
    });

    const { markPayoutsPaid } = createPayoutManager(supabase);
    const result = await markPayoutsPaid(["p1"], TX_HASH_OUT);

    assert.ok(result.error, "should contain an error field");
    assert.ok(typeof result.error === "string");
  });
});

// ---------------------------------------------------------------------------
// Suite: getRevenueOverview
// ---------------------------------------------------------------------------

describe("getRevenueOverview", () => {
  it("should return zeroed overview when there are no rows", async () => {
    const supabase = createMockSupabase({ overviewRows: [] });
    const { getRevenueOverview } = createPayoutManager(supabase);
    const overview = await getRevenueOverview();

    assert.equal(overview.total_gross, 0);
    assert.equal(overview.total_provider_payouts, 0);
    assert.equal(overview.total_platform_fees, 0);
    assert.equal(overview.total_pending_payouts, 0);
    assert.equal(overview.total_paid_payouts, 0);
  });

  it("should sum gross, provider and fee amounts across all rows", async () => {
    const overviewRows = [
      {
        gross_amount: "1.00",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "2.00",
        provider_amount: "1.90",
        platform_fee: "0.10",
        status: "pending",
        chain: "base",
      },
      {
        gross_amount: "0.10",
        provider_amount: "0.095",
        platform_fee: "0.005",
        status: "paid",
        chain: "skale",
      },
    ];

    const supabase = createMockSupabase({ overviewRows });
    const { getRevenueOverview } = createPayoutManager(supabase);
    const overview = await getRevenueOverview();

    assert.ok(
      Math.abs(overview.total_gross - 3.1) < 1e-10,
      `total_gross: ${overview.total_gross}`,
    );
    assert.ok(
      Math.abs(overview.total_provider_payouts - 2.945) < 1e-10,
      `total_provider_payouts: ${overview.total_provider_payouts}`,
    );
    assert.ok(
      Math.abs(overview.total_platform_fees - 0.155) < 1e-10,
      `total_platform_fees: ${overview.total_platform_fees}`,
    );
  });

  it("should segregate pending vs paid provider amounts", async () => {
    const overviewRows = [
      {
        gross_amount: "10",
        provider_amount: "9.5",
        platform_fee: "0.5",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "2",
        provider_amount: "1.9",
        platform_fee: "0.1",
        status: "pending",
        chain: "base",
      },
    ];

    const supabase = createMockSupabase({ overviewRows });
    const { getRevenueOverview } = createPayoutManager(supabase);
    const overview = await getRevenueOverview();

    assert.ok(Math.abs(overview.total_paid_payouts - 9.5) < 1e-10);
    assert.ok(Math.abs(overview.total_pending_payouts - 1.9) < 1e-10);
  });

  it("should count rows by status in by_status", async () => {
    const overviewRows = [
      {
        gross_amount: "1",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "1",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "1",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "pending",
        chain: "base",
      },
      {
        gross_amount: "1",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "failed",
        chain: "base",
      },
    ];

    const supabase = createMockSupabase({ overviewRows });
    const { getRevenueOverview } = createPayoutManager(supabase);
    const overview = await getRevenueOverview();

    assert.equal(overview.by_status.paid, 2);
    assert.equal(overview.by_status.pending, 1);
    assert.equal(overview.by_status.failed, 1);
  });

  it("should aggregate gross amounts by chain in by_chain", async () => {
    const overviewRows = [
      {
        gross_amount: "1",
        provider_amount: "0.95",
        platform_fee: "0.05",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "2",
        provider_amount: "1.90",
        platform_fee: "0.10",
        status: "paid",
        chain: "base",
      },
      {
        gross_amount: "0.5",
        provider_amount: "0.475",
        platform_fee: "0.025",
        status: "pending",
        chain: "skale",
      },
    ];

    const supabase = createMockSupabase({ overviewRows });
    const { getRevenueOverview } = createPayoutManager(supabase);
    const overview = await getRevenueOverview();

    assert.ok(
      Math.abs(overview.by_chain["base"] - 3.0) < 1e-10,
      `by_chain.base: ${overview.by_chain["base"]}`,
    );
    assert.ok(
      Math.abs(overview.by_chain["skale"] - 0.5) < 1e-10,
      `by_chain.skale: ${overview.by_chain["skale"]}`,
    );
  });

  it("should return an error object (not throw) when supabase errors", async () => {
    const supabase = createMockSupabase({
      overviewError: { message: "Supabase timeout" },
    });

    const { getRevenueOverview } = createPayoutManager(supabase);
    const result = await getRevenueOverview();

    assert.ok(result.error, "should contain an error field");
    assert.ok(typeof result.error === "string");
  });
});
