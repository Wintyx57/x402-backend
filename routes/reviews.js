// routes/reviews.js — POST /api/reviews, GET /api/reviews/:serviceId, GET /api/reviews/:serviceId/stats
//
// SQL migration (run manually in Supabase dashboard):
// -----------------------------------------------------
// CREATE TABLE reviews (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   service_id UUID REFERENCES services(id),
//   wallet_address TEXT NOT NULL,
//   rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
//   comment TEXT CHECK (char_length(comment) <= 500),
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_reviews_service ON reviews(service_id);
// CREATE UNIQUE INDEX idx_reviews_unique ON reviews(service_id, wallet_address);
// -----------------------------------------------------

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("../lib/logger");
const { UUID_REGEX } = require("../lib/payment");
const { NETWORK } = require("../lib/chains");

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Max drift accepted between client timestamp and server time (5 minutes)
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

// Lazy-load viem recoverMessageAddress (ESM module via dynamic require fallback)
let _recoverMessageAddress = null;
function getRecoverMessageAddress() {
  if (_recoverMessageAddress) return _recoverMessageAddress;
  try {
    // viem is a direct dependency — require works with commonjs interop
    const viem = require("viem");
    _recoverMessageAddress = viem.recoverMessageAddress;
  } catch {
    _recoverMessageAddress = null;
  }
  return _recoverMessageAddress;
}

// Strip HTML tags for comment sanitization
function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "").trim();
}

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const wallet = (req.headers["x-wallet-address"] || "").toLowerCase();
    return `${ip}:${wallet}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  message: {
    error: "Too many reviews",
    message: "Rate limit: max 10 reviews per hour per wallet.",
  },
});

const readLimiter = rateLimit({
  windowMs: 60000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function createReviewsRouter(supabase) {
  const router = express.Router();

  // POST /api/reviews — Submit a review
  router.post("/api/reviews", reviewLimiter, async (req, res) => {
    const wallet = (req.headers["x-wallet-address"] || "").trim();
    const { service_id, rating, comment } = req.body;

    // Validate wallet
    if (!wallet || !WALLET_REGEX.test(wallet)) {
      return res.status(400).json({
        error: "Invalid wallet",
        message:
          "X-Wallet-Address header must be a valid Ethereum address (0x...)",
      });
    }

    // Validate service_id
    if (!service_id || !UUID_REGEX.test(service_id)) {
      return res.status(400).json({
        error: "Invalid service_id",
        message: "service_id must be a valid UUID",
      });
    }

    // Validate rating
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        error: "Invalid rating",
        message: "rating must be an integer between 1 and 5",
      });
    }

    // Validate wallet signature (optional for backward compatibility)
    const { signature, timestamp } = req.body;
    let signatureVerified = false;

    if (signature && timestamp) {
      const ts = Number(timestamp);
      if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
        return res.status(400).json({
          error: "Invalid timestamp",
          message:
            "Timestamp must be within 5 minutes of server time (milliseconds).",
        });
      }

      const recoverMessageAddress = getRecoverMessageAddress();
      if (!recoverMessageAddress) {
        logger.error(
          "Reviews",
          "viem recoverMessageAddress unavailable — rejecting review (fail closed)",
        );
        return res.status(503).json({
          error: "Signature verification temporarily unavailable",
          message:
            "Signature verification service is unavailable. Please try again later.",
        });
      }
      try {
        const commentHash = comment
          ? crypto
              .createHash("sha256")
              .update(comment)
              .digest("hex")
              .slice(0, 8)
          : "nocomment";
        const message = `x402-review:${service_id}:${rating}:${commentHash}:${timestamp}`;
        const recovered = await recoverMessageAddress({ message, signature });
        if (recovered.toLowerCase() === wallet.toLowerCase()) {
          signatureVerified = true;
        } else {
          return res.status(401).json({
            error: "Signature mismatch",
            message:
              "The signature does not match the declared wallet address.",
          });
        }
      } catch (sigErr) {
        return res.status(400).json({
          error: "Invalid signature",
          message: "Could not recover address from signature.",
        });
      }
    } else if (NETWORK !== "testnet") {
      return res
        .status(400)
        .json({
          error: "Signature required",
          message: "Reviews require wallet signature in production.",
        });
    } else {
      logger.warn(
        "Reviews",
        `Review submitted without signature from ${wallet.slice(0, 8)}... (testnet mode — allowed)`,
      );
    }

    // Validate + sanitize comment
    let sanitizedComment = null;
    if (comment !== undefined && comment !== null && comment !== "") {
      if (typeof comment !== "string") {
        return res.status(400).json({ error: "comment must be a string" });
      }
      sanitizedComment = stripHtml(comment);
      if (sanitizedComment.length > 500) {
        return res.status(400).json({
          error: "Comment too long",
          message: "comment must be 500 characters or less",
        });
      }
    }

    // Check service exists
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("id")
      .eq("id", service_id)
      .single();

    if (serviceError || !service) {
      return res.status(404).json({ error: "Service not found" });
    }

    // Check wallet has used the service (at least 1 activity entry)
    const { data: activityRows, error: activityError } = await supabase
      .from("activity")
      .select("id")
      .ilike("detail", `%${service_id.replace(/[%_\\]/g, "\\$&")}%`)
      .limit(1);

    // Fallback: also check by wallet in detail if activity includes wallet info
    // Since activity table may not store service_id directly, we allow if no activity found
    // (the check is best-effort: if activity table has no matching entry, we still allow)
    if (!activityError && activityRows && activityRows.length === 0) {
      // Check broader: any activity from this wallet
      const { data: walletActivity } = await supabase
        .from("activity")
        .select("id")
        .ilike("detail", `%${wallet.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`)
        .limit(1);

      // If activity table is empty or wallet never used anything, still allow
      // (graceful degradation — table structure may vary)
      if (walletActivity && walletActivity.length === 0) {
        // Best-effort check passed (wallet unknown but not blocked)
        logger.warn(
          "Reviews",
          `Wallet ${wallet.slice(0, 8)}... has no recorded activity — allowing review`,
        );
      }
    }

    // Upsert review (one review per wallet per service)
    const { data, error } = await supabase
      .from("reviews")
      .upsert(
        [
          {
            service_id,
            wallet_address: wallet.toLowerCase(),
            rating: ratingNum,
            comment: sanitizedComment,
          },
        ],
        { onConflict: "service_id,wallet_address", ignoreDuplicates: false },
      )
      .select()
      .single();

    if (error) {
      logger.error("Reviews", `POST /api/reviews error: ${error.message}`);
      return res.status(500).json({ error: "Failed to save review" });
    }

    logger.info(
      "Reviews",
      `Review submitted: service=${service_id} wallet=${wallet.slice(0, 8)}... rating=${ratingNum} verified=${signatureVerified}`,
    );
    return res
      .status(201)
      .json({ success: true, verified: signatureVerified, data });
  });

  // GET /api/reviews/stats/batch — Aggregate stats for multiple services in one query
  // Usage: GET /api/reviews/stats/batch?ids=uuid1,uuid2,...  (max 500 IDs)
  // IMPORTANT: must be declared BEFORE /:serviceId to avoid "stats" being captured as a param
  router.get("/api/reviews/stats/batch", readLimiter, async (req, res) => {
    const raw = (req.query.ids || "").trim();
    if (!raw) {
      return res.status(400).json({ error: "Missing ids query parameter" });
    }

    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return res
        .status(400)
        .json({ error: "ids must contain at least one UUID" });
    }
    if (ids.length > 500) {
      return res
        .status(400)
        .json({ error: "ids must contain at most 500 UUIDs" });
    }

    // Validate each ID
    const invalid = ids.filter((id) => !UUID_REGEX.test(id));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: "Invalid UUID(s)",
        invalid: invalid.slice(0, 5),
      });
    }

    // Single Supabase query for all services
    const { data, error } = await supabase
      .from("reviews")
      .select("service_id, rating")
      .in("service_id", ids);

    if (error) {
      logger.error(
        "Reviews",
        `GET /api/reviews/stats/batch error: ${error.message}`,
      );
      return res
        .status(500)
        .json({ error: "Failed to fetch batch review stats" });
    }

    // Aggregate in-memory
    const statsMap = {};
    for (const row of data || []) {
      if (!statsMap[row.service_id]) {
        statsMap[row.service_id] = { sum: 0, count: 0 };
      }
      statsMap[row.service_id].sum += row.rating;
      statsMap[row.service_id].count += 1;
    }

    // Build response — include requested IDs even if they have no reviews
    const result = {};
    for (const id of ids) {
      const entry = statsMap[id];
      if (entry && entry.count > 0) {
        result[id] = {
          average: Math.round((entry.sum / entry.count) * 10) / 10,
          count: entry.count,
        };
      } else {
        result[id] = { average: 0, count: 0 };
      }
    }

    return res.json(result);
  });

  // GET /api/reviews/:serviceId — Get reviews for a service
  router.get("/api/reviews/:serviceId", readLimiter, async (req, res) => {
    const { serviceId } = req.params;

    if (!UUID_REGEX.test(serviceId)) {
      return res
        .status(400)
        .json({ error: "Invalid serviceId — must be a UUID" });
    }

    const rawPage = parseInt(req.query.page, 10);
    const rawLimit = parseInt(req.query.limit, 10);
    const page = Math.max(1, isNaN(rawPage) || rawPage < 1 ? 1 : rawPage);
    const limit = Math.min(50, isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("reviews")
      .select("id, wallet_address, rating, comment, created_at", {
        count: "exact",
      })
      .eq("service_id", serviceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error(
        "Reviews",
        `GET /api/reviews/${serviceId} error: ${error.message}`,
      );
      return res.status(500).json({ error: "Failed to fetch reviews" });
    }

    return res.json({
      success: true,
      count: count || 0,
      page,
      limit,
      data: data || [],
    });
  });

  // GET /api/reviews/:serviceId/stats — Aggregate stats
  router.get("/api/reviews/:serviceId/stats", readLimiter, async (req, res) => {
    const { serviceId } = req.params;

    if (!UUID_REGEX.test(serviceId)) {
      return res
        .status(400)
        .json({ error: "Invalid serviceId — must be a UUID" });
    }

    const { data, error } = await supabase
      .from("reviews")
      .select("rating")
      .eq("service_id", serviceId);

    if (error) {
      logger.error(
        "Reviews",
        `GET /api/reviews/${serviceId}/stats error: ${error.message}`,
      );
      return res.status(500).json({ error: "Failed to fetch review stats" });
    }

    const reviews = data || [];
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const r of reviews) {
      const key = String(r.rating);
      if (distribution[key] !== undefined) distribution[key]++;
    }

    const total = reviews.length;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    const average = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;

    return res.json({
      average,
      count: total,
      distribution,
    });
  });

  return router;
}

module.exports = createReviewsRouter;
