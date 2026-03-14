// routes/register.js — POST /register + deep auto-verification on registration

const express = require('express');
const logger = require('../lib/logger');
const { notifyAdmin } = require('../lib/telegram-bot');
const { ServiceRegistrationSchema, QuickRegisterSchema } = require('../schemas');
const { verifyService } = require('../lib/service-verifier');
const { safeUrl } = require('../lib/safe-url');
const { registerAgent } = require('../lib/erc8004-registry');

function createRegisterRouter(supabase, logActivity, paymentMiddleware, registerLimiter) {
    const router = express.Router();

    router.post('/quick-register', registerLimiter, async (req, res) => {
        let validatedData;
        try {
            validatedData = QuickRegisterSchema.parse(req.body);
        } catch (zodError) {
            const errors = (zodError.issues || zodError.errors || []).map(err => ({
                field: err.path.join('.') || 'root',
                message: err.message,
            }));
            return res.status(400).json({ error: 'Validation failed', details: errors });
        }

        // SSRF protection
        try {
            await safeUrl(validatedData.url);
        } catch (urlErr) {
            return res.status(400).json({
                error: 'Invalid service URL',
                message: 'URL must point to a publicly reachable address'
            });
        }

        // Auto-derive name from URL hostname if not provided
        const derivedName = validatedData.name ||
            (() => {
                try {
                    const h = new URL(validatedData.url).hostname.replace(/^(www|api)\./, '');
                    return h.split('.')[0].charAt(0).toUpperCase() + h.split('.')[0].slice(1);
                } catch { return 'API Service'; }
            })();

        const insertData = {
            name: derivedName,
            url: validatedData.url,
            price_usdc: validatedData.price,
            owner_address: validatedData.ownerAddress,
            tags: ['utility'],
            quick_registered: true,
        };

        const { data, error } = await supabase
            .from('services')
            .insert([insertData])
            .select();

        if (error) {
            logger.error('Supabase', '/quick-register error:', error.message);
            return res.status(500).json({ error: 'Registration failed' });
        }

        const service = data[0];
        const proxyUrl = `https://x402-api.onrender.com/api/call/${service.id}`;

        logger.info('Bazaar', `Quick registered: "${derivedName}" (${service.id})`);
        logActivity('register', `Quick: "${derivedName}" (${service.id.slice(0, 8)})`);

        // Auto-test (fire-and-forget)
        autoTestService(service, supabase).catch(err => {
            logger.error('AutoTest', `Auto-test failed for "${derivedName}": ${err.message}`);
        });

        // Notify admin
        notifyAdmin(`⚡ *Quick Register*\n*Name:* ${derivedName}\n*URL:* \`${validatedData.url}\`\n*Price:* ${validatedData.price} USDC\n*Owner:* \`${validatedData.ownerAddress.slice(0, 10)}...\`\n*ID:* \`${service.id.slice(0, 8)}...\``).catch(() => {});

        res.status(201).json({
            success: true,
            message: `Service "${derivedName}" registered! No payment required.`,
            data: service,
            proxy_url: proxyUrl,
            service_page: `https://x402bazaar.org/services/${service.id}`,
            embed: {
                curl: `curl -X POST "${proxyUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Payment-TxHash: YOUR_TX_HASH" \\\n  -H "X-Payment-Chain: skale"`,
                javascript: `const res = await fetch("${proxyUrl}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-Payment-TxHash": txHash,\n    "X-Payment-Chain": "skale"\n  }\n});\nconst data = await res.json();`,
                python: `import requests\n\nres = requests.post(\n    "${proxyUrl}",\n    headers={\n        "X-Payment-TxHash": tx_hash,\n        "X-Payment-Chain": "skale"\n    }\n)\nprint(res.json())`,
            },
        });
    });

    router.post('/register', registerLimiter, paymentMiddleware(1000000, 1, "Register Service"), async (req, res) => {
        const txHash = req.headers['x-payment-txhash'] || null;

        // Validate request body using Zod schema
        let validatedData;
        try {
            validatedData = ServiceRegistrationSchema.parse(req.body);
        } catch (zodError) {
            // Return formatted validation errors
            const errors = (zodError.issues || zodError.errors || []).map(err => ({
                field: err.path.join('.') || 'root',
                message: err.message,
            }));
            return res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
        }

        // SSRF protection: validate the service URL before inserting
        try {
            await safeUrl(validatedData.url);
        } catch (urlErr) {
            return res.status(400).json({
                error: 'Invalid service URL',
                message: 'URL must point to a publicly reachable address'
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
        if (validatedData.required_parameters) {
            insertData.required_parameters = validatedData.required_parameters;
        }
        if (typeof validatedData.free_calls_per_month === 'number' && validatedData.free_calls_per_month > 0) {
            insertData.free_calls_per_month = validatedData.free_calls_per_month;
        }

        const { data, error } = await supabase
            .from('services')
            .insert([insertData])
            .select();

        if (error) {
            logger.error('Supabase', '/register error:', error.message);
            return res.status(500).json({ error: 'Registration failed' });
        }

        logger.info('Bazaar', `New service registered: "${validatedData.name}" (${data[0].id})`);
        logActivity('register', `New service: "${validatedData.name}" (${data[0].id.slice(0, 8)})`);

        // Auto-test: ping the registered URL (fire-and-forget)
        autoTestService(data[0], supabase).catch(err => {
            logger.error('AutoTest', `Auto-test failed for "${validatedData.name}": ${err.message}`);
        });

        // Notify Community Agent webhook (fire-and-forget)
        notifyCommunityAgent({ name: validatedData.name, description: validatedData.description, price: validatedData.price }).catch(err => {
            logger.error('Webhook', `Community agent webhook failed: ${err.message}`);
        });

        // Register on ERC-8004 Identity Registry (fire-and-forget)
        registerOnChain(data[0], supabase).catch(err => {
            logger.error('ERC8004', `On-chain registration failed for "${validatedData.name}": ${err.message}`);
        });

        res.status(201).json({
            success: true,
            message: `Service "${validatedData.name}" registered successfully!`,
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
    const updateData = { verified_status: report.verdict, verified_at: new Date().toISOString() };

    // Auto-save detected required_parameters if provider didn't provide them
    if (report.detectedParams && !service.required_parameters) {
        updateData.required_parameters = report.detectedParams;
        logger.info('AutoTest', `Auto-detected required params for "${name}": ${report.detectedParams.required.join(', ')}`);
    }

    try {
        await supabase
            .from('services')
            .update(updateData)
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

    // SSRF protection: validate the webhook URL before fetching
    try {
        await safeUrl(COMMUNITY_AGENT_WEBHOOK);
    } catch (e) {
        logger.warn('Webhook', `Blocked unsafe webhook URL: ${e.message}`);
        return;
    }

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

// --- Register service on ERC-8004 Identity Registry (fire-and-forget) ---
async function registerOnChain(service, supabase) {
    const result = await registerAgent(
        service.id, service.name, service.url, service.description || ''
    );

    if (result && result.agentId != null) {
        await supabase
            .from('services')
            .update({
                erc8004_agent_id: result.agentId,
                erc8004_registered_at: new Date().toISOString(),
            })
            .eq('id', service.id);

        logger.info('ERC8004', `"${service.name}" on-chain: agentId=${result.agentId}`);
        await notifyAdmin(`\u26D3 *ERC-8004 Agent Registered*\n*Service:* ${service.name}\n*Agent ID:* ${result.agentId}\n*TX:* \`${result.txHash.slice(0, 18)}...\``).catch(() => {});
    }
}

module.exports = createRegisterRouter;
