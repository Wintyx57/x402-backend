// lib/telegram-bot.js — Interactive Telegram bot with admin commands
// Commands: /balance, /stats, /status, /recent, /services, /help
// Uses polling (getUpdates), secured by TELEGRAM_CHAT_ID

const logger = require('./logger');
const { RPC_URL, USDC_CONTRACT, NETWORK_LABEL, EXPLORER_URL } = require('./chains');
const { fetchWithTimeout } = require('./payment');

const POLL_INTERVAL = 5000; // 5s between polls
const POLL_TIMEOUT = 3000;  // 3s timeout for getUpdates

let pollTimer = null;
let lastUpdateId = 0;

// --- Send a message to Telegram ---
async function sendMessage(token, chatId, text, parseMode = 'Markdown') {
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode,
                disable_web_page_preview: true,
            }),
        });
    } catch (err) {
        logger.error('TelegramBot', `sendMessage failed: ${err.message}`);
    }
}

// --- Get new updates from Telegram ---
async function getUpdates(token) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT);

        const res = await fetch(
            `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`,
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        const data = await res.json();
        return data.ok ? data.result : [];
    } catch (err) {
        if (err.name !== 'AbortError') {
            logger.error('TelegramBot', `getUpdates failed: ${err.message}`);
        }
        return [];
    }
}

// --- Command: /balance ---
async function handleBalance(token, chatId) {
    let walletBalance = null;
    const walletAddr = process.env.WALLET_ADDRESS;

    if (!walletAddr) {
        return sendMessage(token, chatId, '`WALLET_ADDRESS` non configure.');
    }

    try {
        const balanceCall = '0x70a08231' + '000000000000000000000000' + walletAddr.slice(2).toLowerCase();
        const balRes = await fetchWithTimeout(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [{ to: USDC_CONTRACT, data: balanceCall }, 'latest'],
                id: 1,
            }),
        });
        const { result } = await balRes.json();
        if (result && result !== '0x') {
            walletBalance = Number(BigInt(result)) / 1e6;
        } else {
            walletBalance = 0;
        }
    } catch (err) {
        return sendMessage(token, chatId, `Erreur lecture balance: \`${err.message}\``);
    }

    const text = [
        `*Wallet Balance*`,
        ``,
        `*Adresse:* \`${walletAddr}\``,
        `*Reseau:* ${NETWORK_LABEL}`,
        `*USDC:* ${walletBalance !== null ? `$${walletBalance.toFixed(6)}` : 'N/A'}`,
        ``,
        `[Voir sur BaseScan](${EXPLORER_URL}/address/${walletAddr})`,
    ].join('\n');

    return sendMessage(token, chatId, text);
}

// --- Command: /stats ---
async function handleStats(token, chatId, supabase) {
    let serviceCount = 0;
    let totalPayments = 0;
    let totalRevenue = 0;

    try {
        const { count } = await supabase.from('services').select('*', { count: 'exact', head: true });
        serviceCount = count || 0;
    } catch { /* ignore */ }

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

    const text = [
        `*Statistiques x402 Bazaar*`,
        ``,
        `*Services:* ${serviceCount}`,
        `*Paiements:* ${totalPayments}`,
        `*Revenue:* $${totalRevenue.toFixed(2)} USDC`,
        `*Reseau:* ${NETWORK_LABEL}`,
    ].join('\n');

    return sendMessage(token, chatId, text);
}

// --- Command: /status ---
async function handleStatus(token, chatId, getMonitorStatus) {
    const status = getMonitorStatus();

    if (!status || !status.lastCheck) {
        return sendMessage(token, chatId, 'Monitoring pas encore demarre. Premiere verification dans quelques secondes...');
    }

    const online = status.onlineCount || 0;
    const total = status.totalCount || 0;
    const offlineEndpoints = (status.endpoints || []).filter(e => e.status === 'offline');

    let overallEmoji = '?';
    if (status.overall === 'operational') overallEmoji = '\u2705';
    else if (status.overall === 'degraded') overallEmoji = '\u26A0\uFE0F';
    else if (status.overall === 'major_outage') overallEmoji = '\uD83D\uDD34';

    const lines = [
        `${overallEmoji} *Status: ${status.overall.toUpperCase()}*`,
        ``,
        `*En ligne:* ${online}/${total} endpoints`,
        `*Dernier check:* ${status.lastCheck.replace('T', ' ').slice(0, 19)} UTC`,
    ];

    if (offlineEndpoints.length > 0) {
        lines.push('');
        lines.push('*Endpoints offline:*');
        for (const ep of offlineEndpoints.slice(0, 10)) {
            lines.push(`  \u2022 ${ep.label} (\`${ep.endpoint}\`)`);
        }
        if (offlineEndpoints.length > 10) {
            lines.push(`  ... et ${offlineEndpoints.length - 10} autres`);
        }
    }

    return sendMessage(token, chatId, lines.join('\n'));
}

// --- Command: /recent ---
async function handleRecent(token, chatId, supabase) {
    let activities = [];

    try {
        const { data } = await supabase
            .from('activity')
            .select('type, detail, amount, created_at')
            .order('created_at', { ascending: false })
            .limit(10);
        activities = data || [];
    } catch { /* ignore */ }

    if (activities.length === 0) {
        return sendMessage(token, chatId, 'Aucune activite recente.');
    }

    const lines = [`*10 dernieres activites:*`, ''];

    for (const a of activities) {
        const time = (a.created_at || '').replace('T', ' ').slice(11, 19);
        const emoji = a.type === 'payment' ? '\uD83D\uDCB0' : a.type === '402' ? '\uD83D\uDD12' : a.type === 'register' ? '\uD83C\uDD95' : '\u2022';
        const amount = a.amount > 0 ? ` ($${Number(a.amount).toFixed(3)})` : '';
        const detail = (a.detail || '').slice(0, 60);
        lines.push(`${emoji} \`${time}\` ${detail}${amount}`);
    }

    return sendMessage(token, chatId, lines.join('\n'));
}

// --- Command: /services ---
async function handleServices(token, chatId, supabase) {
    let services = [];

    try {
        const { data } = await supabase
            .from('services')
            .select('name, price_usdc, url')
            .order('created_at', { ascending: false })
            .limit(20);
        services = data || [];
    } catch { /* ignore */ }

    const total = services.length;
    const lines = [`*${total} derniers services:*`, ''];

    for (const s of services) {
        const price = s.price_usdc > 0 ? `$${Number(s.price_usdc).toFixed(3)}` : 'FREE';
        lines.push(`\u2022 *${s.name}* — ${price}`);
    }

    return sendMessage(token, chatId, lines.join('\n'));
}

// --- Command: /help ---
async function handleHelp(token, chatId) {
    const text = [
        `*x402 Bazaar Bot* — Commandes disponibles:`,
        ``,
        `/balance — Solde USDC du wallet`,
        `/stats — Statistiques globales`,
        `/status — Status des 41 endpoints`,
        `/recent — 10 dernieres activites`,
        `/services — 20 derniers services`,
        `/help — Cette aide`,
        ``,
        `Les alertes de monitoring (up/down) sont envoyees automatiquement.`,
    ].join('\n');

    return sendMessage(token, chatId, text);
}

// --- Process a single message ---
async function processMessage(token, chatId, message, supabase, getMonitorStatus) {
    const text = (message.text || '').trim().toLowerCase();

    // Only process commands
    if (!text.startsWith('/')) return;

    const command = text.split('@')[0]; // Handle /command@botname

    switch (command) {
        case '/balance':
            return handleBalance(token, chatId);
        case '/stats':
            return handleStats(token, chatId, supabase);
        case '/status':
            return handleStatus(token, chatId, getMonitorStatus);
        case '/recent':
            return handleRecent(token, chatId, supabase);
        case '/services':
            return handleServices(token, chatId, supabase);
        case '/help':
        case '/start':
            return handleHelp(token, chatId);
        default:
            return sendMessage(token, chatId, `Commande inconnue: \`${command}\`\nTapez /help pour la liste des commandes.`);
    }
}

// --- Poll loop ---
async function poll(token, authorizedChatId, supabase, getMonitorStatus) {
    const updates = await getUpdates(token);

    for (const update of updates) {
        lastUpdateId = update.update_id;

        const message = update.message;
        if (!message || !message.text) continue;

        // Security: only respond to authorized chat
        const chatId = String(message.chat.id);
        if (chatId !== String(authorizedChatId)) {
            logger.warn('TelegramBot', `Rejected message from unauthorized chat: ${chatId}`);
            await sendMessage(token, chatId, 'Acces non autorise.');
            continue;
        }

        await processMessage(token, chatId, message, supabase, getMonitorStatus);
    }
}

// --- Public API ---
function startTelegramBot(supabase, getMonitorStatus) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        logger.info('TelegramBot', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, bot disabled');
        return;
    }

    // Start polling
    pollTimer = setInterval(() => {
        poll(token, chatId, supabase, getMonitorStatus).catch(err => {
            logger.error('TelegramBot', `Poll error: ${err.message}`);
        });
    }, POLL_INTERVAL);

    logger.info('TelegramBot', `Bot started, polling every ${POLL_INTERVAL / 1000}s`);

    // Send startup message
    sendMessage(token, chatId, '\u2705 *x402 Bazaar Bot demarre*\nTapez /help pour les commandes.');
}

function stopTelegramBot() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        logger.info('TelegramBot', 'Bot stopped');
    }
}

// Exported for use in register.js auto-test notification
async function notifyAdmin(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    return sendMessage(token, chatId, text);
}

module.exports = { startTelegramBot, stopTelegramBot, notifyAdmin };
