// routes/wrappers/data.js — Data-related API wrappers
// weather, crypto, stocks, currency, timestamp, lorem, uuid, headers, useragent

const crypto = require('crypto');
const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { safeUrl } = require('../../lib/safe-url');

// --- Crypto price cache (5min TTL) ---
const cryptoCache = new Map();
const CRYPTO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedCrypto(coin) {
    const entry = cryptoCache.get(coin);
    if (entry && (Date.now() - entry.ts) < CRYPTO_CACHE_TTL) return entry.data;
    return null;
}

function setCachedCrypto(coin, data) {
    cryptoCache.set(coin, { data, ts: Date.now() });
    // Prevent unbounded growth
    if (cryptoCache.size > 200) {
        const oldest = cryptoCache.keys().next().value;
        cryptoCache.delete(oldest);
    }
}

// --- Weather cache (10min TTL) ---
const weatherCache = new Map();
const WEATHER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedWeather(city) {
    const key = city.toLowerCase();
    const entry = weatherCache.get(key);
    if (entry && (Date.now() - entry.ts) < WEATHER_CACHE_TTL) return entry.data;
    return null;
}

function setCachedWeather(city, data) {
    const key = city.toLowerCase();
    weatherCache.set(key, { data, ts: Date.now() });
    if (weatherCache.size > 200) {
        const oldest = weatherCache.keys().next().value;
        weatherCache.delete(oldest);
    }
}

function createDataRouter(logActivity, paymentMiddleware, paidEndpointLimiter) {
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
            // Check cache first (10min TTL)
            const cached = getCachedWeather(city);
            if (cached) {
                logActivity('api_call', `Weather API (cached): ${city}`);
                return res.json(cached);
            }

            // Primary: Open-Meteo (geocode + forecast)
            let weatherResult = null;
            try {
                const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
                const geocodeRes = await fetchWithTimeout(geocodeUrl, {}, 8000);
                const geocodeData = await geocodeRes.json();

                if (!geocodeData.results || geocodeData.results.length === 0) {
                    return res.status(404).json({ error: 'City not found', city });
                }

                const location = geocodeData.results[0];
                const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true&timezone=auto`;
                const weatherRes = await fetchWithTimeout(weatherUrl, {}, 8000);
                const weatherData = await weatherRes.json();

                if (weatherData.current_weather) {
                    const c = weatherData.current_weather;
                    weatherResult = {
                        city: location.name, country: location.country || 'Unknown',
                        temperature: c.temperature, wind_speed: c.windspeed,
                        weather_code: c.weathercode, time: c.time, source: 'open-meteo',
                    };
                }
            } catch (primaryErr) {
                logger.warn('Weather API', `Open-Meteo failed: ${primaryErr.message}, trying fallback`);
            }

            // Fallback: wttr.in (no geocoding needed)
            if (!weatherResult) {
                try {
                    const wttrUrl = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
                    const wttrRes = await fetchWithTimeout(wttrUrl, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 8000);
                    const wttrData = await wttrRes.json();
                    const cur = wttrData.current_condition?.[0];
                    const area = wttrData.nearest_area?.[0];
                    if (cur) {
                        weatherResult = {
                            city: area?.areaName?.[0]?.value || city,
                            country: area?.country?.[0]?.value || 'Unknown',
                            temperature: parseFloat(cur.temp_C),
                            wind_speed: parseFloat(cur.windspeedKmph),
                            weather_code: parseInt(cur.weatherCode, 10) || 0,
                            time: cur.localObsDateTime || new Date().toISOString(),
                            source: 'wttr.in',
                        };
                    }
                } catch (fallbackErr) {
                    logger.warn('Weather API', `wttr.in fallback also failed: ${fallbackErr.message}`);
                }
            }

            if (!weatherResult) {
                return res.status(502).json({ error: 'Weather data temporarily unavailable. Both upstreams failed.' });
            }

            logActivity('api_call', `Weather API: ${city} -> ${weatherResult.city}, ${weatherResult.country}`);
            const weatherResponse = { success: true, ...weatherResult };
            setCachedWeather(city, weatherResponse);
            res.json(weatherResponse);
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
            // Check cache first (5min TTL)
            const cached = getCachedCrypto(coin);
            if (cached) {
                logActivity('api_call', `Crypto Price API (cached): ${coin}`);
                return res.json(cached);
            }

            // Primary: CoinGecko (with retry on empty response / rate limit)
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,eur&include_24hr_change=true`;
                    const apiRes = await fetchWithTimeout(apiUrl, { headers: apiHeaders }, 8000);

                    if (apiRes.status === 429) {
                        logger.warn('Crypto API', `CoinGecko 429 rate limit (attempt ${attempt + 1}/2)`);
                        if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
                        break;
                    }

                    if (apiRes.ok) {
                        const data = await apiRes.json();
                        if (data[coin] && data[coin].usd !== undefined) {
                            const prices = data[coin];
                            logActivity('api_call', `Crypto Price API: ${coin}`);
                            const result = {
                                success: true, coin,
                                usd: prices.usd, eur: prices.eur,
                                usd_24h_change: prices.usd_24h_change || 0,
                                source: 'coingecko'
                            };
                            setCachedCrypto(coin, result);
                            return res.json(result);
                        }
                        // Empty response (CoinGecko returned {} or coin not in result) — try fallback
                        break;
                    }
                } catch (cgErr) {
                    logger.warn('Crypto API', `CoinGecko error (attempt ${attempt + 1}/2): ${cgErr.message}`);
                    if (attempt === 0) continue;
                }
                break;
            }

            // Fallback: CryptoCompare API
            const symbolMap = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', dogecoin:'DOGE', cardano:'ADA', polkadot:'DOT', avalanche:'AVAX', chainlink:'LINK', polygon:'MATIC', litecoin:'LTC', uniswap:'UNI', stellar:'XLM', cosmos:'ATOM', near:'NEAR', arbitrum:'ARB', optimism:'OP', aptos:'APT', sui:'SUI', toncoin:'TON', tron:'TRX', ripple:'XRP' };
            const sym = symbolMap[coin] || coin.toUpperCase();
            const ccUrl = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(sym)}&tsyms=USD,EUR`;
            const ccRes = await fetchWithTimeout(ccUrl, { headers: apiHeaders }, 8000);

            if (ccRes.ok) {
                const ccData = await ccRes.json();
                if (ccData.RAW?.[sym]?.USD) {
                    const d = ccData.RAW[sym];
                    logActivity('api_call', `Crypto Price API (fallback): ${coin}`);
                    const result = {
                        success: true, coin,
                        usd: d.USD.PRICE,
                        eur: d.EUR?.PRICE || null,
                        usd_24h_change: d.USD.CHANGEPCT24HOUR || 0,
                        source: 'cryptocompare'
                    };
                    setCachedCrypto(coin, result);
                    return res.json(result);
                }
                logger.warn('Crypto API', `CryptoCompare returned OK but no data for symbol ${sym}`);
            }

            // Fallback 2: Binance API (symbol-based, no coin ID)
            try {
                const binanceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}USDT`;
                const binRes = await fetchWithTimeout(binanceUrl, { headers: apiHeaders }, 8000);
                if (binRes.ok) {
                    const binData = await binRes.json();
                    if (binData.price) {
                        logActivity('api_call', `Crypto Price API (binance): ${coin}`);
                        const result = {
                            success: true, coin,
                            usd: parseFloat(binData.price),
                            eur: null,
                            usd_24h_change: 0,
                            source: 'binance'
                        };
                        setCachedCrypto(coin, result);
                        return res.json(result);
                    }
                    logger.warn('Crypto API', `Binance returned OK but no price for symbol ${sym}USDT`);
                }
            } catch (binErr) {
                logger.warn('Crypto API', `Binance fallback also failed: ${binErr.message}`);
            }

            // Fallback 3: CoinCap API (free, no key, reliable)
            try {
                const capUrl = `https://api.coincap.io/v2/assets/${encodeURIComponent(coin)}`;
                const capRes = await fetchWithTimeout(capUrl, { headers: apiHeaders }, 8000);
                if (capRes.ok) {
                    const capData = await capRes.json();
                    if (capData.data && capData.data.priceUsd) {
                        const d = capData.data;
                        logActivity('api_call', `Crypto Price API (coincap): ${coin}`);
                        const result = {
                            success: true, coin,
                            usd: parseFloat(d.priceUsd),
                            eur: null,
                            usd_24h_change: parseFloat(d.changePercent24Hr) || 0,
                            source: 'coincap'
                        };
                        setCachedCrypto(coin, result);
                        return res.json(result);
                    }
                }
            } catch (capErr) {
                logger.warn('Crypto API', `CoinCap fallback also failed: ${capErr.message}`);
            }

            return res.status(404).json({ error: 'Cryptocurrency not found', coin });
        } catch (err) {
            logger.error('Crypto API', err.message);
            return res.status(500).json({ error: 'Crypto API request failed' });
        }
    });

    // --- STOCK PRICE API (0.005 USDC) ---
    router.get('/api/stocks', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Stock Price API"), async (req, res) => {
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

        try {
            await safeUrl(targetUrl);
        } catch (e) {
            return res.status(400).json({ error: e.message });
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

    // --- BTC ADDRESS INFO API (0.005 USDC) ---
    router.get('/api/btc-address', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "BTC Address Info API"), async (req, res) => {
        const address = (req.query.address || '').trim().slice(0, 100);

        if (!address) {
            return res.status(400).json({ error: "Parameter 'address' required. Ex: /api/btc-address?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" });
        }

        if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/.test(address)) {
            return res.status(400).json({ error: 'Invalid Bitcoin address format' });
        }

        try {
            const apiUrl = `https://blockchain.info/rawaddr/${encodeURIComponent(address)}?limit=0`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 10000);

            if (!apiRes.ok) {
                return res.status(404).json({ error: 'Bitcoin address not found', address });
            }

            const data = await apiRes.json();

            logActivity('api_call', `BTC Address Info API: ${address.slice(0, 10)}...`);
            res.json({
                success: true,
                address: data.address,
                balance_satoshi: data.final_balance || 0,
                balance_btc: (data.final_balance || 0) / 1e8,
                total_received_satoshi: data.total_received || 0,
                total_sent_satoshi: data.total_sent || 0,
                tx_count: data.n_tx || 0
            });
        } catch (err) {
            logger.error('BTC Address Info API', err.message);
            return res.status(500).json({ error: 'BTC Address Info API request failed' });
        }
    });

    // --- ETH GAS PRICE API (0.003 USDC) ---
    router.get('/api/eth-gas', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "ETH Gas Price API"), async (req, res) => {
        try {
            // Fetch gas prices from multiple chains
            const chains = [
                { name: 'ethereum', rpc: 'https://eth.llamarpc.com' },
                { name: 'base', rpc: 'https://base.publicnode.com' },
                { name: 'polygon', rpc: 'https://polygon.publicnode.com' }
            ];

            const results = {};
            await Promise.all(chains.map(async (chain) => {
                try {
                    const rpcRes = await fetchWithTimeout(chain.rpc, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 })
                    }, 5000);
                    const rpcData = await rpcRes.json();
                    if (rpcData.result) {
                        const weiPrice = parseInt(rpcData.result, 16);
                        results[chain.name] = {
                            wei: weiPrice,
                            gwei: +(weiPrice / 1e9).toFixed(4)
                        };
                    }
                } catch {
                    // Skip failed chains
                }
            }));

            if (Object.keys(results).length === 0) {
                return res.status(502).json({ error: 'Could not fetch gas prices from any chain' });
            }

            logActivity('api_call', `ETH Gas Price API: ${Object.keys(results).join(', ')}`);
            res.json({ success: true, chains: results, timestamp: Math.floor(Date.now() / 1000) });
        } catch (err) {
            logger.error('ETH Gas Price API', err.message);
            return res.status(500).json({ error: 'ETH Gas Price API request failed' });
        }
    });

    // --- ELEVATION API (0.003 USDC) ---
    router.get('/api/elevation', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Elevation API"), async (req, res) => {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: "Parameters 'lat' and 'lon' required. Ex: /api/elevation?lat=48.85&lon=2.35" });
        }
        if (lat < -90 || lat > 90) {
            return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
        }
        if (lon < -180 || lon > 180) {
            return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
        }

        try {
            const apiUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 10000);
            const data = await apiRes.json();

            const result = data.results?.[0];
            if (!result) {
                return res.status(500).json({ error: 'Could not get elevation data' });
            }

            logActivity('api_call', `Elevation API: ${lat},${lon} -> ${result.elevation}m`);
            res.json({
                success: true,
                latitude: result.latitude,
                longitude: result.longitude,
                elevation_meters: result.elevation,
                elevation_feet: +(result.elevation * 3.28084).toFixed(1)
            });
        } catch (err) {
            logger.error('Elevation API', err.message);
            return res.status(500).json({ error: 'Elevation API request failed' });
        }
    });

    // --- TIMEZONE API (0.003 USDC) ---
    router.get('/api/timezone', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Timezone API"), async (req, res) => {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: "Parameters 'lat' and 'lon' required. Ex: /api/timezone?lat=48.85&lon=2.35" });
        }
        if (lat < -90 || lat > 90) {
            return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
        }
        if (lon < -180 || lon > 180) {
            return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
        }

        try {
            const apiUrl = `https://timeapi.io/api/time/current/coordinate?latitude=${lat}&longitude=${lon}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (!data.timeZone) {
                return res.status(500).json({ error: 'Could not determine timezone' });
            }

            logActivity('api_call', `Timezone API: ${lat},${lon} -> ${data.timeZone}`);
            res.json({
                success: true,
                latitude: lat,
                longitude: lon,
                timezone: data.timeZone,
                datetime: data.dateTime || '',
                date: data.date || '',
                time: data.time || '',
                day_of_week: data.dayOfWeek || '',
                utc_offset: data.currentUtcOffset?.standardOffset || ''
            });
        } catch (err) {
            logger.error('Timezone API', err.message);
            return res.status(500).json({ error: 'Timezone API request failed' });
        }
    });

    return router;
}

module.exports = createDataRouter;
