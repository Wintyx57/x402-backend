// routes/provider.js — Provider self-service endpoints (Wallet-as-Account)
//
// Public (no auth):
//   GET /api/provider/:address/services  — list services owned by wallet
//   GET /api/provider/:address/revenue   — revenue aggregated from pending_payouts
//
// Authenticated (EIP-191 wallet signature):
//   PATCH /api/services/:id              — update editable fields of a service
//   DELETE /api/services/:id             — delete a service

const express = require("express");
const { walletAuth } = require("../lib/wallet-auth");
const { ServiceUpdateSchema, ServiceCredentialsSchema } = require("../schemas");
const { encryptCredentials } = require("../lib/credentials");
const { safeUrl } = require("../lib/safe-url");
const { probeProtocol } = require("../lib/protocolSniffer");
const logger = require("../lib/logger");

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Columns returned for service listings (mirrors services.js SERVICE_COLUMNS)
const SERVICE_COLUMNS = [
  "id",
  "name",
  "url",
  "description",
  "price_usdc",
  "owner_address",
  "tags",
  "verified_status",
  "created_at",
  "status",
  "last_checked_at",
  "trust_score",
  "required_parameters",
  "quick_registered",
].join(", ");

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Function} logActivity
 * @param {import('express-rate-limit').RateLimitRequestHandler} rateLimiter
 * @param {object} [payoutManager] - optional, from lib/payouts.js
 */
function createProviderRouter(
  supabase,
  logActivity,
  rateLimiter,
  payoutManager,
) {
  const router = express.Router();

  // Apply rate limiter to all provider endpoints
  router.use(rateLimiter);

  // ──────────────────────────────────────────────────────────────────────
  // GET /api/provider/:address/services
  // Public — no auth required.
  // Returns all services where owner_address matches :address (case-insensitive).
  // ──────────────────────────────────────────────────────────────────────
  router.get("/api/provider/:address/services", async (req, res) => {
    const { address } = req.params;

    if (!WALLET_REGEX.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    try {
      const { data, error } = await supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .ilike("owner_address", address)
        .order("created_at", { ascending: false });

      if (error) {
        logger.error(
          "Provider",
          `GET /api/provider/:address/services error: ${error.message}`,
        );
        return res.status(500).json({ error: "Failed to fetch services" });
      }

      return res.json({ services: data || [], count: (data || []).length });
    } catch (err) {
      logger.error(
        "Provider",
        `GET /api/provider/:address/services unexpected: ${err.message}`,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /api/provider/:address/revenue
  // Public — no auth required.
  // Returns aggregated revenue from pending_payouts for the given wallet.
  // ──────────────────────────────────────────────────────────────────────
  router.get("/api/provider/:address/revenue", async (req, res) => {
    const { address } = req.params;

    if (!WALLET_REGEX.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    try {
      const { data, error } = await supabase
        .from("pending_payouts")
        .select("service_id, service_name, provider_amount, chain")
        .ilike("provider_wallet", address)
        .order("created_at", { ascending: false })
        .limit(10000);

      if (error) {
        logger.error(
          "Provider",
          `GET /api/provider/:address/revenue error: ${error.message}`,
        );
        return res.status(500).json({ error: "Failed to fetch revenue" });
      }

      const rows = data || [];

      let total_earned = 0;
      const byServiceMap = {};
      const by_chain = {};

      for (const row of rows) {
        const amount = Number(row.provider_amount) || 0;
        total_earned += amount;

        const sid = row.service_id;
        if (!byServiceMap[sid]) {
          byServiceMap[sid] = {
            service_id: sid,
            service_name: row.service_name || sid,
            earned: 0,
            calls: 0,
          };
        }
        byServiceMap[sid].earned += amount;
        byServiceMap[sid].calls += 1;

        const chain = row.chain || "base";
        by_chain[chain] = (by_chain[chain] || 0) + amount;
      }

      // Round float drift (integer micro-USDC)
      total_earned = Math.round(total_earned * 1e6) / 1e6;
      const by_service = Object.values(byServiceMap).map((s) => ({
        ...s,
        earned: Math.round(s.earned * 1e6) / 1e6,
      }));
      for (const chain of Object.keys(by_chain)) {
        by_chain[chain] = Math.round(by_chain[chain] * 1e6) / 1e6;
      }

      return res.json({
        total_earned,
        total_calls: rows.length,
        by_service,
        by_chain,
      });
    } catch (err) {
      logger.error(
        "Provider",
        `GET /api/provider/:address/revenue unexpected: ${err.message}`,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /api/provider/:address/analytics
  // Sensitive data (tx hashes, payout statuses) stripped from public response.
  // Full details require X-Wallet-Address + X-Wallet-Signature auth.
  // ──────────────────────────────────────────────────────────────────────
  router.get("/api/provider/:address/analytics", async (req, res) => {
    const { address } = req.params;

    if (!WALLET_REGEX.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    // Determine if caller is the authenticated owner
    const callerWallet = (req.headers["x-wallet-address"] || "").toLowerCase();
    const isOwner =
      callerWallet === address.toLowerCase() && callerWallet.length === 42;

    try {
      const [servicesResult, payoutsResult] = await Promise.all([
        supabase
          .from("services")
          .select(SERVICE_COLUMNS)
          .ilike("owner_address", address)
          .neq("status", "pending_validation")
          .order("created_at", { ascending: false }),
        supabase
          .from("pending_payouts")
          .select(
            isOwner
              ? "id, service_id, service_name, provider_amount, gross_amount, platform_fee, chain, status, tx_hash_in, created_at, paid_at"
              : "id, service_id, service_name, provider_amount, chain, status, created_at",
          )
          .ilike("provider_wallet", address)
          .order("created_at", { ascending: false })
          .limit(isOwner ? 10000 : 100),
      ]);

      if (servicesResult.error) {
        logger.error(
          "Provider",
          `analytics services error: ${servicesResult.error.message}`,
        );
        return res.status(500).json({ error: "Failed to fetch services" });
      }
      if (payoutsResult.error) {
        logger.error(
          "Provider",
          `analytics payouts error: ${payoutsResult.error.message}`,
        );
        return res.status(500).json({ error: "Failed to fetch payouts" });
      }

      const services = servicesResult.data || [];
      const payouts = payoutsResult.data || [];

      // --- Aggregate revenue ---
      let total_earned = 0;
      const byServiceMap = {};
      const by_chain = {};
      const dailyMap = {};

      for (const row of payouts) {
        const amount = Number(row.provider_amount) || 0;
        total_earned += amount;

        // By service
        const sid = row.service_id;
        if (!byServiceMap[sid]) {
          byServiceMap[sid] = {
            service_id: sid,
            service_name: row.service_name || sid,
            earned: 0,
            calls: 0,
          };
        }
        byServiceMap[sid].earned += amount;
        byServiceMap[sid].calls += 1;

        // By chain
        const chain = row.chain || "base";
        by_chain[chain] = (by_chain[chain] || 0) + amount;

        // Daily (last 30 days)
        const date = row.created_at?.slice(0, 10);
        if (date) {
          if (!dailyMap[date]) dailyMap[date] = { date, amount: 0, count: 0 };
          dailyMap[date].amount += amount;
          dailyMap[date].count += 1;
        }
      }

      // Round float drift
      total_earned = Math.round(total_earned * 1e6) / 1e6;
      for (const chain of Object.keys(by_chain)) {
        by_chain[chain] = Math.round(by_chain[chain] * 1e6) / 1e6;
      }

      // Build daily_revenue (last 30 days, fill gaps with zeros)
      const daily_revenue = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entry = dailyMap[dateStr];
        daily_revenue.push({
          date: dateStr,
          amount: entry ? Math.round(entry.amount * 1e6) / 1e6 : 0,
          count: entry ? entry.count : 0,
        });
      }

      // By service with service metadata (status, uptime, price)
      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const by_service = Object.values(byServiceMap)
        .map((s) => {
          const svc = serviceMap.get(s.service_id);
          return {
            ...s,
            earned: Math.round(s.earned * 1e6) / 1e6,
            price_usdc: svc?.price_usdc,
            status: svc?.status || "unknown",
            trust_score: svc?.trust_score,
          };
        })
        .sort((a, b) => b.earned - a.earned);

      // Recent earnings (last 20 paid calls)
      const recent_earnings = payouts.slice(0, 20).map((p) => ({
        service_name: p.service_name,
        amount: Number(p.provider_amount),
        chain: p.chain || "base",
        created_at: p.created_at,
      }));

      // Payouts summary
      let pending_total = 0;
      let paid_total = 0;
      let pending_count = 0;
      let paid_count = 0;
      for (const p of payouts) {
        const amt = Number(p.provider_amount) || 0;
        if (p.status === "pending") {
          pending_total += amt;
          pending_count++;
        }
        if (p.status === "paid") {
          paid_total += amt;
          paid_count++;
        }
      }

      // Avg uptime from services
      const uptimes = services
        .filter((s) => s.trust_score != null)
        .map((s) => Number(s.trust_score));
      const avg_uptime =
        uptimes.length > 0
          ? Math.round(
              (uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 10,
            ) / 10
          : null;

      return res.json({
        total_earned,
        total_calls: payouts.length,
        active_services: services.length,
        avg_uptime,
        by_service,
        by_chain,
        daily_revenue,
        recent_earnings,
        payouts_summary: {
          pending_total: Math.round(pending_total * 1e6) / 1e6,
          paid_total: Math.round(paid_total * 1e6) / 1e6,
          pending_count,
          paid_count,
        },
        services,
      });
    } catch (err) {
      logger.error(
        "Provider",
        `GET /api/provider/:address/analytics unexpected: ${err.message}`,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /api/services/:id
  // Requires wallet signature. Wallet must own the service.
  // Only allows updating: name, description, price_usdc, tags, required_parameters.
  // ──────────────────────────────────────────────────────────────────────
  router.patch(
    "/api/services/:id",
    walletAuth("update-service"),
    async (req, res) => {
      const { id } = req.params;
      const wallet = req.verifiedWallet; // set by walletAuth middleware

      // Validate update payload
      const parseResult = ServiceUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      }

      try {
        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from("services")
          .select("id, owner_address, name")
          .eq("id", id)
          .single();

        if (fetchError || !existing) {
          return res.status(404).json({ error: "Service not found" });
        }

        if (existing.owner_address.toLowerCase() !== wallet) {
          return res
            .status(403)
            .json({ error: "Forbidden: you do not own this service" });
        }

        // Build update object from validated data (only allowed fields)
        const {
          name,
          description,
          price_usdc,
          tags,
          required_parameters,
          encrypted_credentials: rawCreds,
          credential_type: credType,
          endpoint_url,
          webhook_url,
        } = parseResult.data;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (price_usdc !== undefined) updates.price_usdc = price_usdc;
        if (tags !== undefined) updates.tags = tags;
        if (required_parameters !== undefined)
          updates.required_parameters = required_parameters;
        if (webhook_url !== undefined) updates.webhook_url = webhook_url;

        // Re-encrypt credentials so providers can rotate expired API keys
        if (rawCreds !== undefined && rawCreds !== null) {
          let credPayload;
          try {
            credPayload =
              typeof rawCreds === "string" ? JSON.parse(rawCreds) : rawCreds;
          } catch {
            return res
              .status(400)
              .json({ error: "encrypted_credentials must be valid JSON" });
          }
          if (credType) credPayload.type = credType;
          const credParse = ServiceCredentialsSchema.safeParse(credPayload);
          if (!credParse.success) {
            return res.status(400).json({
              error: "Invalid credentials format",
              details: credParse.error.errors.map((e) => ({
                path: e.path.join("."),
                message: e.message,
              })),
            });
          }
          updates.encrypted_credentials = encryptCredentials(credParse.data);
          updates.credential_type = credParse.data.type;
        } else if (rawCreds === null) {
          // Explicit null clears credentials
          updates.encrypted_credentials = null;
          updates.credential_type = null;
        }

        // Validate new URL against SSRF, then re-sniff its payment protocol in background
        if (endpoint_url !== undefined) {
          try {
            await safeUrl(endpoint_url);
          } catch (ssrfErr) {
            return res
              .status(400)
              .json({ error: `Invalid endpoint URL: ${ssrfErr.message}` });
          }
          updates.url = endpoint_url;

          // Re-run protocol sniffer in background (non-blocking)
          probeProtocol(endpoint_url)
            .then((probe) => {
              if (probe.protocol && probe.protocol !== "unknown") {
                supabase
                  .from("services")
                  .update({ payment_protocol: probe.protocol })
                  .eq("id", id)
                  .then(null, (err) => {
                    logger.warn(
                      "Provider",
                      `Failed to update payment_protocol after URL change: ${err?.message}`,
                    );
                  });
              }
            })
            .catch(() => {
              /* non-blocking — ignore errors */
            });
        }

        updates.updated_at = new Date().toISOString();

        const { data: updated, error: updateError } = await supabase
          .from("services")
          .update(updates)
          .eq("id", id)
          .select(SERVICE_COLUMNS)
          .single();

        if (updateError) {
          logger.error(
            "Provider",
            `PATCH /api/services/:id update error: ${updateError.message}`,
          );
          return res.status(500).json({ error: "Failed to update service" });
        }

        logActivity(
          "service_updated",
          `Service ${id} (${existing.name}) updated by ${wallet.slice(0, 10)}...`,
        );
        logger.info(
          "Provider",
          `Service ${id} updated by ${wallet.slice(0, 10)}...`,
        );

        return res.json({ service: updated });
      } catch (err) {
        logger.error(
          "Provider",
          `PATCH /api/services/:id unexpected: ${err.message}`,
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // DELETE /api/services/:id
  // Requires wallet signature. Wallet must own the service.
  // ──────────────────────────────────────────────────────────────────────
  router.delete(
    "/api/services/:id",
    walletAuth("delete-service"),
    async (req, res) => {
      const { id } = req.params;
      const wallet = req.verifiedWallet; // set by walletAuth middleware

      try {
        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from("services")
          .select("id, owner_address, name")
          .eq("id", id)
          .single();

        if (fetchError || !existing) {
          return res.status(404).json({ error: "Service not found" });
        }

        if (existing.owner_address.toLowerCase() !== wallet) {
          return res
            .status(403)
            .json({ error: "Forbidden: you do not own this service" });
        }

        const { error: deleteError } = await supabase
          .from("services")
          .delete()
          .eq("id", id);

        if (deleteError) {
          logger.error(
            "Provider",
            `DELETE /api/services/:id delete error: ${deleteError.message}`,
          );
          return res.status(500).json({ error: "Failed to delete service" });
        }

        logActivity(
          "service_deleted",
          `Service ${id} (${existing.name}) deleted by ${wallet.slice(0, 10)}...`,
        );
        logger.info(
          "Provider",
          `Service ${id} (${existing.name}) deleted by ${wallet.slice(0, 10)}...`,
        );

        return res.json({ deleted: true, id, name: existing.name });
      } catch (err) {
        logger.error(
          "Provider",
          `DELETE /api/services/:id unexpected: ${err.message}`,
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/provider/withdraw
  // Requires wallet signature (action: "withdraw").
  // Marks all pending payouts for the wallet as 'processing'.
  // The actual on-chain transfer is executed by an admin.
  // ─────────────────────────────────────────────────────────────────────
  router.post(
    "/api/provider/withdraw",
    walletAuth("withdraw"),
    async (req, res) => {
      if (!payoutManager) {
        return res.status(503).json({ error: "Payout manager not configured" });
      }

      const wallet = req.verifiedWallet;

      try {
        const result = await payoutManager.requestWithdraw(wallet);

        if (result.error) {
          logger.error(
            "Provider",
            "POST /api/provider/withdraw error for " +
              wallet.slice(0, 10) +
              ": " +
              result.error,
          );
          return res
            .status(500)
            .json({ error: "Failed to process withdrawal request" });
        }

        if (result.count === 0) {
          return res.json({
            success: true,
            message: "No pending payouts found",
            total_usdc: 0,
            count: 0,
            payouts: [],
          });
        }

        logActivity(
          "withdrawal_requested",
          wallet.slice(0, 10) +
            " requested withdrawal: " +
            result.count +
            " payouts, " +
            result.total_usdc.toFixed(4) +
            " USDC",
        );
        logger.info(
          "Provider",
          "Withdrawal requested by " +
            wallet.slice(0, 10) +
            ": " +
            result.count +
            " payouts (" +
            result.total_usdc.toFixed(4) +
            " USDC)",
        );

        return res.json({
          success: true,
          message:
            "Withdrawal request submitted for " +
            result.total_usdc.toFixed(4) +
            " USDC (" +
            result.count +
            " payouts). An admin will process the on-chain transfer.",
          total_usdc: result.total_usdc,
          count: result.count,
          withdrawal_requested_at: result.withdrawal_requested_at,
          payouts: result.payouts,
        });
      } catch (err) {
        logger.error(
          "Provider",
          "POST /api/provider/withdraw unexpected: " + err.message,
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/cron/auto-payout?secret=CRON_SECRET
  // Protected by CRON_SECRET env var. Called by Render Cron Jobs.
  // Finds all wallets with pending payouts > threshold and marks them 'processing'.
  // ─────────────────────────────────────────────────────────────────────
  router.get("/api/cron/auto-payout", async (req, res) => {
    const cronSecret = (process.env.CRON_SECRET || "").trim();
    if (!cronSecret) {
      return res.status(503).json({ error: "CRON_SECRET not configured" });
    }

    const provided = (
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
      req.query.secret ||
      ""
    ).trim();
    const maxLen = Math.max(provided.length, cronSecret.length);
    const buf1 = Buffer.from(provided.padEnd(maxLen));
    const buf2 = Buffer.from(cronSecret.padEnd(maxLen));
    if (
      !provided ||
      buf1.length !== buf2.length ||
      !require("crypto").timingSafeEqual(buf1, buf2)
    ) {
      logger.warn(
        "CronPayout",
        "Unauthorized auto-payout attempt from " + (req.ip || "unknown"),
      );
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!payoutManager) {
      return res.status(503).json({ error: "Payout manager not configured" });
    }

    const thresholdUsdc = Number(req.query.threshold) || 1;

    try {
      const result = await payoutManager.autoPayout(thresholdUsdc);

      if (result.error) {
        logger.error("CronPayout", "auto-payout error: " + result.error);
        return res.status(500).json({ error: "Auto-payout failed" });
      }

      logger.info(
        "CronPayout",
        "auto-payout complete: " +
          result.wallets_processed +
          " wallets, " +
          result.total_usdc.toFixed(4) +
          " USDC",
      );
      return res.json({
        success: true,
        wallets_processed: result.wallets_processed,
        total_usdc: result.total_usdc,
        threshold_usdc: thresholdUsdc,
        wallets: result.wallets,
      });
    } catch (err) {
      logger.error("CronPayout", "auto-payout unexpected: " + err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /api/services/:id/webhook
  // Update (or clear) the payment webhook URL for a service.
  // Requires wallet signature (action: "update-webhook").
  // Body: { webhook_url: "https://..." } or { webhook_url: null } to remove.
  // ─────────────────────────────────────────────────────────────────────
  router.put(
    "/api/services/:id/webhook",
    walletAuth("update-webhook"),
    async (req, res) => {
      const { id } = req.params;
      const wallet = req.verifiedWallet;

      // Validate webhook_url
      const rawUrl = req.body.webhook_url;
      if (rawUrl !== null && rawUrl !== undefined) {
        if (typeof rawUrl !== "string") {
          return res
            .status(400)
            .json({ error: "webhook_url must be a string or null" });
        }
        if (!rawUrl.startsWith("https://")) {
          return res.status(400).json({ error: "webhook_url must use HTTPS" });
        }
        if (rawUrl.length > 500) {
          return res
            .status(400)
            .json({ error: "webhook_url must be at most 500 characters" });
        }
        // SSRF check
        try {
          await safeUrl(rawUrl);
        } catch (ssrfErr) {
          return res.status(400).json({
            error: `Invalid webhook URL: ${ssrfErr.message}`,
          });
        }
      }

      try {
        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from("services")
          .select("id, owner_address, name")
          .eq("id", id)
          .single();

        if (fetchError || !existing) {
          return res.status(404).json({ error: "Service not found" });
        }
        if (existing.owner_address.toLowerCase() !== wallet) {
          return res
            .status(403)
            .json({ error: "Forbidden: you do not own this service" });
        }

        const { error: updateError } = await supabase
          .from("services")
          .update({
            webhook_url: rawUrl ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (updateError) {
          logger.error(
            "Provider",
            `PUT /api/services/:id/webhook error: ${updateError.message}`,
          );
          return res.status(500).json({ error: "Failed to update webhook" });
        }

        logActivity(
          "webhook_updated",
          `Webhook ${rawUrl ? "set" : "cleared"} for service ${id} by ${wallet.slice(0, 10)}...`,
        );
        logger.info(
          "Provider",
          `Webhook ${rawUrl ? "updated" : "cleared"} for service ${id} by ${wallet.slice(0, 10)}...`,
        );

        return res.json({
          success: true,
          service_id: id,
          webhook_url: rawUrl ?? null,
        });
      } catch (err) {
        logger.error(
          "Provider",
          `PUT /api/services/:id/webhook unexpected: ${err.message}`,
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  return router;
}

module.exports = createProviderRouter;
