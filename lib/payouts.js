// lib/payouts.js — Revenue split tracking (95/5)

const logger = require('./logger');

const PLATFORM_FEE_PERCENT = 5;

function createPayoutManager(supabase) {
    /**
     * Record a pending payout after a proxied API call.
     * Called after payment is verified and the external API call succeeds.
     */
    async function recordPayout({ serviceId, serviceName, providerWallet, grossAmount, txHashIn, chain = 'base' }) {
        // Integer arithmetic on micro-USDC (6 decimals) to avoid IEEE-754 float drift
        const grossRaw = Math.round(grossAmount * 1e6);
        const platformFeeRaw = Math.floor(grossRaw * PLATFORM_FEE_PERCENT / 100);
        const providerAmountRaw = grossRaw - platformFeeRaw;
        const platformFee = platformFeeRaw / 1e6;
        const providerAmount = providerAmountRaw / 1e6;

        const { data, error } = await supabase
            .from('pending_payouts')
            .insert([{
                service_id: serviceId,
                service_name: serviceName,
                provider_wallet: providerWallet,
                gross_amount: grossAmount,
                provider_amount: providerAmount,
                platform_fee: platformFee,
                tx_hash_in: txHashIn,
                chain,
                status: 'pending',
            }])
            .select();

        if (error) {
            logger.error('Payouts', 'recordPayout error:', { message: error.message });
            return null;
        }

        logger.info('Payouts', `Recorded payout: ${providerAmount.toFixed(4)} USDC to ${providerWallet.slice(0, 10)}... (fee: ${platformFee.toFixed(4)})`);
        return data[0];
    }

    /**
     * Get pending payouts summary grouped by provider wallet.
     */
    async function getPendingPayouts() {
        const { data, error } = await supabase
            .from('pending_payouts')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('Payouts', 'getPendingPayouts error:', { message: error.message });
            return { error: error.message };
        }

        // Group by provider wallet
        const byProvider = {};
        let totalOwed = 0;
        let totalFees = 0;

        for (const payout of (data || [])) {
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
            .from('pending_payouts')
            .update({
                status: 'paid',
                tx_hash_out: txHashOut,
                paid_at: new Date().toISOString(),
            })
            .in('id', ids)
            .select();

        if (error) {
            logger.error('Payouts', 'markPayoutsPaid error:', { message: error.message });
            return { error: error.message };
        }

        logger.info('Payouts', `Marked ${(data || []).length} payouts as paid (tx: ${txHashOut.slice(0, 18)}...)`);
        return { updated: (data || []).length };
    }

    /**
     * Get revenue overview (all time).
     */
    async function getRevenueOverview() {
        const { data, error } = await supabase
            .from('pending_payouts')
            .select('status, gross_amount, provider_amount, platform_fee, chain, created_at');

        if (error) {
            logger.error('Payouts', 'getRevenueOverview error:', { message: error.message });
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

        for (const row of (data || [])) {
            overview.total_gross += Number(row.gross_amount);
            overview.total_provider_payouts += Number(row.provider_amount);
            overview.total_platform_fees += Number(row.platform_fee);

            if (row.status === 'pending') overview.total_pending_payouts += Number(row.provider_amount);
            if (row.status === 'paid') overview.total_paid_payouts += Number(row.provider_amount);

            overview.by_status[row.status] = (overview.by_status[row.status] || 0) + 1;
            overview.by_chain[row.chain] = (overview.by_chain[row.chain] || 0) + Number(row.gross_amount);
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
    async function recordSplitPayout({ serviceId, serviceName, providerWallet, grossAmount, txHashProvider, txHashPlatform, chain = 'base', splitMode }) {
        // Integer arithmetic on micro-USDC (6 decimals) to avoid IEEE-754 float drift
        const grossRaw = Math.round(grossAmount * 1e6);
        const platformFeeRaw = Math.floor(grossRaw * PLATFORM_FEE_PERCENT / 100);
        const providerAmountRaw = grossRaw - platformFeeRaw;
        const platformFee = platformFeeRaw / 1e6;
        const providerAmount = providerAmountRaw / 1e6;

        // If split_complete the provider has already been paid on-chain → mark as paid immediately
        const status = splitMode === 'split_complete' ? 'paid' : 'pending';

        const { data, error } = await supabase
            .from('pending_payouts')
            .insert([{
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
            }])
            .select();

        if (error) {
            logger.error('Payouts', 'recordSplitPayout error:', { message: error.message });
            return null;
        }

        logger.info('Payouts', `Recorded split payout [${splitMode}]: ${providerAmount.toFixed(4)} USDC to ${providerWallet.slice(0, 10)}... (fee: ${platformFee.toFixed(4)}, status: ${status})`);
        return data[0];
    }

    return { recordPayout, recordSplitPayout, getPendingPayouts, markPayoutsPaid, getRevenueOverview, PLATFORM_FEE_PERCENT };
}

module.exports = { createPayoutManager };
