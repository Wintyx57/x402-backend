// routes/register.js — POST /register + deep auto-verification on registration

const express = require('express');
const logger = require('../lib/logger');
const { notifyAdmin } = require('../lib/telegram-bot');
const { ServiceRegistrationSchema } = require('../schemas');
const { verifyService } = require('../lib/service-verifier');

function createRegisterRouter(supabase, logActivity, paymentMiddleware, registerLimiter) {
    const router = express.Router();

    router.post('/register', registerLimiter, paymentMiddleware(1000000, 1, "Enregistrer un service"), async (req, res) => {
        const txHash = req.headers['x-payment-txhash'] || null;

        // Validate request body using Zod schema
        let validatedData;
        try {
            validatedData = ServiceRegistrationSchema.parse(req.body);
        } catch (zodError) {
            // Return formatted validation errors
            const errors = zodError.errors.map(err => ({
                field: err.path.join('.') || 'root',
                message: err.message,
            }));
            return res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
        }

        const insertData = {
            name: validatedData.name,
            description: validatedData.description,
            url: validatedData.url,
            price_usdc: validatedData.price,
            owner_address: validatedData.ownerAddress,
            tags: validatedData.tags,
        };
        if (txHash) insertData.tx_hash = txHash;

        const { data, error } = await supabase
            .from('services')
            .insert([insertData])
            .select();

        if (error) {
            logger.error('Supabase', '/register error:', error.message);
            return res.status(500).json({ error: 'Registration failed' });
        }

        logger.info('Bazaar', `Nouveau service enregistre : "${validatedData.name}" (${data[0].id})`);
        logActivity('register', `Nouveau service : "${validatedData.name}" (${data[0].id.slice(0, 8)})`);

        // Auto-test: ping the registered URL (fire-and-forget)
        autoTestService(data[0], supabase).catch(err => {
            logger.error('AutoTest', `Auto-test failed for "${validatedData.name}": ${err.message}`);
        });

        // Notify Community Agent webhook (fire-and-forget)
        notifyCommunityAgent({ name: validatedData.name, description: validatedData.description, price: validatedData.price }).catch(err => {
            logger.error('Webhook', `Community agent webhook failed: ${err.message}`);
        });

        res.status(201).json({
            success: true,
            message: `Service "${validatedData.name}" enregistre avec succes !`,
            data: data[0]
        });
    });

    return router;
}

// --- Auto-test: deep x402 verification and notify admin ---
async function autoTestService(service, supabase) {
    const { name, url, id, price_usdc } = service;

    const report = await verifyService(url);

    // Update service verified status in Supabase
    try {
        await supabase
            .from('services')
            .update({ verified_status: report.verdict, verified_at: new Date().toISOString() })
            .eq('id', id);
    } catch {
        // Column might not exist yet, that's OK
    }

    // Notify admin via Telegram with rich details
    const VERDICT_EMOJI = {
        mainnet_verified: '\u2705',  // ✅
        reachable: '\u2139\uFE0F',   // ℹ️
        testnet: '\u26A0\uFE0F',     // ⚠️
        wrong_chain: '\u26A0\uFE0F', // ⚠️
        no_x402: '\u2753',           // ❓
        offline: '\uD83D\uDD34',     // 🔴
    };
    const VERDICT_LABEL = {
        mainnet_verified: 'MAINNET VERIFIE',
        reachable: 'ACCESSIBLE (pas de x402)',
        testnet: 'TESTNET',
        wrong_chain: 'CHAIN INCONNUE',
        no_x402: 'PAS DE x402',
        offline: 'HORS LIGNE',
    };

    const emoji = VERDICT_EMOJI[report.verdict] || '\u2753';
    const label = VERDICT_LABEL[report.verdict] || report.verdict;

    const lines = [
        `${emoji} *Nouveau service — ${label}*`,
        ``,
        `*Nom:* ${name}`,
        `*URL:* \`${url}\``,
        `*Prix:* ${price_usdc} USDC`,
        `*HTTP:* ${report.httpStatus || 'N/A'}`,
        `*Latence:* ${report.latency}ms`,
    ];

    if (report.x402 && report.x402.valid) {
        lines.push(`*Chain:* ${report.x402.chainLabel} (${report.x402.network})`);
        lines.push(`*USDC:* ${report.x402.asset ? report.x402.asset.slice(0, 10) + '...' : 'N/A'} ${report.x402.isValidUsdc ? '\u2705' : '\u274C'}`);
        lines.push(`*Mainnet:* ${report.x402.isMainnet ? 'Oui \u2705' : 'Non \u274C'}`);
        if (report.x402.payTo) lines.push(`*PayTo:* \`${report.x402.payTo.slice(0, 10)}...\``);
    }

    if (report.endpoints.health) lines.push(`*/health:* accessible \u2705`);
    if (report.details) lines.push(`\n_${report.details}_`);
    lines.push(`\n*ID:* \`${id.slice(0, 8)}...\``);

    await notifyAdmin(lines.filter(Boolean).join('\n'));

    logger.info('AutoTest', `Service "${name}" (${id.slice(0, 8)}): ${report.verdict} — ${report.details}`);
}

// --- Notify Community Agent of new API registration ---
// Auto-derive webhook URL from COMMUNITY_AGENT_URL if explicit env not set
const COMMUNITY_AGENT_WEBHOOK = process.env.COMMUNITY_AGENT_WEBHOOK_URL ||
    (process.env.COMMUNITY_AGENT_URL ? `${process.env.COMMUNITY_AGENT_URL.replace(/\/$/, '')}/api/webhook/new-api` : '');
const WEBHOOK_TIMEOUT = 5000;

async function notifyCommunityAgent({ name, description, price }) {
    if (!COMMUNITY_AGENT_WEBHOOK) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

    try {
        const res = await fetch(COMMUNITY_AGENT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiName: name,
                apiDescription: description || '',
                apiPrice: `${price} USDC`
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        logger.info('Webhook', `Community agent notified for "${name}" (HTTP ${res.status})`);
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

module.exports = createRegisterRouter;
