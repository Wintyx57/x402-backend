// lib/free-tier.js — Free Tier: 5 calls/day per IP on native services <= $0.01 USDC
"use strict";

const crypto = require("crypto");
const logger = require("./logger");

// ─── Configuration ────────────────────────────────────────────────────────────

const FREE_TIER_DAILY_LIMIT = parseInt(process.env.FREE_TIER_LIMIT, 10) || 5;
const FREE_TIER_MAX_PRICE = parseFloat(process.env.FREE_TIER_MAX_PRICE) || 0.01;

// ─── hashIp ───────────────────────────────────────────────────────────────────

/**
 * Returns a keyed HMAC-SHA-256 hex digest (64 chars) of the given IP string.
 *
 * SECURITY: plain SHA-256 of an IP is trivially reversible with a rainbow
 * table (2^32 IPv4 addresses, one precomputed hash each). Without a server
 * secret, any leak of `free_usage.ip_hash` effectively leaks every caller's
 * IP — a GDPR breach. We use HMAC with `IP_HASH_SECRET` so that an attacker
 * who reads the table but not the backend env cannot reverse the IPs.
 *
 * If IP_HASH_SECRET is not set, we fall back to SHA-256 and log once so the
 * operator knows to fix it. Tests can still run without the env var.
 *
 * @param {string} ip — e.g. "203.0.113.42"
 * @returns {string} 64-character lowercase hex
 */
let _warnedMissingIpSecret = false;
function hashIp(ip) {
  const secret = process.env.IP_HASH_SECRET;
  if (secret && secret.length >= 16) {
    return crypto.createHmac("sha256", secret).update(String(ip)).digest("hex");
  }
  if (!_warnedMissingIpSecret) {
    _warnedMissingIpSecret = true;
    logger.warn(
      "FreeTier",
      "IP_HASH_SECRET is not configured (or <16 chars). Falling back to SHA-256. " +
        "This is reversible with a rainbow table — configure IP_HASH_SECRET in prod.",
    );
  }
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

// ─── isFreeTierEligible ───────────────────────────────────────────────────────

/**
 * Determines whether a service qualifies for the free tier.
 * Criteria:
 *   - Native platform service (no owner_address, OR owner_address === WALLET_ADDRESS)
 *   - `price_usdc` is a number <= FREE_TIER_MAX_PRICE
 *
 * @param {{ price_usdc: number|null, owner_address: string|null }} service
 * @returns {boolean}
 */
function isFreeTierEligible(service) {
  const platformWallet = (process.env.WALLET_ADDRESS || "").toLowerCase();
  const ownerAddr = (service.owner_address || "").toLowerCase();
  const isNative = !service.owner_address || ownerAddr === platformWallet;
  if (!isNative) return false;
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
 * Fail-closed on DB errors: if the `free_usage` table query fails, we deny the call.
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
      // PGRST116 = "no rows found" from .single() — this is normal for new users
      if (error.code === "PGRST116" || error.message?.includes("not found")) {
        // No usage row yet → user has full quota
        return { eligible: true, remaining: FREE_TIER_DAILY_LIMIT };
      }
      // Real DB error — fail closed to prevent abuse
      logger.error(
        "FreeTier",
        `DB query failed, failing closed: ${error.message} (code: ${error.code})`,
      );
      return { eligible: false, remaining: 0, reason: "service_unavailable" };
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
    // Fail closed on unexpected errors — prevent abuse
    logger.error(
      "FreeTier",
      `Unexpected error checking usage, failing closed: ${err.message}`,
    );
    return { eligible: false, remaining: 0, reason: "service_unavailable" };
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
    // Atomic increment via Postgres RPC (migration 029). The old
    // SELECT-then-UPDATE flow had a TOCTOU window that let parallel requests
    // each pass the limit check and double-count the free quota.
    const { data, error } = await supabase.rpc("increment_free_usage", {
      p_ip_hash: ipHash,
      p_usage_date: today,
    });

    if (error) {
      // Fallback to the legacy non-atomic path only if the RPC is missing
      // (e.g. migration not applied yet). Log as a warning.
      if (
        error.code === "42883" || // function does not exist
        error.message?.includes("function") ||
        error.message?.includes("increment_free_usage")
      ) {
        logger.warn(
          "FreeTier",
          "increment_free_usage RPC missing — falling back to non-atomic upsert. Apply migration 029.",
        );
        await _recordFreeUsageLegacy(supabase, ipHash, today);
        return;
      }
      logger.warn("FreeTier", `recordFreeUsage RPC failed: ${error.message}`);
    } else if (typeof data === "number") {
      logger.debug?.(
        "FreeTier",
        `recorded usage ipHash=${ipHash.slice(0, 8)}... date=${today} count=${data}`,
      );
    }
  } catch (err) {
    logger.warn("FreeTier", `recordFreeUsage unexpected error: ${err.message}`);
  }
}

// Legacy non-atomic fallback. Kept only for the case where migration 029 has
// not been applied yet. Do not use for new code paths.
async function _recordFreeUsageLegacy(supabase, ipHash, today) {
  const { data: existing } = await supabase
    .from("free_usage")
    .select("count")
    .eq("ip_hash", ipHash)
    .eq("usage_date", today)
    .single();

  if (existing) {
    await supabase
      .from("free_usage")
      .update({ count: existing.count + 1 })
      .eq("ip_hash", ipHash)
      .eq("usage_date", today);
  } else {
    await supabase
      .from("free_usage")
      .upsert([{ ip_hash: ipHash, usage_date: today, count: 1 }], {
        onConflict: "ip_hash,usage_date",
      });
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
