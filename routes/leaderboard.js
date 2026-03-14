// routes/leaderboard.js — GET /api/leaderboard
// Aggregates top providers, top APIs, and top payers from activity + pending_payouts tables.
// In-memory cache with 5-minute TTL.

const express = require('express');
const logger = require('../lib/logger');

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOP_N = 20;

let _cache = { data: null, ts: 0 };

// Cleanup interval — prevent stale references from accumulating
const _cleanupInterval = setInterval(() => {
    if (_cache.data && Date.now() - _cache.ts > CACHE_TTL * 3) {
        _cache = { data: null, ts: 0 };
    }
}, 15 * 60 * 1000).unref();
_cleanupInterval; // ref retained by unref'd interval — just suppress lint

/**
 * Mask wallet address: 0xab12...ef56 (first 6 + last 4 chars)
 * @param {string} addr
 * @returns {string}
 */
function maskAddress(addr) {
    if (!addr || typeof addr !== 'string') return 'Unknown';
    const clean = addr.trim();
    if (clean.length < 12) return clean;
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

/**
 * Build leaderboard data from Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<object>}
 */
async function buildLeaderboard(supabase) {
    // --- Top Providers: aggregate pending_payouts per owner ---
    // pending_payouts has: owner_address, service_id, amount_usdc, call_count (or similar)
    // We join with services to get name + api_count per owner.
    const [payoutsResult, servicesResult, activityResult] = await Promise.all([
        supabase
            .from('pending_payouts')
            .select('owner_address, amount_usdc'),
        supabase
            .from('services')
            .select('owner_address, id, name, price_usdc'),
        supabase
            .from('activity')
            .select('type, detail, amount')
            .eq('type', 'payment')
            .limit(5000),
    ]);

    if (payoutsResult.error) {
        logger.warn('Leaderboard', 'pending_payouts fetch error:', payoutsResult.error.message);
    }
    if (activityResult.error) {
        logger.warn('Leaderboard', 'activity fetch error:', activityResult.error.message);
    }
    if (servicesResult.error) {
        logger.warn('Leaderboard', 'services fetch error:', servicesResult.error.message);
    }

    const payouts = payoutsResult.data || [];
    const services = servicesResult.data || [];
    const activities = activityResult.data || [];

    // --- Top Providers ---
    // Aggregate earned per owner from pending_payouts
    const providerMap = new Map();
    for (const p of payouts) {
        if (!p.owner_address) continue;
        const existing = providerMap.get(p.owner_address) || { total_earned: 0, service_ids: new Set() };
        existing.total_earned += Number(p.amount_usdc) || 0;
        providerMap.set(p.owner_address, existing);
    }

    // Enrich with service names (first service found per owner) + api_count
    const servicesByOwner = new Map();
    for (const s of services) {
        if (!s.owner_address) continue;
        const existing = servicesByOwner.get(s.owner_address) || { names: [], ids: [] };
        existing.names.push(s.name);
        existing.ids.push(s.id);
        servicesByOwner.set(s.owner_address, existing);
    }

    // For owners with no payouts but with services, add them with 0 earned
    // (only if they appear in payouts — otherwise list would be dominated by zero-revenue providers)
    const topProviders = Array.from(providerMap.entries())
        .map(([owner_address, data]) => {
            const svcData = servicesByOwner.get(owner_address) || { names: [], ids: [] };
            return {
                owner_address: maskAddress(owner_address),
                name: svcData.names[0] || 'Unknown Provider',
                total_earned: Math.round(data.total_earned * 1e6) / 1e6,
                api_count: svcData.ids.length,
                call_count: 0, // enriched below from activity
            };
        })
        .sort((a, b) => b.total_earned - a.total_earned)
        .slice(0, TOP_N);

    // --- Top APIs: aggregate call counts from activity.detail ---
    // Activity detail format: typically "<service name> called" or similar
    // We also aggregate revenue from activities with amount > 0
    const apiCallMap = new Map(); // service name (lowercased) -> { calls, revenue, name }
    for (const a of activities) {
        if (!a.detail) continue;
        const amount = Number(a.amount) || 0;
        // Heuristic: extract service name from detail string
        // Typical: "Payment for <ServiceName>" or "<ServiceName> API call"
        const detail = a.detail;
        // Try to find a matching service by name in the detail string
        let matched = null;
        for (const s of services) {
            if (s.name && detail.toLowerCase().includes(s.name.toLowerCase().slice(0, 20))) {
                matched = s;
                break;
            }
        }
        const key = matched ? matched.id : detail.slice(0, 40).trim();
        const displayName = matched ? matched.name : detail.slice(0, 40).trim();
        const existing = apiCallMap.get(key) || { name: displayName, category: 'Other', total_calls: 0, total_revenue: 0, service_id: key };
        existing.total_calls += 1;
        existing.total_revenue += amount;
        apiCallMap.set(key, existing);
    }

    const topApis = Array.from(apiCallMap.values())
        .map(api => ({
            service_id: api.service_id,
            name: api.name,
            category: api.category,
            total_calls: api.total_calls,
            total_revenue: Math.round(api.total_revenue * 1e6) / 1e6,
        }))
        .sort((a, b) => b.total_calls - a.total_calls)
        .slice(0, TOP_N);

    // --- Top Payers: aggregate spending per wallet from activity ---
    // activity rows with type='payment' may carry X-Agent-Wallet in detail or amount
    // We look for detail patterns containing wallet addresses (0x...)
    const payerMap = new Map(); // wallet_address -> { total_spent, call_count }
    const walletRegex = /(0x[a-fA-F0-9]{40})/g;
    for (const a of activities) {
        if (!a.detail) continue;
        const amount = Number(a.amount) || 0;
        const matches = a.detail.match(walletRegex);
        if (!matches) continue;
        for (const wallet of matches) {
            const existing = payerMap.get(wallet.toLowerCase()) || { total_spent: 0, call_count: 0 };
            existing.total_spent += amount;
            existing.call_count += 1;
            payerMap.set(wallet.toLowerCase(), existing);
        }
    }

    const topPayers = Array.from(payerMap.entries())
        .map(([wallet_address, data]) => ({
            wallet_address: maskAddress(wallet_address),
            total_spent: Math.round(data.total_spent * 1e6) / 1e6,
            call_count: data.call_count,
        }))
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, TOP_N);

    return {
        topProviders,
        topApis,
        topPayers,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Create leaderboard router.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('express-rate-limit').RateLimitRequestHandler} dashboardApiLimiter
 * @returns {import('express').Router}
 */
function createLeaderboardRouter(supabase, dashboardApiLimiter) {
    const router = express.Router();

    router.get('/api/leaderboard', dashboardApiLimiter, async (req, res) => {
        // Return cached data if still fresh
        if (_cache.data && Date.now() - _cache.ts < CACHE_TTL) {
            return res.json(_cache.data);
        }

        try {
            const data = await buildLeaderboard(supabase);
            _cache = { data, ts: Date.now() };
            return res.json(data);
        } catch (err) {
            logger.error('Leaderboard', `GET /api/leaderboard error: ${err.message}`);
            // Return stale cache rather than a 500 if available
            if (_cache.data) {
                return res.json({ ..._cache.data, stale: true });
            }
            return res.status(500).json({ error: 'Failed to build leaderboard' });
        }
    });

    return router;
}

module.exports = createLeaderboardRouter;
