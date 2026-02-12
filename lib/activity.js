// lib/activity.js — Activity log (persisted in Supabase)

const logger = require('./logger');

function createActivityLogger(supabase) {
    return async function logActivity(type, detail, amount = 0, txHash = null) {
        const entry = {
            type,
            detail,
            amount,
        };
        if (txHash) entry.tx_hash = txHash;

        try {
            await supabase.from('activity').insert([entry]);
        } catch (err) {
            logger.error('Activity', 'Erreur insert:', err.message);
        }
    };
}

module.exports = { createActivityLogger };
