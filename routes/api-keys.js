// routes/api-keys.js — API Key + Prepaid Credits endpoints
//
// POST   /api/keys              — Generate new API key (wallet-auth required)
// GET    /api/keys              — List keys for wallet (wallet-auth required)
// DELETE /api/keys/:id          — Revoke a key (wallet-auth required)
// POST   /api/credits/topup     — Add credits via on-chain USDC payment
// GET    /api/credits/balance/:keyId — Check credit balance

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { walletAuth } = require("../lib/wallet-auth");
const {
  generateApiKey,
  hashApiKey,
  keyPrefix,
  addCredits,
} = require("../lib/credits");
const { TX_HASH_REGEX } = require("../lib/payment");
const logger = require("../lib/logger");

// Rate limiter: 30 req/min for key management
const keyMgmtLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", message: "Rate limit exceeded." },
});

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Function} logActivity
 * @param {object} paymentSystem - { verifySinglePayment } from createPaymentSystem
 */
function createApiKeysRouter(supabase, logActivity, paymentSystem) {
  const router = express.Router();

  router.use(keyMgmtLimiter);

  // ────────────────────────────────────────────────────────────────────
  // POST /api/keys
  // Generate a new API key for the authenticated wallet.
  // Body: { name: string, daily_limit?: number }
  // Returns: { key, name, credits, id }
  // ────────────────────────────────────────────────────────────────────
  router.post("/api/keys", walletAuth("create-api-key"), async (req, res) => {
    const wallet = req.verifiedWallet;
    const { name, daily_limit } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "name is required (e.g. 'my-agent')" });
    }
    if (name.length > 100) {
      return res
        .status(400)
        .json({ error: "name must be at most 100 characters" });
    }
    if (
      daily_limit !== undefined &&
      (typeof daily_limit !== "number" || daily_limit <= 0)
    ) {
      return res
        .status(400)
        .json({ error: "daily_limit must be a positive number (USDC)" });
    }

    // Cap per-wallet key count to prevent abuse
    const { count } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("owner_wallet", wallet)
      .eq("is_active", true);

    if ((count || 0) >= 20) {
      return res.status(429).json({
        error: "Maximum 20 active API keys per wallet. Revoke unused keys.",
      });
    }

    const plainKey = generateApiKey();
    const keyHash = hashApiKey(plainKey);
    const prefix = keyPrefix(plainKey);

    const row = {
      key_hash: keyHash,
      key_prefix: prefix,
      name: name.trim(),
      owner_wallet: wallet,
      credits_usdc: 0,
      is_active: true,
    };
    if (daily_limit !== undefined) row.daily_limit_usdc = daily_limit;

    const { data, error } = await supabase
      .from("api_keys")
      .insert([row])
      .select("id, name, credits_usdc, key_prefix, created_at")
      .single();

    if (error) {
      logger.error("ApiKeys", `POST /api/keys insert error: ${error.message}`);
      return res.status(500).json({ error: "Failed to create API key" });
    }

    logActivity(
      "api_key_created",
      `Key "${name}" created by ${wallet.slice(0, 10)}...`,
    );
    logger.info("ApiKeys", `Key "${name}" created for ${wallet.slice(0, 10)}`);

    // Return plaintext key ONCE — never shown again
    return res.status(201).json({
      key: plainKey,
      id: data.id,
      name: data.name,
      key_prefix: data.key_prefix,
      credits: Number(data.credits_usdc),
      created_at: data.created_at,
      warning:
        "Store this key securely. It will not be shown again. Use as: Authorization: Bearer <key>",
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/keys
  // List all active API keys for the authenticated wallet.
  // Returns masked keys (prefix only), credits, last_used_at.
  // ────────────────────────────────────────────────────────────────────
  router.get("/api/keys", walletAuth("list-api-keys"), async (req, res) => {
    const wallet = req.verifiedWallet;

    const { data, error } = await supabase
      .from("api_keys")
      .select(
        "id, key_prefix, name, credits_usdc, daily_limit_usdc, daily_spent_usdc, last_used_at, is_active, created_at",
      )
      .eq("owner_wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      logger.error("ApiKeys", `GET /api/keys error: ${error.message}`);
      return res.status(500).json({ error: "Failed to fetch API keys" });
    }

    const keys = (data || []).map((k) => ({
      id: k.id,
      name: k.name,
      key_masked: `${k.key_prefix}${"*".repeat(20)}`,
      credits_usdc: Number(k.credits_usdc),
      daily_limit_usdc: k.daily_limit_usdc ? Number(k.daily_limit_usdc) : null,
      daily_spent_usdc: Number(k.daily_spent_usdc || 0),
      last_used_at: k.last_used_at,
      is_active: k.is_active,
      created_at: k.created_at,
    }));

    return res.json({ keys, count: keys.length });
  });

  // ────────────────────────────────────────────────────────────────────
  // DELETE /api/keys/:id
  // Revoke (soft-delete) an API key. Sets is_active = false.
  // ────────────────────────────────────────────────────────────────────
  router.delete(
    "/api/keys/:id",
    walletAuth("revoke-api-key"),
    async (req, res) => {
      const wallet = req.verifiedWallet;
      const { id } = req.params;

      // Verify ownership
      const { data: existing, error: fetchErr } = await supabase
        .from("api_keys")
        .select("id, owner_wallet, name, is_active")
        .eq("id", id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ error: "API key not found" });
      }
      if (existing.owner_wallet.toLowerCase() !== wallet) {
        return res
          .status(403)
          .json({ error: "Forbidden: you do not own this key" });
      }
      if (!existing.is_active) {
        return res.status(409).json({ error: "Key is already revoked" });
      }

      const { error: updateErr } = await supabase
        .from("api_keys")
        .update({ is_active: false })
        .eq("id", id);

      if (updateErr) {
        logger.error(
          "ApiKeys",
          `DELETE /api/keys/${id} error: ${updateErr.message}`,
        );
        return res.status(500).json({ error: "Failed to revoke key" });
      }

      logActivity(
        "api_key_revoked",
        `Key "${existing.name}" revoked by ${wallet.slice(0, 10)}...`,
      );
      logger.info(
        "ApiKeys",
        `Key "${existing.name}" revoked by ${wallet.slice(0, 10)}`,
      );

      return res.json({ success: true, id, name: existing.name });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/credits/topup
  // Add credits to a key by submitting an on-chain USDC payment proof.
  // Body: { key_id, amount_usdc, tx_hash, chain? }
  // The payment must be sent to WALLET_ADDRESS (platform).
  // ────────────────────────────────────────────────────────────────────
  router.post("/api/credits/topup", async (req, res) => {
    const { key_id, amount_usdc, tx_hash, chain = "skale" } = req.body || {};

    if (!key_id || typeof key_id !== "string") {
      return res.status(400).json({ error: "key_id is required" });
    }
    if (
      !amount_usdc ||
      typeof amount_usdc !== "number" ||
      amount_usdc <= 0 ||
      amount_usdc > 10000
    ) {
      return res.status(400).json({
        error: "amount_usdc must be a positive number (max 10000 USDC)",
      });
    }
    if (!tx_hash || !TX_HASH_REGEX.test(tx_hash)) {
      return res
        .status(400)
        .json({ error: "tx_hash must be a valid 0x-prefixed 64-hex string" });
    }

    // Verify key exists and is active
    const { data: keyRow, error: keyErr } = await supabase
      .from("api_keys")
      .select("id, owner_wallet, name, credits_usdc, is_active")
      .eq("id", key_id)
      .single();

    if (keyErr || !keyRow) {
      return res.status(404).json({ error: "API key not found" });
    }
    if (!keyRow.is_active) {
      return res
        .status(409)
        .json({ error: "API key is revoked — cannot top up" });
    }

    // Verify on-chain payment using existing payment system
    // Minimum: amount_usdc in raw (6 decimals)
    const minRaw = Math.round(amount_usdc * 1e6);
    let paymentValid = false;
    try {
      if (paymentSystem && paymentSystem.verifyPayment) {
        // verifyPayment(txHash, minAmountRaw, chainKey, recipientAddress)
        // minRaw is in micro-USDC (6 decimals), recipient null → uses WALLET_ADDRESS
        const result = await paymentSystem.verifyPayment(
          tx_hash,
          minRaw,
          chain,
          null,
        );
        paymentValid = result && result.valid === true;
      } else {
        // No payment system — reject (never accept without verification)
        return res
          .status(503)
          .json({ error: "Payment verification system not available" });
      }
    } catch (err) {
      logger.error(
        "ApiKeys",
        `Credits topup payment verify error: ${err.message}`,
      );
      return res.status(500).json({ error: "Payment verification failed" });
    }

    if (!paymentValid) {
      return res.status(402).json({
        error: "Payment not verified",
        message: `Send ${amount_usdc} USDC to ${process.env.WALLET_ADDRESS} on ${chain}, then retry with the tx_hash.`,
      });
    }

    // Add credits
    const result = await addCredits(supabase, key_id, amount_usdc);
    if (!result.ok) {
      return res
        .status(500)
        .json({ error: result.error || "Failed to add credits" });
    }

    logActivity(
      "credits_topup",
      `${amount_usdc} USDC credits added to key ${key_id.slice(0, 8)} (tx: ${tx_hash.slice(0, 18)})`,
      amount_usdc,
      tx_hash,
    );
    logger.info(
      "ApiKeys",
      `Credits topup: +${amount_usdc} USDC to key ${key_id.slice(0, 8)} — new balance: ${result.credits_usdc}`,
    );

    return res.json({
      success: true,
      key_id,
      added_usdc: amount_usdc,
      credits_usdc: result.credits_usdc,
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/credits/balance/:keyId
  // Returns credit balance for a key. Public (key_id is a UUID, not secret).
  // ────────────────────────────────────────────────────────────────────
  router.get("/api/credits/balance/:keyId", async (req, res) => {
    const { keyId } = req.params;

    const { data, error } = await supabase
      .from("api_keys")
      .select(
        "id, key_prefix, name, credits_usdc, daily_limit_usdc, daily_spent_usdc, is_active",
      )
      .eq("id", keyId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "API key not found" });
    }

    return res.json({
      id: data.id,
      name: data.name,
      key_prefix: data.key_prefix,
      credits_usdc: Number(data.credits_usdc),
      daily_limit_usdc: data.daily_limit_usdc
        ? Number(data.daily_limit_usdc)
        : null,
      daily_spent_usdc: Number(data.daily_spent_usdc || 0),
      is_active: data.is_active,
    });
  });

  return router;
}

module.exports = createApiKeysRouter;
