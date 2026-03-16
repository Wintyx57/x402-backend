// routes/health.js — GET /health, GET /, /.well-known/*, /api/agent/:agentId, /api/faucet/claim

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createPublicClient, createWalletClient, http, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { NETWORK, CHAINS, NETWORK_LABEL, DEFAULT_CHAIN_KEY } = require('../lib/chains');
const { verifyAgent, getAgentInfo, IDENTITY_REGISTRY, REPUTATION_REGISTRY } = require('../erc8004');
const logger = require('../lib/logger');
const { version: PKG_VERSION } = require('../package.json');

// SKALE on Base chain definition for viem
const skaleOnBase = defineChain({
    id: 1187947933,
    name: 'SKALE on Base',
    nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
    rpcUrls: { default: { http: [CHAINS.skale?.rpcUrl || 'https://skale-base.skalenodes.com/v1/base'] } },
    blockExplorers: { default: { name: 'SKALE Explorer', url: CHAINS.skale?.explorer || 'https://skale-base-explorer.skalenodes.com' } },
});

// Singleton public client for SKALE — avoids re-creating on every faucet request
const _skalePublicClient = createPublicClient({ chain: skaleOnBase, transport: http() });

// Faucet rate limiter: 3 requests per IP per hour
const faucetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { funded: false, reason: 'rate_limited', message: 'Max 3 faucet claims per hour' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Cache du count de services — TTL 60 secondes pour éviter des queries Supabase excessives
let _countCache = { value: 0, ts: 0 };
const COUNT_CACHE_TTL = 60 * 1000;

function createHealthRouter(supabase) {
    const router = express.Router();

    // --- OpenAPI spec for GPT Actions ---
    const openApiSpec = require('../openapi.json');
    router.get('/.well-known/openapi.json', (req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(openApiSpec);
    });

    // --- ERC-8004 Agent Registration JSON ---
    router.get('/.well-known/agent-registration.json', (req, res) => {
        const agentId = process.env.ERC8004_AGENT_ID || null;
        res.json({
            type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
            name: 'x402 Bazaar',
            description: 'The decentralized API marketplace where AI agents pay with USDC via HTTP 402 protocol',
            image: 'https://x402bazaar.org/og-image.png',
            services: [
                { name: 'MCP', endpoint: 'https://x402-api.onrender.com/', version: '2025-06-18' }
            ],
            x402Support: true,
            active: true,
            registrations: agentId ? [{ chain: 'base', chainId: 8453, agentId, registry: IDENTITY_REGISTRY }] : [],
            supportedTrust: ['reputation'],
        });
    });

    // --- ERC-8004 Agent Lookup (free) ---
    router.get('/api/agent/:agentId', async (req, res) => {
        const rawId = req.params.agentId;

        // Validate: must be a positive integer
        if (!/^\d+$/.test(rawId)) {
            return res.status(400).json({ error: 'agentId must be a positive integer' });
        }

        try {
            const info = await getAgentInfo(rawId);
            if (!info) {
                return res.status(404).json({ error: 'Agent not found', agentId: rawId });
            }
            res.json({ success: true, ...info });
        } catch (err) {
            logger.error('ERC-8004', 'Agent lookup error:', err.message);
            return res.status(500).json({ error: 'Agent lookup failed' });
        }
    });

    // --- ERC-8004 AGENT METADATA (agentURI endpoint) ---
    // Returns the registration JSON for a service, used by Identity Registry's agentURI.
    router.get('/api/agents/:serviceId/metadata.json', async (req, res) => {
        const { serviceId } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId)) {
            return res.status(400).json({ error: 'Invalid service ID format' });
        }

        const { data: service, error } = await supabase
            .from('services')
            .select('id, name, description, url, price_usdc, tags, owner_address, erc8004_agent_id')
            .eq('id', serviceId)
            .single();

        if (error || !service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json({
            type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
            name: service.name,
            description: service.description || '',
            image: 'https://x402bazaar.org/og-image.png',
            services: [{ name: 'api', endpoint: service.url }],
            supportedTrust: ['reputation'],
            x402Support: true,
            active: true,
            marketplace: {
                platform: 'x402 Bazaar',
                price_usdc: service.price_usdc,
                tags: service.tags || [],
                listing_url: `https://x402bazaar.org/services/${serviceId}`,
            },
        });
    });

    // --- HEALTH CHECK ---
    router.get('/health', (req, res) => {
        const supportedNetworks = Object.entries(CHAINS)
            .filter(([key]) => NETWORK === 'testnet' ? key === 'base-sepolia' : key !== 'base-sepolia')
            .map(([key, cfg]) => ({ network: key, label: cfg.label, chainId: cfg.chainId }));
        res.json({
            status: 'ok',
            network: NETWORK_LABEL,
            networks: supportedNetworks,
            timestamp: new Date().toISOString(),
            version: PKG_VERSION,
            uptime_seconds: Math.floor(process.uptime()),
            ...(process.env.NODE_ENV !== 'production' && { node_version: process.version }),
        });
    });

    // --- DEEP HEALTH CHECK ---
    // Checks external dependencies: Supabase and Base RPC.
    // Returns HTTP 200 if all deps are healthy, 503 if at least one is degraded.
    router.get('/health/deep', async (req, res) => {
        const checks = {};
        let allOk = true;

        // 1. Supabase — simple count query on the services table
        try {
            const start = Date.now();
            const { error } = await supabase
                .from('services')
                .select('id', { count: 'exact', head: true });
            const latencyMs = Date.now() - start;
            if (error) {
                logger.error('HealthDeep', 'Supabase check failed:', error.message);
                checks.supabase = { status: 'error', latency_ms: latencyMs };
                allOk = false;
            } else {
                checks.supabase = { status: 'ok', latency_ms: latencyMs };
            }
        } catch (e) {
            logger.error('HealthDeep', 'Supabase check exception:', e.message);
            checks.supabase = { status: 'error' };
            allOk = false;
        }

        // 2. Base RPC — eth_blockNumber via the first available RPC URL
        const baseRpcUrls = CHAINS.base ? CHAINS.base.rpcUrls : [];
        let rpcChecked = false;
        for (const rpcUrl of baseRpcUrls) {
            try {
                const start = Date.now();
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
                    signal: AbortSignal.timeout(5000),
                });
                const latencyMs = Date.now() - start;
                const json = await response.json();
                if (json.result) {
                    checks.rpc_base = {
                        status: 'ok',
                        latency_ms: latencyMs,
                        block_number: parseInt(json.result, 16),
                        url: rpcUrl,
                    };
                } else {
                    checks.rpc_base = { status: 'error', latency_ms: latencyMs, url: rpcUrl, error: json.error?.message || 'No result' };
                    allOk = false;
                }
                rpcChecked = true;
                break;
            } catch (e) {
                // Try next RPC URL
                logger.warn('health/deep', `RPC ${rpcUrl} unreachable: ${e.message}`);
            }
        }
        if (!rpcChecked) {
            checks.rpc_base = { status: 'error', error: 'All RPC endpoints unreachable' };
            allOk = false;
        }

        // 3. SKALE RPC — eth_blockNumber
        const skaleRpcUrl = CHAINS.skale?.rpcUrl || 'https://skale-base.skalenodes.com/v1/base';
        try {
            const skaleStart = Date.now();
            const skaleRes = await fetch(skaleRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
                signal: AbortSignal.timeout(5000),
            });
            const skaleJson = await skaleRes.json();
            if (skaleJson.result) {
                checks.rpc_skale = {
                    status: 'ok',
                    latency_ms: Date.now() - skaleStart,
                    block_number: parseInt(skaleJson.result, 16),
                    url: skaleRpcUrl,
                };
            } else {
                checks.rpc_skale = { status: 'error', latency_ms: Date.now() - skaleStart, url: skaleRpcUrl, error: skaleJson.error?.message || 'No result' };
                allOk = false;
            }
        } catch (e) {
            logger.warn('health/deep', `SKALE RPC ${skaleRpcUrl} unreachable: ${e.message}`);
            checks.rpc_skale = { status: 'error', error: e.message };
            allOk = false;
        }

        // 4. FeeSplitter status (Polygon distribute)
        try {
            const feeSplitter = require('../lib/fee-splitter');
            const fsConfigured = feeSplitter.isConfigured();
            const fsInit = fsConfigured ? feeSplitter.init() : false;
            checks.fee_splitter = {
                status: fsInit ? 'ok' : (fsConfigured ? 'init_failed' : 'not_configured'),
                configured: fsConfigured,
                initialized: fsInit,
                contract: process.env.POLYGON_FEE_SPLITTER_CONTRACT || null,
                operator_key_set: !!process.env.FEE_SPLITTER_OPERATOR_KEY,
                operator_key_format: process.env.FEE_SPLITTER_OPERATOR_KEY
                    ? /^0x[a-fA-F0-9]{64}$/.test(process.env.FEE_SPLITTER_OPERATOR_KEY)
                    : false,
            };
            if (fsInit) {
                const pending = await feeSplitter.getPendingBalance();
                if (pending !== null) {
                    checks.fee_splitter.pending_usdc = (Number(pending) / 1e6).toFixed(6);
                }
            }
        } catch (e) {
            checks.fee_splitter = { status: 'error', error: e.message };
        }

        // 5. ERC-8004 Reputation push status
        try {
            const erc8004 = require('../lib/erc8004-registry');
            const [pushStatus, walletInfo] = await Promise.all([
                erc8004.getPushStatus(),
                erc8004.getFeedbackWalletInfo(),
            ]);

            // Count services with agent_id + trust_score in DB
            const [agentIdCount, trustScoreCount] = await Promise.all([
                supabase.from('services').select('id', { count: 'exact', head: true }).not('erc8004_agent_id', 'is', null),
                supabase.from('services').select('id', { count: 'exact', head: true }).not('trust_score', 'is', null),
            ]);

            const erc8004Status = !walletInfo.configured ? 'not_configured'
                : (pushStatus.error ? 'error' : 'ok');

            checks.erc8004_reputation = {
                status: erc8004Status,
                feedback_wallet_configured: walletInfo.configured,
                feedback_wallet_address: walletInfo.address
                    ? `${walletInfo.address.slice(0, 6)}...${walletInfo.address.slice(-4)}` : null,
                feedback_wallet_credits: walletInfo.credits_balance,
                last_push: pushStatus.timestamp ? {
                    timestamp: pushStatus.timestamp,
                    pushed: pushStatus.pushed,
                    failed: pushStatus.failed,
                    total: pushStatus.total,
                    duration_ms: pushStatus.duration_ms,
                    ...(pushStatus.error && { error: pushStatus.error }),
                } : null,
                push_in_progress: pushStatus.pushInProgress,
                auto_refill: {
                    enabled: !!process.env.FAUCET_PRIVATE_KEY,
                    threshold: '0.1 CREDITS',
                    amount: '2.0 CREDITS',
                },
                services_with_agent_id: agentIdCount.count || 0,
                services_with_trust_score: trustScoreCount.count || 0,
            };
        } catch (e) {
            checks.erc8004_reputation = { status: 'error', error: e.message };
        }

        const status = allOk ? 'ok' : 'degraded';
        res.status(allOk ? 200 : 503).json({
            status,
            timestamp: new Date().toISOString(),
            version: PKG_VERSION,
            uptime_seconds: Math.floor(process.uptime()),
            checks,
        });
    });

    // --- ROUTE PUBLIQUE (Gratuite) ---
    router.get('/', async (req, res) => {
        let count = _countCache.value;
        // Refresh cache only when TTL has expired
        if (Date.now() - _countCache.ts > COUNT_CACHE_TTL) {
            try {
                const result = await supabase.from('services').select('id', { count: 'exact', head: true });
                _countCache = { value: result.count || 0, ts: Date.now() };
                count = _countCache.value;
            } catch (err) {
                logger.error('Root', 'Supabase error:', err.message);
                // Keep serving stale value on error
            }
        }
        const agentId = process.env.ERC8004_AGENT_ID || null;
        res.json({
            name: "x402 Bazaar",
            description: "Autonomous API marketplace — x402 HTTP 402 Payment Required protocol. Multi-chain: Base + SKALE on Base.",
            network: NETWORK_LABEL,
            total_services: count,
            api_docs: "/api-docs",
            endpoints: {
                "GET /services":  "Liste complete des services (0.05 USDC)",
                "GET /search?q=": "Recherche de services par mot-cle (0.05 USDC)",
                "POST /register": "Enregistrer un nouveau service (1 USDC)",
                "GET /api/search?q=": "Clean web search results for LLMs (0.005 USDC)",
                "GET /api/scrape?url=": "Universal URL scraper - returns clean Markdown (0.005 USDC)",
                "GET /api/twitter?user=|tweet=|search=": "Twitter/X profiles, tweets, and search (0.005 USDC)",
                "GET /api/weather?city=": "Weather data for any city (0.02 USDC)",
                "GET /api/crypto?coin=": "Cryptocurrency prices (0.02 USDC)",
                "GET /api/joke": "Random joke (0.01 USDC)",
                "GET /api/image?prompt=": "AI image generation via DALL-E 3 (0.05 USDC)",
                "GET /api/wikipedia?q=": "Wikipedia article summary (0.005 USDC)",
                "GET /api/dictionary?word=": "English dictionary definitions (0.005 USDC)",
                "GET /api/countries?name=": "Country data (population, capital, languages) (0.005 USDC)",
                "GET /api/github?user=|repo=": "GitHub user profiles and repo stats (0.005 USDC)",
                "GET /api/npm?package=": "NPM package metadata (0.005 USDC)",
                "GET /api/ip?address=": "IP geolocation data (0.005 USDC)",
                "GET /api/qrcode?text=": "QR code image generation (0.005 USDC)",
                "GET /api/time?timezone=": "Current time in any timezone (0.005 USDC)",
                "GET /api/holidays?country=&year=": "Public holidays by country (0.005 USDC)",
                "GET /api/geocoding?city=": "City to coordinates geocoding (0.005 USDC)",
                "GET /api/airquality?lat=&lon=": "Air quality index and pollutants (0.005 USDC)",
                "GET /api/quote": "Random advice quote (0.005 USDC)",
                "GET /api/facts": "Random fun fact (0.005 USDC)",
                "GET /api/dogs?breed=": "Random dog image by breed (0.005 USDC)",
                "GET /api/translate?text=&from=&to=": "Translate text between 90+ languages (0.005 USDC)",
                "GET /api/summarize?text=&maxLength=": "AI-powered text summarization (0.01 USDC)",
                "POST /api/code": "Execute code in 50+ languages (0.005 USDC)",
                "GET /api/dns?domain=&type=": "DNS record lookup (A, MX, TXT, etc.) (0.003 USDC)",
                "GET /api/qrcode-gen?data=&size=": "Generate QR code image URL (0.003 USDC)",
                "GET /api/readability?url=": "Extract clean text from web pages (0.005 USDC)",
                "GET /api/sentiment?text=": "AI sentiment analysis (positive/negative/neutral) (0.005 USDC)",
                "GET /api/validate-email?email=": "Email validation with MX verification (0.003 USDC)",
                "GET /api/hash?text=&algo=": "Hash text with MD5, SHA-1, SHA-256, SHA-512 (0.003 USDC)",
                "GET /api/uuid": "Generate UUID v4 (0.003 USDC)",
                "GET /api/base64?text=&mode=": "Base64 encode/decode (0.003 USDC)",
                "GET /api/password?length=&symbols=": "Secure random password generator (0.003 USDC)",
                "GET /api/currency?from=&to=&amount=": "Currency conversion with ECB rates (0.005 USDC)",
                "GET /api/timestamp?ts=": "Unix timestamp converter (0.003 USDC)",
                "GET /api/lorem?paragraphs=": "Lorem ipsum generator (0.003 USDC)",
                "GET /api/headers": "HTTP request headers inspector (0.003 USDC)",
                "GET /api/markdown?text=": "Markdown to HTML converter (0.003 USDC)",
                "GET /api/color?hex=": "Color information and conversions (0.003 USDC)",
                "GET /api/json-validate": "JSON schema validator (0.003 USDC)",
                "GET /api/useragent": "User-Agent string parser (0.003 USDC)",
                "GET /api/agent/:agentId": "ERC-8004 agent identity lookup (free)",
                "POST /api/call/:serviceId": "Call an external API through the Bazaar proxy (price varies, 95/5 split)"
            },
            protocol: "x402 - HTTP 402 Payment Required",
            erc8004: {
                agentId,
                identityRegistry: IDENTITY_REGISTRY,
                reputationRegistry: REPUTATION_REGISTRY,
                chain: 'base',
                chainId: 8453,
                registrationURI: 'https://x402-api.onrender.com/.well-known/agent-registration.json',
            }
        });
    });

    // --- FAUCET: auto-distribute CREDITS to new wallets on SKALE ---
    router.post('/api/faucet/claim', faucetLimiter, async (req, res) => {
        const { address } = req.body || {};

        // 1. Validate address format
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ funded: false, reason: 'invalid_address' });
        }

        // 2. Check FAUCET_PRIVATE_KEY
        const faucetKey = process.env.FAUCET_PRIVATE_KEY;
        if (!faucetKey) {
            return res.status(503).json({ funded: false, reason: 'faucet_not_configured' });
        }

        try {
            // 3. Check target CREDITS balance on SKALE (reuse singleton client)
            const pubClient = _skalePublicClient;
            const balance = await pubClient.getBalance({ address });

            // If already has CREDITS (> 0.001), skip
            if (balance > 1_000_000_000_000_000n) {
                return res.json({
                    funded: false,
                    reason: 'already_has_credits',
                    balance: (Number(balance) / 1e18).toFixed(8),
                });
            }

            // 4. Create faucet wallet + check faucet balance
            const normalizedKey = faucetKey.startsWith('0x') ? faucetKey : `0x${faucetKey}`;
            const faucetAccount = privateKeyToAccount(normalizedKey);
            const DRIP_AMOUNT = 100_000_000_000_000_000n; // 0.1 CREDITS

            const faucetBalance = await pubClient.getBalance({ address: faucetAccount.address });
            if (faucetBalance < DRIP_AMOUNT * 2n) {
                logger.warn('Faucet', `Low faucet balance: ${(Number(faucetBalance) / 1e18).toFixed(6)} CREDITS`);
                return res.json({ funded: false, reason: 'faucet_low_balance' });
            }

            const faucetWallet = createWalletClient({
                account: faucetAccount,
                chain: skaleOnBase,
                transport: http(),
            });

            // 5. Send 0.1 CREDITS (~100 transactions worth)
            const txHash = await faucetWallet.sendTransaction({
                to: address,
                value: DRIP_AMOUNT,
                type: 'legacy',
            });

            // 6. Wait confirmation (SKALE instant finality)
            await pubClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 30_000 });

            logger.info('Faucet', `Sent 0.1 CREDITS to ${address} — tx: ${txHash}`);
            res.json({
                funded: true,
                amount_credits: '0.1',
                estimated_transactions: '~100',
                tx_hash: txHash,
            });
        } catch (err) {
            logger.error('Faucet', `Failed to fund ${address}: ${err.message}`);
            res.status(500).json({
                funded: false,
                reason: 'send_failed',
                error: err.message?.includes('insufficient') ? 'Faucet wallet has insufficient CREDITS for gas'
                     : err.message?.includes('nonce') ? 'Transaction nonce conflict — retry in a few seconds'
                     : 'CREDITS transfer failed — try again later',
                hint: 'If this persists, you can manually send 0.01 CREDITS to your wallet on SKALE on Base (chain ID 1187947933)',
            });
        }
    });

    return router;
}

module.exports = createHealthRouter;
