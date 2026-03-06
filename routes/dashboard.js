// routes/dashboard.js — GET /dashboard, GET /api/stats, GET /api/analytics

const express = require('express');
const logger = require('../lib/logger');
const { RPC_URL, USDC_CONTRACT, EXPLORER_URL, NETWORK_LABEL } = require('../lib/chains');
const { fetchWithTimeout } = require('../lib/payment');

// Cache solde USDC RPC — TTL 5 minutes (evite 1-3s de latence RPC par appel)
let _balanceCache = { value: null, ts: 0 };
const BALANCE_TTL = 5 * 60_000;

async function getCachedBalance() {
    if (_balanceCache.value !== null && Date.now() - _balanceCache.ts < BALANCE_TTL) {
        return _balanceCache.value;
    }
    const walletAddr = process.env.WALLET_ADDRESS;
    if (!walletAddr) return null;
    const balanceCall = '0x70a08231' + '000000000000000000000000' + walletAddr.slice(2).toLowerCase();
    const balRes = await fetchWithTimeout(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call',
            params: [{ to: USDC_CONTRACT, data: balanceCall }, 'latest'], id: 3
        })
    });
    const rpcResponse = await balRes.json();
    let balance = 0;
    if (rpcResponse.error) {
        throw new Error(rpcResponse.error.message || 'RPC error');
    } else if (rpcResponse.result && rpcResponse.result !== '0x') {
        balance = Number(BigInt(rpcResponse.result)) / 1e6;
    }
    _balanceCache = { value: balance, ts: Date.now() };
    return balance;
}

function createDashboardRouter(supabase, adminAuth, dashboardApiLimiter, adminAuthLimiter, payoutManager, logActivity) {
    const router = express.Router();

    // Redirect old dashboard to frontend admin
    router.get('/dashboard', (req, res) => {
        res.redirect(301, 'https://x402bazaar.org/admin');
    });

    // API stats (protected by admin auth)
    router.get('/api/stats', dashboardApiLimiter, adminAuthLimiter, adminAuth, async (req, res) => {
        let count = 0;
        try {
            const result = await supabase.from('services').select('*', { count: 'exact', head: true });
            count = result.count || 0;
        } catch (err) {
            logger.error('Stats', 'Supabase count error:', err.message);
        }

        // Paiements et revenus depuis Supabase
        let totalPayments = 0;
        let totalRevenue = 0;
        try {
            const { data: payments } = await supabase
                .from('activity')
                .select('amount')
                .eq('type', 'payment');
            if (payments) {
                totalPayments = payments.length;
                totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);
            }
        } catch (err) { logger.warn('Dashboard', `Failed to fetch payment stats: ${err.message}`); }

        // Solde USDC du wallet serveur (on-chain) — cache TTL 5min
        let walletBalance = null;
        let balanceError = null;
        const walletAddr = process.env.WALLET_ADDRESS;
        try {
            walletBalance = await getCachedBalance();
        } catch (err) {
            balanceError = err.message;
            logger.error('Balance', `Failed to read USDC balance: ${err.message}`);
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.json({
            totalServices: count || 0,
            totalPayments,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            walletBalance,
            wallet: walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : null,
            network: NETWORK_LABEL,
            explorer: EXPLORER_URL,
            usdcContract: USDC_CONTRACT,
            ...(balanceError && { balanceError }),
        });
    });

    // --- ANALYTICS (aggregated data for charts, protected by admin auth) ---
    router.get('/api/analytics', dashboardApiLimiter, adminAuthLimiter, adminAuth, async (req, res) => {
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
                // 1. Payments — limite 5000 pour eviter full scan
                supabase.from('activity').select('amount, created_at').eq('type', 'payment').order('created_at', { ascending: true }).limit(5000),
                // 2. API calls pour top services
                supabase.from('activity').select('detail, created_at').eq('type', 'api_call').order('created_at', { ascending: false }).limit(1000),
                // 3. Total services count
                supabase.from('services').select('*', { count: 'exact', head: true }),
                // 4. Recent activity (last 10) — tx_hash truncated for security
                supabase.from('activity').select('type, detail, amount, created_at, tx_hash').order('created_at', { ascending: false }).limit(10),
                // 5. Average price of paid services
                supabase.from('services').select('price_usdc').gt('price_usdc', 0),
                // 6. Wallet balance (cache TTL 5min — evite 1-3s RPC par appel)
                getCachedBalance(),
            ]);

            const payments = paymentsResult.status === 'fulfilled' ? (paymentsResult.value.data || []) : [];
            const apiCalls = apiCallsResult.status === 'fulfilled' ? (apiCallsResult.value.data || []) : [];
            const servicesCount = servicesCountResult.status === 'fulfilled' ? (servicesCountResult.value.count || 0) : 0;

            if (paymentsResult.status === 'rejected') logger.warn('Analytics', `Failed to fetch payments: ${paymentsResult.reason?.message}`);
            if (apiCallsResult.status === 'rejected') logger.warn('Analytics', `Failed to fetch api_calls: ${apiCallsResult.reason?.message}`);
            if (servicesCountResult.status === 'rejected') logger.warn('Analytics', `Failed to count services: ${servicesCountResult.reason?.message}`);

            // Aggregate payments by day
            const dailyMap = {};
            let cumulativeTotal = 0;
            const cumulativeRevenue = [];

            for (const p of payments) {
                const date = p.created_at?.split('T')[0];
                if (!date) continue;
                const amount = Number(p.amount) || 0;
                if (!dailyMap[date]) dailyMap[date] = { total: 0, count: 0 };
                dailyMap[date].total += amount;
                dailyMap[date].count++;
            }

            const dailyVolume = Object.entries(dailyMap)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, { total, count }]) => {
                    cumulativeTotal += total;
                    cumulativeRevenue.push({
                        date,
                        total: Math.round(cumulativeTotal * 100) / 100,
                    });
                    return {
                        date,
                        total: Math.round(total * 100) / 100,
                        count,
                    };
                });

            // Aggregate top services by call count
            const serviceCountMap = {};
            for (const call of apiCalls) {
                const match = call.detail?.match(/^(\w[\w\s/]+?)(?:\s*[:.])/);
                const endpoint = match ? match[1].trim() : (call.detail || 'Unknown');
                serviceCountMap[endpoint] = (serviceCountMap[endpoint] || 0) + 1;
            }

            const topServices = Object.entries(serviceCountMap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8)
                .map(([endpoint, count]) => ({ endpoint, count }));

            // Totals
            const totalRevenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const totalTransactions = payments.length;

            // Wallet balance (depuis cache)
            let walletBalance = null;
            if (walletBalanceResult.status === 'fulfilled') {
                walletBalance = walletBalanceResult.value;
            } else {
                logger.error('Analytics', `Balance read failed: ${walletBalanceResult.reason?.message}`);
            }

            // Recent activity
            let recentActivity = [];
            if (recentActivityResult.status === 'fulfilled' && recentActivityResult.value.data) {
                recentActivity = recentActivityResult.value.data.map(a => ({
                    type: a.type,
                    detail: a.detail,
                    amount: a.amount,
                    time: a.created_at,
                    txHash: a.tx_hash ? `${a.tx_hash.slice(0, 10)}...${a.tx_hash.slice(-6)}` : null
                }));
            } else if (recentActivityResult.status === 'rejected') {
                logger.warn('Analytics', `Failed to fetch recent activity: ${recentActivityResult.reason?.message}`);
            }

            // Average price
            let avgPrice = 0;
            if (avgPriceResult.status === 'fulfilled' && avgPriceResult.value.data?.length > 0) {
                const svcData = avgPriceResult.value.data;
                avgPrice = Math.round((svcData.reduce((sum, s) => sum + Number(s.price_usdc), 0) / svcData.length) * 1000) / 1000;
            } else if (avgPriceResult.status === 'rejected') {
                logger.warn('Analytics', `Failed to compute avg price: ${avgPriceResult.reason?.message}`);
            }

            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
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
                walletAddress: process.env.WALLET_ADDRESS ? process.env.WALLET_ADDRESS.slice(0, 6) + '...' + process.env.WALLET_ADDRESS.slice(-4) : null,
                network: NETWORK_LABEL,
                explorer: EXPLORER_URL,
                recentActivity,
                activeServicesCount: servicesCount,
                avgPrice,
            });
        } catch (err) {
            logger.error('Analytics', err.message);
            res.status(500).json({ error: 'Analytics failed' });
        }
    });

    // --- ADMIN: Revenue overview ---
    router.get('/api/admin/revenue', dashboardApiLimiter, adminAuth, async (req, res) => {
        if (!payoutManager) {
            return res.status(501).json({ error: 'Payout system not configured' });
        }
        const overview = await payoutManager.getRevenueOverview();
        if (overview.error) return res.status(500).json({ error: overview.error });
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.json(overview);
    });

    // --- ADMIN: Pending payouts ---
    router.get('/api/admin/payouts', dashboardApiLimiter, adminAuth, async (req, res) => {
        if (!payoutManager) {
            return res.status(501).json({ error: 'Payout system not configured' });
        }
        const result = await payoutManager.getPendingPayouts();
        if (result.error) return res.status(500).json({ error: result.error });
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.json(result);
    });

    // --- ADMIN: Mark payouts as paid ---
    router.post('/api/admin/payouts/mark-paid', dashboardApiLimiter, adminAuth, async (req, res) => {
        if (!payoutManager) {
            return res.status(501).json({ error: 'Payout system not configured' });
        }
        const { ids, txHashOut } = req.body;
        if (!Array.isArray(ids) || ids.length === 0 || !txHashOut) {
            return res.status(400).json({ error: 'Required: ids (array) and txHashOut (string)' });
        }

        const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!TX_HASH_REGEX.test(txHashOut)) {
            return res.status(400).json({ error: 'txHashOut must be a valid transaction hash (0x + 64 hex chars)' });
        }
        if (!ids.every(id => UUID_RE.test(id))) {
            return res.status(400).json({ error: 'All ids must be valid UUIDs' });
        }
        if (ids.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 ids per batch' });
        }

        const result = await payoutManager.markPayoutsPaid(ids, txHashOut);
        if (result.error) return res.status(500).json({ error: result.error });
        logActivity('admin', `Marked ${result.updated} payouts as paid (tx: ${txHashOut.slice(0, 18)}...)`);
        res.json({ success: true, ...result });
    });

    // Daily E2E tester status (admin-only diagnostic)
    router.get('/api/admin/daily-tester', adminAuth, (req, res) => {
        const { getDailyTesterStatus } = require('../lib/daily-tester');
        res.json(getDailyTesterStatus());
    });

    return router;
}

module.exports = createDashboardRouter;
