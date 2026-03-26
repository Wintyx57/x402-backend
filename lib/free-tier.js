// lib/free-tier.js — Free Tier: 5 calls/day per IP on native services <= $0.01 USDC
"use strict";

const crypto = require("crypto");
const logger = require("./logger");

// ─── Configuration ────────────────────────────────────────────────────────────

const FREE_TIER_DAILY_LIMIT = parseInt(process.env.FREE_TIER_LIMIT, 10) || 5;
const FREE_TIER_MAX_PRICE = parseFloat(process.env.FREE_TIER_MAX_PRICE) || 0.01;

// ─── hashIp ───────────────────────────────────────────────────────────────────

/**
 * Returns a SHA-256 hex digest (64 chars) of the given IP string.
 * Used to store usage counts without persisting raw IPs (privacy).
 * @param {string} ip — e.g. "203.0.113.42"
 * @returns {string} 64-character lowercase hex
 */
function hashIp(ip) {
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

// ─── isFreeTierEligible ───────────────────────────────────────────────────────

/**
 * Determines whether a service qualifies for the free tier.
 * Criteria:
 *   - No `owner_address` (null/undefined) — native platform service only
 *   - `price_usdc` is a number <= FREE_TIER_MAX_PRICE
 *
 * @param {{ price_usdc: number|null, owner_address: string|null }} service
 * @returns {boolean}
 */
function isFreeTierEligible(service) {
  if (service.owner_address) return false;
  const price = parseFloat(service.price_usdc);
  if (
    isNaN(price) ||
    service.price_usdc === null ||
    service.price_usdc === undefined
  )
    return false;
  return price <= FREE_TIER_MAX_PRICE;
}

// ─── checkFreeTier ────────────────────────────────────────────────────────────

/**
 * Checks whether the given IP (hashed) is eligible for a free call to the service.
 *
 * Returns:
 *   { eligible: true,  remaining: N }                  — allowed
 *   { eligible: false, remaining: 0, reason: string }  — denied
 *
 * Fail-open on DB errors: if the `free_usage` table query fails, we allow the call.
 *
 * @param {object} supabase — Supabase client
 * @param {string} ipHash   — SHA-256 hex of the caller IP
 * @param {object} service  — service row from DB
 * @returns {Promise<{ eligible: boolean, remaining: number, reason?: string }>}
 */
async function checkFreeTier(supabase, ipHash, service) {
  // Step 1: check service eligibility (synchronous, no DB needed)
  if (!isFreeTierEligible(service)) {
    return {
      eligible: false,
      remaining: 0,
      reason: service.owner_address
        ? "Free tier is only available for native platform services"
        : `Service price $${service.price_usdc} exceeds free tier maximum $${FREE_TIER_MAX_PRICE}`,
    };
  }

  // Step 2: check daily usage from DB
  const today = todayDate();

  try {
    const { data, error } = await supabase
      .from("free_usage")
      .select("count")
      .eq("ip_hash", ipHash)
      .eq("usage_date", today)
      .single();

    if (error) {
      // Fail open — don't block legitimate users if the table doesn't exist yet
      logger.warn(
        "FreeTier",
        `DB query failed, failing open: ${error.message}`,
      );
      return { eligible: true, remaining: FREE_TIER_DAILY_LIMIT };
    }

    const used = data ? data.count : 0;
    const remaining = Math.max(0, FREE_TIER_DAILY_LIMIT - used);

    if (used >= FREE_TIER_DAILY_LIMIT) {
      return {
        eligible: false,
        remaining: 0,
        reason: `Free tier daily limit reached (${FREE_TIER_DAILY_LIMIT} calls/day). Please provide payment to continue.`,
      };
    }

    return { eligible: true, remaining };
  } catch (err) {
    // Fail open on unexpected errors (e.g. table not created yet)
    logger.warn(
      "FreeTier",
      `Unexpected error checking usage, failing open: ${err.message}`,
    );
    return { eligible: true, remaining: FREE_TIER_DAILY_LIMIT };
  }
}

// ─── recordFreeUsage ──────────────────────────────────────────────────────────

/**
 * Records a free tier call for the given IP hash.
 * - If a row exists for (ip_hash, today): increments count by 1 via UPDATE
 * - If no row exists: inserts with count:1 via upsert
 *
 * Fire-and-forget safe (caller does not need to await errors).
 *
 * @param {object} supabase — Supabase client
 * @param {string} ipHash   — SHA-256 hex of the caller IP
 * @returns {Promise<void>}
 */
async function recordFreeUsage(supabase, ipHash) {
  const today = todayDate();

  try {
    // Check if a row already exists for this IP + day
    const { data: existing, error: selectError } = await supabase
      .from("free_usage")
      .select("count")
      .eq("ip_hash", ipHash)
      .eq("usage_date", today)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      // PGRST116 = "no rows found" — expected for new IPs
      logger.warn(
        "FreeTier",
        `recordFreeUsage SELECT failed: ${selectError.message}`,
      );
    }

    if (existing) {
      // Row exists — increment count
      const { error: updateError } = await supabase
        .from("free_usage")
        .update({ count: existing.count + 1 })
        .eq("ip_hash", ipHash)
        .eq("usage_date", today);

      if (updateError) {
        logger.warn(
          "FreeTier",
          `recordFreeUsage UPDATE failed: ${updateError.message}`,
        );
      }
    } else {
      // No row — insert with count:1
      const { error: upsertError } = await supabase
        .from("free_usage")
        .upsert([{ ip_hash: ipHash, usage_date: today, count: 1 }], {
          onConflict: "ip_hash,usage_date",
        });

      if (upsertError) {
        logger.warn(
          "FreeTier",
          `recordFreeUsage UPSERT failed: ${upsertError.message}`,
        );
      }
    }
  } catch (err) {
    logger.warn("FreeTier", `recordFreeUsage unexpected error: ${err.message}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns today's date as a YYYY-MM-DD string (UTC).
 * @returns {string}
 */
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  FREE_TIER_DAILY_LIMIT,
  FREE_TIER_MAX_PRICE,
  hashIp,
  isFreeTierEligible,
  checkFreeTier,
  recordFreeUsage,
};
