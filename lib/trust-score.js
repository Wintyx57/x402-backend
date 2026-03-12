// lib/trust-score.js — Proof of Quality: TrustScore Engine
// ⚠️  PROPRIETARY ALGORITHM — weights and formula are trade secrets.
// Only the final score (0-100) is exposed publicly.
// The breakdown is available to admin only via /dashboard.

'use strict';

const logger = require('./logger');

// ---------------------------------------------------------------------------
// CONFIGURATION (PRIVATE — never expose these constants via API)
// ---------------------------------------------------------------------------
const RECALC_INTERVAL   = 6 * 60 * 60 * 1000;   // Every 6 hours
const INITIAL_DELAY     = 3 * 60 * 1000;         // 3 min after startup
const LOOKBACK_DAYS     = 30;                     // Rolling window
const MIN_DATAPOINTS    = 3;                      // Minimum checks before scoring
const BATCH_SIZE        = 25;                     // Services per batch update

// ---------------------------------------------------------------------------
// WEIGHTS (SECRET SAUCE — do NOT log, do NOT expose)
// ---------------------------------------------------------------------------
const W = Object.freeze({
    SUCCESS_RATE:   0.40,
    LATENCY:        0.25,
    REVIEWS:        0.20,
    VOLUME:         0.15,
});

// Latency thresholds (ms) — anything above MAX scores 0
const LATENCY_EXCELLENT = 200;
const LATENCY_MAX       = 5000;

// Volume normalization — log10(V) / log10(V_MAX)
const VOLUME_MAX        = 10000;

// ---------------------------------------------------------------------------
// SCORE COMPUTATION (PRIVATE)
// ---------------------------------------------------------------------------

/**
 * Compute the Success Rate score (S) for a service.
 * Uses monitoring_checks (5min) + daily_checks (24h) combined.
 * Returns 0-1.
 */
async function computeSuccessRate(supabase, serviceUrl, serviceId, cutoff) {
    let totalChecks = 0;
    let successChecks = 0;

    // 1) monitoring_checks — match by endpoint pattern
    const urlPath = extractPath(serviceUrl);
    if (urlPath) {
        const { data: monData } = await supabase
            .from('monitoring_checks')
            .select('status')
            .eq('endpoint', urlPath)
            .gte('checked_at', cutoff)
            .limit(2000);

        if (monData && monData.length > 0) {
            totalChecks += monData.length;
            successChecks += monData.filter(c => c.status === 'online').length;
        }
    }

    // 2) daily_checks — match by endpoint or service UUID
    const dailyEndpoint = urlPath || serviceId;
    if (dailyEndpoint) {
        const { data: dailyData } = await supabase
            .from('daily_checks')
            .select('overall_status')
            .eq('endpoint', dailyEndpoint)
            .gte('checked_at', cutoff)
            .limit(500);

        if (dailyData && dailyData.length > 0) {
            totalChecks += dailyData.length;
            successChecks += dailyData.filter(c => c.overall_status === 'pass').length;
            // partial counts as 0.5
            successChecks += dailyData.filter(c => c.overall_status === 'partial').length * 0.5;
        }
    }

    if (totalChecks < MIN_DATAPOINTS) return null; // Not enough data
    return successChecks / totalChecks;
}

/**
 * Compute the Latency score (L) for a service.
 * Lower latency = higher score. Uses inverse linear mapping.
 * Returns 0-1.
 */
async function computeLatencyScore(supabase, serviceUrl, serviceId, cutoff) {
    const urlPath = extractPath(serviceUrl);
    const latencies = [];

    // monitoring_checks latency
    if (urlPath) {
        const { data: monData } = await supabase
            .from('monitoring_checks')
            .select('latency')
            .eq('endpoint', urlPath)
            .gte('checked_at', cutoff)
            .not('latency', 'is', null)
            .limit(2000);

        if (monData) {
            for (const row of monData) {
                if (typeof row.latency === 'number' && row.latency > 0) {
                    latencies.push(row.latency);
                }
            }
        }
    }

    // daily_checks call_latency_ms
    const dailyEndpoint = urlPath || serviceId;
    if (dailyEndpoint) {
        const { data: dailyData } = await supabase
            .from('daily_checks')
            .select('call_latency_ms')
            .eq('endpoint', dailyEndpoint)
            .gte('checked_at', cutoff)
            .not('call_latency_ms', 'is', null)
            .limit(500);

        if (dailyData) {
            for (const row of dailyData) {
                if (typeof row.call_latency_ms === 'number' && row.call_latency_ms > 0) {
                    latencies.push(row.call_latency_ms);
                }
            }
        }
    }

    if (latencies.length < MIN_DATAPOINTS) return null;

    // Use P75 (75th percentile) to be robust against outliers
    latencies.sort((a, b) => a - b);
    const p75 = latencies[Math.floor(latencies.length * 0.75)];

    if (p75 <= LATENCY_EXCELLENT) return 1.0;
    if (p75 >= LATENCY_MAX) return 0.0;
    return Math.max(0, 1 - (p75 - LATENCY_EXCELLENT) / (LATENCY_MAX - LATENCY_EXCELLENT));
}

/**
 * Compute the Review quality score (R) for a service.
 * Normalizes 1-5 stars to 0-1 scale: (avg - 1) / 4
 * Returns 0-1 or null if no reviews.
 */
async function computeReviewScore(supabase, serviceId) {
    const { data, error } = await supabase
        .from('reviews')
        .select('rating')
        .eq('service_id', serviceId);

    if (error || !data || data.length === 0) return null;

    const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
    return (avg - 1) / 4; // Normalize 1-5 → 0-1
}

/**
 * Compute the Volume score (V) for a service.
 * Uses log10(volume) / log10(VOLUME_MAX) capped at 1.
 * Returns 0-1.
 */
async function computeVolumeScore(supabase, serviceUrl, serviceId, cutoff) {
    let volume = 0;

    const urlPath = extractPath(serviceUrl);

    // monitoring_checks count
    if (urlPath) {
        const { count } = await supabase
            .from('monitoring_checks')
            .select('id', { count: 'exact', head: true })
            .eq('endpoint', urlPath)
            .gte('checked_at', cutoff);

        volume += (count || 0);
    }

    // daily_checks count
    const dailyEndpoint = urlPath || serviceId;
    if (dailyEndpoint) {
        const { count } = await supabase
            .from('daily_checks')
            .select('id', { count: 'exact', head: true })
            .eq('endpoint', dailyEndpoint)
            .gte('checked_at', cutoff);

        volume += (count || 0);
    }

    if (volume <= 1) return 0;
    return Math.min(1, Math.log10(volume) / Math.log10(VOLUME_MAX));
}

// ---------------------------------------------------------------------------
// MAIN TRUST SCORE FORMULA
// ---------------------------------------------------------------------------

/**
 * Compute the TrustScore for a single service.
 * Returns { score: 0-100, factors: {...}, hasData: boolean }
 * factors is stored internally but NEVER exposed publicly.
 */
async function computeTrustScore(supabase, service) {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
    const { id, url } = service;

    const [S, L, R, V] = await Promise.all([
        computeSuccessRate(supabase, url, id, cutoff),
        computeLatencyScore(supabase, url, id, cutoff),
        computeReviewScore(supabase, id),
        computeVolumeScore(supabase, url, id, cutoff),
    ]);

    // If no data at all, return null (service too new)
    if (S === null && L === null && R === null && V === 0) {
        return { score: null, factors: null, hasData: false };
    }

    // Default missing components to neutral (0.5)
    const sVal = S !== null ? S : 0.5;
    const lVal = L !== null ? L : 0.5;
    const rVal = R !== null ? R : 0.5;
    const vVal = V || 0;

    // THE FORMULA (secret — weights defined above)
    const raw = (W.SUCCESS_RATE * sVal)
              + (W.LATENCY * lVal)
              + (W.REVIEWS * rVal)
              + (W.VOLUME * vVal);

    // Scale to 0-100 and clamp
    const score = Math.round(Math.max(0, Math.min(100, raw * 100)));

    return {
        score,
        // factors stored for admin dashboard breakdown — NEVER sent to public API
        factors: { S: sVal, L: lVal, R: rVal, V: vVal },
        hasData: true,
    };
}

// ---------------------------------------------------------------------------
// BATCH RECALCULATION (CRON JOB)
// ---------------------------------------------------------------------------

async function recalculateAllScores(supabase) {
    if (!supabase) return;

    logger.info('TrustScore', 'Starting recalculation...');
    const start = Date.now();

    try {
        const { data: services, error } = await supabase
            .from('services')
            .select('id, url, name')
            .limit(500);

        if (error) throw error;
        if (!services || services.length === 0) {
            logger.info('TrustScore', 'No services found, skipping');
            return;
        }

        let updated = 0;
        let skipped = 0;

        for (let i = 0; i < services.length; i += BATCH_SIZE) {
            const batch = services.slice(i, i + BATCH_SIZE);

            const results = await Promise.all(
                batch.map(svc => computeTrustScore(supabase, svc).catch(err => {
                    logger.warn('TrustScore', `Error computing score for ${svc.name}: ${err.message}`);
                    return { score: null, hasData: false };
                }))
            );

            // Batch update to DB
            const now = new Date().toISOString();
            for (let j = 0; j < batch.length; j++) {
                const { score, hasData } = results[j];
                if (!hasData) {
                    skipped++;
                    continue;
                }

                const { error: upErr } = await supabase
                    .from('services')
                    .update({
                        trust_score: score,
                        trust_score_updated_at: now,
                    })
                    .eq('id', batch[j].id);

                if (upErr) {
                    logger.warn('TrustScore', `Failed to update ${batch[j].name}: ${upErr.message}`);
                } else {
                    updated++;
                }
            }
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        logger.info('TrustScore', `Recalculation complete: ${updated} updated, ${skipped} skipped (no data) in ${elapsed}s`);

        // Push updated scores to ERC-8004 Reputation Registry on-chain (fire-and-forget)
        const { pushAllTrustScores } = require('./erc8004-registry');
        pushAllTrustScores(supabase).catch(err => {
            logger.error('TrustScore', `ERC-8004 reputation push failed: ${err.message}`);
        });
    } catch (err) {
        logger.error('TrustScore', `Recalculation failed: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY BREAKDOWN (for dashboard)
// ---------------------------------------------------------------------------

/**
 * Get the detailed TrustScore breakdown for a service.
 * ⚠️  This data is ADMIN-ONLY — never expose via public API.
 */
async function getTrustBreakdown(supabase, serviceId) {
    const { data: service, error } = await supabase
        .from('services')
        .select('id, url, name, trust_score, trust_score_updated_at')
        .eq('id', serviceId)
        .single();

    if (error || !service) return null;

    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();

    const [S, L, R, V] = await Promise.all([
        computeSuccessRate(supabase, service.url, serviceId, cutoff),
        computeLatencyScore(supabase, service.url, serviceId, cutoff),
        computeReviewScore(supabase, serviceId),
        computeVolumeScore(supabase, service.url, serviceId, cutoff),
    ]);

    return {
        service_id: serviceId,
        service_name: service.name,
        trust_score: service.trust_score,
        updated_at: service.trust_score_updated_at,
        // Breakdown — admin eyes only
        factors: {
            success_rate:  S !== null ? parseFloat(S.toFixed(4)) : null,
            latency:       L !== null ? parseFloat(L.toFixed(4)) : null,
            reviews:       R !== null ? parseFloat(R.toFixed(4)) : null,
            volume:        V !== null ? parseFloat(V.toFixed(4)) : null,
        },
    };
}

// ---------------------------------------------------------------------------
// SCHEDULER (same pattern as monitor.js / daily-tester.js)
// ---------------------------------------------------------------------------

let _intervalId = null;
let _startupTimerId = null;

function scheduleTrustScore(supabase) {
    _startupTimerId = setTimeout(async () => {
        _startupTimerId = null;
        await recalculateAllScores(supabase);

        _intervalId = setInterval(
            () => recalculateAllScores(supabase),
            RECALC_INTERVAL
        ).unref();
    }, INITIAL_DELAY);
    _startupTimerId.unref();

    logger.info('TrustScore', `Scheduled: first run in ${INITIAL_DELAY / 60000}min, then every ${RECALC_INTERVAL / 3600000}h`);
}

function stopTrustScore() {
    if (_startupTimerId) {
        clearTimeout(_startupTimerId);
        _startupTimerId = null;
    }
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
        logger.info('TrustScore', 'Recalculation stopped');
    }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Extract /api/xxx path from a full URL */
function extractPath(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        return u.pathname;  // e.g. /api/joke
    } catch {
        // Already a path like /api/joke
        return url.startsWith('/') ? url : null;
    }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
    scheduleTrustScore,
    stopTrustScore,
    recalculateAllScores,
    getTrustBreakdown,
    // Expose for testing only
    _test: {
        computeTrustScore,
        computeSuccessRate,
        computeLatencyScore,
        computeReviewScore,
        computeVolumeScore,
        extractPath,
        W,
    },
};
