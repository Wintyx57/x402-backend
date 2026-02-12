require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const logger = require('./lib/logger');
const { NETWORK, NETWORK_LABEL, CHAINS, DEFAULT_CHAIN_KEY } = require('./lib/chains');
const { createActivityLogger } = require('./lib/activity');
const { createPaymentSystem } = require('./lib/payment');

// --- Route factories ---
const createHealthRouter = require('./routes/health');
const createServicesRouter = require('./routes/services');
const createRegisterRouter = require('./routes/register');
const createDashboardRouter = require('./routes/dashboard');
const createWrappersRouter = require('./routes/wrappers');

// --- VALIDATION ENV VARS ---
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY', 'WALLET_ADDRESS'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        logger.error('Init', `FATAL: Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

// --- Lazy OpenAI client ---
let _openai = null;
function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- Activity logger ---
const logActivity = createActivityLogger(supabase);

// --- Payment system ---
const { paymentMiddleware } = createPaymentSystem(supabase, logActivity);

// --- Express app ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- SECURITY HEADERS (Helmet) ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "https:"],
            connectSrc: ["*"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// --- COMPRESSION ---
app.use(compression());

// --- CORS (whitelist strict) ---
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
    windowMs: 15 * 60 * 1000,
    max: 200,
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
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Rate limit exceeded. Try again in 1 minute.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Registration rate limit exceeded. Try again in 1 hour.' }
});

app.use(generalLimiter);

// --- ADMIN AUTH MIDDLEWARE ---
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!process.env.ADMIN_TOKEN) {
        return next();
    }
    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid X-Admin-Token header required.' });
    }
    next();
}

// --- REQUEST LOGGING ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`;
        if (res.statusCode >= 500) {
            logger.error('HTTP', log);
        } else if (res.statusCode >= 400) {
            logger.warn('HTTP', log);
        } else {
            logger.info('HTTP', log);
        }
    });
    next();
});

// ============================================================
// MOUNT ROUTES
// ============================================================

app.use(createHealthRouter(supabase));
app.use(createServicesRouter(supabase, logActivity, paymentMiddleware, paidEndpointLimiter, dashboardApiLimiter));
app.use(createRegisterRouter(supabase, logActivity, paymentMiddleware, registerLimiter));
app.use(createDashboardRouter(supabase, adminAuth, dashboardApiLimiter));
app.use(createWrappersRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    logger.error('Global', `${req.method} ${req.originalUrl}`);
    logger.error('Global', err.stack || err.message || err);
    logActivity('error', `${req.method} ${req.originalUrl} -> Internal error`);
    res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: 'Something went wrong'
    });
});

// --- STARTUP ---
const serverInstance = app.listen(PORT, async () => {
    let count = 0;
    try {
        const result = await supabase.from('services').select('*', { count: 'exact', head: true });
        count = result.count || 0;
    } catch { /* ignore */ }
    const maskedWallet = process.env.WALLET_ADDRESS
        ? `${process.env.WALLET_ADDRESS.slice(0, 6)}...${process.env.WALLET_ADDRESS.slice(-4)}`
        : 'NOT SET';
    const activeNetworks = Object.entries(CHAINS)
        .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
        .map(([, cfg]) => cfg.label).join(', ');
    console.log(`\nx402 Bazaar active on http://localhost:${PORT}`);
    console.log(`Wallet: ${maskedWallet}`);
    console.log(`Networks: ${activeNetworks} (${NETWORK})`);
    console.log(`Database: Supabase (PostgreSQL)`);
    console.log(`Services registered: ${count}`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard\n`);
});

// --- GRACEFUL SHUTDOWN ---
function gracefulShutdown(signal) {
    console.log(`\n[Shutdown] ${signal} received. Closing server...`);
    serverInstance.close(() => {
        console.log('[Shutdown] HTTP server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('[Shutdown] Forcing exit after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
