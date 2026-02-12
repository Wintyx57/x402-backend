// routes/health.js — GET /health, GET /, /.well-known/agent-registration.json, /api/agent/:agentId

const express = require('express');
const { NETWORK, CHAINS, NETWORK_LABEL, DEFAULT_CHAIN_KEY } = require('../lib/chains');
const { verifyAgent, getAgentInfo, IDENTITY_REGISTRY, REPUTATION_REGISTRY } = require('../erc8004');
const logger = require('../lib/logger');

function createHealthRouter(supabase) {
    const router = express.Router();

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

    // --- HEALTH CHECK ---
    router.get('/health', (req, res) => {
        const supportedNetworks = Object.entries(CHAINS)
            .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
            .map(([key, cfg]) => ({ network: key, label: cfg.label, chainId: cfg.chainId }));
        res.json({ status: 'ok', network: NETWORK_LABEL, networks: supportedNetworks, timestamp: new Date().toISOString() });
    });

    // --- ROUTE PUBLIQUE (Gratuite) ---
    router.get('/', async (req, res) => {
        let count = 0;
        try {
            const result = await supabase.from('services').select('*', { count: 'exact', head: true });
            count = result.count || 0;
        } catch (err) {
            logger.error('Root', 'Supabase error:', err.message);
        }
        const agentId = process.env.ERC8004_AGENT_ID || null;
        res.json({
            name: "x402 Bazaar",
            description: "Place de marche autonome de services IA - Protocole x402",
            network: NETWORK_LABEL,
            total_services: count,
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
                "GET /api/agent/:agentId": "ERC-8004 agent identity lookup (free)"
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

    return router;
}

module.exports = createHealthRouter;
