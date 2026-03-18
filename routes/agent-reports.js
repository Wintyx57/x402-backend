// routes/agent-reports.js — Public endpoints for Live AI Agent reports

const express = require('express');
const logger = require('../lib/logger');
const { CHAINS } = require('../lib/chains');

const CHAIN_KEY = 'skale';
const EXPLORER_BASE = CHAINS[CHAIN_KEY]?.explorer || 'https://skale-base-explorer.skalenodes.com';

// In-memory cache (5min TTL)
let _latestCache = null;
let _latestCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

function createAgentReportsRouter(supabase, adminAuth, runLiveAgentOnce) {
    const router = express.Router();

    // GET /api/agent-reports/latest — Public, free, cached 5min
    router.get('/api/agent-reports/latest', async (req, res) => {
        try {
            // Serve from cache if fresh
            if (_latestCache && Date.now() - _latestCacheAt < CACHE_TTL) {
                res.set('Cache-Control', 'public, max-age=300');
                return res.json(_latestCache);
            }

            const { data, error } = await supabase
                .from('agent_reports')
                .select('*')
                .order('run_at', { ascending: false })
                .limit(1)
                .single();

            if (error || !data) {
                return res.json({ status: 'no_data', message: 'No agent report yet' });
            }

            const report = formatReport(data);
            _latestCache = report;
            _latestCacheAt = Date.now();

            res.set('Cache-Control', 'public, max-age=300');
            res.json(report);
        } catch (err) {
            logger.error('AgentReports', `Latest: ${err.message}`);
            res.status(500).json({ error: 'Failed to fetch agent report' });
        }
    });

    // GET /api/agent-reports/history?limit=10 — Public, free
    router.get('/api/agent-reports/history', async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

            const { data, error } = await supabase
                .from('agent_reports')
                .select('id, run_at, status, nasa_title, nasa_url, nasa_date, iss_latitude, iss_longitude, spacex_name, spacex_date_utc, total_cost, agent_wallet, chain, nasa_tx_hash, iss_tx_hash, spacex_tx_hash')
                .order('run_at', { ascending: false })
                .limit(limit);

            if (error) {
                logger.error('AgentReports', `History: ${error.message}`);
                return res.status(500).json({ error: 'Failed to fetch history' });
            }

            const reports = (data || []).map(row => ({
                id: row.id,
                run_at: row.run_at,
                status: row.status,
                nasa_title: row.nasa_title,
                nasa_url: row.nasa_url,
                nasa_date: row.nasa_date,
                iss: row.iss_latitude != null ? { lat: row.iss_latitude, lon: row.iss_longitude } : null,
                spacex_name: row.spacex_name,
                spacex_date_utc: row.spacex_date_utc,
                total_cost: row.total_cost,
                tx_count: [row.nasa_tx_hash, row.iss_tx_hash, row.spacex_tx_hash].filter(Boolean).length,
                agent_wallet: row.agent_wallet,
                chain: row.chain,
            }));

            res.set('Cache-Control', 'public, max-age=300');
            res.json({ reports });
        } catch (err) {
            logger.error('AgentReports', `History: ${err.message}`);
            res.status(500).json({ error: 'Failed to fetch history' });
        }
    });

    // POST /api/admin/agent/run — Admin-only trigger for manual run
    router.post('/api/admin/agent/run', adminAuth, async (req, res) => {
        try {
            const result = await runLiveAgentOnce(supabase);
            // Invalidate cache
            _latestCache = null;
            _latestCacheAt = 0;
            res.json({ triggered: true, result });
        } catch (err) {
            logger.error('AgentReports', `Manual run: ${err.message}`);
            res.status(500).json({ error: 'Agent run failed', message: err.message });
        }
    });

    return router;
}

function formatReport(row) {
    return {
        id: row.id,
        run_at: row.run_at,
        status: row.status,
        nasa: {
            title: row.nasa_title,
            explanation: row.nasa_explanation,
            date: row.nasa_date,
            url: row.nasa_url,
            hdurl: row.nasa_hdurl,
            media_type: row.nasa_media_type,
            tx_hash: row.nasa_tx_hash,
            cost: row.nasa_cost,
            latency_ms: row.nasa_latency_ms,
            error: row.nasa_error,
        },
        iss: {
            position: row.iss_latitude != null ? { lat: row.iss_latitude, lon: row.iss_longitude } : null,
            crew: {
                count: row.iss_crew_count,
                members: row.iss_crew_members,
            },
            tx_hash: row.iss_tx_hash,
            cost: row.iss_cost,
            latency_ms: row.iss_latency_ms,
            error: row.iss_error,
        },
        spacex: {
            name: row.spacex_name,
            date_utc: row.spacex_date_utc,
            flight_number: row.spacex_flight_number,
            details: row.spacex_details,
            rocket: row.spacex_rocket,
            links: row.spacex_links,
            tx_hash: row.spacex_tx_hash,
            cost: row.spacex_cost,
            latency_ms: row.spacex_latency_ms,
            error: row.spacex_error,
        },
        total_cost: row.total_cost,
        agent_wallet: row.agent_wallet,
        chain: row.chain,
        explorer_base_url: `${EXPLORER_BASE}/tx`,
    };
}

module.exports = createAgentReportsRouter;
