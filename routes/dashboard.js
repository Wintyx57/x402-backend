// routes/dashboard.js — GET /dashboard, GET /api/stats, GET /api/analytics

const express = require("express");
const logger = require("../lib/logger");
const {
  USDC_CONTRACT,
  EXPLORER_URL,
  NETWORK_LABEL,
  CHAINS,
} = require("../lib/chains");
const {
  fetchWithTimeout,
  TX_HASH_REGEX,
  UUID_REGEX,
} = require("../lib/payment");
const { getDailyTesterStatus } = require("../lib/daily-tester");
const { getTrustBreakdown } = require("../lib/trust-score");
const feeSplitter = require("../lib/fee-splitter");
const {
  getPushStatus,
  getFeedbackWalletInfo,
  forcePushAllScores,
} = require("../lib/erc8004-registry");

// Cache solde USDC RPC — TTL 5 minutes (evite 1-3s de latence RPC par appel)
let _balanceCache = { value: null, ts: 0 };
const BALANCE_TTL = 5 * 60_000;

async function getCachedBalance() {
  if (
    _balanceCache.value !== null &&
    Date.now() - _balanceCache.ts < BALANCE_TTL
  ) {
    return _balanceCache.value;
  }
  const walletAddr = process.env.WALLET_ADDRESS;
  if (!walletAddr) return null;

  // The main wallet (WALLET_ADDRESS) receives payments on Base mainnet.
  // Force Base chain regardless of DEFAULT_CHAIN_KEY (which may be 'skale').
  const baseChain = CHAINS.base;
  const baseRpcUrl = baseChain.rpcUrl;
  const baseUsdcContract = baseChain.usdcContract;

  const balanceCall =
    "0x70a08231" +
    "000000000000000000000000" +
    walletAddr.slice(2).toLowerCase();
  const balRes = await fetchWithTimeout(baseRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: baseUsdcContract, data: balanceCall }, "latest"],
      id: 3,
    }),
  });
  const rpcResponse = await balRes.json();
  let balance = 0;
  if (rpcResponse.error) {
    throw new Error(rpcResponse.error.message || "RPC error");
  } else if (rpcResponse.result && rpcResponse.result !== "0x") {
    // Base USDC has 6 decimals
    balance = Number(BigInt(rpcResponse.result)) / 1e6;
  }
  _balanceCache = { value: balance, ts: Date.now() };
  return balance;
}

function createDashboardRouter(
  supabase,
  adminAuth,
  dashboardApiLimiter,
  adminAuthLimiter,
  payoutManager,
  logActivity,
  adminDashboardLimiter,
) {
  const router = express.Router();

  // adminDashboardLimiter is applied on all /api/admin/* routes.
  // Fall back to a no-op middleware if not provided (backward compatibility).
  const adminRateLimit = adminDashboardLimiter || ((req, res, next) => next());

  // Redirect old dashboard to frontend admin
  router.get("/dashboard", (req, res) => {
    res.redirect(301, "https://x402bazaar.org/admin");
  });

  // API stats (protected by admin auth)
  router.get(
    "/api/stats",
    dashboardApiLimiter,
    adminAuthLimiter,
    adminAuth,
    async (req, res) => {
      let count = 0;
      try {
        const result = await supabase
          .from("services")
          .select("id", { count: "exact", head: true });
        count = result.count || 0;
      } catch (err) {
        logger.error("Stats", "Supabase count error:", err.message);
      }

      // Paiements et revenus — aggregate in Postgres via RPC (migration 031).
      // Previously the handler pulled up to 10k rows and summed in JS.
      // The RPC returns count+sum in a single query with no row payload.
      let totalPayments = 0;
      let totalRevenue = 0;
      try {
        const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data, error } = await supabase.rpc("activity_payment_stats", {
          p_since: sinceIso,
        });
        if (error) {
          // Fallback to the old row-based path if the RPC isn't installed yet.
          if (error.code === "42883" || /function/.test(error.message || "")) {
            logger.warn(
              "Dashboard",
              "activity_payment_stats RPC missing — apply migration 031. Falling back to row scan.",
            );
            const { data: payments } = await supabase
              .from("activity")
              .select("amount")
              .eq("type", "payment")
              .gte("created_at", sinceIso)
              .limit(10000);
            if (payments) {
              totalPayments = payments.length;
              totalRevenue = payments.reduce(
                (sum, p) => sum + Number(p.amount),
                0,
              );
            }
          } else {
            throw error;
          }
        } else if (data && data[0]) {
          totalPayments = Number(data[0].total_count) || 0;
          totalRevenue = Number(data[0].total_amount) || 0;
        }
      } catch (err) {
        logger.warn(
          "Dashboard",
          `Failed to fetch payment stats: ${err.message}`,
        );
      }

      // Solde USDC du wallet serveur (on-chain) — cache TTL 5min
      let walletBalance = null;
      let balanceError = null;
      const walletAddr = process.env.WALLET_ADDRESS;
      try {
        walletBalance = await getCachedBalance();
      } catch (err) {
        balanceError = err.message;
        logger.error("Balance", `Failed to read USDC balance: ${err.message}`);
      }

      // Agent wallet balances (unified wallet)
      let agentWallet = null;
      try {
        agentWallet = await getAgentWalletBalances();
      } catch (err) {
        logger.warn("Dashboard", `Agent wallet balance failed: ${err.message}`);
      }

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.json({
        totalServices: count || 0,
        totalPayments,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        walletBalance,
        wallet: walletAddr
          ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}`
          : null,
        network: NETWORK_LABEL,
        explorer: EXPLORER_URL,
        usdcContract: USDC_CONTRACT,
        ...(balanceError && {
          balanceError: "Balance temporarily unavailable",
        }),
        agentWallet,
      });
    },
  );

  // --- ANALYTICS (aggregated data for charts, protected by admin auth) ---
  router.get(
    "/api/analytics",
    dashboardApiLimiter,
    adminAuthLimiter,
    adminAuth,
    async (req, res) => {
      try {
        // Lancer toutes les queries independantes en parallele
        const [
          paymentsResult,
          apiCallsResult,
          servicesCountResult,
          recentActivityResult,
          avgPriceResult,
          walletBalanceResult,
        ] = await Promise.allSettled([
          // 1. Payments — last 90 days for charts
          supabase
            .from("activity")
            .select("amount, created_at")
            .eq("type", "payment")
            .gte(
              "created_at",
              new Date(Date.now() - 90 * 86400000).toISOString(),
            )
            .order("created_at", { ascending: true })
            .limit(5000),
          // 2. API calls pour top services
          supabase
            .from("activity")
            .select("detail, created_at")
            .eq("type", "api_call")
            .order("created_at", { ascending: false })
            .limit(1000),
          // 3. Total services count
          supabase
            .from("services")
            .select("id", { count: "exact", head: true }),
          // 4. Recent activity (last 10) — admin-only, full tx_hash
          supabase
            .from("activity")
            .select("type, detail, amount, created_at, tx_hash, chain")
            .order("created_at", { ascending: false })
            .limit(10),
          // 5. Average price of paid services
          supabase.from("services").select("price_usdc").gt("price_usdc", 0),
          // 6. Wallet balance (cache TTL 5min — evite 1-3s RPC par appel)
          getCachedBalance(),
        ]);

        const payments =
          paymentsResult.status === "fulfilled"
            ? paymentsResult.value.data || []
            : [];
        const apiCalls =
          apiCallsResult.status === "fulfilled"
            ? apiCallsResult.value.data || []
            : [];
        const servicesCount =
          servicesCountResult.status === "fulfilled"
            ? servicesCountResult.value.count || 0
            : 0;

        if (paymentsResult.status === "rejected")
          logger.warn(
            "Analytics",
            `Failed to fetch payments: ${paymentsResult.reason?.message}`,
          );
        if (apiCallsResult.status === "rejected")
          logger.warn(
            "Analytics",
            `Failed to fetch api_calls: ${apiCallsResult.reason?.message}`,
          );
        if (servicesCountResult.status === "rejected")
          logger.warn(
            "Analytics",
            `Failed to count services: ${servicesCountResult.reason?.message}`,
          );

        // Aggregate payments by day
        const dailyMap = {};

        for (const p of payments) {
          const date = p.created_at?.split("T")[0];
          if (!date) continue;
          const amount = Number(p.amount) || 0;
          if (!dailyMap[date]) dailyMap[date] = { total: 0, count: 0 };
          dailyMap[date].total += amount;
          dailyMap[date].count++;
        }

        // Fill missing calendar days so charts always show continuous data
        const now = new Date();
        const chartDays = 30; // show last 30 days
        const allDates = [];
        for (let i = chartDays - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          allDates.push(d.toISOString().split("T")[0]);
        }

        let cumulativeTotal = 0;
        const cumulativeRevenue = [];

        // Include historical data before the 30-day window for correct cumulative
        const sortedDates = Object.keys(dailyMap).sort();
        for (const date of sortedDates) {
          if (date < allDates[0]) {
            cumulativeTotal += dailyMap[date].total;
          }
        }

        const dailyVolume = allDates.map((date) => {
          const day = dailyMap[date] || { total: 0, count: 0 };
          cumulativeTotal += day.total;
          cumulativeRevenue.push({
            date,
            total: Math.round(cumulativeTotal * 100) / 100,
          });
          return {
            date,
            total: Math.round(day.total * 100) / 100,
            count: day.count,
          };
        });

        // Aggregate top services by call count
        const serviceCountMap = {};
        for (const call of apiCalls) {
          const match = call.detail?.match(/^(\w[\w\s/]+?)(?:\s*[:.])/);
          const endpoint = match ? match[1].trim() : call.detail || "Unknown";
          serviceCountMap[endpoint] = (serviceCountMap[endpoint] || 0) + 1;
        }

        const topServices = Object.entries(serviceCountMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
          .map(([endpoint, count]) => ({ endpoint, count }));

        // Totals
        const totalRevenue = payments.reduce(
          (sum, p) => sum + (Number(p.amount) || 0),
          0,
        );
        const totalTransactions = payments.length;

        // Wallet balance (depuis cache)
        let walletBalance = null;
        if (walletBalanceResult.status === "fulfilled") {
          walletBalance = walletBalanceResult.value;
        } else {
          logger.error(
            "Analytics",
            `Balance read failed: ${walletBalanceResult.reason?.message}`,
          );
        }

        // Recent activity
        let recentActivity = [];
        if (
          recentActivityResult.status === "fulfilled" &&
          recentActivityResult.value.data
        ) {
          recentActivity = recentActivityResult.value.data.map((a) => ({
            type: a.type,
            detail: a.detail,
            amount: a.amount,
            time: a.created_at,
            txHash: a.tx_hash || null,
            chain: a.chain || null,
          }));
        } else if (recentActivityResult.status === "rejected") {
          logger.warn(
            "Analytics",
            `Failed to fetch recent activity: ${recentActivityResult.reason?.message}`,
          );
        }

        // Average price
        let avgPrice = 0;
        if (
          avgPriceResult.status === "fulfilled" &&
          avgPriceResult.value.data?.length > 0
        ) {
          const svcData = avgPriceResult.value.data;
          avgPrice =
            Math.round(
              (svcData.reduce((sum, s) => sum + Number(s.price_usdc), 0) /
                svcData.length) *
                1000,
            ) / 1000;
        } else if (avgPriceResult.status === "rejected") {
          logger.warn(
            "Analytics",
            `Failed to compute avg price: ${avgPriceResult.reason?.message}`,
          );
        }

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.json({
          dailyVolume,
          topServices,
          cumulativeRevenue,
          totals: {
            revenue: Math.round(totalRevenue * 100) / 100,
            transactions: totalTransactions,
            services: servicesCount,
          },
          walletBalance,
          walletAddress: process.env.WALLET_ADDRESS
            ? process.env.WALLET_ADDRESS.slice(0, 6) +
              "..." +
              process.env.WALLET_ADDRESS.slice(-4)
            : null,
          network: NETWORK_LABEL,
          explorer: EXPLORER_URL,
          recentActivity,
          activeServicesCount: servicesCount,
          avgPrice,
        });
      } catch (err) {
        logger.error("Analytics", err.message);
        res.status(500).json({ error: "Analytics failed" });
      }
    },
  );

  // --- ADMIN: Usage metrics (unique wallets, growth, hourly distribution) ---
  router.get(
    "/api/admin/usage",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 7);
        const prevWeekStart = new Date(now);
        prevWeekStart.setDate(prevWeekStart.getDate() - 14);
        const monthStart = new Date(now);
        monthStart.setDate(monthStart.getDate() - 30);

        const [
          todayCallsResult,
          weekCallsResult,
          prevWeekCallsResult,
          monthCallsResult,
          walletsResult,
          hourlyResult,
          errorCountResult,
          totalCallsResult,
          registrationsResult,
        ] = await Promise.allSettled([
          // Calls today
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .in("type", ["api_call", "payment"])
            .gte("created_at", todayStart.toISOString()),
          // Calls this week
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .in("type", ["api_call", "payment"])
            .gte("created_at", weekStart.toISOString()),
          // Calls prev week (for growth rate)
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .in("type", ["api_call", "payment"])
            .gte("created_at", prevWeekStart.toISOString())
            .lt("created_at", weekStart.toISOString()),
          // Calls this month
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .in("type", ["api_call", "payment"])
            .gte("created_at", monthStart.toISOString()),
          // Unique wallets (from used_transactions)
          supabase.from("used_transactions").select("from_address").limit(2000),
          // Hourly distribution (last 7 days)
          supabase
            .from("activity")
            .select("created_at")
            .in("type", ["api_call", "payment"])
            .gte("created_at", weekStart.toISOString())
            .limit(2000),
          // Error count this week
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .eq("type", "error")
            .gte("created_at", weekStart.toISOString()),
          // Total calls all time
          supabase
            .from("activity")
            .select("id", { count: "exact", head: true })
            .in("type", ["api_call", "payment"]),
          // New service registrations this week
          supabase
            .from("services")
            .select("id", { count: "exact", head: true })
            .gte("created_at", weekStart.toISOString()),
        ]);

        const val = (r) => (r.status === "fulfilled" ? r.value : null);

        // Unique wallets
        const walletsData = val(walletsResult)?.data || [];
        const uniqueWallets = new Set(walletsData.map((r) => r.from_address))
          .size;

        // Hourly distribution
        const hourly = new Array(24).fill(0);
        const hourlyData = val(hourlyResult)?.data || [];
        for (const row of hourlyData) {
          if (row.created_at) {
            const hour = new Date(row.created_at).getUTCHours();
            hourly[hour]++;
          }
        }

        // Growth rate
        const thisWeek = val(weekCallsResult)?.count || 0;
        const prevWeek = val(prevWeekCallsResult)?.count || 0;
        const growthRate =
          prevWeek > 0
            ? Math.round(((thisWeek - prevWeek) / prevWeek) * 100)
            : thisWeek > 0
              ? 100
              : 0;

        // Error rate
        const errorCount = val(errorCountResult)?.count || 0;
        const successRate =
          thisWeek > 0
            ? Math.round(((thisWeek - errorCount) / thisWeek) * 100)
            : 100;

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json({
          calls_today: val(todayCallsResult)?.count || 0,
          calls_this_week: thisWeek,
          calls_this_month: val(monthCallsResult)?.count || 0,
          calls_all_time: val(totalCallsResult)?.count || 0,
          unique_wallets: uniqueWallets,
          growth_rate_percent: growthRate,
          success_rate_percent: successRate,
          errors_this_week: errorCount,
          new_services_this_week: val(registrationsResult)?.count || 0,
          hourly_distribution: hourly,
        });
      } catch (err) {
        logger.error("Usage", err.message);
        res.status(500).json({ error: "Usage metrics failed" });
      }
    },
  );

  // --- ADMIN: Revenue overview ---
  router.get(
    "/api/admin/revenue",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!payoutManager) {
        return res.status(501).json({ error: "Payout system not configured" });
      }
      const overview = await payoutManager.getRevenueOverview();
      if (overview.error)
        return res.status(500).json({ error: overview.error });
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.json(overview);
    },
  );

  // --- ADMIN: Pending payouts ---
  router.get(
    "/api/admin/payouts",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!payoutManager) {
        return res.status(501).json({ error: "Payout system not configured" });
      }
      const result = await payoutManager.getPendingPayouts();
      if (result.error) return res.status(500).json({ error: result.error });
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.json(result);
    },
  );

  // --- ADMIN: Mark payouts as paid ---
  router.post(
    "/api/admin/payouts/mark-paid",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!payoutManager) {
        return res.status(501).json({ error: "Payout system not configured" });
      }
      const { ids, txHashOut } = req.body;
      if (!Array.isArray(ids) || ids.length === 0 || !txHashOut) {
        return res
          .status(400)
          .json({ error: "Required: ids (array) and txHashOut (string)" });
      }

      if (!TX_HASH_REGEX.test(txHashOut)) {
        return res.status(400).json({
          error:
            "txHashOut must be a valid transaction hash (0x + 64 hex chars)",
        });
      }
      if (!ids.every((id) => UUID_REGEX.test(id))) {
        return res.status(400).json({ error: "All ids must be valid UUIDs" });
      }
      if (ids.length > 100) {
        return res.status(400).json({ error: "Maximum 100 ids per batch" });
      }

      const result = await payoutManager.markPayoutsPaid(ids, txHashOut);
      if (result.error) return res.status(500).json({ error: result.error });
      logActivity(
        "admin",
        `Marked ${result.updated} payouts as paid (tx: ${txHashOut.slice(0, 18)}...)`,
      );
      res.json({ success: true, ...result });
    },
  );

  // Daily E2E tester status (admin-only diagnostic)
  router.get(
    "/api/admin/daily-tester",
    adminRateLimit,
    adminAuth,
    (req, res) => {
      res.json(getDailyTesterStatus());
    },
  );

  // --- ADMIN: TrustScore breakdown for a service (PRIVATE — algorithm details) ---
  router.get(
    "/api/admin/trust-score/:serviceId",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const serviceId = req.params.serviceId;
        if (!UUID_REGEX.test(serviceId)) {
          return res.status(400).json({ error: "Invalid service ID" });
        }
        const breakdown = await getTrustBreakdown(supabase, serviceId);
        if (!breakdown) {
          return res.status(404).json({ error: "Service not found" });
        }
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json(breakdown);
      } catch (err) {
        logger.error("TrustScore", `Breakdown error: ${err.message}`);
        res.status(500).json({ error: "Failed to compute trust breakdown" });
      }
    },
  );

  // --- ADMIN: TrustScore leaderboard (all services sorted by score) ---
  router.get(
    "/api/admin/trust-score",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from("services")
          .select(
            "id, name, url, trust_score, trust_score_updated_at, status, price_usdc",
          )
          .not("trust_score", "is", null)
          .order("trust_score", { ascending: false })
          .limit(200);

        if (error) throw error;
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json({ services: data || [], count: (data || []).length });
      } catch (err) {
        logger.error("TrustScore", `Leaderboard error: ${err.message}`);
        res.status(500).json({ error: "Failed to fetch trust scores" });
      }
    },
  );

  // ─── FeeSplitter admin endpoints ─────────────────────────────────────

  // GET /api/admin/fee-splitter — FeeSplitter contract status (pending balance, stats)
  router.get(
    "/api/admin/fee-splitter",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!feeSplitter.isConfigured()) {
        return res.json({
          configured: false,
          message:
            "FeeSplitter not configured — set FEE_SPLITTER_OPERATOR_KEY + POLYGON_FEE_SPLITTER_CONTRACT",
        });
      }

      const [pending, preview] = await Promise.all([
        feeSplitter.getPendingBalance(),
        feeSplitter.previewSplit(1_000_000), // preview for 1 USDC
      ]);

      res.json({
        configured: true,
        contract: process.env.POLYGON_FEE_SPLITTER_CONTRACT,
        pending_usdc:
          pending !== null ? (Number(pending) / 1e6).toFixed(6) : null,
        preview_1usdc: preview
          ? {
              provider: (Number(preview.providerShare) / 1e6).toFixed(6),
              platform: (Number(preview.platformShare) / 1e6).toFixed(6),
            }
          : null,
      });
    },
  );

  // POST /api/admin/fee-splitter/distribute — Trigger distribute(provider, amount)
  router.post(
    "/api/admin/fee-splitter/distribute",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!feeSplitter.isConfigured()) {
        return res.status(503).json({ error: "FeeSplitter not configured" });
      }

      const { provider, amount_usdc } = req.body || {};
      if (!provider || !/^0x[a-fA-F0-9]{40}$/.test(provider)) {
        return res
          .status(400)
          .json({ error: "Invalid provider address", field: "provider" });
      }
      const amountUsdc = parseFloat(amount_usdc);
      if (!amountUsdc || amountUsdc <= 0 || amountUsdc > 10000) {
        return res.status(400).json({
          error: "Invalid amount (0 < amount <= 10000)",
          field: "amount_usdc",
        });
      }

      const amountRaw = Math.round(amountUsdc * 1e6);
      const txHash = await feeSplitter.callDistribute(provider, amountRaw);

      if (!txHash) {
        return res
          .status(500)
          .json({ error: "distribute() failed — check logs" });
      }

      logActivity(
        "fee_splitter",
        `distribute(${provider.slice(0, 10)}..., ${amountUsdc} USDC) — tx: ${txHash}`,
        amountUsdc,
        txHash,
      );

      res.json({
        success: true,
        txHash,
        provider,
        amount_usdc: amountUsdc,
        explorer: `https://polygonscan.com/tx/${txHash}`,
      });
    },
  );

  // ─── Agent Wallet balances (unified wallet) ───────────────────────

  // Cache agent wallet balances — TTL 5 minutes
  let _agentWalletCache = { value: null, ts: 0 };
  const AGENT_WALLET_TTL = 5 * 60_000;

  async function getAgentWalletBalances() {
    if (
      _agentWalletCache.value &&
      Date.now() - _agentWalletCache.ts < AGENT_WALLET_TTL
    ) {
      return _agentWalletCache.value;
    }

    const pk = process.env.AGENT_PRIVATE_KEY;
    if (!pk) return null;

    const { privateKeyToAccount } = require("viem/accounts");
    const normalizedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
    const address = privateKeyToAccount(normalizedKey).address;
    const padded = "000000000000000000000000" + address.slice(2).toLowerCase();
    const balanceOfCall = "0x70a08231" + padded;

    async function rpc(url, method, params) {
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      });
      const j = await r.json();
      if (!j.result) return 0n;
      return BigInt(j.result);
    }

    const skaleRpc =
      CHAINS.skale?.rpcUrl || "https://skale-base.skalenodes.com/v1/base";
    const baseRpc = CHAINS.base?.rpcUrl || "https://mainnet.base.org";
    const polygonRpc =
      CHAINS.polygon?.rpcUrl || "https://polygon-bor-rpc.publicnode.com";

    const [skaleCredits, skaleUsdc, baseUsdc, baseEth, polyUsdc, polyPol] =
      await Promise.allSettled([
        rpc(skaleRpc, "eth_getBalance", [address, "latest"]),
        rpc(skaleRpc, "eth_call", [
          { to: CHAINS.skale?.usdcContract, data: balanceOfCall },
          "latest",
        ]),
        rpc(baseRpc, "eth_call", [
          { to: CHAINS.base?.usdcContract, data: balanceOfCall },
          "latest",
        ]),
        rpc(baseRpc, "eth_getBalance", [address, "latest"]),
        rpc(polygonRpc, "eth_call", [
          { to: CHAINS.polygon?.usdcContract, data: balanceOfCall },
          "latest",
        ]),
        rpc(polygonRpc, "eth_getBalance", [address, "latest"]),
      ]);

    const val = (r) => (r.status === "fulfilled" ? r.value : 0n);

    const result = {
      address: `${address.slice(0, 6)}...${address.slice(-4)}`,
      address_full: address,
      skale: {
        credits: +(Number(val(skaleCredits)) / 1e18).toFixed(4),
        usdc: +(Number(val(skaleUsdc)) / 1e6).toFixed(4),
      },
      base: {
        usdc: +(Number(val(baseUsdc)) / 1e6).toFixed(4),
        eth: +(Number(val(baseEth)) / 1e18).toFixed(8),
      },
      polygon: {
        usdc: +(Number(val(polyUsdc)) / 1e6).toFixed(4),
        pol: +(Number(val(polyPol)) / 1e18).toFixed(6),
      },
      total_usdc: +(
        Number(val(skaleUsdc)) / 1e6 +
        Number(val(baseUsdc)) / 1e6 +
        Number(val(polyUsdc)) / 1e6
      ).toFixed(4),
      timestamp: new Date().toISOString(),
    };

    _agentWalletCache = { value: result, ts: Date.now() };
    return result;
  }

  // GET /api/admin/agent-wallet — Real-time balances of the unified agent wallet
  router.get(
    "/api/admin/agent-wallet",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const balances = await getAgentWalletBalances();
        if (!balances) {
          return res
            .status(503)
            .json({ error: "AGENT_PRIVATE_KEY not configured" });
        }
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json(balances);
      } catch (err) {
        logger.error("AgentWallet", `Balance check failed: ${err.message}`);
        res.status(500).json({ error: "Failed to read agent wallet balances" });
      }
    },
  );

  // ─── ERC-8004 admin endpoints ──────────────────────────────────────

  // GET /api/admin/erc8004/status — Full diagnostic of ERC-8004 reputation push pipeline
  router.get(
    "/api/admin/erc8004/status",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const [pushStatus, walletInfo, agentIdResult, trustScoreResult] =
          await Promise.all([
            getPushStatus(),
            getFeedbackWalletInfo(),
            supabase
              .from("services")
              .select("id", { count: "exact", head: true })
              .not("erc8004_agent_id", "is", null),
            supabase
              .from("services")
              .select("id", { count: "exact", head: true })
              .not("trust_score", "is", null),
          ]);

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json({
          feedback_wallet: walletInfo,
          last_push: pushStatus,
          auto_refill: {
            enabled: !!process.env.FAUCET_PRIVATE_KEY,
            threshold_credits: "0.1",
            refill_amount_credits: "2.0",
          },
          services: {
            with_agent_id: agentIdResult.count || 0,
            with_trust_score: trustScoreResult.count || 0,
          },
          env: {
            AGENT_PRIVATE_KEY: !!process.env.AGENT_PRIVATE_KEY,
            ERC8004_FEEDBACK_KEY: !!process.env.ERC8004_FEEDBACK_KEY,
          },
        });
      } catch (err) {
        logger.error("ERC8004", `Admin status error: ${err.message}`);
        res.status(500).json({ error: "Failed to get ERC-8004 status" });
      }
    },
  );

  // POST /api/admin/trust-score/recalculate — Force immediate trust score recalculation + push
  router.post(
    "/api/admin/trust-score/recalculate",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const { recalculateAllScores } = require("../lib/trust-score");
        await recalculateAllScores(supabase);

        // Read updated counts
        const [trustCount, agentCount] = await Promise.all([
          supabase
            .from("services")
            .select("id", { count: "exact", head: true })
            .not("trust_score", "is", null),
          supabase
            .from("services")
            .select("id", { count: "exact", head: true })
            .not("erc8004_agent_id", "is", null),
        ]);

        res.json({
          success: true,
          services_with_trust_score: trustCount.count || 0,
          services_with_agent_id: agentCount.count || 0,
        });
      } catch (err) {
        logger.error("TrustScore", `Force recalculate error: ${err.message}`);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // GET /api/admin/trust-score/diagnostic — Check monitoring data availability
  router.get(
    "/api/admin/trust-score/diagnostic",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

        const [monCount, dailyCount, sampleMon, sampleDaily, serviceCount] =
          await Promise.all([
            supabase
              .from("monitoring_checks")
              .select("id", { count: "exact", head: true })
              .gte("checked_at", cutoff),
            supabase
              .from("daily_checks")
              .select("id", { count: "exact", head: true })
              .gte("checked_at", cutoff),
            supabase
              .from("monitoring_checks")
              .select("endpoint, status, latency, checked_at")
              .gte("checked_at", cutoff)
              .order("checked_at", { ascending: false })
              .limit(5),
            supabase
              .from("daily_checks")
              .select("endpoint, overall_status, call_latency_ms, checked_at")
              .gte("checked_at", cutoff)
              .order("checked_at", { ascending: false })
              .limit(5),
            supabase
              .from("services")
              .select("id, url, trust_score, erc8004_agent_id")
              .limit(5),
          ]);

        // Count unique endpoints in monitoring_checks
        const { data: uniqueEndpoints } = await supabase
          .from("monitoring_checks")
          .select("endpoint")
          .gte("checked_at", cutoff)
          .limit(5000);
        const uniqueEpSet = new Set(
          (uniqueEndpoints || []).map((r) => r.endpoint),
        );

        res.json({
          monitoring_checks: {
            total_rows: monCount.count || 0,
            unique_endpoints: uniqueEpSet.size,
          },
          daily_checks: { total_rows: dailyCount.count || 0 },
          sample_monitoring: sampleMon.data || [],
          sample_daily: sampleDaily.data || [],
          sample_services: (serviceCount.data || []).map((s) => ({
            id: s.id.slice(0, 8),
            path: (() => {
              try {
                return new URL(s.url).pathname;
              } catch {
                return s.url;
              }
            })(),
            trust_score: s.trust_score,
            erc8004_agent_id: s.erc8004_agent_id,
          })),
          cutoff_date: cutoff,
        });
      } catch (err) {
        logger.error("TrustScore", `Diagnostic error: ${err.message}`);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // POST /api/admin/erc8004/push — Force immediate trust score push (synchronous)
  router.post(
    "/api/admin/erc8004/push",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      try {
        const result = await forcePushAllScores(supabase);
        logActivity(
          "admin",
          `Force ERC-8004 push: ${result.pushed}/${result.total} ok`,
        );
        res.json(result);
      } catch (err) {
        logger.error("ERC8004", `Force push error: ${err.message}`);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // POST /api/admin/fee-splitter/withdraw — Emergency withdraw to platform wallet
  router.post(
    "/api/admin/fee-splitter/withdraw",
    adminRateLimit,
    adminAuth,
    async (req, res) => {
      if (!feeSplitter.isConfigured()) {
        return res.status(503).json({ error: "FeeSplitter not configured" });
      }

      // Check pending balance first
      const pending = await feeSplitter.getPendingBalance();
      if (pending === null) {
        return res
          .status(500)
          .json({ error: "Failed to read pending balance" });
      }
      if (pending === 0n) {
        return res.json({
          success: true,
          message: "No pending balance to withdraw",
          amount_usdc: "0",
        });
      }

      // emergencyWithdraw is owner-only on the contract, but distribute() to WALLET_ADDRESS
      // achieves the same effect: sends 95% to WALLET_ADDRESS + 5% to platformWallet (same wallet)
      const platformWallet = process.env.WALLET_ADDRESS;
      const txHash = await feeSplitter.callDistribute(platformWallet, pending);

      if (!txHash) {
        return res.status(500).json({
          error:
            "withdraw failed — check logs. Try emergencyWithdraw() directly on contract.",
        });
      }

      const amountUsdc = (Number(pending) / 1e6).toFixed(6);
      logActivity(
        "fee_splitter_withdraw",
        `withdraw ${amountUsdc} USDC to platform — tx: ${txHash}`,
        parseFloat(amountUsdc),
        txHash,
      );

      res.json({
        success: true,
        txHash,
        amount_usdc: amountUsdc,
        recipient: platformWallet,
        explorer: `https://polygonscan.com/tx/${txHash}`,
      });
    },
  );

  return router;
}

module.exports = createDashboardRouter;
