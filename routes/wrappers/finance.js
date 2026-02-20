// routes/wrappers/finance.js — Finance, crypto Web3, research APIs
// gold, forex, eth-balance, gas-price, ens-resolve, defi-stats, company, domain-age, arxiv, random-user, timezone, word-stats

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createFinanceRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- GOLD / SILVER PRICE (0.005 USDC) ---
    router.get('/api/gold', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Gold Price API"), async (req, res) => {
        try {
            const r = await fetchWithTimeout('https://api.metals.live/v1/spot', {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 5000);
            const data = await r.json();
            const gold = data.find(d => d.gold) || {};
            const silver = data.find(d => d.silver) || {};
            logActivity('api_call', 'Gold Price API');
            res.json({ success: true, gold_usd_oz: gold.gold || null, silver_usd_oz: silver.silver || null, source: 'metals.live' });
        } catch (err) {
            logger.error('Gold API', err.message);
            res.status(500).json({ error: 'Failed to fetch metal prices' });
        }
    });

    // --- FOREX EXCHANGE RATE (0.005 USDC) ---
    router.get('/api/forex', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Forex API"), async (req, res) => {
        const from = (req.query.from || 'USD').toUpperCase().slice(0, 3);
        const to = (req.query.to || 'EUR').toUpperCase().slice(0, 3);
        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to))
            return res.status(400).json({ error: 'Invalid currency code. Use 3-letter ISO codes (e.g. USD, EUR)' });
        try {
            const r = await fetchWithTimeout(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {}, 5000);
            if (!r.ok) return res.status(400).json({ error: `Currency not found: ${from}` });
            const data = await r.json();
            logActivity('api_call', `Forex API: ${from} -> ${to}`);
            res.json({ success: true, from, to, rate: data.rates[to], date: data.date });
        } catch (err) {
            logger.error('Forex API', err.message);
            res.status(500).json({ error: 'Failed to fetch exchange rate' });
        }
    });

    // --- ETH BALANCE (0.01 USDC) ---
    router.get('/api/eth-balance', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "ETH Balance API"), async (req, res) => {
        const address = (req.query.address || '').trim();
        if (!address) return res.status(400).json({ error: "Parameter 'address' required. Ex: /api/eth-balance?address=0x..." });
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'Invalid Ethereum address format' });
        try {
            const r = await fetchWithTimeout(
                `https://api.ankr.com/multichain/v1/json-rpc/public?blockchain=eth`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 })
                }, 5000
            );
            const data = await r.json();
            const weiHex = data.result || '0x0';
            const eth = parseInt(weiHex, 16) / 1e18;
            logActivity('api_call', `ETH Balance: ${address.slice(0, 10)}...`);
            res.json({ success: true, address, balance_eth: eth.toFixed(6), balance_wei: parseInt(weiHex, 16).toString() });
        } catch (err) {
            logger.error('ETH Balance API', err.message);
            res.status(500).json({ error: 'Failed to fetch ETH balance' });
        }
    });

    // --- GAS PRICE (0.005 USDC) ---
    router.get('/api/gas-price', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Gas Price API"), async (req, res) => {
        try {
            const r = await fetchWithTimeout('https://api.owlracle.info/v4/eth/gas?apikey=', {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 5000);
            if (r.ok) {
                const data = await r.json();
                logActivity('api_call', 'Gas Price API');
                return res.json({ success: true, slow: data.speeds?.[0]?.maxFeePerGas, standard: data.speeds?.[1]?.maxFeePerGas, fast: data.speeds?.[2]?.maxFeePerGas, unit: 'gwei', source: 'owlracle' });
            }
            // Fallback: Cloudflare ETH gateway
            const fb = await fetchWithTimeout('https://cloudflare-eth.com/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 })
            }, 5000);
            const fbData = await fb.json();
            const gwei = parseInt(fbData.result, 16) / 1e9;
            logActivity('api_call', 'Gas Price API (fallback)');
            res.json({ success: true, standard: parseFloat(gwei.toFixed(2)), unit: 'gwei', source: 'cloudflare-eth' });
        } catch (err) {
            logger.error('Gas Price API', err.message);
            res.status(500).json({ error: 'Failed to fetch gas price' });
        }
    });

    // --- ENS RESOLVE (0.01 USDC) ---
    router.get('/api/ens-resolve', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "ENS Resolve API"), async (req, res) => {
        const name = (req.query.name || '').trim().toLowerCase().slice(0, 100);
        if (!name) return res.status(400).json({ error: "Parameter 'name' required. Ex: /api/ens-resolve?name=vitalik.eth" });
        if (!/\.eth$/.test(name)) return res.status(400).json({ error: "Name must end in .eth" });
        try {
            const r = await fetchWithTimeout(`https://api.ensdata.net/${encodeURIComponent(name)}`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 6000);
            if (!r.ok) return res.status(404).json({ error: `ENS name not found: ${name}` });
            const data = await r.json();
            logActivity('api_call', `ENS Resolve: ${name}`);
            res.json({ success: true, name, address: data.address || null, avatar: data.avatar || null, twitter: data.twitter || null });
        } catch (err) {
            logger.error('ENS Resolve API', err.message);
            res.status(500).json({ error: 'Failed to resolve ENS name' });
        }
    });

    // --- DEFI STATS (0.01 USDC) ---
    router.get('/api/defi-stats', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "DeFi Stats API"), async (req, res) => {
        const protocol = (req.query.protocol || '').trim().toLowerCase().slice(0, 50);
        if (!protocol) return res.status(400).json({ error: "Parameter 'protocol' required. Ex: /api/defi-stats?protocol=uniswap" });
        if (/[^a-z0-9\-]/.test(protocol)) return res.status(400).json({ error: 'Invalid protocol name' });
        try {
            const r = await fetchWithTimeout(`https://api.llama.fi/protocol/${encodeURIComponent(protocol)}`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 6000);
            if (!r.ok) return res.status(404).json({ error: `Protocol not found: ${protocol}` });
            const data = await r.json();
            logActivity('api_call', `DeFi Stats: ${protocol}`);
            res.json({
                success: true, name: data.name, category: data.category,
                tvl_usd: data.currentChainTvls ? Object.values(data.currentChainTvls).reduce((a, b) => a + b, 0) : null,
                chains: data.chains?.slice(0, 10), url: data.url
            });
        } catch (err) {
            logger.error('DeFi Stats API', err.message);
            res.status(500).json({ error: 'Failed to fetch DeFi stats' });
        }
    });

    // --- COMPANY INFO (0.02 USDC) ---
    router.get('/api/company', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Company Info API"), async (req, res) => {
        const name = (req.query.name || '').trim().slice(0, 100);
        if (!name) return res.status(400).json({ error: "Parameter 'name' required. Ex: /api/company?name=Apple" });
        if (/[\x00-\x1F\x7F<>]/.test(name)) return res.status(400).json({ error: 'Invalid characters in company name' });
        try {
            const r = await fetchWithTimeout(
                `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
                { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 5000
            );
            if (!r.ok) return res.status(404).json({ error: `Company not found: ${name}` });
            const data = await r.json();
            logActivity('api_call', `Company Info: ${name}`);
            res.json({ success: true, name: data.title, description: data.extract, thumbnail: data.thumbnail?.source || null, url: data.content_urls?.desktop?.page });
        } catch (err) {
            logger.error('Company Info API', err.message);
            res.status(500).json({ error: 'Failed to fetch company info' });
        }
    });

    // --- DOMAIN AGE (0.01 USDC) ---
    router.get('/api/domain-age', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Domain Age API"), async (req, res) => {
        const domain = (req.query.domain || '').trim().toLowerCase().slice(0, 100);
        if (!domain) return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/domain-age?domain=google.com" });
        if (!/^[a-z0-9][a-z0-9\-\.]{0,61}[a-z0-9]\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain format' });
        try {
            const r = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0', 'Accept': 'application/json' }
            }, 6000);
            if (!r.ok) return res.status(404).json({ error: `Domain not found: ${domain}` });
            const data = await r.json();
            const registered = data.events?.find(e => e.eventAction === 'registration')?.eventDate;
            const updated = data.events?.find(e => e.eventAction === 'last changed')?.eventDate;
            const expires = data.events?.find(e => e.eventAction === 'expiration')?.eventDate;
            const ageYears = registered ? ((Date.now() - new Date(registered)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1) : null;
            logActivity('api_call', `Domain Age: ${domain}`);
            res.json({ success: true, domain, registered, updated, expires, age_years: ageYears ? parseFloat(ageYears) : null, status: data.status });
        } catch (err) {
            logger.error('Domain Age API', err.message);
            res.status(500).json({ error: 'Failed to fetch domain info' });
        }
    });

    // --- ARXIV SEARCH (0.01 USDC) ---
    router.get('/api/arxiv', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "ArXiv Search API"), async (req, res) => {
        const query = (req.query.q || '').trim().slice(0, 200);
        const max = Math.min(parseInt(req.query.max || '5'), 10);
        if (!query) return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/arxiv?q=transformer+attention" });
        if (/[\x00-\x1F\x7F]/.test(query)) return res.status(400).json({ error: 'Invalid characters in query' });
        try {
            const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${max}&sortBy=relevance`;
            const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 8000);
            const xml = await r.text();
            const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
            const papers = entries.map(e => ({
                title: (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim(),
                authors: (e.match(/<name>(.*?)<\/name>/g) || []).slice(0, 3).map(n => n.replace(/<\/?name>/g, '')),
                summary: (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim().slice(0, 300),
                published: (e.match(/<published>(.*?)<\/published>/) || [])[1]?.slice(0, 10),
                url: (e.match(/<id>(.*?)<\/id>/) || [])[1]?.trim()
            }));
            logActivity('api_call', `ArXiv: "${query.slice(0, 50)}"`);
            res.json({ success: true, query, count: papers.length, papers });
        } catch (err) {
            logger.error('ArXiv API', err.message);
            res.status(500).json({ error: 'Failed to fetch ArXiv papers' });
        }
    });

    // --- RANDOM USER (free) ---
    router.get('/api/random-user', paidEndpointLimiter, paymentMiddleware(0, 0, "Random User API"), async (req, res) => {
        const count = Math.min(parseInt(req.query.count || '1'), 10);
        const nat = (req.query.nat || '').slice(0, 20);
        try {
            let url = `https://randomuser.me/api/?results=${count}&inc=name,email,location,picture,login`;
            if (nat && /^[a-z,]+$/.test(nat)) url += `&nat=${nat}`;
            const r = await fetchWithTimeout(url, {}, 5000);
            const data = await r.json();
            logActivity('api_call', 'Random User API');
            res.json({ success: true, count, users: data.results });
        } catch (err) {
            logger.error('Random User API', err.message);
            res.status(500).json({ error: 'Failed to fetch random users' });
        }
    });

    // --- TIMEZONE INFO & CONVERSION (free) ---
    router.get('/api/timezone', paidEndpointLimiter, paymentMiddleware(0, 0, "Timezone API"), async (req, res) => {
        const zone = (req.query.zone || '').trim().slice(0, 60);
        const convert = (req.query.convert || '').trim().slice(0, 60);
        const dt = req.query.dt ? new Date(req.query.dt) : new Date();
        if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid datetime in dt parameter' });
        try {
            const fmt = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(dt);
            if (!zone) {
                const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
                return res.json({ success: true, utc: dt.toISOString(), available_zones_count: zones.length, example: 'Use ?zone=America/New_York' });
            }
            const result = { success: true, zone, datetime: fmt(zone), utc_offset: dt.toLocaleString('en-US', { timeZone: zone, timeZoneName: 'short' }).split(' ').pop() };
            if (convert) result.converted = { zone: convert, datetime: fmt(convert) };
            logActivity('api_call', `Timezone: ${zone}`);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: `Invalid timezone: ${zone}. Use IANA format (e.g. America/New_York)` });
        }
    });

    // --- WORD STATS (free) ---
    router.get('/api/word-stats', paidEndpointLimiter, paymentMiddleware(0, 0, "Word Stats API"), async (req, res) => {
        const text = (req.query.text || req.body?.text || '').slice(0, 50000);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required" });
        const words = text.trim().split(/\s+/).filter(Boolean);
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        const chars = text.length;
        const charsNoSpace = text.replace(/\s/g, '').length;
        const readingTimeMin = Math.ceil(words.length / 200);
        const freq = {};
        words.forEach(w => { const k = w.toLowerCase().replace(/[^a-z]/g, ''); if (k.length > 2) freq[k] = (freq[k] || 0) + 1; });
        const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));
        logActivity('api_call', 'Word Stats API');
        res.json({ success: true, words: words.length, sentences: sentences.length, paragraphs: paragraphs.length, characters: chars, characters_no_spaces: charsNoSpace, reading_time_minutes: readingTimeMin, top_words: topWords });
    });

    return router;
}

module.exports = createFinanceRouter;
