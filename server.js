require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Réseau configurable (testnet / mainnet) ---
const NETWORK = process.env.NETWORK || 'testnet';
const RPC_URL = NETWORK === 'mainnet'
    ? 'https://mainnet.base.org'
    : 'https://sepolia.base.org';
const USDC_CONTRACT = NETWORK === 'mainnet'
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC on Base Mainnet
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // USDC on Base Sepolia
const EXPLORER_URL = NETWORK === 'mainnet'
    ? 'https://basescan.org'
    : 'https://sepolia.basescan.org';
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'Base' : 'Base Sepolia';

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
    allowedHeaders: ['Content-Type', 'X-Payment-TxHash']
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

async function verifyPayment(txHash, minAmount) {
    // Normalize tx hash
    const normalizedTxHash = txHash.toLowerCase().trim();
    if (normalizedTxHash.length !== 66) {
        throw new Error('Invalid transaction hash length');
    }

    const serverAddress = process.env.WALLET_ADDRESS.toLowerCase();

    // 1. Récupérer le reçu de transaction
    const receiptRes = await fetchWithTimeout(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getTransactionReceipt',
            params: [normalizedTxHash], id: 1
        })
    });
    const { result: receipt } = await receiptRes.json();

    if (!receipt || receipt.status !== '0x1') {
        console.log(`[x402] Tx ${normalizedTxHash.slice(0, 18)}... : échouée ou introuvable`);
        return false;
    }

    // 2. Vérifier les Transfer ERC20 (USDC) vers notre wallet
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receipt.logs) {
        if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
            const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
            if (toAddress === serverAddress) {
                const amount = BigInt(log.data);
                if (amount >= BigInt(minAmount)) {
                    console.log(`[x402] Paiement USDC vérifié : ${Number(amount) / 1e6} USDC`);
                    return true;
                }
            }
        }
    }

    // 3. Fallback : vérifier un transfert ETH natif
    const txRes = await fetchWithTimeout(RPC_URL, {
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
            console.log(`[x402] Paiement ETH vérifié : ${Number(value) / 1e18} ETH`);
            return true;
        }
    }

    console.log(`[x402] Tx ${normalizedTxHash.slice(0, 18)}... : paiement non reconnu ou insuffisant`);
    return false;
}

// --- MIDDLEWARE DE PAIEMENT PARAMÉTRABLE ---
function paymentMiddleware(minAmountRaw, displayAmount, displayLabel) {
    return async (req, res, next) => {
        const txHash = req.headers['x-payment-txhash'];

        if (!txHash) {
            console.log(`[x402] 402 → ${req.method} ${req.path} (${displayLabel})`);
            logActivity('402', `${displayLabel} - paiement demandé`);
            return res.status(402).json({
                error: "Payment Required",
                message: `Cette action coûte ${displayAmount} USDC. Envoyez le paiement puis fournissez le hash dans le header X-Payment-TxHash.`,
                payment_details: {
                    amount: displayAmount,
                    currency: "USDC",
                    network: NETWORK === 'mainnet' ? 'base' : 'base-sepolia',
                    chainId: NETWORK === 'mainnet' ? 8453 : 84532,
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

        // Anti-replay: check if tx already used (Supabase + memory)
        try {
            const alreadyUsed = await isTxAlreadyUsed(txHash);
            if (alreadyUsed) {
                console.log(`[x402] Replay blocked for tx ${txHash.slice(0, 10)}...`);
                return res.status(402).json({
                    error: "Payment Required",
                    message: "This transaction has already been used. Please send a new payment."
                });
            }
        } catch (err) {
            console.error('[x402] Anti-replay check error:', err.message);
        }

        // Vérification on-chain
        try {
            const valid = await verifyPayment(txHash, minAmountRaw);
            if (valid) {
                await markTxUsed(txHash, displayLabel);
                logActivity('payment', `${displayLabel} - ${displayAmount} USDC vérifié`, displayAmount, txHash);
                return next();
            }
        } catch (err) {
            console.error(`[x402] Erreur de vérification :`, err.message);
        }

        return res.status(402).json({
            error: "Payment Required",
            message: "Transaction invalide ou paiement insuffisant.",
            tx_provided: txHash
        });
    };
}

// ============================================================
// ROUTES
// ============================================================

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.json({ status: 'ok', network: NETWORK_LABEL, timestamp: new Date().toISOString() });
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
            "POST /register": "Enregistrer un nouveau service (1 USDC)"
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
    console.log(`\n🚀 x402 Bazaar actif sur http://localhost:${PORT}`);
    console.log(`💰 Wallet : ${maskedWallet}`);
    console.log(`🔗 Réseau : ${NETWORK_LABEL} (${NETWORK})`);
    console.log(`🗄️  Base   : Supabase (PostgreSQL)`);
    console.log(`📦 Services enregistrés : ${count || 0}`);
    console.log(`\n   GET  /           → Infos (gratuit)`);
    console.log(`   GET  /services   → Liste (0.05 USDC)`);
    console.log(`   GET  /search?q=  → Recherche (0.05 USDC)`);
    console.log(`   POST /register   → Enregistrement (1 USDC)`);
    console.log(`\n   📊 Dashboard : http://localhost:${PORT}/dashboard\n`);
});
