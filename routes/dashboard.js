// routes/dashboard.js — GET /dashboard, GET /api/stats, GET /api/analytics

const express = require('express');
const path = require('path');
const logger = require('../lib/logger');
const { RPC_URL, USDC_CONTRACT, EXPLORER_URL, NETWORK_LABEL } = require('../lib/chains');
const { fetchWithTimeout } = require('../lib/payment');

function createDashboardRouter(supabase, adminAuth, dashboardApiLimiter, adminAuthLimiter, adminAuthLimiter) {
    const router = express.Router();

    // Servir le dashboard HTML (auth handled client-side via API calls)
    router.get('/dashboard', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'dashboard.html'));
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
        } catch { /* ignore */ }

        // Solde USDC du wallet serveur (on-chain)
        let walletBalance = null;
        let balanceError = null;
        const walletAddr = process.env.WALLET_ADDRESS;
        try {
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
            if (rpcResponse.error) {
                balanceError = rpcResponse.error.message || 'RPC error';
                logger.error('Balance', `RPC error: ${JSON.stringify(rpcResponse.error)}`);
            } else if (rpcResponse.result && rpcResponse.result !== '0x') {
                walletBalance = Number(BigInt(rpcResponse.result)) / 1e6;
            } else {
                walletBalance = 0;
            }
        } catch (err) {
            balanceError = err.message;
            logger.error('Balance', `Failed to read USDC balance: ${err.message}`);
        }

        res.json({
            totalServices: count || 0,
            totalPayments,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            walletBalance,
            walletFull: walletAddr || null,
            wallet: walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : null,
            network: NETWORK_LABEL,
            explorer: EXPLORER_URL,
            usdcContract: USDC_CONTRACT,
            rpcUrl: RPC_URL,
            ...(balanceError && { balanceError }),
        });
    });

    // --- ANALYTICS (aggregated data for charts, protected by admin auth) ---
    router.get('/api/analytics', dashboardApiLimiter, adminAuthLimiter, adminAuth, async (req, res) => {
        try {
            // 1. Get all payments for daily volume + cumulative revenue
            const { data: payments } = await supabase
                .from('activity')
                .select('amount, created_at')
                .eq('type', 'payment')
                .order('created_at', { ascending: true });

            // 2. Get all api_calls for top services
            const { data: apiCalls } = await supabase
                .from('activity')
                .select('detail, created_at')
                .eq('type', 'api_call')
                .order('created_at', { ascending: false })
                .limit(1000);

            // 3. Total services count
            const { count: servicesCount } = await supabase
                .from('services')
                .select('*', { count: 'exact', head: true });

            // Aggregate payments by day
            const dailyMap = {};
            let cumulativeTotal = 0;
            const cumulativeRevenue = [];

            for (const p of (payments || [])) {
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
            for (const call of (apiCalls || [])) {
                const match = call.detail?.match(/^(\w[\w\s/]+?)(?:\s*[:.])/);
                const endpoint = match ? match[1].trim() : (call.detail || 'Unknown');
                serviceCountMap[endpoint] = (serviceCountMap[endpoint] || 0) + 1;
            }

            const topServices = Object.entries(serviceCountMap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8)
                .map(([endpoint, count]) => ({ endpoint, count }));

            // Totals
            const totalRevenue = (payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const totalTransactions = (payments || []).length;

            // 4. Wallet balance (on-chain USDC)
            let walletBalance = null;
            try {
                const balanceCall = '0x70a08231' + '000000000000000000000000' + process.env.WALLET_ADDRESS.slice(2).toLowerCase();
                const balRes = await fetchWithTimeout(RPC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0', method: 'eth_call',
                        params: [{ to: USDC_CONTRACT, data: balanceCall }, 'latest'], id: 3
                    })
                });
                const rpcResponse = await balRes.json();
                if (rpcResponse.result && rpcResponse.result !== '0x') {
                    walletBalance = Number(BigInt(rpcResponse.result)) / 1e6;
                } else {
                    walletBalance = 0;
                }
            } catch (err) {
                logger.error('Analytics', `Balance read failed: ${err.message}`);
            }

            // 5. Recent activity (last 10)
            let recentActivity = [];
            try {
                const { data: actData } = await supabase
                    .from('activity')
                    .select('type, detail, amount, created_at, tx_hash')
                    .order('created_at', { ascending: false })
                    .limit(10);
                recentActivity = (actData || []).map(a => ({
                    type: a.type,
                    detail: a.detail,
                    amount: a.amount,
                    time: a.created_at,
                    txHash: a.tx_hash
                }));
            } catch { /* ignore */ }

            // 6. Average price of paid services
            let avgPrice = 0;
            try {
                const { data: svcData } = await supabase
                    .from('services')
                    .select('price_usdc')
                    .gt('price_usdc', 0);
                if (svcData && svcData.length > 0) {
                    avgPrice = Math.round((svcData.reduce((sum, s) => sum + Number(s.price_usdc), 0) / svcData.length) * 1000) / 1000;
                }
            } catch { /* ignore */ }

            res.json({
                dailyVolume,
                topServices,
                cumulativeRevenue,
                totals: {
                    revenue: Math.round(totalRevenue * 100) / 100,
                    transactions: totalTransactions,
                    services: servicesCount || 0,
                },
                walletBalance,
                walletAddress: process.env.WALLET_ADDRESS,
                network: NETWORK_LABEL,
                explorer: EXPLORER_URL,
                recentActivity,
                activeServicesCount: servicesCount || 0,
                avgPrice,
            });
        } catch (err) {
            logger.error('Analytics', err.message);
            res.status(500).json({ error: 'Analytics failed' });
        }
    });

    return router;
}

module.exports = createDashboardRouter;
