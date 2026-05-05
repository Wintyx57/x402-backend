// routes/admin-quarantine.js — Admin endpoints for quarantine management
//
// GET  /api/admin/quarantine          — list all quarantined services
// POST /api/admin/quarantine/:id      — manually quarantine a service
// POST /api/admin/unquarantine/:id    — remove quarantine from a service
//
// All routes require X-Admin-Token header (via adminAuth middleware).

"use strict";

const express = require("express");
const logger = require("../lib/logger");
const analytics = require("../lib/analytics");

function createAdminQuarantineRouter(supabase, adminAuth, logActivity) {
  const router = express.Router();

  router.use(adminAuth);

  // ────────────────────────────────────────────────────────────────────
  // GET /api/admin/quarantine
  // Returns all quarantined services with key details.
  // ────────────────────────────────────────────────────────────────────
  router.get("/api/admin/quarantine", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("services")
        .select(
          "id, name, url, owner_address, status, verified_status, created_at",
        )
        .eq("status", "quarantined")
        .order("created_at", { ascending: false });

      if (error) {
        logger.error("AdminQuarantine", `LIST error: ${error.message}`);
        return res
          .status(500)
          .json({ error: "Failed to fetch quarantined services" });
      }

      return res.json({
        count: data.length,
        services: data,
        fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("AdminQuarantine", `LIST unexpected: ${err.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/admin/unquarantine/:id
  // Remove quarantine: set status back to 'unknown', clear verified_status.
  // Body (optional): { reason: string }
  // ────────────────────────────────────────────────────────────────────
  router.post("/api/admin/unquarantine/:id", async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};

    try {
      // Verify the service exists and is actually quarantined
      const { data: service, error: fetchErr } = await supabase
        .from("services")
        .select("id, name, status, verified_status")
        .eq("id", id)
        .single();

      if (fetchErr || !service) {
        return res.status(404).json({ error: "Service not found" });
      }

      if (service.status !== "quarantined") {
        return res.status(409).json({
          error: "Service is not quarantined",
          current_status: service.status,
        });
      }

      // Remove quarantine
      const { error: updateErr } = await supabase
        .from("services")
        .update({ status: "unknown", verified_status: null })
        .eq("id", id);

      if (updateErr) {
        logger.error(
          "AdminQuarantine",
          `UNQUARANTINE error: ${updateErr.message}`,
        );
        return res
          .status(500)
          .json({ error: "Failed to unquarantine service" });
      }

      logActivity(
        "admin_unquarantine",
        `Admin unquarantined service "${service.name}" (${id})${reason ? ` — reason: ${reason}` : ""}`,
        0,
      );
      logger.info(
        "AdminQuarantine",
        `Unquarantined: "${service.name}" (${id})${reason ? ` — ${reason}` : ""}`,
      );

      return res.json({
        success: true,
        service_id: id,
        service_name: service.name,
        previous_status: "quarantined",
        new_status: "unknown",
        unquarantined_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        "AdminQuarantine",
        `UNQUARANTINE unexpected: ${err.message}`,
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/admin/quarantine/:id
  // Manually quarantine a service.
  // Body (optional): { reason: string }
  // ────────────────────────────────────────────────────────────────────
  router.post("/api/admin/quarantine/:id", async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};

    try {
      // Verify the service exists
      const { data: service, error: fetchErr } = await supabase
        .from("services")
        .select("id, name, status")
        .eq("id", id)
        .single();

      if (fetchErr || !service) {
        return res.status(404).json({ error: "Service not found" });
      }

      if (service.status === "quarantined") {
        return res.status(409).json({
          error: "Service is already quarantined",
        });
      }

      // Quarantine
      const { error: updateErr } = await supabase
        .from("services")
        .update({
          status: "quarantined",
          verified_status: reason || "manual_quarantine",
        })
        .eq("id", id);

      if (updateErr) {
        logger.error(
          "AdminQuarantine",
          `QUARANTINE error: ${updateErr.message}`,
        );
        return res.status(500).json({ error: "Failed to quarantine service" });
      }

      logActivity(
        "admin_quarantine",
        `Admin quarantined service "${service.name}" (${id})${reason ? ` — reason: ${reason}` : ""}`,
        0,
      );
      logger.info(
        "AdminQuarantine",
        `Quarantined: "${service.name}" (${id})${reason ? ` — ${reason}` : ""}`,
      );

      analytics.capture("service_quarantined", {
        distinctId: "admin",
        properties: {
          service_id: id,
          service_name: service.name,
          reason: reason || "manual_quarantine",
        },
      });

      return res.json({
        success: true,
        service_id: id,
        service_name: service.name,
        previous_status: service.status,
        new_status: "quarantined",
        quarantined_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("AdminQuarantine", `QUARANTINE unexpected: ${err.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createAdminQuarantineRouter;
