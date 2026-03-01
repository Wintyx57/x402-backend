// routes/register.js — POST /register + auto-test on registration

const express = require('express');
const logger = require('../lib/logger');
const { notifyAdmin } = require('../lib/telegram-bot');
const { ServiceRegistrationSchema } = require('../schemas');

const AUTO_TEST_TIMEOUT = 10000; // 10s

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

// --- Auto-test: ping registered URL and notify admin ---
async function autoTestService(service, supabase) {
    const { name, url, id } = service;
    const start = Date.now();

    let status = 'unknown';
    let httpStatus = 0;
    let latency = 0;
    let errorMsg = null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AUTO_TEST_TIMEOUT);

        const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'x402-bazaar-autotest/1.0' },
        });
        clearTimeout(timeoutId);

        latency = Date.now() - start;
        httpStatus = res.status;
        // 200, 402, 400, 403 = endpoint exists and responds
        status = (httpStatus >= 200 && httpStatus < 500) ? 'reachable' : 'error';
    } catch (err) {
        latency = Date.now() - start;
        errorMsg = err.name === 'AbortError' ? 'Timeout (10s)' : err.message;
        status = 'unreachable';
    }

    // Update service verified status in Supabase (add verified_at + verified_status columns if they exist)
    try {
        await supabase
            .from('services')
            .update({ verified_status: status, verified_at: new Date().toISOString() })
            .eq('id', id);
    } catch {
        // Column might not exist yet, that's OK
    }

    // Notify admin via Telegram
    const emoji = status === 'reachable' ? '\u2705' : '\uD83D\uDD34';
    const text = [
        `${emoji} *Nouveau service enregistre*`,
        ``,
        `*Nom:* ${name}`,
        `*URL:* \`${url}\``,
        `*Auto-test:* ${status}`,
        `*HTTP:* ${httpStatus || 'N/A'}`,
        `*Latence:* ${latency}ms`,
        errorMsg ? `*Erreur:* ${errorMsg}` : null,
        ``,
        `*ID:* \`${id.slice(0, 8)}...\``,
    ].filter(Boolean).join('\n');

    await notifyAdmin(text);

    logger.info('AutoTest', `Service "${name}" (${id.slice(0, 8)}): ${status} (HTTP ${httpStatus}, ${latency}ms)`);
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
