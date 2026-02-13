// routes/monitoring.js — Public status API endpoints

const express = require('express');
const { getStatus, getEndpoints } = require('../lib/monitor');

function createMonitoringRouter(supabase) {
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
  router.get('/api/status/uptime', async (req, res) => {
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

  // GET /api/status/history?endpoint=/api/weather&limit=50 — Check history for one endpoint
  router.get('/api/status/history', async (req, res) => {
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
