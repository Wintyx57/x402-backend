// routes/catalog.js — GET /api/catalog
// Public partner endpoint: curated catalog for external marketplace embedding (e.g. XONA/Orbit)

const express = require('express');
const logger = require('../lib/logger');

const PROXY_BASE_URL = process.env.BASE_URL || 'https://x402-api.onrender.com';

// Curated columns — no owner_address, no url (upstream), no encrypted_credentials
const CATALOG_COLUMNS = 'id, name, description, price_usdc, tags, status, trust_score, required_parameters, logo_url';

function createCatalogRouter(supabase, dashboardApiLimiter) {
    const router = express.Router();

    router.get('/api/catalog', dashboardApiLimiter, async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
        const offset = (page - 1) * limit;
        const rawSearch = (req.query.search || '').trim().slice(0, 200);
        const rawTag = (req.query.tag || '').trim().slice(0, 100);
        const rawStatus = (req.query.status || '').trim().slice(0, 20);

        const sanitize = (s) => s.replace(/[%_\\]/g, '\\$&').replace(/[.,()]/g, '');

        let query = supabase
            .from('services')
            .select(CATALOG_COLUMNS, { count: 'exact' })
            .neq('status', 'pending_validation');

        if (rawSearch) {
            const safe = sanitize(rawSearch);
            query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
        }

        if (rawTag) {
            const safeTag = sanitize(rawTag);
            query = query.contains('tags', [safeTag]);
        }

        if (rawStatus && ['online', 'offline', 'degraded', 'unknown'].includes(rawStatus)) {
            query = query.eq('status', rawStatus);
        }

        const { data, count, error } = await query
            .order('trust_score', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error('Catalog', `/api/catalog error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to fetch catalog' });
        }

        // Enrich with call_endpoint and has_credentials flag
        const enriched = (data || []).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            price_usdc: s.price_usdc,
            tags: s.tags,
            status: s.status,
            trust_score: s.trust_score,
            required_parameters: s.required_parameters,
            has_credentials: false, // catalog never exposes credential details
            logo_url: s.logo_url || null,
            call_endpoint: `${PROXY_BASE_URL}/api/call/${s.id}`,
        }));

        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
        res.json({
            success: true,
            count: enriched.length,
            data: enriched,
            pagination: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit),
            },
            meta: {
                marketplace: 'x402 Bazaar',
                website: 'https://x402bazaar.org',
                payment_protocol: 'x402 (HTTP 402 + USDC)',
                supported_chains: ['base', 'skale', 'polygon'],
                proxy_base_url: PROXY_BASE_URL,
                docs: 'https://x402bazaar.org/docs',
            },
        });
    });

    return router;
}

module.exports = createCatalogRouter;
