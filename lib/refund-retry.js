// lib/refund-retry.js — Periodic retry for failed refunds
'use strict';

const logger = require('./logger');

const RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RETRY_COUNT = 3;
const MAX_AGE_HOURS = 24;

let _intervalId = null;

async function retryFailedRefunds(supabase) {
    if (!supabase) return;

    // Lazy-load refund module (avoids circular deps at startup)
    let refundEngine;
    try {
        refundEngine = require('./refund');
        if (!refundEngine.isConfigured()) return;
    } catch {
        return; // refund module not available
    }

    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: failedRefunds, error } = await supabase
        .from('refunds')
        .select('id, original_tx_hash, chain, service_id, service_name, amount_usdc, agent_wallet, retry_count')
        .eq('status', 'failed')
        .lt('retry_count', MAX_RETRY_COUNT)
        .gt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(10);

    if (error) {
        logger.warn('RefundRetry', `Failed to fetch failed refunds: ${error.message}`);
        return;
    }

    if (!failedRefunds || failedRefunds.length === 0) return;

    logger.info('RefundRetry', `Found ${failedRefunds.length} failed refund(s) to retry`);

    for (const refund of failedRefunds) {
        try {
            const result = await refundEngine.processRefund(
                refund.agent_wallet,
                Number(refund.amount_usdc),
                refund.chain,
                refund.service_id,
                refund.original_tx_hash
            );

            const newRetryCount = (refund.retry_count || 0) + 1;

            if (result.refunded) {
                await supabase.from('refunds').update({
                    status: 'completed',
                    refund_tx_hash: result.txHash,
                    refund_wallet: refundEngine.getRefundWalletAddress(),
                    retry_count: newRetryCount,
                    failure_reason: null,
                }).eq('id', refund.id);

                logger.info('RefundRetry', `Retry #${newRetryCount} SUCCESS for ${refund.agent_wallet.slice(0, 10)}... on ${refund.chain} — tx: ${result.txHash}`);
            } else {
                await supabase.from('refunds').update({
                    retry_count: newRetryCount,
                    failure_reason: result.reason,
                }).eq('id', refund.id);

                logger.info('RefundRetry', `Retry #${newRetryCount} FAILED for ${refund.agent_wallet.slice(0, 10)}... on ${refund.chain}: ${result.reason}`);
            }
        } catch (err) {
            logger.error('RefundRetry', `Unexpected error retrying refund ${refund.id}: ${err.message}`);
        }
    }
}

function scheduleRefundRetry(supabase) {
    // Run once after 30s startup delay
    setTimeout(() => retryFailedRefunds(supabase), 30_000).unref();
    // Then every 15 minutes
    _intervalId = setInterval(() => retryFailedRefunds(supabase), RETRY_INTERVAL_MS);
    _intervalId.unref();
    logger.info('RefundRetry', `Scheduled: retry failed refunds every ${RETRY_INTERVAL_MS / 60000}min (max ${MAX_RETRY_COUNT} retries, ${MAX_AGE_HOURS}h window)`);
}

function stopRefundRetry() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
}

module.exports = { scheduleRefundRetry, stopRefundRetry, retryFailedRefunds };
