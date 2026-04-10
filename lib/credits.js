// lib/credits.js — API Key + Prepaid Credits management
// Keys use format: x402_sk_ + 48 random hex chars
// Only SHA-256 hash is stored in DB — plaintext key shown once at creation

"use strict";

const crypto = require("node:crypto");
const logger = require("./logger");

const KEY_PREFIX = "x402_sk_";
const KEY_RANDOM_BYTES = 24; // 24 bytes → 48 hex chars

/**
 * Generate a new API key.
 * Returns the full plaintext key (store it — never shown again).
 *
 * @returns {string} full API key e.g. "x402_sk_<48 hex chars>"
 */
function generateApiKey() {
  const random = crypto.randomBytes(KEY_RANDOM_BYTES).toString("hex");
  return `${KEY_PREFIX}${random}`;
}

/**
 * Hash an API key with SHA-256 for DB storage.
 * @param {string} key - full plaintext API key
 * @returns {string} 64-char hex digest
 */
function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Extract the display prefix (first 12 chars incl. "x402_sk_").
 * Used to help users identify their keys without revealing the full secret.
 *
 * @param {string} key - full or partial API key
 * @returns {string} e.g. "x402_sk_ab1c"
 */
function keyPrefix(key) {
  return key.slice(0, 12);
}

/**
 * Validate an API key against the DB.
 * Returns the key row (with credits, owner_wallet, etc.) or null.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} rawKey - plaintext API key from request
 * @returns {Promise<object|null>} key row or null
 */
async function validateApiKey(supabase, rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(rawKey);

  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, key_hash, key_prefix, name, owner_wallet, credits_usdc, daily_limit_usdc, daily_spent_usdc, daily_reset_at, last_used_at, is_active",
    )
    .eq("key_hash", hash)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;

  // Reset daily spend if the reset window has passed
  const resetAt = new Date(data.daily_reset_at || 0);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - resetAt >= dayMs) {
    // Fire-and-forget reset
    supabase
      .from("api_keys")
      .update({
        daily_spent_usdc: 0,
        daily_reset_at: now.toISOString(),
      })
      .eq("id", data.id)
      .then(null, (err) =>
        logger.warn("Credits", `Daily reset update failed: ${err.message}`),
      );
    data.daily_spent_usdc = 0;
    data.daily_reset_at = now.toISOString();
  }

  return data;
}

/**
 * Atomically deduct `amount` USDC from key's credit balance.
 * Uses optimistic update with a guard on credits_usdc >= amount.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} keyId         - UUID of the api_key row
 * @param {number} amount        - USDC amount to deduct (float)
 * @param {number} currentCredits      - current credits from validated row (optimistic check)
 * @param {number} [currentDailySpent] - current daily_spent_usdc, incremented in same UPDATE
 * @returns {Promise<{ ok: boolean, error?: string, credits_remaining?: number }>}
 */
async function deductCredits(
  supabase,
  keyId,
  amount,
  currentCredits,
  currentDailySpent,
) {
  if (currentCredits < amount) {
    return { ok: false, error: "insufficient_credits" };
  }

  const updateFields = {
    credits_usdc: Math.max(
      0,
      Math.round((currentCredits - amount) * 1e6) / 1e6,
    ),
    last_used_at: new Date().toISOString(),
  };
  // Increment daily_spent in the same atomic UPDATE when caller provides current value
  if (currentDailySpent !== undefined) {
    updateFields.daily_spent_usdc = Math.round(
      ((currentDailySpent + amount) * 1e6) / 1e6,
    );
  }

  // Conditional update: only succeeds if credits_usdc >= amount at DB level
  // (row-level .gte() guard prevents concurrent over-deduction)
  const { data, error } = await supabase
    .from("api_keys")
    .update(updateFields)
    .eq("id", keyId)
    .gte("credits_usdc", amount)
    .select("credits_usdc")
    .single();

  if (error || !data) {
    return { ok: false, error: "concurrent_deduction_or_insufficient" };
  }

  return { ok: true, credits_remaining: Number(data.credits_usdc) };
}

/**
 * Add credits to an API key (top-up).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} keyId  - UUID of the api_key row
 * @param {number} amount - USDC amount to add
 * @returns {Promise<{ ok: boolean, credits_usdc?: number, error?: string }>}
 */
async function addCredits(supabase, keyId, amount) {
  // Fetch current balance
  const { data: current, error: fetchErr } = await supabase
    .from("api_keys")
    .select("credits_usdc")
    .eq("id", keyId)
    .single();

  if (fetchErr || !current) {
    return { ok: false, error: "key_not_found" };
  }

  const newBalance =
    Math.round((Number(current.credits_usdc) + amount) * 1e6) / 1e6;

  const { data, error } = await supabase
    .from("api_keys")
    .update({ credits_usdc: newBalance })
    .eq("id", keyId)
    .select("credits_usdc")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message || "update_failed" };
  }

  logger.info(
    "Credits",
    `Added ${amount} USDC to key ${keyId.slice(0, 8)} — new balance: ${newBalance}`,
  );

  return { ok: true, credits_usdc: Number(data.credits_usdc) };
}

module.exports = {
  generateApiKey,
  hashApiKey,
  keyPrefix,
  validateApiKey,
  deductCredits,
  addCredits,
  KEY_PREFIX,
};
