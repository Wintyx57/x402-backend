// routes/wrappers/data.js — Data-related API wrappers
// weather, crypto, stocks, currency, timestamp, lorem, uuid, headers, useragent

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createDataRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- WEATHER API WRAPPER (0.02 USDC) ---
    router.get('/api/weather', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Weather API"), async (req, res) => {
        const city = (req.query.city || '').trim().slice(0, 100);

        if (!city) {
            return res.status(400).json({ error: "Parameter 'city' required. Ex: /api/weather?city=Paris" });
        }

        if (/[\x00-\x1F\x7F]/.test(city)) {
            return res.status(400).json({ error: 'Invalid characters in city name' });
        }

        try {
            const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
            const geocodeRes = await fetchWithTimeout(geocodeUrl, {}, 5000);
            const geocodeData = await geocodeRes.json();

            if (!geocodeData.results || geocodeData.results.length === 0) {
                return res.status(404).json({ error: 'City not found', city });
            }

            const location = geocodeData.results[0];
            const { latitude, longitude, name, country } = location;

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
            logger.error('Weather API', err.message);
            return res.status(500).json({ error: 'Weather API request failed' });
        }
    });

    // --- CRYPTO PRICE API WRAPPER (0.02 USDC) ---
    router.get('/api/crypto', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Crypto Price API"), async (req, res) => {
        const coin = (req.query.coin || '').trim().toLowerCase().slice(0, 50);

        if (!coin) {
            return res.status(400).json({ error: "Parameter 'coin' required. Ex: /api/crypto?coin=bitcoin" });
        }

        if (/[\x00-\x1F\x7F]/.test(coin)) {
            return res.status(400).json({ error: 'Invalid characters in coin name' });
        }

        const apiHeaders = { 'User-Agent': 'x402-bazaar/1.0', 'Accept': 'application/json' };

        try {
            const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,eur&include_24hr_change=true`;
            const apiRes = await fetchWithTimeout(apiUrl, { headers: apiHeaders }, 5000);

            if (apiRes.ok) {
                const data = await apiRes.json();
                if (data[coin]) {
                    const prices = data[coin];
                    logActivity('api_call', `Crypto Price API: ${coin}`);
                    return res.json({
                        success: true, coin,
                        usd: prices.usd, eur: prices.eur,
                        usd_24h_change: prices.usd_24h_change || 0,
                        source: 'coingecko'
                    });
                }
            }

            // Fallback: CryptoCompare API
            const symbolMap = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', dogecoin:'DOGE', cardano:'ADA', polkadot:'DOT', avalanche:'AVAX', chainlink:'LINK', polygon:'MATIC', litecoin:'LTC', uniswap:'UNI', stellar:'XLM', cosmos:'ATOM', near:'NEAR', arbitrum:'ARB', optimism:'OP', aptos:'APT', sui:'SUI', toncoin:'TON', tron:'TRX', ripple:'XRP' };
            const sym = symbolMap[coin] || coin.toUpperCase();
            const ccUrl = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(sym)}&tsyms=USD,EUR`;
            const ccRes = await fetchWithTimeout(ccUrl, { headers: apiHeaders }, 5000);

            if (ccRes.ok) {
                const ccData = await ccRes.json();
                if (ccData.RAW?.[sym]?.USD) {
                    const d = ccData.RAW[sym];
                    logActivity('api_call', `Crypto Price API (fallback): ${coin}`);
                    return res.json({
                        success: true, coin,
                        usd: d.USD.PRICE,
                        eur: d.EUR?.PRICE || null,
                        usd_24h_change: d.USD.CHANGEPCT24HOUR || 0,
                        source: 'cryptocompare'
                    });
                }
            }

            return res.status(404).json({ error: 'Cryptocurrency not found', coin });
        } catch (err) {
            logger.error('Crypto API', err.message);
            return res.status(500).json({ error: 'Crypto API request failed' });
        }
    });

    // --- STOCK PRICE API (0.005 USDC) ---
    router.get('/api/stocks', paidEndpointLimiter, paymentMiddleware(10000, 0.005, "Stock Price API"), async (req, res) => {
        const symbol = (req.query.symbol || '').trim().toUpperCase().slice(0, 10);

        if (!symbol) {
            return res.status(400).json({ error: "Parameter 'symbol' required. Ex: /api/stocks?symbol=AAPL" });
        }
        if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
            return res.status(400).json({ error: 'Invalid symbol format (letters, digits, dots only, max 10 chars)' });
        }

        try {
            // Yahoo Finance v8 public endpoint (no API key)
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
            const apiRes = await fetchWithTimeout(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
            }, 8000);
            const data = await apiRes.json();

            const result = data?.chart?.result?.[0];
            if (!result) {
                return res.status(404).json({ error: 'Symbol not found', symbol });
            }

            const meta = result.meta;
            const quotes = result.indicators?.quote?.[0] || {};
            const closes = quotes.close || [];
            const lastPrice = meta.regularMarketPrice || closes[closes.length - 1];
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = lastPrice && prevClose ? +(lastPrice - prevClose).toFixed(2) : null;
            const changePercent = lastPrice && prevClose ? +((change / prevClose) * 100).toFixed(2) : null;

            logActivity('api_call', `Stock Price API: ${symbol} -> $${lastPrice}`);
            res.json({
                success: true,
                symbol: meta.symbol || symbol,
                name: meta.shortName || meta.longName || symbol,
                currency: meta.currency || 'USD',
                price: lastPrice,
                previous_close: prevClose,
                change,
                change_percent: changePercent,
                market_state: meta.marketState || 'UNKNOWN',
                exchange: meta.exchangeName || 'UNKNOWN'
            });
        } catch (err) {
            logger.error('Stock Price API', err.message);
            return res.status(500).json({ error: 'Stock Price API request failed' });
        }
    });

    // --- CURRENCY CONVERTER API (0.005 USDC) ---
    router.get('/api/currency', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Currency Converter API"), async (req, res) => {
        const from = (req.query.from || '').trim().toUpperCase().slice(0, 3);
        const to = (req.query.to || '').trim().toUpperCase().slice(0, 3);
        const amount = parseFloat(req.query.amount) || 1;

        if (!from || !to) {
            return res.status(400).json({ error: "Parameters 'from' and 'to' required. Ex: /api/currency?from=USD&to=EUR&amount=100" });
        }
        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
            return res.status(400).json({ error: 'Currency codes must be 3 uppercase letters (ISO 4217)' });
        }
        if (amount <= 0 || amount > 1e12) {
            return res.status(400).json({ error: 'Amount must be between 0 and 1,000,000,000,000' });
        }

        try {
            const apiUrl = `https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}&amount=${amount}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (!data.rates || !data.rates[to]) {
                return res.status(400).json({ error: `Could not convert ${from} to ${to}. Check currency codes.` });
            }

            logActivity('api_call', `Currency API: ${amount} ${from} -> ${to}`);

            res.json({ success: true, from, to, amount, converted: data.rates[to], rate: data.rates[to] / amount, date: data.date });
        } catch (err) {
            logger.error('Currency Converter API', err.message);
            return res.status(500).json({ error: 'Currency Converter API request failed' });
        }
    });

    // --- TIMESTAMP CONVERTER API (0.001 USDC) ---
    router.get('/api/timestamp', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Timestamp Converter API"), async (req, res) => {
        const ts = (req.query.ts || '').trim();
        const date = (req.query.date || '').trim();

        if (!ts && !date) {
            // Return current timestamp
            const now = new Date();
            logActivity('api_call', `Timestamp API: current time`);
            return res.json({
                success: true,
                timestamp: Math.floor(now.getTime() / 1000),
                timestamp_ms: now.getTime(),
                iso: now.toISOString(),
                utc: now.toUTCString(),
                unix_readable: now.toString()
            });
        }

        if (ts) {
            const num = parseInt(ts);
            if (isNaN(num) || num < 0 || num > 32503680000) {
                return res.status(400).json({ error: 'Invalid timestamp (must be 0-32503680000)' });
            }
            const d = new Date(num > 1e11 ? num : num * 1000);
            logActivity('api_call', `Timestamp API: ts -> date`);
            return res.json({ success: true, timestamp: Math.floor(d.getTime() / 1000), timestamp_ms: d.getTime(), iso: d.toISOString(), utc: d.toUTCString() });
        }

        if (date) {
            const d = new Date(date);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 (e.g., 2026-01-15T12:00:00Z)' });
            }
            logActivity('api_call', `Timestamp API: date -> ts`);
            return res.json({ success: true, timestamp: Math.floor(d.getTime() / 1000), timestamp_ms: d.getTime(), iso: d.toISOString(), utc: d.toUTCString() });
        }
    });

    // --- LOREM IPSUM GENERATOR API (0.001 USDC) ---
    router.get('/api/lorem', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Lorem Ipsum Generator API"), async (req, res) => {
        let paragraphs = parseInt(req.query.paragraphs) || 3;
        paragraphs = Math.max(1, Math.min(20, paragraphs));

        const LOREM_WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');

        function genSentence() {
            const len = 8 + Math.floor(Math.random() * 12);
            const words = [];
            for (let i = 0; i < len; i++) {
                words.push(LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)]);
            }
            words[0] = words[0][0].toUpperCase() + words[0].slice(1);
            return words.join(' ') + '.';
        }

        function genParagraph() {
            const count = 3 + Math.floor(Math.random() * 5);
            return Array.from({ length: count }, genSentence).join(' ');
        }

        const text = Array.from({ length: paragraphs }, genParagraph);

        logActivity('api_call', `Lorem Ipsum API: ${paragraphs} paragraphs`);

        res.json({ success: true, paragraphs: text, count: paragraphs, total_words: text.join(' ').split(/\s+/).length });
    });

    // --- UUID GENERATOR API (0.001 USDC) ---
    router.get('/api/uuid', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "UUID Generator API"), async (req, res) => {
        let count = parseInt(req.query.count) || 1;
        count = Math.max(1, Math.min(100, count));

        const crypto = require('crypto');
        const uuids = Array.from({ length: count }, () => crypto.randomUUID());

        logActivity('api_call', `UUID Generator API: ${count} UUIDs`);

        res.json({ success: true, uuids, count });
    });

    // --- HTTP HEADERS INSPECTOR API (0.003 USDC) ---
    router.get('/api/headers', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "HTTP Headers API"), async (req, res) => {
        const targetUrl = (req.query.url || '').trim();

        if (!targetUrl) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/headers?url=https://example.com" });
        }

        let parsed;
        try {
            parsed = new URL(targetUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
            }
        } catch {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        const blockedHostname = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\])/i;
        if (blockedHostname.test(parsed.hostname)) {
            return res.status(400).json({ error: 'Internal URLs not allowed' });
        }

        try {
            const headRes = await fetchWithTimeout(targetUrl, { method: 'HEAD', redirect: 'follow' }, 8000);
            const headers = {};
            headRes.headers.forEach((value, key) => { headers[key] = value; });

            logActivity('api_call', `HTTP Headers API: ${parsed.hostname}`);

            res.json({ success: true, url: targetUrl, status: headRes.status, headers });
        } catch (err) {
            logger.error('HTTP Headers API', err.message);
            return res.status(500).json({ error: 'HTTP Headers request failed' });
        }
    });

    // --- USER AGENT PARSER API (0.001 USDC) ---
    router.get('/api/useragent', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "User Agent Parser API"), async (req, res) => {
        const ua = (req.query.ua || req.headers['user-agent'] || '').trim();

        if (!ua) {
            return res.status(400).json({ error: "Parameter 'ua' required (or sends your own User-Agent). Ex: /api/useragent?ua=Mozilla/5.0..." });
        }
        if (ua.length > 1000) {
            return res.status(400).json({ error: 'User agent too long (max 1000 characters)' });
        }

        // Simple UA parsing (no external deps)
        const browser = ua.match(/(?:Chrome|Firefox|Safari|Edge|Opera|MSIE|Trident|Brave|Vivaldi|Arc|SamsungBrowser)[\/\s]?([\d.]+)?/i);
        const os = ua.match(/(?:Windows NT [\d.]+|Mac OS X [\d._]+|Linux|Android [\d.]+|iPhone OS [\d_]+|iPad|CrOS)/i);
        const isBot = /bot|crawler|spider|scraper|curl|wget|python|httpx|node-fetch|axios/i.test(ua);
        const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

        logActivity('api_call', `User Agent Parser API`);

        res.json({
            success: true,
            user_agent: ua,
            browser: browser ? browser[0] : 'Unknown',
            os: os ? os[0].replace(/_/g, '.') : 'Unknown',
            is_mobile: isMobile,
            is_bot: isBot,
            engine: ua.includes('Gecko') ? 'Gecko' : ua.includes('WebKit') ? 'WebKit' : ua.includes('Trident') ? 'Trident' : 'Unknown'
        });
    });

    return router;
}

module.exports = createDataRouter;
