// lib/activity.js — Activity log (persisted in Supabase)

const logger = require('./logger');

function createActivityLogger(supabase) {
    return function logActivity(type, detail, amount = 0, txHash = null) {
        const entry = {
            type,
            detail,
            amount,
        };
        if (txHash) entry.tx_hash = txHash;

        // Fire-and-forget insert — .then() is safe on Supabase PostgrestFilterBuilder
        supabase.from('activity').insert([entry]).then(
            ({ error }) => {
                if (error) {
                    logger.warn('Activity', `Insert failed: ${error.message}`, { type, detail: detail.slice(0, 100) });
                }
            },
            (err) => {
                logger.error('Activity', `Insert exception: ${err.message}`, { type, detail: detail.slice(0, 100) });
            }
        );
    };
}

module.exports = { createActivityLogger };
