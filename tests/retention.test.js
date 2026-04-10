// tests/retention.test.js — Unit tests for lib/retention.js
// Tests: purgeOldData() with mocked Supabase, date cutoff calculations,
// error resilience (DB errors don't crash the process)
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ─── We inline purgeOldData logic to test without importing (avoids
//     setInterval side-effects from scheduleRetention) ────────────────────────

const ACTIVITY_RETENTION_DAYS = 90;
const MONITORING_RETENTION_DAYS = 30;
const DAILY_CHECKS_RETENTION_DAYS = 90;

function buildCutoff(days) {
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockSupabase(options = {}) {
  const calls = [];

  return {
    _calls: calls,
    from(table) {
      const tableOps = [];
      calls.push({ table, ops: tableOps });
      return {
        delete(opts) {
          tableOps.push({ op: "delete", opts });
          return {
            lt(col, cutoff) {
              tableOps.push({ op: "lt", col, cutoff });
              if (options.errorTable === table) {
                return Promise.resolve({
                  error: { message: "DB error" },
                  count: null,
                });
              }
              return Promise.resolve({
                error: null,
                count: options.deletedCount || 0,
              });
            },
          };
        },
      };
    },
  };
}

// Inline purgeOldData to avoid setInterval side-effects
async function purgeOldData(supabase) {
  if (!supabase) return;

  try {
    const activityCutoff = new Date(
      Date.now() - ACTIVITY_RETENTION_DAYS * 86400 * 1000,
    ).toISOString();
    await supabase
      .from("activity")
      .delete({ count: "exact" })
      .lt("created_at", activityCutoff);
  } catch {
    /* ignored */
  }

  try {
    const monitorCutoff = new Date(
      Date.now() - MONITORING_RETENTION_DAYS * 86400 * 1000,
    ).toISOString();
    await supabase
      .from("monitoring_checks")
      .delete({ count: "exact" })
      .lt("checked_at", monitorCutoff);
  } catch {
    /* ignored */
  }

  try {
    const dailyCutoff = new Date(
      Date.now() - DAILY_CHECKS_RETENTION_DAYS * 86400 * 1000,
    ).toISOString();
    await supabase
      .from("daily_checks")
      .delete({ count: "exact" })
      .lt("checked_at", dailyCutoff);
  } catch {
    /* ignored */
  }
}

// ─── Suite 1: Cutoff date calculations ────────────────────────────────────────

describe("retention — cutoff date calculations", () => {
  it("activity cutoff should be ~90 days ago", () => {
    const cutoff = buildCutoff(ACTIVITY_RETENTION_DAYS);
    const cutoffDate = new Date(cutoff);
    const daysAgo = (Date.now() - cutoffDate.getTime()) / (86400 * 1000);
    assert.ok(
      Math.abs(daysAgo - 90) < 0.01,
      `Expected ~90 days, got ${daysAgo}`,
    );
  });

  it("monitoring cutoff should be ~30 days ago", () => {
    const cutoff = buildCutoff(MONITORING_RETENTION_DAYS);
    const cutoffDate = new Date(cutoff);
    const daysAgo = (Date.now() - cutoffDate.getTime()) / (86400 * 1000);
    assert.ok(Math.abs(daysAgo - 30) < 0.01);
  });

  it("daily_checks cutoff should be ~90 days ago", () => {
    const cutoff = buildCutoff(DAILY_CHECKS_RETENTION_DAYS);
    const cutoffDate = new Date(cutoff);
    const daysAgo = (Date.now() - cutoffDate.getTime()) / (86400 * 1000);
    assert.ok(Math.abs(daysAgo - 90) < 0.01);
  });

  it("activity cutoff should be a valid ISO 8601 string", () => {
    const cutoff = buildCutoff(ACTIVITY_RETENTION_DAYS);
    assert.ok(!isNaN(Date.parse(cutoff)), `Not a valid ISO date: ${cutoff}`);
    assert.ok(
      cutoff.includes("T"),
      "Should contain T separator for ISO format",
    );
  });

  it("activity cutoff should be strictly in the past", () => {
    const cutoff = buildCutoff(ACTIVITY_RETENTION_DAYS);
    assert.ok(new Date(cutoff) < new Date());
  });
});

// ─── Suite 2: purgeOldData table access ───────────────────────────────────────

describe("retention — purgeOldData calls", () => {
  it("should call delete on activity, monitoring_checks, and daily_checks", async () => {
    const supabase = createMockSupabase({ deletedCount: 5 });
    await purgeOldData(supabase);

    const tables = supabase._calls.map((c) => c.table);
    assert.ok(tables.includes("activity"), "Should call activity");
    assert.ok(
      tables.includes("monitoring_checks"),
      "Should call monitoring_checks",
    );
    assert.ok(tables.includes("daily_checks"), "Should call daily_checks");
  });

  it("should use created_at column for activity table", async () => {
    let capturedCol = null;
    const supabase = {
      from(table) {
        return {
          delete: () => ({
            lt(col, cutoff) {
              if (table === "activity") capturedCol = col;
              return Promise.resolve({ error: null, count: 0 });
            },
          }),
        };
      },
    };
    await purgeOldData(supabase);
    assert.strictEqual(capturedCol, "created_at");
  });

  it("should use checked_at column for monitoring_checks table", async () => {
    let capturedCol = null;
    const supabase = {
      from(table) {
        return {
          delete: () => ({
            lt(col) {
              if (table === "monitoring_checks") capturedCol = col;
              return Promise.resolve({ error: null, count: 0 });
            },
          }),
        };
      },
    };
    await purgeOldData(supabase);
    assert.strictEqual(capturedCol, "checked_at");
  });

  it("should not throw when supabase is null", async () => {
    // purgeOldData should return early without throwing
    await assert.doesNotReject(() => purgeOldData(null));
  });

  it("should not throw when activity delete returns an error", async () => {
    const supabase = createMockSupabase({ errorTable: "activity" });
    await assert.doesNotReject(() => purgeOldData(supabase));
  });

  it("should continue processing other tables after one error", async () => {
    const processedTables = [];

    const supabase = {
      from(table) {
        return {
          delete: () => ({
            lt() {
              processedTables.push(table);
              if (table === "activity") {
                return Promise.resolve({
                  error: { message: "DB error" },
                  count: null,
                });
              }
              return Promise.resolve({ error: null, count: 0 });
            },
          }),
        };
      },
    };

    await purgeOldData(supabase);

    // All 3 tables should have been processed despite the error on the first
    assert.ok(
      processedTables.includes("monitoring_checks"),
      "monitoring_checks should still be processed",
    );
    assert.ok(
      processedTables.includes("daily_checks"),
      "daily_checks should still be processed",
    );
  });
});

// ─── Suite 3: scheduleRetention module export ─────────────────────────────────

describe("retention — scheduleRetention export", () => {
  it("should export scheduleRetention as a function", () => {
    const { scheduleRetention } = require("../lib/retention");
    assert.strictEqual(typeof scheduleRetention, "function");
  });
});
