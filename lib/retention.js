// lib/retention.js — Automatic data retention / purge for Supabase tables

const logger = require("./logger");

const ACTIVITY_RETENTION_DAYS = 90;
const MONITORING_RETENTION_DAYS = 30;
const DAILY_CHECKS_RETENTION_DAYS = 90;
const QUALITY_AUDITS_RETENTION_DAYS = 90;
const FREE_USAGE_RETENTION_DAYS = 7;
// used_transactions: kept until a replay can't realistically happen anymore.
// 6 months is safe — even the slowest facilitator finalizes transfers well
// before that. Prevents unbounded growth of the anti-replay table.
const USED_TRANSACTIONS_RETENTION_DAYS = 180;

async function purgeOldData(supabase) {
  if (!supabase) return;

  const activityCutoff = new Date(
    Date.now() - ACTIVITY_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const monitorCutoff = new Date(
    Date.now() - MONITORING_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const dailyCutoff = new Date(
    Date.now() - DAILY_CHECKS_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const qualityCutoff = new Date(
    Date.now() - QUALITY_AUDITS_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const freeUsageCutoff = new Date(
    Date.now() - FREE_USAGE_RETENTION_DAYS * 86400 * 1000,
  )
    .toISOString()
    .slice(0, 10); // DATE format (YYYY-MM-DD)
  const usedTxCutoff = new Date(
    Date.now() - USED_TRANSACTIONS_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();

  const results = await Promise.allSettled([
    supabase
      .from("activity")
      .delete({ count: "exact" })
      .lt("created_at", activityCutoff),
    supabase
      .from("monitoring_checks")
      .delete({ count: "exact" })
      .lt("checked_at", monitorCutoff),
    supabase
      .from("daily_checks")
      .delete({ count: "exact" })
      .lt("checked_at", dailyCutoff),
    supabase
      .from("quality_audits")
      .delete({ count: "exact" })
      .lt("checked_at", qualityCutoff),
    supabase
      .from("free_usage")
      .delete({ count: "exact" })
      .lt("usage_date", freeUsageCutoff),
    supabase
      .from("used_transactions")
      .delete({ count: "exact" })
      .lt("created_at", usedTxCutoff),
  ]);

  const tableNames = [
    "activity",
    "monitoring_checks",
    "daily_checks",
    "quality_audits",
    "free_usage",
    "used_transactions",
  ];
  const cutoffDates = [
    activityCutoff,
    monitorCutoff,
    dailyCutoff,
    qualityCutoff,
    freeUsageCutoff,
    usedTxCutoff,
  ];

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error("retention", `Unexpected error purging ${tableNames[i]}`, {
        error: r.reason?.message,
      });
    } else if (r.value.error) {
      logger.warn("retention", `Failed to purge ${tableNames[i]}`, {
        error: r.value.error.message,
      });
    } else {
      logger.info("retention", `Purged old ${tableNames[i]} rows`, {
        deleted: r.value.count ?? 0,
        cutoff: cutoffDates[i],
      });
    }
  });
}

function scheduleRetention(supabase) {
  // Run once at startup (after a short delay to let the server settle)
  setTimeout(() => purgeOldData(supabase), 10_000).unref();
  // Then every 24h
  setInterval(() => purgeOldData(supabase), 24 * 60 * 60 * 1000).unref();
}

module.exports = { scheduleRetention };
