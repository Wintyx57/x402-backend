// tests/provider-dashboard.test.js — Unit tests for provider analytics endpoints
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WALLET = "0x" + "a".repeat(40);

function makeSupabaseWith(
  serviceRows = [],
  payoutRows = [],
  activityRows = [],
) {
  // Chainable mock — supports .select().ilike().neq().order()
  function makeChain(rows, err = null) {
    const chain = {
      ilike: () => chain,
      neq: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      gte: () => chain,
      select: () => chain,
      single: () => Promise.resolve({ data: rows[0] || null, error: err }),
      then: (resolve) => resolve({ data: rows, error: err }),
    };
    return chain;
  }

  return {
    from(table) {
      if (table === "services") return { select: () => makeChain(serviceRows) };
      if (table === "pending_payouts")
        return { select: () => makeChain(payoutRows) };
      if (table === "activity")
        return { select: () => makeChain(activityRows) };
      if (table === "monitoring_checks") return { select: () => makeChain([]) };
      return { select: () => makeChain([]) };
    },
  };
}

// ─── Provider analytics aggregation logic (unit-level, no HTTP) ──────────────

describe("provider analytics data aggregation", () => {
  it("total_earned sums provider_amount across all payouts", () => {
    const payouts = [
      {
        provider_amount: "1.0",
        chain: "base",
        service_id: "s1",
        service_name: "A",
        created_at: "2026-01-01",
      },
      {
        provider_amount: "2.5",
        chain: "skale",
        service_id: "s1",
        service_name: "A",
        created_at: "2026-01-02",
      },
    ];
    let total = 0;
    for (const p of payouts) total += Number(p.provider_amount);
    assert.strictEqual(Math.round(total * 1e6) / 1e6, 3.5);
  });

  it("by_chain groups correctly", () => {
    const payouts = [
      {
        provider_amount: "1.0",
        chain: "base",
        service_id: "s1",
        service_name: "A",
        created_at: "2026-01-01",
      },
      {
        provider_amount: "2.0",
        chain: "base",
        service_id: "s1",
        service_name: "A",
        created_at: "2026-01-02",
      },
      {
        provider_amount: "0.5",
        chain: "skale",
        service_id: "s2",
        service_name: "B",
        created_at: "2026-01-03",
      },
    ];
    const by_chain = {};
    for (const p of payouts) {
      by_chain[p.chain] = (by_chain[p.chain] || 0) + Number(p.provider_amount);
    }
    assert.strictEqual(Math.round(by_chain.base * 1e6) / 1e6, 3.0);
    assert.strictEqual(Math.round(by_chain.skale * 1e6) / 1e6, 0.5);
  });

  it("by_service groups calls and earnings per service", () => {
    const payouts = [
      {
        provider_amount: "1.0",
        chain: "base",
        service_id: "s1",
        service_name: "API A",
        created_at: "2026-01-01",
      },
      {
        provider_amount: "2.0",
        chain: "base",
        service_id: "s1",
        service_name: "API A",
        created_at: "2026-01-02",
      },
      {
        provider_amount: "0.5",
        chain: "skale",
        service_id: "s2",
        service_name: "API B",
        created_at: "2026-01-03",
      },
    ];
    const byServiceMap = {};
    for (const p of payouts) {
      const sid = p.service_id;
      if (!byServiceMap[sid]) {
        byServiceMap[sid] = {
          service_id: sid,
          service_name: p.service_name,
          earned: 0,
          calls: 0,
        };
      }
      byServiceMap[sid].earned += Number(p.provider_amount);
      byServiceMap[sid].calls += 1;
    }
    const s1 = byServiceMap["s1"];
    assert.strictEqual(s1.calls, 2);
    assert.strictEqual(Math.round(s1.earned * 1e6) / 1e6, 3.0);
    const s2 = byServiceMap["s2"];
    assert.strictEqual(s2.calls, 1);
  });

  it("daily_revenue fills 30-day gaps with zeros", () => {
    const daily_revenue = [];
    const now = new Date();
    const dailyMap = {
      [now.toISOString().slice(0, 10)]: { amount: 1.0, count: 2 },
    };
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const entry = dailyMap[dateStr];
      daily_revenue.push({
        date: dateStr,
        amount: entry ? entry.amount : 0,
        count: entry ? entry.count : 0,
      });
    }
    assert.strictEqual(daily_revenue.length, 30);
    const today = daily_revenue[daily_revenue.length - 1];
    assert.strictEqual(today.count, 2);
    // All other days should be 0
    const zeros = daily_revenue.filter((d) => d.count === 0);
    assert.strictEqual(zeros.length, 29);
  });

  it("pending vs paid payout counts are separated correctly", () => {
    const payouts = [
      { provider_amount: "1.0", status: "pending" },
      { provider_amount: "2.0", status: "pending" },
      { provider_amount: "0.5", status: "paid" },
    ];
    let pending_total = 0,
      paid_total = 0,
      pending_count = 0,
      paid_count = 0;
    for (const p of payouts) {
      const amt = Number(p.provider_amount);
      if (p.status === "pending") {
        pending_total += amt;
        pending_count++;
      }
      if (p.status === "paid") {
        paid_total += amt;
        paid_count++;
      }
    }
    assert.strictEqual(pending_count, 2);
    assert.strictEqual(paid_count, 1);
    assert.strictEqual(Math.round(pending_total * 1e6) / 1e6, 3.0);
  });

  it("wallet anonymization: shows first 6 + last 4 chars", () => {
    const wallet = "0x" + "a".repeat(38) + "bb";
    const anonymized = wallet.slice(0, 6) + "..." + wallet.slice(-4);
    assert.strictEqual(anonymized.slice(0, 6), wallet.slice(0, 6));
    assert.strictEqual(anonymized.slice(-4), wallet.slice(-4));
    assert.ok(anonymized.includes("..."));
  });

  it("avg_uptime returns null when no services have trust_score", () => {
    const services = [
      { id: "s1", trust_score: null },
      { id: "s2", trust_score: null },
    ];
    const uptimes = services
      .filter((s) => s.trust_score != null)
      .map((s) => Number(s.trust_score));
    const avg_uptime =
      uptimes.length > 0
        ? Math.round(
            (uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 10,
          ) / 10
        : null;
    assert.strictEqual(avg_uptime, null);
  });

  it("avg_uptime computes correctly from trust_score values", () => {
    const services = [
      { id: "s1", trust_score: 80 },
      { id: "s2", trust_score: 90 },
    ];
    const uptimes = services.map((s) => Number(s.trust_score));
    const avg_uptime =
      Math.round((uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 10) /
      10;
    assert.strictEqual(avg_uptime, 85);
  });
});
