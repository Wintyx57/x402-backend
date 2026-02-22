require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const logger = require('./lib/logger');
const correlationId = require('./lib/correlationId');
const { scheduleRetention } = require('./lib/retention');
const { NETWORK, NETWORK_LABEL, CHAINS, DEFAULT_CHAIN_KEY } = require('./lib/chains');
const { createActivityLogger } = require('./lib/activity');
const { createPaymentSystem } = require('./lib/payment');
const { startMonitor, stopMonitor, getStatus } = require('./lib/monitor');
const { startTelegramBot, stopTelegramBot } = require('./lib/telegram-bot');
const { BudgetManager } = require('./lib/budget');
const { startAgent, stopAgent } = require('./lib/agent-process');

// --- Route factories ---
const createHealthRouter = require('./routes/health');
const createServicesRouter = require('./routes/services');
const createRegisterRouter = require('./routes/register');
const createDashboardRouter = require('./routes/dashboard');
const createWrappersRouter = require('./routes/wrappers/index');
const createMonitoringRouter = require('./routes/monitoring');
const createBudgetRouter = require('./routes/budget');
const { createCommunityAgentRouter } = require('./routes/community-agent');
const createStreamRouter = require('./routes/stream');

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

// --- Budget Guardian (Supabase-persisted) ---
const budgetManager = new BudgetManager(supabase);

// --- Payment system (with budget integration) ---
const { paymentMiddleware } = createPaymentSystem(supabase, logActivity, budgetManager);

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
    'https://chatgpt.com',
    'https://chat.openai.com',
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
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Payment-TxHash', 'X-Payment-Chain', 'X-Agent-Wallet', 'X-Admin-Token'],
    exposedHeaders: ['X-Budget-Remaining', 'X-Budget-Used-Percent', 'X-Budget-Alert']
}));

// --- BODY LIMITS ---
app.use(express.json({ limit: '10kb' }));

// --- RATE LIMITING ---
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.headers['x-monitor'] === 'internal' || req.path.startsWith('/api/status'),
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
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-monitor'] === 'internal',
    message: { error: 'Too many requests', message: 'Rate limit exceeded. Try again in 1 minute.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Registration rate limit exceeded. Try again in 1 hour.' }
});

const adminAuthLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many requests', message: 'Too many admin auth attempts. Try again in 5 minutes.' }
});

app.use(generalLimiter);

// --- CORRELATION IDs ---
app.use(correlationId);

// --- ADMIN AUTH MIDDLEWARE ---
function adminAuth(req, res, next) {
    const expected = (process.env.ADMIN_TOKEN || '').trim();
    if (!expected) {
        return res.status(503).json({ error: 'Admin not configured', message: 'ADMIN_TOKEN environment variable is not set.' });
    }
    const token = (req.headers['x-admin-token'] || '').trim();
    if (!token || !timingSafeCompare(token, expected)) {
        logger.warn('AdminAuth', `Rejected: received ${token.length} chars, expected ${expected.length} chars`);
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid X-Admin-Token header required.' });
    }
    next();
}

// S4 — Timing-safe token comparison to prevent timing attacks
function timingSafeCompare(a, b) {
    const crypto = require('crypto');
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Compare against itself to maintain constant time, then return false
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// --- REQUEST LOGGING ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const extra = { method: req.method, url: req.originalUrl, status: res.statusCode, ms: duration, correlationId: req.correlationId };
        if (res.statusCode >= 500) {
            logger.error('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode}`, extra);
        } else if (res.statusCode >= 400) {
            logger.warn('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode}`, extra);
        } else {
            logger.info('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode}`, extra);
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
app.use(createDashboardRouter(supabase, adminAuth, dashboardApiLimiter, adminAuthLimiter));
app.use(createWrappersRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI));
app.use(createMonitoringRouter(supabase));
app.use(createBudgetRouter(budgetManager, logActivity));
app.use('/admin/community-agent', createCommunityAgentRouter(adminAuth));
app.use(createStreamRouter(adminAuth));

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
    logger.info('server', `x402 Bazaar active on http://localhost:${PORT}`, { port: PORT, wallet: maskedWallet, networks: activeNetworks, services: count });

    // Load budgets from Supabase (non-blocking — table may not exist yet)
    budgetManager.loadFromDb().catch(() => {});

    // Start monitoring (checks localhost endpoints)
    startMonitor(`http://localhost:${PORT}`, supabase);

    // Start Telegram bot (interactive commands)
    startTelegramBot(supabase, getStatus);

    // Start Community Agent companion process (port 3500)
    if (process.env.COMMUNITY_AGENT_URL || process.env.ENABLE_COMMUNITY_AGENT !== 'false') {
        startAgent();
    }

    // Data retention: purge old activity + monitoring_checks automatically
    scheduleRetention(supabase);

    // Keep-alive: ping external Render URL every 10min to prevent free-tier spin-down
    // Render only counts EXTERNAL requests for idle detection, localhost doesn't count
    const externalUrl = process.env.RENDER_EXTERNAL_URL;
    if (externalUrl) {
        const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes
        setInterval(async () => {
            try {
                const res = await fetch(`${externalUrl}/health`);
                logger.info('KeepAlive', `Ping ${externalUrl}/health -> ${res.status}`);
            } catch (err) {
                logger.warn('KeepAlive', `Ping failed: ${err.message}`);
            }
        }, KEEP_ALIVE_INTERVAL);
        logger.info('KeepAlive', `Self-ping every 10min to ${externalUrl}`);
    }
});

// --- GRACEFUL SHUTDOWN ---
async function gracefulShutdown(signal) {
    logger.info('server', `${signal} received — shutting down`);
    stopMonitor();
    stopTelegramBot();
    await stopAgent().catch(() => {});
    serverInstance.close(() => {
        logger.info('server', 'HTTP server closed');
        process.exit(0);
    });
    setTimeout(() => {
        logger.error('server', 'Forcing exit after shutdown timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
