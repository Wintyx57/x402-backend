// routes/monitoring.js — Public status API endpoints

const express = require('express');
const logger = require('../lib/logger');
const { getStatus, getEndpoints } = require('../lib/monitor');

// Cache memoire pour /api/public-stats — TTL 60s
const STATS_CACHE = { data: null, ts: 0 };
const STATS_TTL = 60_000;

function createMonitoringRouter(supabase, statsLimiter) {
  const router = express.Router();

  // GET /api/status — Current status of all endpoints (public, free)
  router.get('/api/status', (req, res) => {
    const status = getStatus();
    res.json({
      success: true,
      ...status,
    });
  });

  // GET /api/status/uptime?period=24h|7d|30d — Uptime % per endpoint
  router.get('/api/status/uptime', statsLimiter, async (req, res) => {
    const period = req.query.period || '24h';

    const periodMap = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const ms = periodMap[period];
    if (!ms) {
      return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });
    }

    const since = new Date(Date.now() - ms).toISOString();

    try {
      const { data, error } = await supabase
        .from('monitoring_checks')
        .select('endpoint, label, status')
        .gte('checked_at', since)
        .order('checked_at', { ascending: false });

      if (error) {
        // Table may not exist yet — return empty data gracefully
        const endpoints = getEndpoints();
        return res.json({
          success: true,
          period,
          overallUptime: null,
          endpoints: endpoints.map((ep) => ({ endpoint: ep.path, label: ep.label, uptime: null, checks: 0 })),
          note: 'Monitoring table not yet populated',
        });
      }

      // Group by endpoint and calc uptime %
      const grouped = {};
      for (const row of (data || [])) {
        if (!grouped[row.endpoint]) {
          grouped[row.endpoint] = { label: row.label, total: 0, online: 0 };
        }
        grouped[row.endpoint].total++;
        if (row.status === 'online') grouped[row.endpoint].online++;
      }

      const endpoints = getEndpoints();
      const uptime = endpoints.map((ep) => {
        const g = grouped[ep.path];
        if (!g || g.total === 0) {
          return { endpoint: ep.path, label: ep.label, uptime: null, checks: 0 };
        }
        return {
          endpoint: ep.path,
          label: ep.label,
          uptime: parseFloat(((g.online / g.total) * 100).toFixed(2)),
          checks: g.total,
        };
      });

      const totalChecks = uptime.reduce((sum, u) => sum + u.checks, 0);
      const totalOnline = uptime.reduce((sum, u) => sum + (u.uptime !== null ? (u.uptime / 100) * u.checks : 0), 0);
      const overallUptime = totalChecks > 0 ? parseFloat(((totalOnline / totalChecks) * 100).toFixed(2)) : null;

      res.json({
        success: true,
        period,
        overallUptime,
        endpoints: uptime,
      });
    } catch (err) {
      res.status(500).json({ error: 'Uptime query failed' });
    }
  });

  // GET /api/public-stats — Public stats for homepage + analytics (no auth required)
  router.get('/api/public-stats', statsLimiter, async (req, res) => {
    // Servir depuis le cache si encore frais (TTL 60s)
    if (STATS_CACHE.data && Date.now() - STATS_CACHE.ts < STATS_TTL) {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(STATS_CACHE.data);
    }

    const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || 'https://x402-api.onrender.com';
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Lancer les 7 queries en parallele
    const [
      servicesCountResult,
      apiCallsCountResult,
      paymentsCountResult,
      topCallsResult,
      recentCallsResult,
      uptimeResult,
      allServicesResult,
      usdcPaymentsResult,
    ] = await Promise.allSettled([
      supabase.from('services').select('*', { count: 'exact', head: true }),
      supabase.from('activity').select('*', { count: 'exact', head: true }).eq('type', 'api_call'),
      supabase.from('activity').select('*', { count: 'exact', head: true }).eq('type', 'payment'),
      supabase.from('activity').select('detail').eq('type', 'api_call').order('created_at', { ascending: false }).limit(1000),
      supabase.from('activity').select('*', { count: 'exact', head: true }).eq('type', 'api_call').gte('created_at', since24h),
      supabase.from('monitoring_checks').select('status').gte('checked_at', since24h),
      supabase.from('services').select('url, name, owner_address'),
      supabase.from('activity').select('detail').eq('type', 'payment').order('created_at', { ascending: false }).limit(5000),
    ]);

    // Extraire chaque resultat avec fallback
    const servicesCount = servicesCountResult.status === 'fulfilled' ? (servicesCountResult.value.count || 0) : 0;
    const totalApiCalls = apiCallsCountResult.status === 'fulfilled' ? (apiCallsCountResult.value.count || 0) : 0;
    const totalPayments = paymentsCountResult.status === 'fulfilled' ? (paymentsCountResult.value.count || 0) : 0;
    const recentCallCount24h = recentCallsResult.status === 'fulfilled' ? (recentCallsResult.value.count || 0) : 0;

    if (servicesCountResult.status === 'rejected') logger.warn('PublicStats', `Failed to count services: ${servicesCountResult.reason?.message}`);
    if (apiCallsCountResult.status === 'rejected') logger.warn('PublicStats', `Failed to count API calls: ${apiCallsCountResult.reason?.message}`);
    if (paymentsCountResult.status === 'rejected') logger.warn('PublicStats', `Failed to count payments: ${paymentsCountResult.reason?.message}`);
    if (recentCallsResult.status === 'rejected') logger.warn('PublicStats', `Failed to count 24h calls: ${recentCallsResult.reason?.message}`);

    // Top endpoints
    let topEndpoints = [];
    if (topCallsResult.status === 'fulfilled' && topCallsResult.value.data) {
      const counts = {};
      for (const c of topCallsResult.value.data) {
        const match = c.detail?.match(/^(\w[\w\s/]+?)(?:\s*[:.])/);
        const ep = match ? match[1].trim() : (c.detail || 'Unknown');
        counts[ep] = (counts[ep] || 0) + 1;
      }
      topEndpoints = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([endpoint, count]) => ({ endpoint, count }));
    } else if (topCallsResult.status === 'rejected') {
      logger.warn('PublicStats', `Failed to compute top endpoints: ${topCallsResult.reason?.message}`);
    }

    // Uptime
    let uptimePercent = null;
    if (uptimeResult.status === 'fulfilled' && uptimeResult.value.data?.length > 0) {
      const checks = uptimeResult.value.data;
      const online = checks.filter(c => c.status === 'online').length;
      uptimePercent = parseFloat(((online / checks.length) * 100).toFixed(1));
    } else if (uptimeResult.status === 'rejected') {
      logger.warn('PublicStats', `Failed to compute uptime: ${uptimeResult.reason?.message}`);
    }

    // External providers
    let externalProviders = 0;
    let externalProviderNames = [];
    if (allServicesResult.status === 'fulfilled' && allServicesResult.value.data) {
      const extOnly = allServicesResult.value.data.filter(s => s.url && !s.url.startsWith(BACKEND_URL));
      const uniqueWallets = new Set(extOnly.map(s => (s.owner_address || '').toLowerCase()).filter(Boolean));
      externalProviders = uniqueWallets.size;
      externalProviderNames = [...new Set(extOnly.map(s => s.name))];
    } else if (allServicesResult.status === 'rejected') {
      logger.warn('PublicStats', `Failed to count external providers: ${allServicesResult.reason?.message}`);
    }

    // USDC volume
    let usdcVolume = 0;
    if (usdcPaymentsResult.status === 'fulfilled' && usdcPaymentsResult.value.data) {
      for (const p of usdcPaymentsResult.value.data) {
        const match = p.detail?.match(/([\d.]+)\s*USDC/i);
        if (match) usdcVolume += parseFloat(match[1]);
      }
      usdcVolume = parseFloat(usdcVolume.toFixed(2));
    } else if (usdcPaymentsResult.status === 'rejected') {
      logger.warn('PublicStats', `Failed to compute USDC volume: ${usdcPaymentsResult.reason?.message}`);
    }

    const status = getStatus();
    const onlineCount = status?.onlineCount || 0;
    const totalEndpoints = status?.totalCount || 69;

    const responseObj = {
      success: true,
      services: servicesCount,
      nativeEndpoints: 69,
      apiCalls: totalApiCalls,
      totalPayments,
      recentCallCount24h,
      uptimePercent,
      topEndpoints,
      externalProviders,
      externalProviderNames,
      usdcVolume,
      monitoring: {
        online: onlineCount,
        total: totalEndpoints,
        overall: status?.overall || 'unknown',
        lastCheck: status?.lastCheck || null,
      },
      integrations: 8,
      tests: 505,
    };

    // Mettre en cache
    STATS_CACHE.data = responseObj;
    STATS_CACHE.ts = Date.now();

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(responseObj);
  });

  // GET /api/status/history?endpoint=/api/weather&limit=50 — Check history for one endpoint
  router.get('/api/status/history', statsLimiter, async (req, res) => {
    const endpoint = req.query.endpoint;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    if (!endpoint) {
      return res.status(400).json({ error: "Parameter 'endpoint' required. Ex: /api/status/history?endpoint=/api/weather" });
    }

    try {
      const { data, error } = await supabase
        .from('monitoring_checks')
        .select('*')
        .eq('endpoint', endpoint)
        .order('checked_at', { ascending: false })
        .limit(limit);

      if (error) {
        // Table may not exist yet — return empty data gracefully
        return res.json({
          success: true,
          endpoint,
          count: 0,
          checks: [],
          note: 'Monitoring table not yet populated',
        });
      }

      res.json({
        success: true,
        endpoint,
        count: (data || []).length,
        checks: data || [],
      });
    } catch (err) {
      res.status(500).json({ error: 'History query failed' });
    }
  });

  return router;
}

module.exports = createMonitoringRouter;
