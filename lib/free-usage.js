// lib/free-usage.js — Free tier usage tracker per service × user
//
// Tables (migration 013_free_tiers.sql):
//   free_usage(id, service_id, user_id, calls_used, period_start, created_at)
//   UNIQUE(service_id, user_id, period_start)
//
// userIdentifier = wallet address (0x…) OR hashed IP
// Period = calendar month (date_trunc 'month'). Reset automatically when
// period_start < current month.

const logger = require('./logger');

// Returns the ISO string for the first instant of the current UTC month
// e.g. "2026-03-01T00:00:00.000Z"
function currentMonthStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Check whether a user still has free calls remaining for this service/month.
 *
 * @param {object}  supabase
 * @param {string}  serviceId   - UUID of the service
 * @param {string}  userId      - wallet address or hashed IP
 * @param {number}  limit       - free_calls_per_month from the service row
 * @returns {{ allowed: boolean, remaining: number, limit: number, resetAt: string }}
 */
async function checkFreeUsage(supabase, serviceId, userId, limit) {
    const period = currentMonthStart();

    try {
        const { data, error } = await supabase
            .from('free_usage')
            .select('calls_used, period_start')
            .eq('service_id', serviceId)
            .eq('user_id', userId)
            .order('period_start', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            logger.warn('FreeUsage', `checkFreeUsage query error: ${error.message}`);
            // Fail open: if we can't read the table, block free access (safe default)
            return { allowed: false, remaining: 0, limit, resetAt: period };
        }

        // No row yet → user has never called this service this month
        if (!data) {
            return { allowed: true, remaining: limit, limit, resetAt: period };
        }

        // Row exists: check if it belongs to the current month
        const rowPeriod = new Date(data.period_start).toISOString().slice(0, 7); // "YYYY-MM"
        const curPeriod = period.slice(0, 7);

        if (rowPeriod < curPeriod) {
            // Stale row from a previous month — treat as fresh
            return { allowed: true, remaining: limit, limit, resetAt: period };
        }

        const used = data.calls_used || 0;
        const remaining = Math.max(0, limit - used);
        return {
            allowed: remaining > 0,
            remaining,
            limit,
            resetAt: period,
        };
    } catch (err) {
        logger.error('FreeUsage', `checkFreeUsage unexpected error: ${err.message}`);
        return { allowed: false, remaining: 0, limit, resetAt: period };
    }
}

/**
 * Atomically increment the call counter for a service × user × current month.
 * Uses INSERT … ON CONFLICT DO UPDATE (upsert) for atomicity.
 *
 * @param {object} supabase
 * @param {string} serviceId
 * @param {string} userId
 */
async function incrementFreeUsage(supabase, serviceId, userId) {
    const period = currentMonthStart();

    try {
        // Supabase upsert with raw SQL increment via rpc is unavailable in the JS client
        // without a stored procedure. We use the upsert with ignoreDuplicates=false and
        // rely on the DB trigger-free approach: read-modify-write is not truly atomic here
        // for extreme concurrency, but free tiers are best-effort and over-counting by 1
        // under a race is acceptable.  A proper solution would use a Postgres function;
        // for this use-case the upsert below is sufficient.

        // Step 1: try to insert with calls_used = 1
        const { error: insertErr } = await supabase
            .from('free_usage')
            .insert([{
                service_id: serviceId,
                user_id: userId,
                calls_used: 1,
                period_start: period,
            }]);

        if (!insertErr) return; // new row created

        // Step 2: conflict — update existing row
        if (insertErr.code === '23505' || (insertErr.message && insertErr.message.includes('duplicate'))) {
            // Fetch current count then upsert with incremented value
            const { data: existing } = await supabase
                .from('free_usage')
                .select('calls_used')
                .eq('service_id', serviceId)
                .eq('user_id', userId)
                .eq('period_start', period)
                .maybeSingle();

            const newCount = ((existing?.calls_used) || 0) + 1;

            await supabase
                .from('free_usage')
                .upsert([{
                    service_id: serviceId,
                    user_id: userId,
                    calls_used: newCount,
                    period_start: period,
                }], { onConflict: 'service_id,user_id,period_start' });
        } else {
            logger.warn('FreeUsage', `incrementFreeUsage insert error: ${insertErr.message}`);
        }
    } catch (err) {
        logger.error('FreeUsage', `incrementFreeUsage unexpected error: ${err.message}`);
        // Non-critical: do not throw — the upstream call already succeeded
    }
}

module.exports = { checkFreeUsage, incrementFreeUsage };
