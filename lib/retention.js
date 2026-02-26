// lib/retention.js — Automatic data retention / purge for Supabase tables

const logger = require('./logger');

const ACTIVITY_RETENTION_DAYS = 90;
const MONITORING_RETENTION_DAYS = 30;

async function purgeOldData(supabase) {
    if (!supabase) return;

    try {
        const activityCutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86400 * 1000).toISOString();
        const { error: actErr, count: actCount } = await supabase
            .from('activity')
            .delete({ count: 'exact' })
            .lt('created_at', activityCutoff);

        if (actErr) {
            logger.warn('retention', 'Failed to purge activity', { error: actErr.message });
        } else {
            logger.info('retention', 'Purged old activity rows', { deleted: actCount ?? 0, cutoff: activityCutoff });
        }
    } catch (e) {
        logger.error('retention', 'Unexpected error purging activity', { error: e.message });
    }

    try {
        const monitorCutoff = new Date(Date.now() - MONITORING_RETENTION_DAYS * 86400 * 1000).toISOString();
        const { error: monErr, count: monCount } = await supabase
            .from('monitoring_checks')
            .delete({ count: 'exact' })
            .lt('checked_at', monitorCutoff);

        if (monErr) {
            logger.warn('retention', 'Failed to purge monitoring_checks', { error: monErr.message });
        } else {
            logger.info('retention', 'Purged old monitoring_checks rows', { deleted: monCount ?? 0, cutoff: monitorCutoff });
        }
    } catch (e) {
        logger.error('retention', 'Unexpected error purging monitoring_checks', { error: e.message });
    }
}

function scheduleRetention(supabase) {
    // Run once at startup (after a short delay to let the server settle)
    setTimeout(() => purgeOldData(supabase), 10_000);
    // Then every 24h
    setInterval(() => purgeOldData(supabase), 24 * 60 * 60 * 1000);
}

module.exports = { scheduleRetention };
