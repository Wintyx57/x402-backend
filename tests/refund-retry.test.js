// tests/refund-retry.test.js — Fix 4: Retry failed refunds
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Mock supabase for retry logic tests
// ---------------------------------------------------------------------------

function mockSupabase(failedRefunds = [], updateResults = {}) {
  const _updates = [];
  return {
    _updates,
    from(table) {
      return {
        select(...cols) {
          return {
            eq(col, val) {
              return {
                lt(col2, val2) {
                  return {
                    gt(col3, val3) {
                      return {
                        order(col4, opts) {
                          return {
                            limit(n) {
                              return Promise.resolve({
                                data: failedRefunds.slice(0, n),
                                error: null,
                              });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(data) {
          return {
            eq(col, val) {
              _updates.push({ table, data, col, val });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("Refund Retry — Fix 4", async (t) => {
  await t.test(
    "module exports scheduleRefundRetry, stopRefundRetry, retryFailedRefunds",
    () => {
      const mod = require("../lib/refund-retry");
      assert.strictEqual(typeof mod.scheduleRefundRetry, "function");
      assert.strictEqual(typeof mod.stopRefundRetry, "function");
      assert.strictEqual(typeof mod.retryFailedRefunds, "function");
    },
  );

  await t.test(
    "retryFailedRefunds does nothing with null supabase",
    async () => {
      const mod = require("../lib/refund-retry");
      // Should not throw
      await mod.retryFailedRefunds(null);
    },
  );

  await t.test(
    "retryFailedRefunds does nothing when no failed refunds",
    async () => {
      const mod = require("../lib/refund-retry");
      const sb = mockSupabase([]);
      await mod.retryFailedRefunds(sb);
      assert.strictEqual(sb._updates.length, 0);
    },
  );

  await t.test("stopRefundRetry clears interval without error", () => {
    const mod = require("../lib/refund-retry");
    // Should not throw even if no interval is running
    mod.stopRefundRetry();
  });

  await t.test("migration 020 exists with retry_count column", () => {
    const fs = require("fs");
    const path = require("path");
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "migrations", "020_refund_retry_count.sql"),
      "utf8",
    );
    assert.ok(sql.includes("retry_count"), "should add retry_count column");
    assert.ok(sql.includes("INTEGER"), "retry_count should be INTEGER");
    assert.ok(sql.includes("DEFAULT 0"), "retry_count should default to 0");
  });

  await t.test("server.js imports refund-retry module", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "server.js"),
      "utf8",
    );
    assert.ok(
      src.includes("refund-retry"),
      "server.js should import refund-retry",
    );
    assert.ok(
      src.includes("scheduleRefundRetry"),
      "server.js should call scheduleRefundRetry",
    );
    assert.ok(
      src.includes("stopRefundRetry"),
      "server.js should call stopRefundRetry in shutdown",
    );
  });

  await t.test(
    "proxy.js differentiates failed vs skipped refund status",
    () => {
      const fs = require("fs");
      const path = require("path");
      const src = fs.readFileSync(
        path.join(__dirname, "..", "routes", "proxy.js"),
        "utf8",
      );
      assert.ok(
        src.includes("failed"),
        "proxy should use failed status for retryable failures",
      );
      assert.ok(
        src.includes("transfer_failed"),
        "should check transfer_failed reason",
      );
      assert.ok(
        src.includes("balance_check_failed"),
        "should check balance_check_failed reason",
      );
    },
  );

  await t.test(
    "refund-retry respects MAX_RETRY_COUNT=3 and MAX_AGE_HOURS=24",
    () => {
      const fs = require("fs");
      const path = require("path");
      const src = fs.readFileSync(
        path.join(__dirname, "..", "lib", "refund-retry.js"),
        "utf8",
      );
      assert.ok(
        src.includes("MAX_RETRY_COUNT = 3"),
        "should have MAX_RETRY_COUNT = 3",
      );
      assert.ok(
        src.includes("MAX_AGE_HOURS = 24"),
        "should have MAX_AGE_HOURS = 24",
      );
      assert.ok(src.includes("15 * 60 * 1000"), "should have 15 min interval");
    },
  );

  await t.test("refund-retry uses .unref() pattern", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "lib", "refund-retry.js"),
      "utf8",
    );
    assert.ok(src.includes(".unref()"), "should use .unref() on timers");
  });
});
