// routes/admin-payouts.js — Admin endpoints for payout management
//
// GET  /api/admin/payouts/pending  — list all pending payouts grouped by provider
// POST /api/admin/payouts/execute  — mark batch as paid (requires tx_hash proof)
//
// Both routes require X-Admin-Token header (via adminAuth middleware).

"use strict";

const express = require("express");
const { TX_HASH_REGEX } = require("../lib/payment");
const logger = require("../lib/logger");

function createAdminPayoutsRouter(
  supabase,
  adminAuth,
  logActivity,
  payoutManager,
) {
  const router = express.Router();

  // Apply admin auth to all routes in this router
  router.use(adminAuth);

  // ────────────────────────────────────────────────────────────────────
  // GET /api/admin/payouts/pending
  // Returns all pending (+ processing) payouts grouped by provider wallet.
  // ────────────────────────────────────────────────────────────────────
  router.get("/api/admin/payouts/pending", async (req, res) => {
    try {
      const result = await payoutManager.getPendingPayouts();

      if (result.error) {
        logger.error("AdminPayouts", `GET pending error: ${result.error}`);
        return res
          .status(500)
          .json({ error: "Failed to fetch pending payouts" });
      }

      return res.json({
        providers: result.providers,
        summary: result.summary,
        fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("AdminPayouts", `GET pending unexpected: ${err.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/admin/payouts/execute
  // Mark a set of payout IDs as paid after admin executes the on-chain transfer.
  // Body: { ids: string[], tx_hash: string }
  // ────────────────────────────────────────────────────────────────────
  router.post("/api/admin/payouts/execute", async (req, res) => {
    const { ids, tx_hash } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "ids must be a non-empty array of payout UUIDs" });
    }
    if (ids.length > 500) {
      return res
        .status(400)
        .json({ error: "Maximum 500 payout IDs per batch" });
    }
    if (!tx_hash || !TX_HASH_REGEX.test(tx_hash)) {
      return res.status(400).json({
        error: "tx_hash must be a valid 0x-prefixed 64-hex transaction hash",
      });
    }

    try {
      const result = await payoutManager.markPayoutsPaid(ids, tx_hash);

      if (result.error) {
        logger.error("AdminPayouts", `POST execute error: ${result.error}`);
        return res
          .status(500)
          .json({ error: "Failed to mark payouts as paid" });
      }

      logActivity(
        "payouts_executed",
        `Admin marked ${result.updated} payouts as paid (tx: ${tx_hash.slice(0, 18)}...)`,
        0,
        tx_hash,
      );
      logger.info(
        "AdminPayouts",
        `Marked ${result.updated} payouts as paid — tx: ${tx_hash.slice(0, 18)}...`,
      );

      return res.json({
        success: true,
        updated: result.updated,
        tx_hash,
        executed_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("AdminPayouts", `POST execute unexpected: ${err.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createAdminPayoutsRouter;
