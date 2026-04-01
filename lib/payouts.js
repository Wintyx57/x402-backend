// lib/payouts.js — Revenue split tracking (95/5)

const logger = require("./logger");

const PLATFORM_FEE_PERCENT = 5;

function createPayoutManager(supabase) {
  /**
   * Record a pending payout after a proxied API call.
   * Called after payment is verified and the external API call succeeds.
   */
  async function recordPayout({
    serviceId,
    serviceName,
    providerWallet,
    grossAmount,
    txHashIn,
    chain = "base",
  }) {
    // Integer arithmetic on micro-USDC (6 decimals) to avoid IEEE-754 float drift
    const grossRaw = Math.round(grossAmount * 1e6);
    const platformFeeRaw = Math.floor((grossRaw * PLATFORM_FEE_PERCENT) / 100);
    const providerAmountRaw = grossRaw - platformFeeRaw;
    const platformFee = platformFeeRaw / 1e6;
    const providerAmount = providerAmountRaw / 1e6;

    const { data, error } = await supabase
      .from("pending_payouts")
      .insert([
        {
          service_id: serviceId,
          service_name: serviceName,
          provider_wallet: providerWallet,
          gross_amount: grossAmount,
          provider_amount: providerAmount,
          platform_fee: platformFee,
          tx_hash_in: txHashIn,
          chain,
          status: "pending",
        },
      ])
      .select();

    if (error) {
      logger.error("Payouts", "recordPayout error:", {
        message: error.message,
      });
      return null;
    }

    logger.info(
      "Payouts",
      `Recorded payout: ${providerAmount.toFixed(4)} USDC to ${providerWallet.slice(0, 10)}... (fee: ${platformFee.toFixed(4)})`,
    );
    return data[0];
  }

  /**
   * Get pending payouts summary grouped by provider wallet.
   */
  async function getPendingPayouts() {
    const { data, error } = await supabase
      .from("pending_payouts")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Payouts", "getPendingPayouts error:", {
        message: error.message,
      });
      return { error: error.message };
    }

    // Group by provider wallet
    const byProvider = {};
    let totalOwed = 0;
    let totalFees = 0;

    for (const payout of data || []) {
      const wallet = payout.provider_wallet;
      if (!byProvider[wallet]) {
        byProvider[wallet] = {
          wallet,
          total_owed: 0,
          total_fees: 0,
          count: 0,
          payouts: [],
        };
      }
      byProvider[wallet].total_owed += Number(payout.provider_amount);
      byProvider[wallet].total_fees += Number(payout.platform_fee);
      byProvider[wallet].count += 1;
      byProvider[wallet].payouts.push(payout);
      totalOwed += Number(payout.provider_amount);
      totalFees += Number(payout.platform_fee);
    }

    return {
      providers: Object.values(byProvider),
      summary: {
        total_pending: (data || []).length,
        total_owed_usdc: totalOwed,
        total_platform_fees_usdc: totalFees,
        provider_count: Object.keys(byProvider).length,
      },
    };
  }

  /**
   * Mark payouts as paid (after batch on-chain transfer).
   */
  async function markPayoutsPaid(ids, txHashOut) {
    const { data, error } = await supabase
      .from("pending_payouts")
      .update({
        status: "paid",
        tx_hash_out: txHashOut,
        paid_at: new Date().toISOString(),
      })
      .in("id", ids)
      .select();

    if (error) {
      logger.error("Payouts", "markPayoutsPaid error:", {
        message: error.message,
      });
      return { error: error.message };
    }

    logger.info(
      "Payouts",
      `Marked ${(data || []).length} payouts as paid (tx: ${txHashOut.slice(0, 18)}...)`,
    );
    return { updated: (data || []).length };
  }

  /**
   * Get revenue overview (all time).
   */
  async function getRevenueOverview() {
    const { data, error } = await supabase
      .from("pending_payouts")
      .select(
        "status, gross_amount, provider_amount, platform_fee, chain, created_at",
      );

    if (error) {
      logger.error("Payouts", "getRevenueOverview error:", {
        message: error.message,
      });
      return { error: error.message };
    }

    const overview = {
      total_gross: 0,
      total_provider_payouts: 0,
      total_platform_fees: 0,
      total_pending_payouts: 0,
      total_paid_payouts: 0,
      by_status: { pending: 0, paid: 0, processing: 0, failed: 0 },
      by_chain: {},
    };

    for (const row of data || []) {
      overview.total_gross += Number(row.gross_amount);
      overview.total_provider_payouts += Number(row.provider_amount);
      overview.total_platform_fees += Number(row.platform_fee);

      if (row.status === "pending")
        overview.total_pending_payouts += Number(row.provider_amount);
      if (row.status === "paid")
        overview.total_paid_payouts += Number(row.provider_amount);

      overview.by_status[row.status] =
        (overview.by_status[row.status] || 0) + 1;
      overview.by_chain[row.chain] =
        (overview.by_chain[row.chain] || 0) + Number(row.gross_amount);
    }

    return overview;
  }

  /**
   * Record a split payout after a native split payment.
   *
   * @param {object} opts
   * @param {string}      opts.serviceId
   * @param {string}      opts.serviceName
   * @param {string}      opts.providerWallet
   * @param {number}      opts.grossAmount       - Total price in USDC (float)
   * @param {string}      opts.txHashProvider    - Hash of the provider tx (95%)
   * @param {string|null} opts.txHashPlatform    - Hash of the platform tx (5%), null if absent
   * @param {string}      opts.chain             - 'base' | 'skale'
   * @param {string}      opts.splitMode         - 'legacy' | 'split_complete' | 'provider_only'
   */
  async function recordSplitPayout({
    serviceId,
    serviceName,
    providerWallet,
    grossAmount,
    txHashProvider,
    txHashPlatform,
    chain = "base",
    splitMode,
  }) {
    // Integer arithmetic on micro-USDC (6 decimals) to avoid IEEE-754 float drift
    const grossRaw = Math.round(grossAmount * 1e6);
    const platformFeeRaw = Math.floor((grossRaw * PLATFORM_FEE_PERCENT) / 100);
    const providerAmountRaw = grossRaw - platformFeeRaw;
    const platformFee = platformFeeRaw / 1e6;
    const providerAmount = providerAmountRaw / 1e6;

    // If split_complete the provider has already been paid on-chain → mark as paid immediately
    const status = splitMode === "split_complete" ? "paid" : "pending";

    const { data, error } = await supabase
      .from("pending_payouts")
      .insert([
        {
          service_id: serviceId,
          service_name: serviceName,
          provider_wallet: providerWallet,
          gross_amount: grossAmount,
          provider_amount: providerAmount,
          platform_fee: platformFee,
          tx_hash_in: txHashProvider,
          tx_hash_platform: txHashPlatform || null,
          chain,
          split_mode: splitMode,
          status,
        },
      ])
      .select();

    if (error) {
      logger.error("Payouts", "recordSplitPayout error:", {
        message: error.message,
      });
      return null;
    }

    logger.info(
      "Payouts",
      `Recorded split payout [${splitMode}]: ${providerAmount.toFixed(4)} USDC to ${providerWallet.slice(0, 10)}... (fee: ${platformFee.toFixed(4)}, status: ${status})`,
    );
    return data[0];
  }

  /**
   * Get revenue for a specific provider wallet (all time, all statuses).
   * Used by GET /api/provider/:address/revenue
   *
   * @param {string} address — wallet address (case-insensitive)
   * @returns {{ total_earned, total_calls, by_service, by_chain } | { error }}
   */
  async function getProviderRevenue(address) {
    const { data, error } = await supabase
      .from("pending_payouts")
      .select("service_id, service_name, provider_amount, chain")
      .ilike("provider_wallet", address)
      .order("created_at", { ascending: false })
      .limit(10000);

    if (error) {
      logger.error("Payouts", "getProviderRevenue error:", {
        message: error.message,
      });
      return { error: error.message };
    }

    const rows = data || [];

    // Aggregate totals
    let total_earned = 0;
    const byServiceMap = {};
    const by_chain = {};

    for (const row of rows) {
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
    }

    // Round float drift
    total_earned = Math.round(total_earned * 1e6) / 1e6;
    const by_service = Object.values(byServiceMap).map((s) => ({
      ...s,
      earned: Math.round(s.earned * 1e6) / 1e6,
    }));
    for (const chain of Object.keys(by_chain)) {
      by_chain[chain] = Math.round(by_chain[chain] * 1e6) / 1e6;
    }

    return {
      total_earned,
      total_calls: rows.length,
      by_service,
      by_chain,
    };
  }

  /**
   * Self-serve withdrawal request.
   * Marks all pending payouts for a wallet as 'processing' and records the request timestamp.
   * The actual on-chain transfer must be executed by an admin.
   *
   * @param {string} wallet — Provider wallet address (lowercased)
   * @returns {{ payouts: Array, total_usdc: number, count: number } | { error: string }}
   */
  async function requestWithdraw(wallet) {
    // Fetch all pending payouts for this wallet
    const { data, error } = await supabase
      .from("pending_payouts")
      .select("id, provider_amount, service_name, chain, created_at")
      .ilike("provider_wallet", wallet)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      logger.error(
        "Payouts",
        `requestWithdraw fetch error for ${wallet.slice(0, 10)}: ${error.message}`,
      );
      return { error: error.message };
    }

    const rows = data || [];
    if (rows.length === 0) {
      return { payouts: [], total_usdc: 0, count: 0 };
    }

    const ids = rows.map((r) => r.id);
    const total_usdc = rows.reduce(
      (sum, r) => sum + (Number(r.provider_amount) || 0),
      0,
    );
    const withdrawalRequestedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("pending_payouts")
      .update({
        status: "processing",
        withdrawal_requested_at: withdrawalRequestedAt,
      })
      .in("id", ids);

    if (updateError) {
      logger.error(
        "Payouts",
        `requestWithdraw update error for ${wallet.slice(0, 10)}: ${updateError.message}`,
      );
      return { error: updateError.message };
    }

    logger.info(
      "Payouts",
      `Withdrawal requested: ${rows.length} payouts (${(Math.round(total_usdc * 1e6) / 1e6).toFixed(4)} USDC) for ${wallet.slice(0, 10)}...`,
    );

    return {
      payouts: rows,
      total_usdc: Math.round(total_usdc * 1e6) / 1e6,
      count: rows.length,
      withdrawal_requested_at: withdrawalRequestedAt,
    };
  }

  /**
   * Auto-payout cron: finds all wallets with pending payouts > threshold USDC
   * and marks them as 'processing'. Called by GET /api/cron/auto-payout.
   *
   * @param {number} [thresholdUsdc=1] — Minimum pending amount to trigger auto-payout
   * @returns {{ wallets_processed: number, total_usdc: number, wallets: Array } | { error: string }}
   */
  async function autoPayout(thresholdUsdc = 1) {
    // Fetch all pending payouts grouped by wallet
    const { data, error } = await supabase
      .from("pending_payouts")
      .select(
        "id, provider_wallet, provider_amount, service_name, chain, created_at",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Payouts", `autoPayout fetch error: ${error.message}`);
      return { error: error.message };
    }

    // Group by wallet
    const byWallet = {};
    for (const row of data || []) {
      const w = (row.provider_wallet || "").toLowerCase();
      if (!byWallet[w])
        byWallet[w] = { wallet: row.provider_wallet, ids: [], total: 0 };
      byWallet[w].ids.push(row.id);
      byWallet[w].total += Number(row.provider_amount) || 0;
    }

    // Filter by threshold
    const eligible = Object.values(byWallet).filter(
      (w) => w.total >= thresholdUsdc,
    );
    if (eligible.length === 0) {
      logger.info(
        "Payouts",
        `autoPayout: no wallets above threshold ($${thresholdUsdc} USDC)`,
      );
      return { wallets_processed: 0, total_usdc: 0, wallets: [] };
    }

    const now = new Date().toISOString();
    let totalProcessed = 0;
    const processedWallets = [];

    for (const wallet of eligible) {
      const { error: updateErr } = await supabase
        .from("pending_payouts")
        .update({ status: "processing", withdrawal_requested_at: now })
        .in("id", wallet.ids);

      if (updateErr) {
        logger.error(
          "Payouts",
          `autoPayout update error for ${wallet.wallet.slice(0, 10)}: ${updateErr.message}`,
        );
        continue;
      }

      const amount = Math.round(wallet.total * 1e6) / 1e6;
      totalProcessed += amount;
      processedWallets.push({
        wallet: wallet.wallet,
        payout_count: wallet.ids.length,
        amount_usdc: amount,
      });
      logger.info(
        "Payouts",
        `autoPayout: queued ${wallet.ids.length} payouts (${amount.toFixed(4)} USDC) for ${wallet.wallet.slice(0, 10)}...`,
      );
    }

    return {
      wallets_processed: processedWallets.length,
      total_usdc: Math.round(totalProcessed * 1e6) / 1e6,
      wallets: processedWallets,
    };
  }

  return {
    recordPayout,
    recordSplitPayout,
    getPendingPayouts,
    markPayoutsPaid,
    getRevenueOverview,
    getProviderRevenue,
    requestWithdraw,
    autoPayout,
    PLATFORM_FEE_PERCENT,
  };
}

module.exports = { createPayoutManager };
