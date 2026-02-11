require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const OpenAI = require('openai');

let _openai = null;
function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Réseau configurable (testnet / mainnet) + Multi-chain ---
const NETWORK = process.env.NETWORK || 'testnet';

const CHAINS = {
    base: {
        rpcUrl: 'https://mainnet.base.org',
        usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chainId: 8453,
        explorer: 'https://basescan.org',
        label: 'Base',
    },
    'base-sepolia': {
        rpcUrl: 'https://sepolia.base.org',
        usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        chainId: 84532,
        explorer: 'https://sepolia.basescan.org',
        label: 'Base Sepolia',
    },
    skale: {
        rpcUrl: 'https://mainnet.skalenodes.com/v1/elated-tan-skat',
        usdcContract: '0x5F795bb52dAc3085f578f4877D450e2929D2F13d',
        chainId: 2046399126,
        explorer: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
        label: 'SKALE Europa',
    },
};

const DEFAULT_CHAIN_KEY = NETWORK === 'mainnet' ? 'base' : 'base-sepolia';
const DEFAULT_CHAIN = CHAINS[DEFAULT_CHAIN_KEY];

function getChainConfig(chainKey) {
    return CHAINS[chainKey] || CHAINS[DEFAULT_CHAIN_KEY];
}

// Backward-compat aliases
const RPC_URL = DEFAULT_CHAIN.rpcUrl;
const USDC_CONTRACT = DEFAULT_CHAIN.usdcContract;
const EXPLORER_URL = DEFAULT_CHAIN.explorer;
const NETWORK_LABEL = DEFAULT_CHAIN.label;

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- SECURITY HEADERS (Helmet) ---
app.use(helmet({
    contentSecurityPolicy: false, // Dashboard uses inline scripts
    crossOriginEmbedderPolicy: false,
}));

// --- CORS (whitelist strict — localhost only in dev) ---
const PROD_ORIGINS = [
    process.env.FRONTEND_URL,
    'https://x402bazaar.org',
    'https://www.x402bazaar.org',
    'https://x402-frontend-one.vercel.app',
].filter(Boolean);

const DEV_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
];

const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
    ? PROD_ORIGINS
    : [...PROD_ORIGINS, ...DEV_ORIGINS];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, agents, server-to-server)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error('CORS not allowed'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Payment-TxHash', 'X-Payment-Chain']
}));

// --- BODY LIMITS ---
app.use(express.json({ limit: '10kb' }));

// --- RATE LIMITING ---
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    message: { error: 'Too many requests', message: 'Rate limit exceeded. Try again in 15 minutes.' }
});

const dashboardApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Dashboard API rate limit exceeded.' }
});

const paidEndpointLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 min
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Rate limit exceeded. Try again in 1 minute.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Registration rate limit exceeded. Try again in 1 hour.' }
});

app.use(generalLimiter);

// --- REQUEST LOGGING ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`;
        if (res.statusCode >= 500) {
            console.error(log);
        } else if (res.statusCode >= 400) {
            console.warn(log);
        } else {
            console.log(log);
        }
    });
    next();
});

// --- Cache des paiements vérifiés (mémoire + Supabase persisté) ---
const verifiedPayments = new Set();

async function isTxAlreadyUsed(txHash) {
    // Check memory cache first
    if (verifiedPayments.has(txHash)) return true;
    // Check Supabase
    const { data } = await supabase
        .from('used_transactions')
        .select('tx_hash')
        .eq('tx_hash', txHash)
        .limit(1);
    if (data && data.length > 0) {
        verifiedPayments.add(txHash); // warm cache
        return true;
    }
    return false;
}

async function markTxUsed(txHash, action) {
    verifiedPayments.add(txHash);
    await supabase.from('used_transactions').insert([{ tx_hash: txHash, action }]).select();
}

// --- Activity log (persisté dans Supabase) ---
async function logActivity(type, detail, amount = 0, txHash = null) {
    const entry = {
        type,
        detail,
        amount,
    };
    if (txHash) entry.tx_hash = txHash;

    try {
        await supabase.from('activity').insert([entry]);
    } catch (err) {
        console.error('[Activity] Erreur insert:', err.message);
    }
}

// --- VÉRIFICATION ON-CHAIN ---
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const RPC_TIMEOUT = 10000; // 10s

function fetchWithTimeout(url, options, timeout = RPC_TIMEOUT) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), timeout))
    ]);
}

async function verifyPayment(txHash, minAmount, chainKey = DEFAULT_CHAIN_KEY) {
    const chain = getChainConfig(chainKey);
    // Normalize tx hash
    const normalizedTxHash = txHash.toLowerCase().trim();
    if (normalizedTxHash.length !== 66) {
        throw new Error('Invalid transaction hash length');
    }

    const serverAddress = process.env.WALLET_ADDRESS.toLowerCase();

    // 1. Récupérer le reçu de transaction
    const receiptRes = await fetchWithTimeout(chain.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getTransactionReceipt',
            params: [normalizedTxHash], id: 1
        })
    });
    const { result: receipt } = await receiptRes.json();

    if (!receipt || receipt.status !== '0x1') {
        console.log(`[x402] Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: échouée ou introuvable`);
        return false;
    }

    // 2. Vérifier les Transfer ERC20 (USDC) vers notre wallet
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receipt.logs) {
        if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
            // SECURITY: Verify the log is from the correct USDC contract
            if (log.address.toLowerCase() !== chain.usdcContract.toLowerCase()) {
                continue; // Skip transfers from other tokens
            }
            const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
            if (toAddress === serverAddress) {
                const amount = BigInt(log.data);
                if (amount >= BigInt(minAmount)) {
                    console.log(`[x402] Paiement USDC vérifié on ${chain.label}: ${Number(amount) / 1e6} USDC`);
                    return true;
                }
            }
        }
    }

    // 3. REMOVED: Native ETH fallback (SECURITY: System is USDC-only)
    // The following code previously accepted ANY native ETH transfer (even 1 wei) as valid payment.
    // This is a security vulnerability - the system is designed for USDC payments only.
    /*
    const txRes = await fetchWithTimeout(chain.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getTransactionByHash',
            params: [normalizedTxHash], id: 2
        })
    });
    const { result: tx } = await txRes.json();

    if (tx && tx.to && tx.to.toLowerCase() === serverAddress) {
        const value = BigInt(tx.value);
        if (value > 0n) {
            console.log(`[x402] Paiement natif vérifié on ${chain.label}: ${Number(value) / 1e18}`);
            return true;
        }
    }
    */

    console.log(`[x402] Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: paiement non reconnu ou insuffisant`);
    return false;
}

// --- MIDDLEWARE DE PAIEMENT PARAMÉTRABLE ---
function paymentMiddleware(minAmountRaw, displayAmount, displayLabel) {
    return async (req, res, next) => {
        const txHash = req.headers['x-payment-txhash'];
        const chainKey = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

        // Validate chain key
        if (!CHAINS[chainKey]) {
            return res.status(400).json({
                error: 'Invalid chain',
                message: `Unsupported chain: ${chainKey}. Accepted: ${Object.keys(CHAINS).join(', ')}`
            });
        }

        if (!txHash) {
            console.log(`[x402] 402 → ${req.method} ${req.path} (${displayLabel})`);
            logActivity('402', `${displayLabel} - paiement demandé`);

            // Build available networks list based on environment
            const availableNetworks = Object.entries(CHAINS)
                .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
                .map(([key, cfg]) => ({
                    network: key,
                    chainId: cfg.chainId,
                    label: cfg.label,
                    usdc_contract: cfg.usdcContract,
                    explorer: cfg.explorer,
                    gas: key === 'skale' ? 'FREE (sFUEL)' : '~$0.001',
                }));

            return res.status(402).json({
                error: "Payment Required",
                message: `Cette action coûte ${displayAmount} USDC. Envoyez le paiement puis fournissez le hash dans le header X-Payment-TxHash.`,
                payment_details: {
                    amount: displayAmount,
                    currency: "USDC",
                    // Backward compat: default network fields
                    network: DEFAULT_CHAIN_KEY,
                    chainId: DEFAULT_CHAIN.chainId,
                    // Multi-chain: all accepted networks
                    networks: availableNetworks,
                    recipient: process.env.WALLET_ADDRESS,
                    accepted: ["USDC", "ETH"],
                    action: displayLabel
                }
            });
        }

        // Validate tx hash format
        if (!TX_HASH_REGEX.test(txHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash format' });
        }

        // Anti-replay: check if tx already used (prefix with chain for disambiguation)
        const replayKey = `${chainKey}:${txHash}`;
        try {
            // Check both prefixed and unprefixed forms for backward compat
            const alreadyUsed = await isTxAlreadyUsed(txHash) || await isTxAlreadyUsed(replayKey);
            if (alreadyUsed) {
                console.log(`[x402] Replay blocked for tx ${txHash.slice(0, 10)}... on ${chainKey}`);
                return res.status(402).json({
                    error: "Payment Required",
                    message: "This transaction has already been used. Please send a new payment."
                });
            }
        } catch (err) {
            console.error('[x402] Anti-replay check error:', err.message);
            // SECURITY: Fail closed - reject request if anti-replay check fails
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Payment verification system error. Please retry.'
            });
        }

        // Vérification on-chain (chain-specific RPC)
        try {
            const valid = await verifyPayment(txHash, minAmountRaw, chainKey);
            if (valid) {
                await markTxUsed(replayKey, displayLabel);
                const chainLabel = getChainConfig(chainKey).label;
                logActivity('payment', `${displayLabel} - ${displayAmount} USDC vérifié on ${chainLabel}`, displayAmount, txHash);
                return next();
            }
        } catch (err) {
            console.error(`[x402] Erreur de vérification on ${chainKey}:`, err.message);
        }

        return res.status(402).json({
            error: "Payment Required",
            message: "Transaction invalide ou paiement insuffisant.",
            tx_provided: txHash,
            chain: chainKey
        });
    };
}

// ============================================================
// ROUTES
// ============================================================

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    const supportedNetworks = Object.entries(CHAINS)
        .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
        .map(([key, cfg]) => ({ network: key, label: cfg.label, chainId: cfg.chainId }));
    res.json({ status: 'ok', network: NETWORK_LABEL, networks: supportedNetworks, timestamp: new Date().toISOString() });
});

// --- ROUTE PUBLIQUE (Gratuite) ---
app.get('/', async (req, res) => {
    const { count } = await supabase.from('services').select('*', { count: 'exact', head: true });
    res.json({
        name: "x402 Bazaar",
        description: "Place de marché autonome de services IA - Protocole x402",
        network: NETWORK_LABEL,
        total_services: count || 0,
        endpoints: {
            "GET /services":  "Liste complète des services (0.05 USDC)",
            "GET /search?q=": "Recherche de services par mot-clé (0.05 USDC)",
            "POST /register": "Enregistrer un nouveau service (1 USDC)",
            "GET /api/search?q=": "Clean web search results for LLMs (0.005 USDC)",
            "GET /api/scrape?url=": "Universal URL scraper - returns clean Markdown (0.005 USDC)",
            "GET /api/twitter?user=|tweet=|search=": "Twitter/X profiles, tweets, and search (0.005 USDC)",
            "GET /api/weather?city=": "Weather data for any city (0.02 USDC)",
            "GET /api/crypto?coin=": "Cryptocurrency prices (0.02 USDC)",
            "GET /api/joke": "Random joke (0.01 USDC)",
            "GET /api/image?prompt=": "AI image generation via DALL-E 3 (0.05 USDC)"
        },
        protocol: "x402 - HTTP 402 Payment Required"
    });
});

// --- LISTE DES SERVICES (0.05 USDC) ---
app.get('/services', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Lister les services"), async (req, res) => {
    const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Supabase] /services error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch services' });
    }

    res.json({
        success: true,
        count: data.length,
        data
    });
});

// --- RECHERCHE DE SERVICES (0.05 USDC) ---
app.get('/search', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Rechercher un service"), async (req, res) => {
    const query = (req.query.q || '').trim().slice(0, 100);

    if (!query) {
        return res.status(400).json({ error: "Paramètre 'q' requis. Ex: /search?q=weather" });
    }

    // Reject control characters and null bytes
    if (/[\x00-\x1F\x7F]/.test(query)) {
        return res.status(400).json({ error: 'Invalid characters in query' });
    }

    // Sanitize: escape special Postgres LIKE characters
    const sanitized = query.replace(/[%_\\]/g, '\\$&');

    // Recherche floue sur name et description
    const { data, error } = await supabase
        .from('services')
        .select('*')
        .or(`name.ilike.%${sanitized}%,description.ilike.%${sanitized}%`);

    if (error) {
        console.error('[Supabase] /search error:', error.message);
        return res.status(500).json({ error: 'Search failed' });
    }

    logActivity('search', `Recherche "${query}" → ${data.length} résultat(s)`);

    res.json({
        success: true,
        query,
        count: data.length,
        data
    });
});

// --- ENREGISTREMENT D'UN SERVICE (1 USDC) ---
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const URL_REGEX = /^https?:\/\/.+/;

app.post('/register', registerLimiter, paymentMiddleware(1000000, 1, "Enregistrer un service"), async (req, res) => {
    const { name, description, url, price, tags, ownerAddress } = req.body;
    const txHash = req.headers['x-payment-txhash'] || null;

    // Validation
    if (!name || !url || !price || !ownerAddress) {
        return res.status(400).json({
            error: "Champs requis manquants",
            required: { name: "string", url: "string", price: "number (ex: 0.10)", ownerAddress: "string (wallet)" },
            optional: { description: "string", tags: "string[]" }
        });
    }

    // Type & format validation
    if (typeof name !== 'string' || name.length > 200) {
        return res.status(400).json({ error: 'name must be a string (max 200 chars)' });
    }
    if (typeof url !== 'string' || !URL_REGEX.test(url) || url.length > 500) {
        return res.status(400).json({ error: 'url must be a valid HTTP(S) URL (max 500 chars)' });
    }
    if (typeof price !== 'number' || price < 0 || price > 1000) {
        return res.status(400).json({ error: 'price must be a number between 0 and 1000' });
    }
    if (typeof ownerAddress !== 'string' || !WALLET_REGEX.test(ownerAddress)) {
        return res.status(400).json({ error: 'ownerAddress must be a valid Ethereum address (0x...)' });
    }
    if (description && (typeof description !== 'string' || description.length > 1000)) {
        return res.status(400).json({ error: 'description must be a string (max 1000 chars)' });
    }
    if (tags && (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== 'string' || t.length > 50))) {
        return res.status(400).json({ error: 'tags must be an array of strings (max 10 tags, 50 chars each)' });
    }

    const insertData = {
        name: name.trim(),
        description: (description || '').trim(),
        url: url.trim(),
        price_usdc: price,
        owner_address: ownerAddress,
        tags: tags || []
    };
    if (txHash) insertData.tx_hash = txHash;

    const { data, error } = await supabase
        .from('services')
        .insert([insertData])
        .select();

    if (error) {
        console.error('[Supabase] /register error:', error.message);
        return res.status(500).json({ error: 'Registration failed' });
    }

    console.log(`[Bazaar] Nouveau service enregistré : "${name}" (${data[0].id})`);
    logActivity('register', `Nouveau service : "${name}" (${data[0].id.slice(0, 8)})`);

    res.status(201).json({
        success: true,
        message: `Service "${name}" enregistré avec succès !`,
        data: data[0]
    });
});

// ============================================================
// API WRAPPERS (Real external APIs proxied via x402)
// ============================================================

// --- WEATHER API WRAPPER (0.02 USDC) ---
app.get('/api/weather', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Weather API"), async (req, res) => {
    const city = (req.query.city || '').trim().slice(0, 100);

    if (!city) {
        return res.status(400).json({ error: "Parameter 'city' required. Ex: /api/weather?city=Paris" });
    }

    // Sanitize: reject control characters
    if (/[\x00-\x1F\x7F]/.test(city)) {
        return res.status(400).json({ error: 'Invalid characters in city name' });
    }

    try {
        // Step 1: Geocode city name using Open-Meteo Geocoding API
        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
        const geocodeRes = await fetchWithTimeout(geocodeUrl, {}, 5000);
        const geocodeData = await geocodeRes.json();

        if (!geocodeData.results || geocodeData.results.length === 0) {
            return res.status(404).json({ error: 'City not found', city });
        }

        const location = geocodeData.results[0];
        const { latitude, longitude, name, country } = location;

        // Step 2: Get current weather using Open-Meteo Weather API
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`;
        const weatherRes = await fetchWithTimeout(weatherUrl, {}, 5000);
        const weatherData = await weatherRes.json();

        if (!weatherData.current_weather) {
            return res.status(500).json({ error: 'Failed to fetch weather data' });
        }

        const current = weatherData.current_weather;

        logActivity('api_call', `Weather API: ${city} -> ${name}, ${country}`);

        res.json({
            success: true,
            city: name,
            country: country || 'Unknown',
            temperature: current.temperature,
            wind_speed: current.windspeed,
            weather_code: current.weathercode,
            time: current.time
        });
    } catch (err) {
        console.error('[Weather API] Error:', err.message);
        return res.status(500).json({ error: 'Weather API request failed' });
    }
});

// --- CRYPTO PRICE API WRAPPER (0.02 USDC) ---
app.get('/api/crypto', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Crypto Price API"), async (req, res) => {
    const coin = (req.query.coin || '').trim().toLowerCase().slice(0, 50);

    if (!coin) {
        return res.status(400).json({ error: "Parameter 'coin' required. Ex: /api/crypto?coin=bitcoin" });
    }

    // Sanitize: reject control characters
    if (/[\x00-\x1F\x7F]/.test(coin)) {
        return res.status(400).json({ error: 'Invalid characters in coin name' });
    }

    try {
        // CoinGecko free API (no key needed)
        const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,eur&include_24hr_change=true`;
        const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
        const data = await apiRes.json();

        if (!data[coin]) {
            return res.status(404).json({ error: 'Cryptocurrency not found', coin });
        }

        const prices = data[coin];

        logActivity('api_call', `Crypto Price API: ${coin}`);

        res.json({
            success: true,
            coin,
            usd: prices.usd,
            eur: prices.eur,
            usd_24h_change: prices.usd_24h_change || 0
        });
    } catch (err) {
        console.error('[Crypto API] Error:', err.message);
        return res.status(500).json({ error: 'Crypto API request failed' });
    }
});

// --- RANDOM JOKE API WRAPPER (0.01 USDC) ---
app.get('/api/joke', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Random Joke API"), async (req, res) => {
    try {
        // Official Joke API (free, no key needed)
        const apiUrl = 'https://official-joke-api.appspot.com/random_joke';
        const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
        const data = await apiRes.json();

        if (!data.setup || !data.punchline) {
            return res.status(500).json({ error: 'Invalid joke data received' });
        }

        logActivity('api_call', `Random Joke API: ${data.type || 'general'}`);

        res.json({
            success: true,
            setup: data.setup,
            punchline: data.punchline,
            type: data.type || 'general'
        });
    } catch (err) {
        console.error('[Joke API] Error:', err.message);
        return res.status(500).json({ error: 'Joke API request failed' });
    }
});

// --- WEB SEARCH API WRAPPER (0.005 USDC) ---
app.get('/api/search', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Web Search API"), async (req, res) => {
    const query = (req.query.q || '').trim().slice(0, 200);

    if (!query) {
        return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/search?q=bitcoin+price" });
    }

    if (/[\x00-\x1F\x7F]/.test(query)) {
        return res.status(400).json({ error: 'Invalid characters in query' });
    }

    // SECURITY: Prevent negative values for max parameter
    const maxResults = Math.min(Math.max(1, parseInt(req.query.max) || 10), 20);

    try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const searchRes = await fetchWithTimeout(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
        }, 8000);
        const html = await searchRes.text();

        const $ = cheerio.load(html);
        const results = [];

        $('.result').each((i, el) => {
            if (results.length >= maxResults) return false;
            const $el = $(el);
            const title = $el.find('.result__a').text().trim();
            const snippet = $el.find('.result__snippet').text().trim();
            const rawHref = $el.find('.result__a').attr('href') || '';

            // DuckDuckGo uses redirect links (uddg param) or protocol-relative URLs
            let url = rawHref;
            try {
                const parsed = new URL(rawHref, 'https://duckduckgo.com');
                url = parsed.searchParams.get('uddg') || rawHref;
            } catch {}
            if (url.startsWith('//')) url = 'https:' + url;

            if (title && url) {
                results.push({ title, url, snippet });
            }
        });

        logActivity('api_call', `Web Search API: "${query}" -> ${results.length} results`);

        res.json({
            success: true,
            query,
            results_count: results.length,
            results
        });
    } catch (err) {
        console.error('[Search API] Error:', err.message);
        return res.status(500).json({ error: 'Search API request failed' });
    }
});

// --- UNIVERSAL SCRAPER API WRAPPER (0.005 USDC) ---
app.get('/api/scrape', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Universal Scraper API"), async (req, res) => {
    const targetUrl = (req.query.url || '').trim();

    if (!targetUrl) {
        return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/scrape?url=https://example.com" });
    }

    // Validate URL
    let parsed;
    try {
        parsed = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
        }
    } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    // SECURITY: Block internal/private IPs and cloud metadata endpoints
    const blockedHostname = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\]|\[::ffff:)/i;
    if (blockedHostname.test(parsed.hostname)) {
        return res.status(400).json({ error: 'Internal URLs not allowed' });
    }

    try {
        const pageRes = await fetchWithTimeout(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' },
            redirect: 'follow',
        }, 10000);

        // SECURITY: Check Content-Length header before downloading
        const contentLength = parseInt(pageRes.headers.get('content-length') || '0');
        if (contentLength > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Page too large (max 5MB)' });
        }

        const contentType = pageRes.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
            return res.status(400).json({ error: 'URL does not return HTML or text content', content_type: contentType });
        }

        const html = await pageRes.text();

        // Limit input size (5MB max) - double check after download
        if (html.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Page too large (max 5MB)' });
        }

        const $ = cheerio.load(html);

        // Remove noise elements
        $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"], .sidebar, .menu, .nav, .footer, .header, .ad, .ads, .advertisement').remove();

        // Extract metadata
        const title = $('title').text().trim() || $('h1').first().text().trim() || '';
        const metaDesc = $('meta[name="description"]').attr('content') || '';

        // Get main content (prefer article/main, fallback to body)
        let contentHtml = $('article').html() || $('main').html() || $('[role="main"]').html() || $('body').html() || '';

        // Convert HTML to Markdown
        const turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            linkStyle: 'inlined',
        });
        turndown.remove(['img', 'figure', 'picture']); // Remove images for clean text
        // Fix protocol-relative URLs in links
        turndown.addRule('fixProtocolRelativeUrls', {
            filter: 'a',
            replacement: (content, node) => {
                let href = node.getAttribute('href') || '';
                if (href.startsWith('//')) href = 'https:' + href;
                return content ? `[${content}](${href})` : '';
            }
        });

        let markdown = turndown.turndown(contentHtml);

        // Clean up: remove excessive whitespace
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

        // Truncate to reasonable size (50K chars max)
        if (markdown.length > 50000) {
            markdown = markdown.slice(0, 50000) + '\n\n[...truncated]';
        }

        logActivity('api_call', `Scraper API: ${parsed.hostname} -> ${markdown.length} chars`);

        res.json({
            success: true,
            url: targetUrl,
            title,
            description: metaDesc,
            content: markdown,
            content_length: markdown.length
        });
    } catch (err) {
        console.error('[Scraper API] Error:', err.message);
        return res.status(500).json({ error: 'Scraper API request failed' });
    }
});

// --- TWITTER/X DATA API WRAPPER (0.005 USDC) ---
app.get('/api/twitter', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Twitter/X Data API"), async (req, res) => {
    const username = (req.query.user || '').trim().replace(/^@/, '').slice(0, 50);
    const tweetUrl = (req.query.tweet || '').trim();
    const searchQuery = (req.query.search || '').trim().slice(0, 200);
    const maxResults = Math.min(Math.max(parseInt(req.query.max) || 10, 1), 20);

    if (!username && !tweetUrl && !searchQuery) {
        return res.status(400).json({
            error: "Parameter 'user', 'tweet', or 'search' required.",
            examples: [
                "/api/twitter?user=elonmusk",
                "/api/twitter?tweet=https://x.com/user/status/123456789",
                "/api/twitter?search=bitcoin&max=10"
            ]
        });
    }

    // Sanitize
    if (username && !/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
        return res.status(400).json({ error: 'Invalid Twitter username format' });
    }
    if (searchQuery && /[\x00-\x1F\x7F]/.test(searchQuery)) {
        return res.status(400).json({ error: 'Invalid characters in search query' });
    }

    try {
        // Tweet search via DuckDuckGo site:twitter.com
        if (searchQuery) {
            const ddgUrl = `https://html.duckduckgo.com/html/?q=site%3Atwitter.com+${encodeURIComponent(searchQuery)}`;
            const ddgRes = await fetchWithTimeout(ddgUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
            }, 10000);
            const ddgHtml = await ddgRes.text();

            const $ = cheerio.load(ddgHtml);
            const results = [];

            $('.result').each((i, el) => {
                if (results.length >= maxResults) return false;

                const linkEl = $(el).find('.result__a');
                const snippetEl = $(el).find('.result__snippet');
                const url = linkEl.attr('href') || '';
                const title = linkEl.text().trim();
                const snippet = snippetEl.text().trim();

                // Only keep results that are actual twitter/x.com URLs
                if (url && (url.includes('twitter.com') || url.includes('x.com'))) {
                    // Try to extract author from URL pattern (/username/status/...)
                    const authorMatch = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
                    const author = authorMatch ? authorMatch[1] : null;

                    results.push({
                        title,
                        text: snippet,
                        url,
                        author: author !== 'search' && author !== 'hashtag' ? author : null,
                    });
                }
            });

            logActivity('api_call', `Twitter API: search "${searchQuery}" -> ${results.length} results`);

            return res.json({
                success: true,
                type: 'search',
                query: searchQuery,
                results_count: results.length,
                results,
            });
        }

        if (tweetUrl) {
            // Extract tweet ID from URL
            const tweetMatch = tweetUrl.match(/status\/(\d+)/);
            if (!tweetMatch) {
                return res.status(400).json({ error: 'Invalid tweet URL. Expected format: https://x.com/user/status/123456789' });
            }
            const tweetId = tweetMatch[1];

            // Use fxtwitter API for tweet data
            const apiUrl = `https://api.fxtwitter.com/x/status/${tweetId}`;
            const apiRes = await fetchWithTimeout(apiUrl, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 8000);
            const data = await apiRes.json();

            if (!data.tweet) {
                return res.status(404).json({ error: 'Tweet not found or unavailable' });
            }

            const tweet = data.tweet;
            logActivity('api_call', `Twitter API: tweet ${tweetId}`);

            res.json({
                success: true,
                type: 'tweet',
                tweet: {
                    id: tweet.id,
                    text: tweet.text,
                    created_at: tweet.created_at,
                    likes: tweet.likes,
                    retweets: tweet.retweets,
                    replies: tweet.replies,
                    views: tweet.views,
                    author: {
                        name: tweet.author?.name,
                        username: tweet.author?.screen_name,
                        followers: tweet.author?.followers,
                        verified: tweet.author?.verified,
                    },
                    media: tweet.media?.photos?.map(p => p.url) || [],
                    url: tweet.url
                }
            });
        } else {
            // Profile lookup via fxtwitter
            const apiUrl = `https://api.fxtwitter.com/${username}`;
            const apiRes = await fetchWithTimeout(apiUrl, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 8000);
            const data = await apiRes.json();

            if (!data.user && !data.tweet) {
                // fxtwitter might return last tweet instead of profile
                // Try syndication API as fallback for profile data
                const synUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`;
                const synRes = await fetchWithTimeout(synUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
                }, 8000);
                const synHtml = await synRes.text();

                // Extract profile info from syndication HTML
                const $s = cheerio.load(synHtml);
                const profileName = $s('[data-testid="UserName"]').text().trim() || username;

                // Extract recent tweets from timeline
                const tweets = [];
                $s('[data-testid="tweet"]').each((i, el) => {
                    if (tweets.length >= 5) return false;
                    const tweetText = $s(el).find('[data-testid="tweetText"]').text().trim();
                    if (tweetText) tweets.push(tweetText);
                });

                logActivity('api_call', `Twitter API: profile @${username} (syndication)`);

                return res.json({
                    success: true,
                    type: 'profile',
                    user: {
                        username,
                        name: profileName,
                        recent_tweets: tweets,
                        source: 'syndication'
                    }
                });
            }

            // fxtwitter returned data (might be user's latest tweet)
            const user = data.user || data.tweet?.author;
            logActivity('api_call', `Twitter API: profile @${username}`);

            res.json({
                success: true,
                type: 'profile',
                user: {
                    username: user?.screen_name || username,
                    name: user?.name,
                    description: user?.description,
                    followers: user?.followers,
                    following: user?.following,
                    tweets_count: user?.tweets,
                    verified: user?.verified,
                    avatar: user?.avatar_url,
                    banner: user?.banner_url,
                },
                latest_tweet: data.tweet ? {
                    text: data.tweet.text,
                    created_at: data.tweet.created_at,
                    likes: data.tweet.likes,
                    retweets: data.tweet.retweets,
                } : null
            });
        }
    } catch (err) {
        console.error('[Twitter API] Error:', err.message);
        return res.status(500).json({ error: 'Twitter API request failed' });
    }
});

// --- IMAGE GENERATION API (DALL-E 3) - 0.05 USDC ---
const IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024'];
const IMAGE_QUALITIES = ['standard', 'hd'];

app.get('/api/image', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Image Generation API"), async (req, res) => {
    try {
        const prompt = (req.query.prompt || '').trim();
        const size = (req.query.size || '1024x1024').trim();
        const quality = (req.query.quality || 'standard').trim();

        // Validate prompt
        if (!prompt) {
            return res.status(400).json({ error: "Parameter 'prompt' is required. Ex: /api/image?prompt=a+cat+in+space" });
        }
        if (prompt.length > 1000) {
            return res.status(400).json({ error: 'Prompt too long (max 1000 characters)' });
        }
        // Reject control characters
        if (/[\x00-\x1F\x7F]/.test(prompt)) {
            return res.status(400).json({ error: 'Invalid characters in prompt' });
        }

        // Validate size
        if (!IMAGE_SIZES.includes(size)) {
            return res.status(400).json({
                error: `Invalid size. Accepted: ${IMAGE_SIZES.join(', ')}`,
            });
        }

        // Validate quality
        if (!IMAGE_QUALITIES.includes(quality)) {
            return res.status(400).json({
                error: `Invalid quality. Accepted: ${IMAGE_QUALITIES.join(', ')}`,
            });
        }

        // Call DALL-E 3
        const response = await getOpenAI().images.generate({
            model: 'dall-e-3',
            prompt,
            size,
            quality,
            n: 1,
        });

        const image = response.data[0];

        logActivity('api_call', `Image API: "${prompt.slice(0, 80)}..." (${size}, ${quality})`);

        res.json({
            success: true,
            prompt,
            revised_prompt: image.revised_prompt,
            image_url: image.url,
            size,
            quality,
        });
    } catch (err) {
        console.error('[Image API] Error:', err.message);

        // Handle specific OpenAI errors
        if (err.status === 400 || err.code === 'content_policy_violation') {
            return res.status(400).json({
                error: 'Content policy violation',
                message: 'Your prompt was rejected by the content safety system. Please modify your prompt.',
            });
        }
        if (err.status === 429) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                message: 'OpenAI rate limit reached. Please try again in a few seconds.',
            });
        }

        return res.status(500).json({ error: 'Image generation failed' });
    }
});

// ============================================================
// DASHBOARD
// ============================================================

const path = require('path');

// Servir le dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API stats (gratuit, pour le dashboard)
app.get('/api/stats', dashboardApiLimiter, async (req, res) => {
    const { count } = await supabase.from('services').select('*', { count: 'exact', head: true });

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
        const { result } = await balRes.json();
        if (result) walletBalance = Number(BigInt(result)) / 1e6;
    } catch { /* ignore */ }

    const walletAddr = process.env.WALLET_ADDRESS;
    res.json({
        totalServices: count || 0,
        totalPayments,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        walletBalance,
        wallet: walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : null,
        network: NETWORK_LABEL,
        explorer: EXPLORER_URL
    });
});

// API services (gratuit, pour le dashboard)
app.get('/api/services', dashboardApiLimiter, async (req, res) => {
    const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[Supabase] /api/services error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch services' });
    }
    res.json(data);
});

// API activity log (gratuit, pour le dashboard — persisté Supabase)
app.get('/api/activity', dashboardApiLimiter, async (req, res) => {
    const { data, error } = await supabase
        .from('activity')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('[Supabase] /api/activity error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch activity' });
    }

    // Mapper pour compatibilité dashboard (time, txHash)
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
app.get('/api/services/activity', dashboardApiLimiter, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('activity')
            .select('detail, created_at')
            .eq('type', 'api_call')
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) {
            console.error('[Supabase] /api/services/activity error:', error.message);
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
        console.error('[Activity] Error:', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// --- HEALTH CHECK (service URLs) ---
const healthCache = new Map();
const HEALTH_TTL = 10 * 60 * 1000; // 10 minutes

app.get('/api/health-check', dashboardApiLimiter, async (req, res) => {
    try {
        // Fetch all services
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
        console.error('[Health Check] Error:', err.message);
        res.status(500).json({ error: 'Health check failed' });
    }
});

// --- ANALYTICS (aggregated data for charts) ---
app.get('/api/analytics', dashboardApiLimiter, async (req, res) => {
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
            // Extract endpoint name from detail
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

        res.json({
            dailyVolume,
            topServices,
            cumulativeRevenue,
            totals: {
                revenue: Math.round(totalRevenue * 100) / 100,
                transactions: totalTransactions,
                services: servicesCount || 0,
            },
        });
    } catch (err) {
        console.error('[Analytics] Error:', err.message);
        res.status(500).json({ error: 'Analytics failed' });
    }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    console.error(err.stack || err.message || err);
    logActivity('error', `${req.method} ${req.originalUrl} → Internal error`);
    res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: 'Something went wrong'
    });
});

// --- LANCEMENT ---
app.listen(PORT, async () => {
    const { count } = await supabase.from('services').select('*', { count: 'exact', head: true });
    const maskedWallet = process.env.WALLET_ADDRESS
        ? `${process.env.WALLET_ADDRESS.slice(0, 6)}...${process.env.WALLET_ADDRESS.slice(-4)}`
        : 'NOT SET';
    const activeNetworks = Object.entries(CHAINS)
        .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
        .map(([, cfg]) => cfg.label).join(', ');
    console.log(`\n🚀 x402 Bazaar actif sur http://localhost:${PORT}`);
    console.log(`💰 Wallet : ${maskedWallet}`);
    console.log(`🔗 Réseaux : ${activeNetworks} (${NETWORK})`);
    console.log(`🗄️  Base   : Supabase (PostgreSQL)`);
    console.log(`📦 Services enregistrés : ${count || 0}`);
    console.log(`\n   GET  /                → Infos (gratuit)`);
    console.log(`   GET  /services        → Liste (0.05 USDC)`);
    console.log(`   GET  /search?q=       → Recherche (0.05 USDC)`);
    console.log(`   POST /register        → Enregistrement (1 USDC)`);
    console.log(`\n   🌐 API Wrappers:`);
    console.log(`   GET  /api/search?q=     → Clean web search (0.005 USDC)`);
    console.log(`   GET  /api/scrape?url=   → URL to Markdown (0.005 USDC)`);
    console.log(`   GET  /api/twitter       → Twitter/X data+search (0.005 USDC)`);
    console.log(`   GET  /api/weather?city= → Weather data (0.02 USDC)`);
    console.log(`   GET  /api/crypto?coin=  → Crypto prices (0.02 USDC)`);
    console.log(`   GET  /api/joke          → Random joke (0.01 USDC)`);
    console.log(`   GET  /api/image?prompt= → AI image generation (0.05 USDC)`);
    console.log(`\n   📊 Dashboard : http://localhost:${PORT}/dashboard\n`);
});
