// routes/services.js — GET /services, GET /search, GET /api/services, GET /api/services/:id,
//                     GET /api/activity, GET /api/services/activity, GET /api/health-check,
//                     DELETE /api/admin/services/:id, POST /api/admin/services/:id/verify

const express = require('express');
const logger = require('../lib/logger');
const { fetchWithTimeout, TX_HASH_REGEX, UUID_REGEX } = require('../lib/payment');
const { ServiceSearchSchema } = require('../schemas/index');
const { verifyService } = require('../lib/service-verifier');
const { safeUrl } = require('../lib/safe-url');
const { getInputSchemaForUrl } = require('../lib/bazaar-discovery');
const { smartSearch } = require('../lib/smart-search');

function createServicesRouter(supabase, logActivity, paymentMiddleware, paidEndpointLimiter, dashboardApiLimiter, adminAuth, getGemini) {
    const router = express.Router();

    // Colonnes explicites pour éviter SELECT * (performance + surface d'exposition réduite)
    const BASE_COLUMNS = 'id, name, url, price_usdc, description, owner_address, tags, verified_status, verified_at, created_at, required_parameters, status, last_checked_at, trust_score, trust_score_updated_at, erc8004_agent_id, erc8004_registered_at';
    let SERVICE_COLUMNS = BASE_COLUMNS;

    // Detect logo_url column availability (migration 016 may not have run yet)
    supabase.from('services').select('logo_url').limit(1).then(({ error }) => {
        if (!error) {
            SERVICE_COLUMNS = BASE_COLUMNS + ', logo_url';
            logger.info('Services', 'logo_url column detected — included in queries');
        }
    }).catch(() => {});

    // Enrich services with required_parameters from discoveryMap when not set in DB
    function enrichWithParams(services) {
        if (!Array.isArray(services)) return services;
        return services.map(s => {
            if (s.required_parameters) return s;
            const schema = getInputSchemaForUrl(s.url);
            if (schema) return { ...s, required_parameters: schema };
            return s;
        });
    }

    // --- LISTE DES SERVICES (0.05 USDC) ---
    router.get('/services', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "List Services"), async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const { data, count, error } = await supabase
            .from('services')
            .select(SERVICE_COLUMNS, { count: 'exact' })
            .order('created_at', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error('Supabase', '/services error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch services' });
        }

        const enriched = enrichWithParams(data);
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
        });
    });

    // --- RECHERCHE DE SERVICES (0.05 USDC) — Smart Search (scoring + Gemini fallback) ---
    router.get('/search', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Search Services"), async (req, res) => {
        // Validate query parameters using Zod
        const parseResult = ServiceSearchSchema.safeParse({ q: req.query.q || '' });

        if (!parseResult.success) {
            const errors = parseResult.error.errors.map(err => err.message).join(', ');
            return res.status(400).json({ error: errors });
        }

        const query = parseResult.data.q;

        // Sanitize: whitelist only safe characters to prevent ILIKE injection
        const safe = query.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().slice(0, 100);
        if (!safe) return res.status(400).json({ error: 'Invalid search query' });

        try {
            // Safe Gemini getter: pass null if not configured (scoring-only mode)
            let safeGetGemini = null;
            try {
                if (getGemini) {
                    getGemini(); // Test if GEMINI_API_KEY is set
                    safeGetGemini = getGemini;
                }
            } catch { /* Gemini not configured — scoring only */ }

            const searchResult = await smartSearch(supabase, safe, safeGetGemini);

            logActivity('search', `Search "${query}" -> ${searchResult.results.length} result(s) [${searchResult.method}]`);

            res.json({
                success: true,
                query,
                count: searchResult.results.length,
                data: searchResult.results,
                search_method: searchResult.method,
                keywords_used: searchResult.keywords_used,
            });
        } catch (err) {
            logger.error('SmartSearch', `/search error: ${err.message}`);
            return res.status(500).json({ error: 'Search failed' });
        }
    });

    // --- API services (gratuit, pour le dashboard) ---
    router.get('/api/services', dashboardApiLimiter, async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const rawSearch = (req.query.search || '').trim().slice(0, 200);
        const rawTag = (req.query.tag || '').trim().slice(0, 100);

        // Sanitize for PostgREST ILIKE (escape %, _, and PostgREST operators)
        const sanitize = (s) => s.replace(/[%_\\]/g, '\\$&').replace(/[.,()]/g, '');

        let query = supabase
            .from('services')
            .select(SERVICE_COLUMNS, { count: 'exact' });

        if (rawSearch) {
            const safe = sanitize(rawSearch);
            query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
        }

        if (rawTag) {
            const safeTag = sanitize(rawTag);
            query = query.contains('tags', [safeTag]);
        }

        const { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error('Supabase', '/api/services error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch services' });
        }
        const enriched = enrichWithParams(data);
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json({
            data: enriched,
            pagination: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit),
            },
        });
    });

    // --- API activity log (gratuit, pour le dashboard) ---
    router.get('/api/activity', adminAuth, dashboardApiLimiter, async (req, res) => {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const typeFilter = (req.query.type || '').trim().slice(0, 50);

        let query = supabase
            .from('activity')
            .select('type, detail, amount, created_at, tx_hash, chain')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (typeFilter) {
            query = query.eq('type', typeFilter);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('Supabase', '/api/activity error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch activity' });
        }

        // Mapper pour compatibilite dashboard (time)
        const activity = (data || []).map(a => ({
            type: a.type,
            detail: a.detail,
            amount: Number(a.amount),
            time: a.created_at,
            txHash: a.tx_hash || null,
            chain: a.chain || null,
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

    // --- GET SINGLE SERVICE BY ID ---
    router.get('/api/services/:id', dashboardApiLimiter, async (req, res) => {
        try {
            const { id } = req.params;

            // Validate UUID format
            if (!UUID_REGEX.test(id)) {
                return res.status(400).json({ error: 'Invalid service ID format' });
            }

            const { data, error } = await supabase
                .from('services')
                .select(SERVICE_COLUMNS)
                .eq('id', id)
                .single();

            if (error || !data) {
                return res.status(404).json({ error: 'Service not found' });
            }

            // Enrich with inputSchema from discoveryMap for internal wrappers
            const enriched = { ...data };
            if (!enriched.required_parameters) {
                const schema = getInputSchemaForUrl(data.url);
                if (schema) {
                    enriched.required_parameters = schema;
                }
            }
            res.json(enriched);
        } catch (err) {
            logger.error('Supabase', `/api/services/:id error: ${err.message}`);
            res.status(500).json({ error: 'Internal server error' });
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
    }, 30 * 60 * 1000).unref();

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
                        await safeUrl(url);
                    } catch {
                        results[url] = 'blocked';
                        return;
                    }
                    {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 5000);
                        try {
                            const response = await fetch(url, {
                                method: 'HEAD',
                                signal: controller.signal,
                                redirect: 'follow',
                            });
                            // Status 402 is normal for x402 (payment required = online)
                            const status = (response.status >= 200 && response.status < 500) ? 'online' : 'offline';
                            healthCache.set(url, { status, timestamp: Date.now() });
                            results[url] = status;
                        } catch {
                            healthCache.set(url, { status: 'offline', timestamp: Date.now() });
                            results[url] = 'offline';
                        } finally {
                            clearTimeout(timeout);
                        }
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

    // --- ADMIN: RE-VERIFY SERVICE ---
    if (adminAuth) {
        router.post('/api/admin/services/:id/verify', adminAuth, async (req, res) => {
            const { id } = req.params;

            // Validate UUID format to prevent injection via :id path parameter
            if (!UUID_REGEX.test(id)) {
                return res.status(400).json({ error: 'Invalid service ID format' });
            }

            // Fetch service from DB
            const { data: services, error: fetchErr } = await supabase
                .from('services')
                .select('id, name, url, price_usdc, verified_status, owner_address, required_parameters')
                .eq('id', id)
                .limit(1);

            if (fetchErr || !services || services.length === 0) {
                return res.status(404).json({ error: 'Service not found' });
            }

            const service = services[0];
            const report = await verifyService(service.url);

            // Update verified_status in DB
            await supabase
                .from('services')
                .update({ verified_status: report.verdict, verified_at: new Date().toISOString() })
                .eq('id', id);

            logActivity('admin', `Re-verified "${service.name}": ${report.verdict}`);
            logger.info('Admin', `Re-verified "${service.name}" (${id.slice(0, 8)}): ${report.verdict}`);

            res.json({ success: true, service: service.name, report });
        });
    }

    // --- ADMIN: DELETE SERVICE BY ID ---
    if (adminAuth) {
        router.delete('/api/admin/services/:id', adminAuth, async (req, res) => {
            const { id } = req.params;

            // Validate UUID format to prevent injection via :id path parameter
            if (!UUID_REGEX.test(id)) {
                return res.status(400).json({ error: 'Invalid service ID format' });
            }

            const { data, error } = await supabase
                .from('services')
                .delete()
                .eq('id', id)
                .select();

            if (error) {
                logger.error('Admin', `DELETE /api/admin/services/${id} error: ${error.message}`);
                return res.status(500).json({ error: 'Failed to delete service' });
            }

            if (!data || data.length === 0) {
                return res.status(404).json({ error: 'Service not found' });
            }

            logActivity('admin', `Deleted service: ${data[0].name} (${id})`);
            logger.info('Admin', `Deleted service: ${data[0].name} (${id})`);
            res.json({ success: true, deleted: data[0] });
        });

        // Debug: step-by-step payment verification (admin only, disabled in production)
        router.get('/api/admin/debug-verify', adminAuth, async (req, res) => {
            if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
            const txHash = req.query.tx;
            const chainKey = req.query.chain || 'base';
            if (!txHash) return res.status(400).json({ error: 'Missing ?tx= parameter' });

            // Validate txHash format before any usage
            if (!TX_HASH_REGEX.test(txHash)) {
                return res.status(400).json({ error: 'Invalid tx hash format — expected 0x followed by 64 hex characters' });
            }

            const { getChainConfig } = require('../lib/chains');
            const chain = getChainConfig(chainKey);
            const steps = [];
            try {
                const normalizedTxHash = txHash.toLowerCase().trim();
                steps.push({ step: 'normalize', txHash: normalizedTxHash, length: normalizedTxHash.length });

                const serverAddress = process.env.WALLET_ADDRESS?.toLowerCase();
                steps.push({ step: 'serverAddress', address: serverAddress, env_set: !!process.env.WALLET_ADDRESS });

                steps.push({ step: 'chain', chainKey, label: chain.label, rpcCount: (chain.rpcUrls || [chain.rpcUrl]).filter(Boolean).length, usdcContract: chain.usdcContract });

                // Fetch receipt
                const rpcUrl = chain.rpcUrls?.[0] || chain.rpcUrl;
                const receiptRes = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [normalizedTxHash], id: 1 }),
                });
                const receiptData = await receiptRes.json();
                const receipt = receiptData.result;
                steps.push({ step: 'receipt', found: !!receipt, status: receipt?.status, blockNumber: receipt?.blockNumber, logsCount: receipt?.logs?.length });

                if (!receipt) { steps.push({ step: 'FAIL', reason: 'No receipt found' }); return res.json({ steps }); }

                // Block confirmations
                const blockRes = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 2 }),
                });
                const { result: currentBlockHex } = await blockRes.json();
                const currentBlock = parseInt(currentBlockHex, 16);
                const txBlock = parseInt(receipt.blockNumber, 16);
                steps.push({ step: 'confirmations', currentBlock, txBlock, confirmations: currentBlock - txBlock });

                // Parse logs
                const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
                for (const log of (receipt.logs || [])) {
                    if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
                        const logAddr = log.address.toLowerCase();
                        const usdcMatch = logAddr === chain.usdcContract.toLowerCase();
                        const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
                        const walletMatch = toAddr === serverAddress;
                        const amount = BigInt(log.data);
                        steps.push({
                            step: 'transfer_log',
                            logAddress: logAddr,
                            usdcMatch,
                            to: toAddr,
                            walletMatch,
                            amount: Number(amount),
                            amountUsdc: Number(amount) / 1e6,
                        });
                    }
                }
                steps.push({ step: 'DONE' });
            } catch (err) {
                steps.push({ step: 'ERROR', message: err.message });
            }
            res.json({ steps });
        });

        // Diagnostic: which community-agent env vars are set (no values exposed)
        // Blocked in production — only for local/staging debugging
        router.get('/api/admin/env-check', adminAuth, (req, res) => {
            if (process.env.NODE_ENV === 'production') {
                return res.status(404).json({ error: 'Not found' });
            }
            const keys = [
                'AGENT_PRIVATE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_CHANNEL_ID',
                'GEMINI_API_KEY', 'DISCORD_WEBHOOK_URL', 'OPENAI_API_KEY', 'ENABLE_COMMUNITY_AGENT',
                'DEVTO_API_KEY', 'MAX_BUDGET_USDC',
            ];
            const result = {};
            for (const k of keys) {
                result[k] = !!process.env[k];
            }
            res.json(result);
        });
    }

    return router;
}

module.exports = createServicesRouter;
