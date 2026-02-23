// lib/telegram-bot.js — Interactive Telegram bot with admin commands
// Commands: /balance, /stats, /status, /recent, /services, /uptime, /top, /revenue, /search, /endpoint, /help
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
        `\uD83D\uDCB3 *Wallet Balance*`,
        ``,
        `*Adresse:* \`${walletAddr}\``,
        `*Reseau:* ${NETWORK_LABEL}`,
        `*USDC:* ${walletBalance !== null ? `$${walletBalance.toFixed(6)}` : 'N/A'}`,
        ``,
        `[Voir sur BaseScan](${EXPLORER_URL}/address/${walletAddr})`,
    ].join('\n');

    return sendMessage(token, chatId, text);
}

// --- Command: /stats (enriched) ---
async function handleStats(token, chatId, supabase, getMonitorStatus) {
    let serviceCount = 0;
    let totalPayments = 0;
    let totalRevenue = 0;
    let apiCallCount = 0;
    let calls24h = 0;
    let avgPrice = 0;

    try {
        const { count } = await supabase.from('services').select('*', { count: 'exact', head: true });
        serviceCount = count || 0;
    } catch (err) { logger.warn('TelegramBot', `Stats: failed to count services: ${err.message}`); }

    try {
        const { data: payments } = await supabase
            .from('activity')
            .select('amount')
            .eq('type', 'payment');
        if (payments) {
            totalPayments = payments.length;
            totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);
        }
    } catch (err) { logger.warn('TelegramBot', `Stats: failed to fetch payments: ${err.message}`); }

    try {
        const { count } = await supabase.from('activity').select('*', { count: 'exact', head: true }).eq('type', 'api_call');
        apiCallCount = count || 0;
    } catch (err) { logger.warn('TelegramBot', `Stats: failed to count API calls: ${err.message}`); }

    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase.from('activity').select('*', { count: 'exact', head: true })
            .eq('type', 'api_call').gte('created_at', since);
        calls24h = count || 0;
    } catch (err) { logger.warn('TelegramBot', `Stats: failed to count 24h calls: ${err.message}`); }

    try {
        const { data: svcData } = await supabase.from('services').select('price_usdc').gt('price_usdc', 0);
        if (svcData && svcData.length > 0) {
            avgPrice = svcData.reduce((sum, s) => sum + Number(s.price_usdc), 0) / svcData.length;
        }
    } catch (err) { logger.warn('TelegramBot', `Stats: failed to compute avg price: ${err.message}`); }

    // Get monitoring status
    const status = getMonitorStatus();
    const onlineCount = status?.onlineCount || 0;
    const totalEndpoints = status?.totalCount || 61;
    const overall = status?.overall || 'unknown';
    const overallEmoji = overall === 'operational' ? '\u2705' : overall === 'degraded' ? '\u26A0\uFE0F' : '\uD83D\uDD34';

    const text = [
        `\uD83D\uDCCA *Statistiques x402 Bazaar*`,
        ``,
        `*Services enregistres:* ${serviceCount}`,
        `*Endpoints natifs:* 61`,
        `*API calls total:* ${apiCallCount}`,
        `*Calls (24h):* ${calls24h}`,
        ``,
        `\uD83D\uDCB0 *Finances*`,
        `*Paiements:* ${totalPayments}`,
        `*Revenue total:* $${totalRevenue.toFixed(2)} USDC`,
        `*Prix moyen:* $${avgPrice.toFixed(4)} USDC`,
        ``,
        `${overallEmoji} *Monitoring*`,
        `*En ligne:* ${onlineCount}/${totalEndpoints}`,
        `*Status:* ${overall}`,
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

// --- Command: /recent (enriched with tx hash links) ---
async function handleRecent(token, chatId, supabase) {
    let activities = [];

    try {
        const { data } = await supabase
            .from('activity')
            .select('type, detail, amount, created_at, tx_hash')
            .order('created_at', { ascending: false })
            .limit(10);
        activities = data || [];
    } catch (err) { logger.warn('TelegramBot', `Recent: failed to fetch activities: ${err.message}`); }

    if (activities.length === 0) {
        return sendMessage(token, chatId, 'Aucune activite recente.');
    }

    const lines = [`\uD83D\uDD59 *10 dernieres activites:*`, ''];

    for (const a of activities) {
        const time = (a.created_at || '').replace('T', ' ').slice(11, 19);
        const emoji = a.type === 'payment' ? '\uD83D\uDCB0'
            : a.type === 'api_call' ? '\u26A1'
            : a.type === '402' ? '\uD83D\uDD12'
            : a.type === 'register' ? '\uD83C\uDD95'
            : '\u2022';
        const amount = a.amount > 0 ? ` ($${Number(a.amount).toFixed(3)})` : '';
        const detail = (a.detail || '').slice(0, 50);
        let txLink = '';
        if (a.tx_hash) {
            txLink = ` [tx](${EXPLORER_URL}/tx/${a.tx_hash})`;
        }
        lines.push(`${emoji} \`${time}\` ${detail}${amount}${txLink}`);
    }

    return sendMessage(token, chatId, lines.join('\n'));
}

// --- Command: /services ---
async function handleServices(token, chatId, supabase) {
    let services = [];

    try {
        const { data } = await supabase
            .from('services')
            .select('name, price_usdc, url, tags')
            .order('created_at', { ascending: false })
            .limit(20);
        services = data || [];
    } catch (err) { logger.warn('TelegramBot', `Services: failed to fetch services list: ${err.message}`); }

    const total = services.length;
    const lines = [`\uD83D\uDCE6 *${total} derniers services:*`, ''];

    for (const s of services) {
        const price = s.price_usdc > 0 ? `$${Number(s.price_usdc).toFixed(3)}` : 'FREE';
        const tags = s.tags && s.tags.length > 0 ? ` [${s.tags.slice(0, 3).join(', ')}]` : '';
        lines.push(`\u2022 *${s.name}* — ${price}${tags}`);
    }

    return sendMessage(token, chatId, lines.join('\n'));
}

// --- Command: /uptime [24h|7d|30d] ---
async function handleUptime(token, chatId, supabase, args) {
    const period = args || '24h';
    const periodMap = { '24h': 24, '7d': 168, '30d': 720 };
    const hours = periodMap[period];

    if (!hours) {
        return sendMessage(token, chatId, 'Periode invalide. Utilisez: `/uptime 24h`, `/uptime 7d`, ou `/uptime 30d`');
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
        const { data, error } = await supabase
            .from('monitoring_checks')
            .select('endpoint, label, status')
            .gte('checked_at', since);

        if (error || !data || data.length === 0) {
            return sendMessage(token, chatId, `Pas de donnees de monitoring pour la periode ${period}.`);
        }

        // Group by endpoint
        const grouped = {};
        for (const row of data) {
            if (!grouped[row.endpoint]) grouped[row.endpoint] = { label: row.label, total: 0, online: 0 };
            grouped[row.endpoint].total++;
            if (row.status === 'online') grouped[row.endpoint].online++;
        }

        // Calculate overall
        const totalChecks = data.length;
        const totalOnline = data.filter(c => c.status === 'online').length;
        const overallUptime = ((totalOnline / totalChecks) * 100).toFixed(1);

        // Find worst endpoints
        const uptimes = Object.entries(grouped)
            .map(([ep, g]) => ({ ep, label: g.label, uptime: ((g.online / g.total) * 100).toFixed(1), total: g.total }))
            .sort((a, b) => Number(a.uptime) - Number(b.uptime));

        const worst = uptimes.filter(u => Number(u.uptime) < 100).slice(0, 5);

        const emoji = Number(overallUptime) >= 99 ? '\u2705' : Number(overallUptime) >= 95 ? '\u26A0\uFE0F' : '\uD83D\uDD34';

        const lines = [
            `${emoji} *Uptime Report (${period})*`,
            ``,
            `*Uptime global:* ${overallUptime}%`,
            `*Checks analyses:* ${totalChecks}`,
            `*Endpoints:* ${uptimes.length}`,
        ];

        if (worst.length > 0) {
            lines.push('');
            lines.push('*Endpoints a surveiller:*');
            for (const w of worst) {
                const wEmoji = Number(w.uptime) >= 95 ? '\u26A0\uFE0F' : '\uD83D\uDD34';
                lines.push(`  ${wEmoji} ${w.label}: ${w.uptime}% (${w.total} checks)`);
            }
        } else {
            lines.push('');
            lines.push('\u2705 Tous les endpoints sont a 100% !');
        }

        return sendMessage(token, chatId, lines.join('\n'));
    } catch (err) {
        return sendMessage(token, chatId, `Erreur uptime: \`${err.message}\``);
    }
}

// --- Command: /top ---
async function handleTop(token, chatId, supabase) {
    try {
        const { data: calls } = await supabase
            .from('activity')
            .select('detail')
            .eq('type', 'api_call')
            .order('created_at', { ascending: false })
            .limit(1000);

        if (!calls || calls.length === 0) {
            return sendMessage(token, chatId, 'Aucun appel API enregistre.');
        }

        const counts = {};
        for (const c of calls) {
            const match = c.detail?.match(/^(\w[\w\s/]+?)(?:\s*[:.])/);
            const ep = match ? match[1].trim() : (c.detail || 'Unknown');
            counts[ep] = (counts[ep] || 0) + 1;
        }

        const top = Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);

        const maxCount = top[0]?.[1] || 1;

        const lines = [`\uD83C\uDFC6 *Top 10 APIs (derniers 1000 appels)*`, ''];

        for (let i = 0; i < top.length; i++) {
            const [name, count] = top[i];
            const pct = ((count / calls.length) * 100).toFixed(0);
            const bar = '\u2588'.repeat(Math.ceil((count / maxCount) * 8));
            const medal = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : `${i + 1}.`;
            lines.push(`${medal} *${name}* — ${count} calls (${pct}%)`);
            lines.push(`   ${bar}`);
        }

        lines.push('');
        lines.push(`_Total: ${calls.length} appels analyses_`);

        return sendMessage(token, chatId, lines.join('\n'));
    } catch (err) {
        return sendMessage(token, chatId, `Erreur top: \`${err.message}\``);
    }
}

// --- Command: /revenue ---
async function handleRevenue(token, chatId, supabase) {
    try {
        const { data: payments } = await supabase
            .from('activity')
            .select('amount, created_at')
            .eq('type', 'payment')
            .order('created_at', { ascending: false });

        if (!payments || payments.length === 0) {
            return sendMessage(token, chatId, 'Aucun paiement enregistre.');
        }

        const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const totalCount = payments.length;

        // Group by day (last 7 days)
        const dailyMap = {};
        const now = Date.now();
        for (const p of payments) {
            const date = p.created_at?.split('T')[0];
            if (!date) continue;
            if (!dailyMap[date]) dailyMap[date] = { total: 0, count: 0 };
            dailyMap[date].total += Number(p.amount);
            dailyMap[date].count++;
        }

        const last7days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(now - i * 86400000);
            const key = d.toISOString().split('T')[0];
            const dayData = dailyMap[key] || { total: 0, count: 0 };
            last7days.push({ date: key, ...dayData });
        }

        // Today / this week
        const today = last7days[0];
        const weekTotal = last7days.reduce((sum, d) => sum + d.total, 0);
        const weekCount = last7days.reduce((sum, d) => sum + d.count, 0);

        const lines = [
            `\uD83D\uDCB0 *Revenue Report*`,
            ``,
            `*Total revenus:* $${totalRevenue.toFixed(4)} USDC`,
            `*Total paiements:* ${totalCount}`,
            `*Prix moyen/tx:* $${(totalRevenue / totalCount).toFixed(4)}`,
            ``,
            `*Aujourd'hui:* $${today.total.toFixed(4)} (${today.count} tx)`,
            `*Cette semaine:* $${weekTotal.toFixed(4)} (${weekCount} tx)`,
            ``,
            `*7 derniers jours:*`,
        ];

        const maxDay = Math.max(...last7days.map(d => d.total), 0.001);
        for (const d of last7days.reverse()) {
            const bar = d.total > 0 ? '\u2588'.repeat(Math.ceil((d.total / maxDay) * 10)) : '\u2591';
            const dayName = d.date.slice(5); // MM-DD
            lines.push(`  \`${dayName}\` ${bar} $${d.total.toFixed(3)} (${d.count})`);
        }

        return sendMessage(token, chatId, lines.join('\n'));
    } catch (err) {
        return sendMessage(token, chatId, `Erreur revenue: \`${err.message}\``);
    }
}

// --- Command: /search <query> ---
async function handleSearch(token, chatId, supabase, query) {
    if (!query || query.trim().length === 0) {
        return sendMessage(token, chatId, 'Usage: `/search <mot-cle>`\nExemple: `/search weather`');
    }

    const q = query.trim().replace(/[%_\\]/g, c => '\\' + c);

    try {
        const { data } = await supabase
            .from('services')
            .select('name, description, price_usdc, url, tags')
            .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(10);

        if (!data || data.length === 0) {
            return sendMessage(token, chatId, `Aucun service trouve pour "${query}".`);
        }

        const lines = [`\uD83D\uDD0D *Resultats pour "${query}":*`, ''];

        for (const s of data) {
            const price = s.price_usdc > 0 ? `$${Number(s.price_usdc).toFixed(3)}` : 'FREE';
            const desc = (s.description || '').slice(0, 60);
            const tags = s.tags && s.tags.length > 0 ? `\n   Tags: ${s.tags.slice(0, 4).join(', ')}` : '';
            lines.push(`\u2022 *${s.name}* — ${price}`);
            lines.push(`   ${desc}${tags}`);
        }

        return sendMessage(token, chatId, lines.join('\n'));
    } catch (err) {
        return sendMessage(token, chatId, `Erreur search: \`${err.message}\``);
    }
}

// --- Command: /endpoint <name> ---
async function handleEndpoint(token, chatId, supabase, getMonitorStatus, query) {
    if (!query || query.trim().length === 0) {
        return sendMessage(token, chatId, 'Usage: `/endpoint <nom>`\nExemple: `/endpoint weather`');
    }

    const q = query.trim().replace(/[%_\\]/g, c => '\\' + c);

    try {
        // Find service
        const { data } = await supabase
            .from('services')
            .select('*')
            .ilike('name', `%${q}%`)
            .limit(1);

        if (!data || data.length === 0) {
            return sendMessage(token, chatId, `Service "${query}" non trouve.`);
        }

        const s = data[0];
        const price = s.price_usdc > 0 ? `$${Number(s.price_usdc).toFixed(3)}` : 'FREE';

        // Get monitoring status for this endpoint
        const monitorStatus = getMonitorStatus();
        const epStatus = (monitorStatus?.endpoints || []).find(e =>
            e.label?.toLowerCase().includes(q.toLowerCase()) ||
            e.endpoint?.toLowerCase().includes(q.toLowerCase())
        );

        // Count calls for this service
        let callCount = 0;
        try {
            const { count } = await supabase
                .from('activity')
                .select('*', { count: 'exact', head: true })
                .eq('type', 'api_call')
                .ilike('detail', `%${q}%`);
            callCount = count || 0;
        } catch (err) { logger.warn('TelegramBot', `Endpoint: failed to count calls for "${q}": ${err.message}`); }

        const statusEmoji = epStatus?.status === 'online' ? '\u2705' : epStatus ? '\uD83D\uDD34' : '\u2753';
        const tags = s.tags && s.tags.length > 0 ? s.tags.join(', ') : 'N/A';

        const lines = [
            `\uD83D\uDD0D *${s.name}*`,
            ``,
            `*Description:* ${(s.description || 'N/A').slice(0, 100)}`,
            `*Prix:* ${price} USDC`,
            `*URL:* \`${s.url || 'N/A'}\``,
            `*Tags:* ${tags}`,
            `*Owner:* \`${s.owner ? s.owner.slice(0, 10) + '...' : 'N/A'}\``,
            `*Verifie:* ${s.verified_status === 'tested' ? '\u2705 Oui' : '\u274C Non'}`,
            ``,
            `${statusEmoji} *Monitoring:* ${epStatus?.status || 'N/A'}`,
            epStatus?.responseTime ? `*Temps de reponse:* ${epStatus.responseTime}ms` : null,
            `*Total appels:* ${callCount}`,
            `*Enregistre le:* ${s.created_at ? s.created_at.split('T')[0] : 'N/A'}`,
        ].filter(Boolean);

        return sendMessage(token, chatId, lines.join('\n'));
    } catch (err) {
        return sendMessage(token, chatId, `Erreur endpoint: \`${err.message}\``);
    }
}

// --- Command: /help ---
async function handleHelp(token, chatId) {
    const text = [
        `*x402 Bazaar Bot* \u2014 11 commandes disponibles:`,
        ``,
        `\uD83D\uDCCA *Tableau de bord*`,
        `/stats \u2014 Statistiques completes`,
        `/balance \u2014 Solde USDC du wallet`,
        `/revenue \u2014 Revenue (7 jours + total)`,
        ``,
        `\uD83D\uDD0D *Monitoring*`,
        `/status \u2014 Status des 61 endpoints`,
        `/uptime \u2014 Uptime (24h/7d/30d)`,
        ``,
        `\uD83D\uDCE6 *Services*`,
        `/services \u2014 20 derniers services`,
        `/search <mot> \u2014 Chercher un service`,
        `/endpoint <nom> \u2014 Detail d'un endpoint`,
        `/top \u2014 Top 10 APIs les plus appelees`,
        ``,
        `\uD83D\uDD59 *Activite*`,
        `/recent \u2014 10 dernieres activites`,
        ``,
        `/help \u2014 Cette aide`,
        ``,
        `_Les alertes de monitoring (up/down) sont envoyees automatiquement._`,
    ].join('\n');

    return sendMessage(token, chatId, text);
}

// --- Process a single message ---
async function processMessage(token, chatId, message, supabase, getMonitorStatus) {
    const rawText = (message.text || '').trim();
    const text = rawText.toLowerCase();

    // Only process commands
    if (!text.startsWith('/')) return;

    const parts = text.split('@')[0].split(/\s+/);
    const command = parts[0];
    const args = rawText.slice(rawText.indexOf(' ') + 1).trim();
    const hasArgs = rawText.includes(' ');

    switch (command) {
        case '/balance':
            return handleBalance(token, chatId);
        case '/stats':
            return handleStats(token, chatId, supabase, getMonitorStatus);
        case '/status':
            return handleStatus(token, chatId, getMonitorStatus);
        case '/recent':
            return handleRecent(token, chatId, supabase);
        case '/services':
            return handleServices(token, chatId, supabase);
        case '/uptime':
            return handleUptime(token, chatId, supabase, hasArgs ? parts[1] : '24h');
        case '/top':
            return handleTop(token, chatId, supabase);
        case '/revenue':
            return handleRevenue(token, chatId, supabase);
        case '/search':
            return handleSearch(token, chatId, supabase, hasArgs ? args : '');
        case '/endpoint':
            return handleEndpoint(token, chatId, supabase, getMonitorStatus, hasArgs ? args : '');
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
    sendMessage(token, chatId, '\u2705 *x402 Bazaar Bot demarre*\nTapez /help pour les commandes (11 disponibles).');
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
