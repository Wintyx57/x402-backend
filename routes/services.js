// routes/services.js — GET /services, GET /search, GET /api/services, GET /api/activity,
//                     GET /api/services/activity, GET /api/health-check

const express = require('express');
const logger = require('../lib/logger');
const { fetchWithTimeout } = require('../lib/payment');

function createServicesRouter(supabase, logActivity, paymentMiddleware, paidEndpointLimiter, dashboardApiLimiter) {
    const router = express.Router();

    // --- LISTE DES SERVICES (0.05 USDC) ---
    router.get('/services', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Lister les services"), async (req, res) => {
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('Supabase', '/services error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch services' });
        }

        res.json({
            success: true,
            count: data.length,
            data
        });
    });

    // --- RECHERCHE DE SERVICES (0.05 USDC) ---
    router.get('/search', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Rechercher un service"), async (req, res) => {
        const query = (req.query.q || '').trim().slice(0, 100);

        if (!query) {
            return res.status(400).json({ error: "Parametre 'q' requis. Ex: /search?q=weather" });
        }

        // Reject control characters and null bytes
        if (/[\x00-\x1F\x7F]/.test(query)) {
            return res.status(400).json({ error: 'Invalid characters in query' });
        }

        // Sanitize: escape special Postgres LIKE characters
        const sanitized = query.replace(/[%_\\]/g, '\\$&');

        // Recherche floue sur name et description
        const pgSafe = sanitized.replace(/[(),."']/g, '');
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .or(`name.ilike.%${pgSafe}%,description.ilike.%${pgSafe}%`);

        if (error) {
            logger.error('Supabase', '/search error:', error.message);
            return res.status(500).json({ error: 'Search failed' });
        }

        logActivity('search', `Recherche "${query}" -> ${data.length} resultat(s)`);

        res.json({
            success: true,
            query,
            count: data.length,
            data
        });
    });

    // --- API services (gratuit, pour le dashboard) ---
    router.get('/api/services', dashboardApiLimiter, async (req, res) => {
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Supabase', '/api/services error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch services' });
        }
        res.json(data);
    });

    // --- API activity log (gratuit, pour le dashboard) ---
    router.get('/api/activity', dashboardApiLimiter, async (req, res) => {
        const { data, error } = await supabase
            .from('activity')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            logger.error('Supabase', '/api/activity error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch activity' });
        }

        // Mapper pour compatibilite dashboard (time, txHash)
        const activity = (data || []).map(a => ({
            type: a.type,
            detail: a.detail,
            amount: Number(a.amount),
            time: a.created_at,
            txHash: a.tx_hash,
        }));

        res.json(activity);
    });

    // --- SERVICES ACTIVITY (Last call timestamps) ---
    router.get('/api/services/activity', dashboardApiLimiter, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('activity')
                .select('detail, created_at')
                .eq('type', 'api_call')
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) {
                logger.error('Supabase', '/api/services/activity error:', error.message);
                return res.status(500).json({ error: 'Failed to fetch activity' });
            }

            // Map detail patterns to endpoints and find latest timestamp
            const activityMap = {};
            const endpointPatterns = [
                { pattern: /Web Search API/i, endpoint: '/api/search' },
                { pattern: /Scraper API/i, endpoint: '/api/scrape' },
                { pattern: /Twitter API/i, endpoint: '/api/twitter' },
                { pattern: /Weather API/i, endpoint: '/api/weather' },
                { pattern: /Crypto (?:Price )?API/i, endpoint: '/api/crypto' },
                { pattern: /(?:Random )?Joke API/i, endpoint: '/api/joke' },
                { pattern: /Image (?:Generation )?API/i, endpoint: '/api/image' },
            ];

            for (const row of (data || [])) {
                for (const { pattern, endpoint } of endpointPatterns) {
                    if (pattern.test(row.detail) && !activityMap[endpoint]) {
                        activityMap[endpoint] = row.created_at;
                    }
                }
            }

            res.json(activityMap);
        } catch (err) {
            logger.error('Activity', err.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    // --- HEALTH CHECK (service URLs) ---
    const healthCache = new Map();
    const HEALTH_TTL = 10 * 60 * 1000; // 10 minutes

    // Cleanup expired healthCache entries every 30 min
    setInterval(() => {
        const now = Date.now();
        for (const [key, val] of healthCache) {
            if (now - val.timestamp > HEALTH_TTL * 3) healthCache.delete(key);
        }
    }, 30 * 60 * 1000);

    router.get('/api/health-check', dashboardApiLimiter, async (req, res) => {
        try {
            const { data: services, error } = await supabase
                .from('services')
                .select('url')
                .order('created_at', { ascending: false });

            if (error) {
                return res.status(500).json({ error: 'Failed to fetch services' });
            }

            // Deduplicate base URLs
            const urls = [...new Set((services || []).map(s => s.url).filter(Boolean))];

            const results = {};
            const toCheck = [];

            // Check cache first
            for (const url of urls) {
                const cached = healthCache.get(url);
                if (cached && (Date.now() - cached.timestamp < HEALTH_TTL)) {
                    results[url] = cached.status;
                } else {
                    toCheck.push(url);
                }
            }

            // Batch check remaining URLs (batches of 10)
            for (let i = 0; i < toCheck.length; i += 10) {
                const batch = toCheck.slice(i, i + 10);
                const checks = batch.map(async (url) => {
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 5000);
                        const response = await fetch(url, {
                            method: 'HEAD',
                            signal: controller.signal,
                            redirect: 'follow',
                        });
                        clearTimeout(timeout);
                        // Status 402 is normal for x402 (payment required = online)
                        const status = (response.status >= 200 && response.status < 500) ? 'online' : 'offline';
                        healthCache.set(url, { status, timestamp: Date.now() });
                        results[url] = status;
                    } catch {
                        healthCache.set(url, { status: 'offline', timestamp: Date.now() });
                        results[url] = 'offline';
                    }
                });
                await Promise.all(checks);
            }

            res.json(results);
        } catch (err) {
            logger.error('Health Check', err.message);
            res.status(500).json({ error: 'Health check failed' });
        }
    });

    return router;
}

module.exports = createServicesRouter;
