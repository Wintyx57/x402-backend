// routes/wrappers.js — ALL /api/* wrapper endpoints

const express = require('express');
const dns = require('dns');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { evaluate } = require('mathjs');
const logger = require('../lib/logger');
const { fetchWithTimeout } = require('../lib/payment');

function createWrappersRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
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

    // --- RANDOM JOKE API WRAPPER (0.01 USDC) ---
    router.get('/api/joke', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Random Joke API"), async (req, res) => {
        try {
            const apiUrl = 'https://official-joke-api.appspot.com/random_joke';
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!data.setup || !data.punchline) {
                return res.status(500).json({ error: 'Invalid joke data received' });
            }

            logActivity('api_call', `Random Joke API: ${data.type || 'general'}`);

            res.json({
                success: true,
                setup: data.setup,
                punchline: data.punchline,
                type: data.type || 'general'
            });
        } catch (err) {
            logger.error('Joke API', err.message);
            return res.status(500).json({ error: 'Joke API request failed' });
        }
    });

    // --- WEB SEARCH API WRAPPER (0.005 USDC) ---
    router.get('/api/search', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Web Search API"), async (req, res) => {
        const query = (req.query.q || '').trim().slice(0, 200);

        if (!query) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/search?q=bitcoin+price" });
        }

        if (/[\x00-\x1F\x7F]/.test(query)) {
            return res.status(400).json({ error: 'Invalid characters in query' });
        }

        const maxResults = Math.min(Math.max(1, parseInt(req.query.max) || 10), 20);

        try {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const searchRes = await fetchWithTimeout(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
            }, 8000);
            const html = await searchRes.text();

            const $ = cheerio.load(html);
            const results = [];

            $('.result').each((i, el) => {
                if (results.length >= maxResults) return false;
                const $el = $(el);
                const title = $el.find('.result__a').text().trim();
                const snippet = $el.find('.result__snippet').text().trim();
                const rawHref = $el.find('.result__a').attr('href') || '';

                let url = rawHref;
                try {
                    const parsed = new URL(rawHref, 'https://duckduckgo.com');
                    url = parsed.searchParams.get('uddg') || rawHref;
                } catch {}
                if (url.startsWith('//')) url = 'https:' + url;

                if (title && url) {
                    results.push({ title, url, snippet });
                }
            });

            logActivity('api_call', `Web Search API: "${query}" -> ${results.length} results`);

            res.json({
                success: true,
                query,
                results_count: results.length,
                results
            });
        } catch (err) {
            logger.error('Search API', err.message);
            return res.status(500).json({ error: 'Search API request failed' });
        }
    });

    // --- UNIVERSAL SCRAPER API WRAPPER (0.005 USDC) ---
    router.get('/api/scrape', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Universal Scraper API"), async (req, res) => {
        const targetUrl = (req.query.url || '').trim();

        if (!targetUrl) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/scrape?url=https://example.com" });
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

        // SECURITY: Block internal/private IPs and cloud metadata endpoints
        const blockedHostname = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\]|\[::ffff:)/i;
        if (blockedHostname.test(parsed.hostname)) {
            return res.status(400).json({ error: 'Internal URLs not allowed' });
        }

        // SECURITY: DNS resolution check to prevent DNS rebinding attacks
        try {
            const { address } = await dns.promises.lookup(parsed.hostname);
            const isPrivateIP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(address);
            if (isPrivateIP) {
                return res.status(400).json({ error: 'Internal URLs not allowed' });
            }
        } catch (dnsErr) {
            return res.status(400).json({ error: 'Could not resolve hostname' });
        }

        try {
            const pageRes = await fetchWithTimeout(targetUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' },
                redirect: 'follow',
            }, 10000);

            const contentLength = parseInt(pageRes.headers.get('content-length') || '0');
            if (contentLength > 5 * 1024 * 1024) {
                return res.status(400).json({ error: 'Page too large (max 5MB)' });
            }

            const contentType = pageRes.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                return res.status(400).json({ error: 'URL does not return HTML or text content', content_type: contentType });
            }

            const html = await pageRes.text();

            if (html.length > 5 * 1024 * 1024) {
                return res.status(400).json({ error: 'Page too large (max 5MB)' });
            }

            const $ = cheerio.load(html);

            $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"], .sidebar, .menu, .nav, .footer, .header, .ad, .ads, .advertisement').remove();

            const title = $('title').text().trim() || $('h1').first().text().trim() || '';
            const metaDesc = $('meta[name="description"]').attr('content') || '';

            let contentHtml = $('article').html() || $('main').html() || $('[role="main"]').html() || $('body').html() || '';

            const turndown = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                linkStyle: 'inlined',
            });
            turndown.remove(['img', 'figure', 'picture']);
            turndown.addRule('fixProtocolRelativeUrls', {
                filter: 'a',
                replacement: (content, node) => {
                    let href = node.getAttribute('href') || '';
                    if (href.startsWith('//')) href = 'https:' + href;
                    return content ? `[${content}](${href})` : '';
                }
            });

            let markdown = turndown.turndown(contentHtml);
            markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

            if (markdown.length > 50000) {
                markdown = markdown.slice(0, 50000) + '\n\n[...truncated]';
            }

            logActivity('api_call', `Scraper API: ${parsed.hostname} -> ${markdown.length} chars`);

            res.json({
                success: true,
                url: targetUrl,
                title,
                description: metaDesc,
                content: markdown,
                content_length: markdown.length
            });
        } catch (err) {
            logger.error('Scraper API', err.message);
            return res.status(500).json({ error: 'Scraper API request failed' });
        }
    });

    // --- TWITTER/X DATA API WRAPPER (0.005 USDC) ---
    router.get('/api/twitter', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Twitter/X Data API"), async (req, res) => {
        const username = (req.query.user || '').trim().replace(/^@/, '').slice(0, 50);
        const tweetUrl = (req.query.tweet || '').trim();
        const searchQuery = (req.query.search || '').trim().slice(0, 200);
        const maxResults = Math.min(Math.max(parseInt(req.query.max) || 10, 1), 20);

        if (!username && !tweetUrl && !searchQuery) {
            return res.status(400).json({
                error: "Parameter 'user', 'tweet', or 'search' required.",
                examples: [
                    "/api/twitter?user=elonmusk",
                    "/api/twitter?tweet=https://x.com/user/status/123456789",
                    "/api/twitter?search=bitcoin&max=10"
                ]
            });
        }

        if (username && !/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
            return res.status(400).json({ error: 'Invalid Twitter username format' });
        }
        if (searchQuery && /[\x00-\x1F\x7F]/.test(searchQuery)) {
            return res.status(400).json({ error: 'Invalid characters in search query' });
        }

        try {
            // Tweet search via DuckDuckGo site:twitter.com
            if (searchQuery) {
                const ddgUrl = `https://html.duckduckgo.com/html/?q=site%3Atwitter.com+${encodeURIComponent(searchQuery)}`;
                const ddgRes = await fetchWithTimeout(ddgUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
                }, 10000);
                const ddgHtml = await ddgRes.text();

                const $ = cheerio.load(ddgHtml);
                const results = [];

                $('.result').each((i, el) => {
                    if (results.length >= maxResults) return false;

                    const linkEl = $(el).find('.result__a');
                    const snippetEl = $(el).find('.result__snippet');
                    const url = linkEl.attr('href') || '';
                    const title = linkEl.text().trim();
                    const snippet = snippetEl.text().trim();

                    if (url && (url.includes('twitter.com') || url.includes('x.com'))) {
                        const authorMatch = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
                        const author = authorMatch ? authorMatch[1] : null;

                        results.push({
                            title,
                            text: snippet,
                            url,
                            author: author !== 'search' && author !== 'hashtag' ? author : null,
                        });
                    }
                });

                logActivity('api_call', `Twitter API: search "${searchQuery}" -> ${results.length} results`);

                return res.json({
                    success: true,
                    type: 'search',
                    query: searchQuery,
                    results_count: results.length,
                    results,
                });
            }

            if (tweetUrl) {
                const tweetMatch = tweetUrl.match(/status\/(\d+)/);
                if (!tweetMatch) {
                    return res.status(400).json({ error: 'Invalid tweet URL. Expected format: https://x.com/user/status/123456789' });
                }
                const tweetId = tweetMatch[1];

                const apiUrl = `https://api.fxtwitter.com/x/status/${tweetId}`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: { 'User-Agent': 'x402-bazaar/1.0' }
                }, 8000);
                const data = await apiRes.json();

                if (!data.tweet) {
                    return res.status(404).json({ error: 'Tweet not found or unavailable' });
                }

                const tweet = data.tweet;
                logActivity('api_call', `Twitter API: tweet ${tweetId}`);

                res.json({
                    success: true,
                    type: 'tweet',
                    tweet: {
                        id: tweet.id,
                        text: tweet.text,
                        created_at: tweet.created_at,
                        likes: tweet.likes,
                        retweets: tweet.retweets,
                        replies: tweet.replies,
                        views: tweet.views,
                        author: {
                            name: tweet.author?.name,
                            username: tweet.author?.screen_name,
                            followers: tweet.author?.followers,
                            verified: tweet.author?.verified,
                        },
                        media: tweet.media?.photos?.map(p => p.url) || [],
                        url: tweet.url
                    }
                });
            } else {
                // Profile lookup via fxtwitter
                const apiUrl = `https://api.fxtwitter.com/${username}`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: { 'User-Agent': 'x402-bazaar/1.0' }
                }, 8000);
                const data = await apiRes.json();

                if (!data.user && !data.tweet) {
                    const synUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`;
                    const synRes = await fetchWithTimeout(synUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
                    }, 8000);
                    const synHtml = await synRes.text();

                    const $s = cheerio.load(synHtml);
                    const profileName = $s('[data-testid="UserName"]').text().trim() || username;

                    const tweets = [];
                    $s('[data-testid="tweet"]').each((i, el) => {
                        if (tweets.length >= 5) return false;
                        const tweetText = $s(el).find('[data-testid="tweetText"]').text().trim();
                        if (tweetText) tweets.push(tweetText);
                    });

                    logActivity('api_call', `Twitter API: profile @${username} (syndication)`);

                    return res.json({
                        success: true,
                        type: 'profile',
                        user: {
                            username,
                            name: profileName,
                            recent_tweets: tweets,
                            source: 'syndication'
                        }
                    });
                }

                const user = data.user || data.tweet?.author;
                logActivity('api_call', `Twitter API: profile @${username}`);

                res.json({
                    success: true,
                    type: 'profile',
                    user: {
                        username: user?.screen_name || username,
                        name: user?.name,
                        description: user?.description,
                        followers: user?.followers,
                        following: user?.following,
                        tweets_count: user?.tweets,
                        verified: user?.verified,
                        avatar: user?.avatar_url,
                        banner: user?.banner_url,
                    },
                    latest_tweet: data.tweet ? {
                        text: data.tweet.text,
                        created_at: data.tweet.created_at,
                        likes: data.tweet.likes,
                        retweets: data.tweet.retweets,
                    } : null
                });
            }
        } catch (err) {
            logger.error('Twitter API', err.message);
            return res.status(500).json({ error: 'Twitter API request failed' });
        }
    });

    // --- IMAGE GENERATION API (DALL-E 3) - 0.05 USDC ---
    const IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024'];
    const IMAGE_QUALITIES = ['standard', 'hd'];

    router.get('/api/image', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Image Generation API"), async (req, res) => {
        try {
            const prompt = (req.query.prompt || '').trim();
            const size = (req.query.size || '1024x1024').trim();
            const quality = (req.query.quality || 'standard').trim();

            if (!prompt) {
                return res.status(400).json({ error: "Parameter 'prompt' is required. Ex: /api/image?prompt=a+cat+in+space" });
            }
            if (prompt.length > 1000) {
                return res.status(400).json({ error: 'Prompt too long (max 1000 characters)' });
            }
            if (/[\x00-\x1F\x7F]/.test(prompt)) {
                return res.status(400).json({ error: 'Invalid characters in prompt' });
            }

            if (!IMAGE_SIZES.includes(size)) {
                return res.status(400).json({
                    error: `Invalid size. Accepted: ${IMAGE_SIZES.join(', ')}`,
                });
            }

            if (!IMAGE_QUALITIES.includes(quality)) {
                return res.status(400).json({
                    error: `Invalid quality. Accepted: ${IMAGE_QUALITIES.join(', ')}`,
                });
            }

            const response = await getOpenAI().images.generate({
                model: 'dall-e-3',
                prompt,
                size,
                quality,
                n: 1,
            });

            const image = response.data[0];
            logActivity('api_call', `Image API: "${prompt.slice(0, 80)}..." (${size}, ${quality})`);

            res.json({
                success: true,
                prompt,
                revised_prompt: image.revised_prompt,
                image_url: image.url,
                size,
                quality,
            });
        } catch (err) {
            logger.error('Image API', err.message);

            if (err.status === 400 || err.code === 'content_policy_violation') {
                return res.status(400).json({
                    error: 'Content policy violation',
                    message: 'Your prompt was rejected by the content safety system. Please modify your prompt.',
                });
            }
            if (err.status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'OpenAI rate limit reached. Please try again in a few seconds.',
                });
            }

            return res.status(500).json({ error: 'Image generation failed' });
        }
    });

    // --- WIKIPEDIA SUMMARY API WRAPPER (0.005 USDC) ---
    router.get('/api/wikipedia', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Wikipedia Summary API"), async (req, res) => {
        const query = (req.query.q || '').trim().slice(0, 200);

        if (!query) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/wikipedia?q=Bitcoin" });
        }

        if (/[\x00-\x1F\x7F]/.test(query)) {
            return res.status(400).json({ error: 'Invalid characters in query' });
        }

        try {
            const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.type === 'disambiguation' || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
                return res.status(404).json({ error: 'Article not found or is a disambiguation page', query });
            }

            logActivity('api_call', `Wikipedia API: "${query}"`);

            res.json({
                success: true,
                title: data.title,
                extract: data.extract,
                description: data.description || '',
                thumbnail: data.thumbnail?.source || null,
                url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`
            });
        } catch (err) {
            logger.error('Wikipedia API', err.message);
            return res.status(500).json({ error: 'Wikipedia API request failed' });
        }
    });

    // --- DICTIONARY API WRAPPER (0.005 USDC) ---
    router.get('/api/dictionary', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Dictionary API"), async (req, res) => {
        const word = (req.query.word || '').trim().toLowerCase().slice(0, 100);

        if (!word) {
            return res.status(400).json({ error: "Parameter 'word' required. Ex: /api/dictionary?word=hello" });
        }

        if (/[\x00-\x1F\x7F]/.test(word)) {
            return res.status(400).json({ error: 'Invalid characters in word' });
        }

        try {
            const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(404).json({ error: 'Word not found', word });
            }

            const entry = data[0];
            const meanings = (entry.meanings || []).map(m => ({
                partOfSpeech: m.partOfSpeech,
                definitions: (m.definitions || []).slice(0, 3).map(d => d.definition)
            }));

            logActivity('api_call', `Dictionary API: "${word}"`);

            res.json({
                success: true,
                word: entry.word,
                phonetic: entry.phonetic || '',
                meanings,
                sourceUrl: entry.sourceUrls?.[0] || ''
            });
        } catch (err) {
            logger.error('Dictionary API', err.message);
            return res.status(500).json({ error: 'Dictionary API request failed' });
        }
    });

    // --- COUNTRIES API WRAPPER (0.005 USDC) ---
    router.get('/api/countries', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Countries API"), async (req, res) => {
        const name = (req.query.name || '').trim().slice(0, 100);

        if (!name) {
            return res.status(400).json({ error: "Parameter 'name' required. Ex: /api/countries?name=France" });
        }

        if (/[\x00-\x1F\x7F]/.test(name)) {
            return res.status(400).json({ error: 'Invalid characters in country name' });
        }

        try {
            const apiUrl = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,region,subregion,currencies,languages,flags,timezones`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(404).json({ error: 'Country not found', name });
            }

            const country = data[0];
            const currencies = country.currencies ? Object.values(country.currencies).map(c => c.name) : [];
            const languages = country.languages ? Object.values(country.languages) : [];

            logActivity('api_call', `Countries API: "${name}"`);

            res.json({
                success: true,
                name: country.name?.common || name,
                official: country.name?.official || '',
                capital: country.capital?.[0] || '',
                population: country.population || 0,
                region: country.region || '',
                subregion: country.subregion || '',
                currencies,
                languages,
                flag: country.flags?.svg || country.flags?.png || '',
                timezones: country.timezones || []
            });
        } catch (err) {
            logger.error('Countries API', err.message);
            return res.status(500).json({ error: 'Countries API request failed' });
        }
    });

    // --- GITHUB API WRAPPER (0.005 USDC) ---
    router.get('/api/github', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "GitHub API"), async (req, res) => {
        const user = (req.query.user || '').trim().slice(0, 100);
        const repo = (req.query.repo || '').trim().slice(0, 200);

        if (!user && !repo) {
            return res.status(400).json({
                error: "Parameter 'user' or 'repo' required.",
                examples: ["/api/github?user=torvalds", "/api/github?repo=facebook/react"]
            });
        }

        if (user && !/^[a-zA-Z0-9_-]+$/.test(user)) {
            return res.status(400).json({ error: 'Invalid GitHub username format' });
        }
        if (repo && !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
            return res.status(400).json({ error: 'Invalid GitHub repo format (expected: owner/repo)' });
        }

        try {
            if (user) {
                const apiUrl = `https://api.github.com/users/${encodeURIComponent(user)}`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: { 'User-Agent': 'x402-bazaar' }
                }, 5000);
                const data = await apiRes.json();

                if (data.message === 'Not Found') {
                    return res.status(404).json({ error: 'User not found', user });
                }

                logActivity('api_call', `GitHub API: user ${user}`);

                return res.json({
                    success: true,
                    type: 'user',
                    login: data.login,
                    name: data.name || '',
                    bio: data.bio || '',
                    public_repos: data.public_repos || 0,
                    followers: data.followers || 0,
                    following: data.following || 0,
                    avatar: data.avatar_url || '',
                    url: data.html_url || '',
                    created_at: data.created_at || ''
                });
            } else {
                const apiUrl = `https://api.github.com/repos/${repo}`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: { 'User-Agent': 'x402-bazaar' }
                }, 5000);
                const data = await apiRes.json();

                if (data.message === 'Not Found') {
                    return res.status(404).json({ error: 'Repository not found', repo });
                }

                logActivity('api_call', `GitHub API: repo ${repo}`);

                return res.json({
                    success: true,
                    type: 'repo',
                    name: data.full_name,
                    description: data.description || '',
                    stars: data.stargazers_count || 0,
                    forks: data.forks_count || 0,
                    language: data.language || '',
                    license: data.license?.spdx_id || '',
                    open_issues: data.open_issues_count || 0,
                    url: data.html_url || '',
                    created_at: data.created_at || '',
                    updated_at: data.updated_at || ''
                });
            }
        } catch (err) {
            logger.error('GitHub API', err.message);
            return res.status(500).json({ error: 'GitHub API request failed' });
        }
    });

    // --- NPM REGISTRY API WRAPPER (0.005 USDC) ---
    router.get('/api/npm', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "NPM Registry API"), async (req, res) => {
        const pkg = (req.query.package || '').trim().slice(0, 100);

        if (!pkg) {
            return res.status(400).json({ error: "Parameter 'package' required. Ex: /api/npm?package=react" });
        }

        if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) {
            return res.status(400).json({ error: 'Invalid npm package name format' });
        }

        try {
            const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.error === 'Not found') {
                return res.status(404).json({ error: 'Package not found', package: pkg });
            }

            logActivity('api_call', `NPM API: "${pkg}"`);

            res.json({
                success: true,
                name: data.name,
                description: data.description || '',
                latest_version: data['dist-tags']?.latest || '',
                license: data.license || '',
                homepage: data.homepage || '',
                repository: data.repository?.url || '',
                keywords: (data.keywords || []).slice(0, 10),
                author: data.author?.name || '',
                modified: data.time?.modified || ''
            });
        } catch (err) {
            logger.error('NPM API', err.message);
            return res.status(500).json({ error: 'NPM API request failed' });
        }
    });

    // --- IP GEOLOCATION API WRAPPER (0.005 USDC) ---
    router.get('/api/ip', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "IP Geolocation API"), async (req, res) => {
        const address = (req.query.address || '').trim().slice(0, 100);

        if (!address) {
            return res.status(400).json({ error: "Parameter 'address' required. Ex: /api/ip?address=8.8.8.8" });
        }

        if (!/^[\d.:a-fA-F]+$/.test(address)) {
            return res.status(400).json({ error: 'Invalid IP address format' });
        }

        try {
            const apiUrl = `http://ip-api.com/json/${encodeURIComponent(address)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.status === 'fail') {
                return res.status(404).json({ error: data.message || 'IP lookup failed', address });
            }

            logActivity('api_call', `IP Geolocation API: ${address}`);

            res.json({
                success: true,
                ip: address,
                country: data.country || '',
                country_code: data.countryCode || '',
                region: data.regionName || '',
                city: data.city || '',
                zip: data.zip || '',
                latitude: data.lat || 0,
                longitude: data.lon || 0,
                timezone: data.timezone || '',
                isp: data.isp || '',
                org: data.org || ''
            });
        } catch (err) {
            logger.error('IP Geolocation API', err.message);
            return res.status(500).json({ error: 'IP Geolocation API request failed' });
        }
    });

    // --- QR CODE API WRAPPER (0.005 USDC) ---
    router.get('/api/qrcode', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "QR Code API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 500);
        let size = parseInt(req.query.size) || 200;

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/qrcode?text=hello&size=200" });
        }

        size = Math.max(50, Math.min(1000, size));

        try {
            const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&format=png`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);

            if (!apiRes.ok) {
                return res.status(500).json({ error: 'QR code generation failed' });
            }

            logActivity('api_call', `QR Code API: ${text.slice(0, 50)}... (${size}px)`);

            res.set('Content-Type', 'image/png');
            const buffer = await apiRes.arrayBuffer();
            res.send(Buffer.from(buffer));
        } catch (err) {
            logger.error('QR Code API', err.message);
            return res.status(500).json({ error: 'QR Code API request failed' });
        }
    });

    // --- WORLD TIME API WRAPPER (0.005 USDC) ---
    router.get('/api/time', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "World Time API"), async (req, res) => {
        const timezone = (req.query.timezone || '').trim().slice(0, 100);

        if (!timezone) {
            return res.status(400).json({ error: "Parameter 'timezone' required. Ex: /api/time?timezone=Europe/Paris" });
        }

        if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timezone)) {
            return res.status(400).json({ error: 'Invalid timezone format (expected: Region/City)' });
        }

        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false, timeZoneName: 'longOffset'
            });
            const parts = formatter.formatToParts(now);
            const get = (type) => (parts.find(p => p.type === type) || {}).value || '';
            const dateStr = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
            const offsetStr = get('timeZoneName').replace('GMT', '') || '+00:00';

            const shortFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });
            const shortParts = shortFmt.formatToParts(now);
            const abbreviation = (shortParts.find(p => p.type === 'timeZoneName') || {}).value || '';

            const dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now);

            logActivity('api_call', `World Time API: ${timezone}`);

            res.json({
                success: true,
                timezone,
                datetime: `${dateStr}${offsetStr}`,
                utc_offset: offsetStr,
                day_of_week: dayOfWeek,
                abbreviation,
                unix_timestamp: Math.floor(now.getTime() / 1000)
            });
        } catch (err) {
            logger.error('World Time API', err.message);
            if (err.message.includes('Invalid time zone')) {
                return res.status(400).json({ error: 'Invalid timezone', timezone });
            }
            return res.status(500).json({ error: 'World Time API request failed' });
        }
    });

    // --- PUBLIC HOLIDAYS API WRAPPER (0.005 USDC) ---
    router.get('/api/holidays', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Public Holidays API"), async (req, res) => {
        let country = (req.query.country || '').trim().toUpperCase().slice(0, 2);
        let year = parseInt(req.query.year) || new Date().getFullYear();

        if (!country) {
            return res.status(400).json({ error: "Parameter 'country' required (2-letter code). Ex: /api/holidays?country=FR&year=2026" });
        }

        if (country.length !== 2 || !/^[A-Z]{2}$/.test(country)) {
            return res.status(400).json({ error: 'Country code must be 2 uppercase letters (ISO 3166-1 alpha-2)' });
        }

        if (year < 2000 || year > 2100) {
            return res.status(400).json({ error: 'Year must be between 2000 and 2100' });
        }

        try {
            const apiUrl = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!Array.isArray(data)) {
                return res.status(404).json({ error: 'Country not found or no holidays available', country });
            }

            const holidays = data.map(h => ({
                date: h.date,
                name: h.localName,
                name_en: h.name,
                fixed: h.fixed,
                types: h.types || []
            }));

            logActivity('api_call', `Public Holidays API: ${country} ${year}`);

            res.json({
                success: true,
                country,
                year,
                count: holidays.length,
                holidays
            });
        } catch (err) {
            logger.error('Public Holidays API', err.message);
            return res.status(500).json({ error: 'Public Holidays API request failed' });
        }
    });

    // --- GEOCODING API WRAPPER (0.005 USDC) ---
    router.get('/api/geocoding', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Geocoding API"), async (req, res) => {
        const city = (req.query.city || '').trim().slice(0, 100);

        if (!city) {
            return res.status(400).json({ error: "Parameter 'city' required. Ex: /api/geocoding?city=Paris" });
        }

        if (/[\x00-\x1F\x7F]/.test(city)) {
            return res.status(400).json({ error: 'Invalid characters in city name' });
        }

        try {
            const apiUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=en&format=json`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!data.results || data.results.length === 0) {
                return res.status(404).json({ error: 'City not found', city });
            }

            const results = data.results.map(r => ({
                name: r.name,
                country: r.country,
                country_code: r.country_code,
                latitude: r.latitude,
                longitude: r.longitude,
                population: r.population || 0,
                timezone: r.timezone || ''
            }));

            logActivity('api_call', `Geocoding API: "${city}"`);

            res.json({
                success: true,
                query: city,
                results
            });
        } catch (err) {
            logger.error('Geocoding API', err.message);
            return res.status(500).json({ error: 'Geocoding API request failed' });
        }
    });

    // --- AIR QUALITY API WRAPPER (0.005 USDC) ---
    router.get('/api/airquality', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Air Quality API"), async (req, res) => {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: "Parameters 'lat' and 'lon' required. Ex: /api/airquality?lat=48.85&lon=2.35" });
        }

        if (lat < -90 || lat > 90) {
            return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
        }
        if (lon < -180 || lon > 180) {
            return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
        }

        try {
            const apiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,european_aqi,us_aqi`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!data.current) {
                return res.status(500).json({ error: 'Failed to fetch air quality data' });
            }

            const current = data.current;
            logActivity('api_call', `Air Quality API: ${lat},${lon}`);

            res.json({
                success: true,
                latitude: data.latitude,
                longitude: data.longitude,
                time: current.time,
                pm2_5: current.pm2_5,
                pm10: current.pm10,
                ozone: current.ozone,
                nitrogen_dioxide: current.nitrogen_dioxide,
                carbon_monoxide: current.carbon_monoxide,
                european_aqi: current.european_aqi,
                us_aqi: current.us_aqi
            });
        } catch (err) {
            logger.error('Air Quality API', err.message);
            return res.status(500).json({ error: 'Air Quality API request failed' });
        }
    });

    // --- RANDOM QUOTE API WRAPPER (0.005 USDC) ---
    router.get('/api/quote', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Random Quote API"), async (req, res) => {
        try {
            const apiUrl = 'https://api.adviceslip.com/advice';
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);

            const text = await apiRes.text();
            const data = JSON.parse(text);

            if (!data.slip) {
                return res.status(500).json({ error: 'Invalid quote data received' });
            }

            logActivity('api_call', 'Random Quote API');

            res.json({
                success: true,
                id: data.slip.id,
                advice: data.slip.advice
            });
        } catch (err) {
            logger.error('Random Quote API', err.message);
            return res.status(500).json({ error: 'Random Quote API request failed' });
        }
    });

    // --- RANDOM FACTS API WRAPPER (0.005 USDC) ---
    router.get('/api/facts', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Random Facts API"), async (req, res) => {
        try {
            const apiUrl = 'https://catfact.ninja/fact';
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (!data.fact) {
                return res.status(500).json({ error: 'Invalid fact data received' });
            }

            logActivity('api_call', 'Random Facts API');

            res.json({
                success: true,
                fact: data.fact,
                length: data.length
            });
        } catch (err) {
            logger.error('Random Facts API', err.message);
            return res.status(500).json({ error: 'Random Facts API request failed' });
        }
    });

    // --- RANDOM DOG IMAGE API WRAPPER (0.005 USDC) ---
    router.get('/api/dogs', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Random Dog Image API"), async (req, res) => {
        const breed = (req.query.breed || '').trim().toLowerCase().slice(0, 50);

        if (breed && !/^[a-z]+$/.test(breed)) {
            return res.status(400).json({ error: 'Invalid breed format (lowercase letters only)' });
        }

        try {
            const apiUrl = breed
                ? `https://dog.ceo/api/breed/${encodeURIComponent(breed)}/images/random`
                : 'https://dog.ceo/api/breeds/image/random';

            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.status !== 'success') {
                return res.status(404).json({ error: 'Breed not found or API error', breed: breed || 'random' });
            }

            logActivity('api_call', `Random Dog Image API: ${breed || 'random'}`);

            res.json({
                success: true,
                image_url: data.message,
                breed: breed || 'random'
            });
        } catch (err) {
            logger.error('Random Dog Image API', err.message);
            return res.status(500).json({ error: 'Random Dog Image API request failed' });
        }
    });

    // --- TRANSLATION API WRAPPER (0.005 USDC) ---
    router.get('/api/translate', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Translation API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 5000);
        const from = (req.query.from || 'auto').trim().toLowerCase().slice(0, 10);
        const to = (req.query.to || '').trim().toLowerCase().slice(0, 10);

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/translate?text=hello&from=en&to=fr" });
        }

        if (!to) {
            return res.status(400).json({ error: "Parameter 'to' required (target language code, ex: 'fr', 'es', 'en')" });
        }

        if (/[\x00-\x1F\x7F]/.test(text) || !/^[a-z-]{2,10}$/.test(to) || (from !== 'auto' && !/^[a-z-]{2,10}$/.test(from))) {
            return res.status(400).json({ error: 'Invalid characters or language code format' });
        }

        try {
            const langFrom = from === 'auto' ? 'en' : from;
            const langPair = `${langFrom}|${to}`;
            const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (!data.responseData || !data.responseData.translatedText) {
                return res.status(500).json({ error: 'Translation failed' });
            }

            logActivity('api_call', `Translation API: ${langFrom} -> ${to} (${text.slice(0, 50)}...)`);

            res.json({
                success: true,
                translatedText: data.responseData.translatedText,
                from: langFrom,
                to: to,
                original: text
            });
        } catch (err) {
            logger.error('Translation API', err.message);
            return res.status(500).json({ error: 'Translation API request failed' });
        }
    });

    // --- SUMMARIZE API WRAPPER (0.01 USDC) ---
    router.get('/api/summarize', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Summarize API"), async (req, res) => {
        const text = (req.query.text || '').trim();
        const maxLength = parseInt(req.query.maxLength) || 200;

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/summarize?text=long+article+here&maxLength=200" });
        }

        if (text.length < 50) {
            return res.status(400).json({ error: 'Text too short to summarize (minimum 50 characters)' });
        }

        if (text.length > 50000) {
            return res.status(400).json({ error: 'Text too long (max 50000 characters)' });
        }

        if (maxLength < 50 || maxLength > 2000) {
            return res.status(400).json({ error: 'maxLength must be between 50 and 2000 words' });
        }

        try {
            const response = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a text summarization assistant. Summarize the provided text in approximately ${maxLength} words or less. Keep the summary concise, informative, and in the same language as the original text.`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.3,
                max_tokens: Math.min(Math.ceil(maxLength * 1.5), 4000)
            });

            const summary = response.choices[0].message.content.trim();
            logActivity('api_call', `Summarize API: ${text.length} chars -> ${summary.length} chars`);

            res.json({
                success: true,
                summary,
                originalLength: text.length,
                summaryLength: summary.length
            });
        } catch (err) {
            logger.error('Summarize API', err.message);

            if (err.status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'OpenAI rate limit reached. Please try again in a few seconds.'
                });
            }

            return res.status(500).json({ error: 'Summarize API request failed' });
        }
    });

    // --- CODE EXECUTION API WRAPPER (0.005 USDC) ---
    router.post('/api/code', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Code Execution API"), async (req, res) => {
        const language = (req.body.language || '').trim().toLowerCase().slice(0, 50);
        const code = (req.body.code || '').trim();

        if (!language || !code) {
            return res.status(400).json({ error: "Parameters 'language' and 'code' required. Ex: POST /api/code {language: 'python', code: 'print(42)'}" });
        }

        if (code.length > 50000) {
            return res.status(400).json({ error: 'Code too long (max 50000 characters)' });
        }

        try {
            const apiUrl = 'https://emkc.org/api/v2/piston/execute';
            const apiRes = await fetchWithTimeout(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: language,
                    version: '*',
                    files: [{ content: code }]
                })
            }, 30000); // 30s timeout for code execution

            const data = await apiRes.json();

            if (!data.run) {
                return res.status(500).json({ error: 'Code execution failed', details: data.message || 'Unknown error' });
            }

            logActivity('api_call', `Code Execution API: ${language} (${code.length} chars)`);

            res.json({
                success: true,
                language: data.language,
                version: data.version,
                output: data.run.stdout || '',
                stderr: data.run.stderr || ''
            });
        } catch (err) {
            logger.error('Code Execution API', err.message);
            return res.status(500).json({ error: 'Code Execution API request failed' });
        }
    });

    // --- DNS LOOKUP API WRAPPER (0.003 USDC) ---
    router.get('/api/dns', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "DNS Lookup API"), async (req, res) => {
        const domain = (req.query.domain || '').trim().toLowerCase().slice(0, 255);
        const type = (req.query.type || 'A').trim().toUpperCase();

        if (!domain) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/dns?domain=google.com&type=A" });
        }

        // Validate domain format (basic check)
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain name format' });
        }

        // Security: Block localhost, private IPs
        const blockedDomains = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|::1|fc00:|fe80:)/i;
        if (blockedDomains.test(domain)) {
            return res.status(400).json({ error: 'Internal domains not allowed' });
        }

        const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS', 'SOA', 'PTR', 'SRV'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `Invalid DNS type. Accepted: ${validTypes.join(', ')}` });
        }

        try {
            const dnsPromises = require('dns/promises');
            let records;

            switch (type) {
                case 'A':
                    records = await dnsPromises.resolve4(domain);
                    break;
                case 'AAAA':
                    records = await dnsPromises.resolve6(domain);
                    break;
                case 'MX':
                    records = await dnsPromises.resolveMx(domain);
                    break;
                case 'TXT':
                    records = await dnsPromises.resolveTxt(domain);
                    break;
                case 'CNAME':
                    records = await dnsPromises.resolveCname(domain);
                    break;
                case 'NS':
                    records = await dnsPromises.resolveNs(domain);
                    break;
                case 'SOA':
                    records = await dnsPromises.resolveSoa(domain);
                    break;
                case 'PTR':
                    records = await dnsPromises.resolvePtr(domain);
                    break;
                case 'SRV':
                    records = await dnsPromises.resolveSrv(domain);
                    break;
            }

            logActivity('api_call', `DNS Lookup API: ${domain} (${type})`);

            res.json({
                success: true,
                domain,
                type,
                records
            });
        } catch (err) {
            if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
                return res.status(404).json({ error: 'DNS records not found', domain, type });
            }
            logger.error('DNS Lookup API', err.message);
            return res.status(500).json({ error: 'DNS Lookup API request failed' });
        }
    });

    // --- QR CODE GENERATOR API WRAPPER (0.003 USDC) ---
    router.get('/api/qrcode-gen', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "QR Code Generator API"), async (req, res) => {
        const data = (req.query.data || '').trim().slice(0, 2000);
        let size = parseInt(req.query.size) || 300;

        if (!data) {
            return res.status(400).json({ error: "Parameter 'data' required. Ex: /api/qrcode-gen?data=https://example.com&size=300" });
        }

        size = Math.max(50, Math.min(1000, size));

        try {
            const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png`;

            logActivity('api_call', `QR Code Generator API: ${data.slice(0, 50)}... (${size}px)`);

            // Return JSON with the image URL instead of returning the image directly
            res.json({
                success: true,
                imageUrl: apiUrl,
                data: data,
                size: size
            });
        } catch (err) {
            logger.error('QR Code Generator API', err.message);
            return res.status(500).json({ error: 'QR Code Generator API request failed' });
        }
    });

    // --- READABILITY API WRAPPER (0.005 USDC) ---
    router.get('/api/readability', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Readability API"), async (req, res) => {
        const targetUrl = (req.query.url || '').trim();

        if (!targetUrl) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/readability?url=https://example.com/article" });
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

        // SECURITY: Block internal/private IPs and cloud metadata endpoints
        const blockedHostname = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\]|\[::ffff:)/i;
        if (blockedHostname.test(parsed.hostname)) {
            return res.status(400).json({ error: 'Internal URLs not allowed' });
        }

        // SECURITY: DNS resolution check to prevent DNS rebinding attacks
        try {
            const { address } = await dns.promises.lookup(parsed.hostname);
            const isPrivateIP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(address);
            if (isPrivateIP) {
                return res.status(400).json({ error: 'Internal URLs not allowed' });
            }
        } catch (dnsErr) {
            return res.status(400).json({ error: 'Could not resolve hostname' });
        }

        try {
            const pageRes = await fetchWithTimeout(targetUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' },
                redirect: 'follow',
            }, 10000);

            const contentLength = parseInt(pageRes.headers.get('content-length') || '0');
            if (contentLength > 5 * 1024 * 1024) {
                return res.status(400).json({ error: 'Page too large (max 5MB)' });
            }

            const contentType = pageRes.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                return res.status(400).json({ error: 'URL does not return HTML or text content', content_type: contentType });
            }

            const html = await pageRes.text();

            if (html.length > 5 * 1024 * 1024) {
                return res.status(400).json({ error: 'Page too large (max 5MB)' });
            }

            const $ = cheerio.load(html);

            // Remove unwanted elements
            $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"], .sidebar, .menu, .nav, .footer, .header, .ad, .ads, .advertisement').remove();

            const title = $('title').text().trim() || $('h1').first().text().trim() || '';

            // Extract main text content
            const textParts = [];
            $('article, main, [role="main"], p').each((i, el) => {
                const text = $(el).text().trim();
                if (text.length > 50) {
                    textParts.push(text);
                }
            });

            let fullText = textParts.join('\n\n').replace(/\s+/g, ' ').trim();

            if (fullText.length > 50000) {
                fullText = fullText.slice(0, 50000) + '\n\n[...truncated]';
            }

            const wordCount = fullText.split(/\s+/).length;

            logActivity('api_call', `Readability API: ${parsed.hostname} -> ${wordCount} words`);

            res.json({
                success: true,
                title,
                text: fullText,
                wordCount,
                url: targetUrl
            });
        } catch (err) {
            logger.error('Readability API', err.message);
            return res.status(500).json({ error: 'Readability API request failed' });
        }
    });

    // --- SENTIMENT ANALYSIS API WRAPPER (0.005 USDC) ---
    router.get('/api/sentiment', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Sentiment Analysis API"), async (req, res) => {
        const text = (req.query.text || '').trim();

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/sentiment?text=I+love+this+product" });
        }

        if (text.length < 5) {
            return res.status(400).json({ error: 'Text too short (minimum 5 characters)' });
        }

        if (text.length > 10000) {
            return res.status(400).json({ error: 'Text too long (max 10000 characters)' });
        }

        try {
            const response = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a sentiment analysis assistant. Analyze the sentiment of the provided text and respond ONLY with valid JSON in this exact format: {"sentiment": "positive|negative|neutral", "score": 0.0-1.0, "keywords": ["word1", "word2", "word3"]}. The score represents confidence (0=low, 1=high). Extract 3-5 keywords that influenced the sentiment.'
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.3,
                max_tokens: 200
            });

            const resultText = response.choices[0].message.content.trim();
            let analysis;

            try {
                analysis = JSON.parse(resultText);
            } catch {
                // Fallback if OpenAI doesn't return valid JSON
                analysis = {
                    sentiment: 'neutral',
                    score: 0.5,
                    keywords: []
                };
            }

            logActivity('api_call', `Sentiment Analysis API: ${analysis.sentiment} (${analysis.score.toFixed(2)})`);

            res.json({
                success: true,
                sentiment: analysis.sentiment || 'neutral',
                score: analysis.score || 0.5,
                keywords: analysis.keywords || [],
                text: text.slice(0, 100) + (text.length > 100 ? '...' : '')
            });
        } catch (err) {
            logger.error('Sentiment Analysis API', err.message);

            if (err.status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'OpenAI rate limit reached. Please try again in a few seconds.'
                });
            }

            return res.status(500).json({ error: 'Sentiment Analysis API request failed' });
        }
    });

    // --- EMAIL VALIDATION API WRAPPER (0.003 USDC) ---
    router.get('/api/validate-email', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Email Validation API"), async (req, res) => {
        const email = (req.query.email || '').trim().toLowerCase().slice(0, 320);

        if (!email) {
            return res.status(400).json({ error: "Parameter 'email' required. Ex: /api/validate-email?email=test@example.com" });
        }

        // Email format validation (RFC 5322 simplified)
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        const formatValid = emailRegex.test(email);

        if (!formatValid) {
            logActivity('api_call', `Email Validation API: ${email} (invalid format)`);
            return res.json({
                success: true,
                email,
                valid: false,
                format: false,
                mxRecords: false,
                domain: null
            });
        }

        // Extract domain
        const domain = email.split('@')[1];

        // DNS MX lookup
        let mxValid = false;
        try {
            const dnsPromises = require('dns/promises');
            const mxRecords = await dnsPromises.resolveMx(domain);
            mxValid = mxRecords && mxRecords.length > 0;
        } catch (err) {
            // MX lookup failed
        }

        const isValid = formatValid && mxValid;

        logActivity('api_call', `Email Validation API: ${email} (${isValid ? 'valid' : 'invalid'})`);

        res.json({
            success: true,
            email,
            valid: isValid,
            format: formatValid,
            mxRecords: mxValid,
            domain
        });
    });

    // =============================================
    // NEW WRAPPERS BATCH 2 (12 services → total 41)
    // =============================================

    // --- HASH GENERATOR API (0.001 USDC) ---
    router.get('/api/hash', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Hash Generator API"), async (req, res) => {
        const text = (req.query.text || '').trim();
        const algo = (req.query.algo || 'sha256').trim().toLowerCase();

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/hash?text=hello&algo=sha256" });
        }
        if (text.length > 10000) {
            return res.status(400).json({ error: 'Text too long (max 10000 characters)' });
        }

        const validAlgos = ['md5', 'sha1', 'sha256', 'sha512'];
        if (!validAlgos.includes(algo)) {
            return res.status(400).json({ error: `Invalid algorithm. Accepted: ${validAlgos.join(', ')}` });
        }

        const crypto = require('crypto');
        const hash = crypto.createHash(algo).update(text).digest('hex');

        logActivity('api_call', `Hash Generator API: ${algo} (${text.slice(0, 30)}...)`);

        res.json({ success: true, hash, algorithm: algo, input_length: text.length });
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

    // --- BASE64 ENCODE/DECODE API (0.001 USDC) ---
    router.get('/api/base64', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Base64 API"), async (req, res) => {
        const text = (req.query.text || '').trim();
        const mode = (req.query.mode || 'encode').trim().toLowerCase();

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/base64?text=hello&mode=encode" });
        }
        if (text.length > 50000) {
            return res.status(400).json({ error: 'Text too long (max 50000 characters)' });
        }
        if (mode !== 'encode' && mode !== 'decode') {
            return res.status(400).json({ error: "Parameter 'mode' must be 'encode' or 'decode'" });
        }

        let result;
        try {
            if (mode === 'encode') {
                result = Buffer.from(text, 'utf-8').toString('base64');
            } else {
                result = Buffer.from(text, 'base64').toString('utf-8');
            }
        } catch {
            return res.status(400).json({ error: 'Invalid base64 input' });
        }

        logActivity('api_call', `Base64 API: ${mode}`);

        res.json({ success: true, result, mode, input_length: text.length, output_length: result.length });
    });

    // --- PASSWORD GENERATOR API (0.001 USDC) ---
    router.get('/api/password', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Password Generator API"), async (req, res) => {
        let length = parseInt(req.query.length) || 16;
        length = Math.max(8, Math.min(128, length));
        const includeSymbols = req.query.symbols !== 'false';
        const includeNumbers = req.query.numbers !== 'false';
        const includeUppercase = req.query.uppercase !== 'false';

        let chars = 'abcdefghijklmnopqrstuvwxyz';
        if (includeUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (includeNumbers) chars += '0123456789';
        if (includeSymbols) chars += '!@#$%^&*()-_=+[]{}|;:,.<>?';

        const crypto = require('crypto');
        const bytes = crypto.randomBytes(length);
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars[bytes[i] % chars.length];
        }

        logActivity('api_call', `Password Generator API: ${length} chars`);

        res.json({ success: true, password, length, options: { symbols: includeSymbols, numbers: includeNumbers, uppercase: includeUppercase } });
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

    // --- MARKDOWN TO HTML API (0.001 USDC) ---
    router.get('/api/markdown', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Markdown to HTML API"), async (req, res) => {
        const text = (req.query.text || '').trim();

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/markdown?text=**bold**+_italic_" });
        }
        if (text.length > 50000) {
            return res.status(400).json({ error: 'Text too long (max 50000 characters)' });
        }

        // Simple markdown to HTML conversion (no external deps)
        let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        html = '<p>' + html + '</p>';

        logActivity('api_call', `Markdown to HTML API: ${text.length} chars`);

        res.json({ success: true, html, input_length: text.length, output_length: html.length });
    });

    // --- COLOR CONVERTER API (0.001 USDC) ---
    router.get('/api/color', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Color Converter API"), async (req, res) => {
        const hex = (req.query.hex || '').trim().replace(/^#/, '');
        const rgb = (req.query.rgb || '').trim();

        if (!hex && !rgb) {
            return res.status(400).json({ error: "Parameter 'hex' or 'rgb' required. Ex: /api/color?hex=ff5733 or /api/color?rgb=255,87,51" });
        }

        let r, g, b;

        if (hex) {
            if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
                return res.status(400).json({ error: 'Invalid hex color (use 6 hex digits, e.g., ff5733)' });
            }
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        } else {
            const parts = rgb.split(',').map(s => parseInt(s.trim()));
            if (parts.length !== 3 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
                return res.status(400).json({ error: 'Invalid RGB (use 3 values 0-255, e.g., 255,87,51)' });
            }
            [r, g, b] = parts;
        }

        // Convert to HSL
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
            else if (max === gn) h = ((bn - rn) / d + 2) / 6;
            else h = ((rn - gn) / d + 4) / 6;
        }

        logActivity('api_call', `Color Converter API: #${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);

        res.json({
            success: true,
            hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
            rgb: { r, g, b },
            hsl: { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) },
            css_rgb: `rgb(${r}, ${g}, ${b})`,
            css_hsl: `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
        });
    });

    // --- JSON VALIDATOR API (0.001 USDC) ---
    function handleJsonValidate(req, res) {
        // Support both GET (?json=...) and POST ({json: ...})
        let input;
        if (req.method === 'GET') {
            input = req.query.json !== undefined ? req.query.json : null;
        } else {
            input = req.body && req.body.json !== undefined ? req.body.json : null;
        }

        if (input === null) {
            return res.status(400).json({ error: "Parameter 'json' required. GET: /api/json-validate?json={...} or POST with {\"json\": \"...\"}" });
        }

        const raw = typeof input === 'string' ? input : JSON.stringify(input);

        if (raw.length > 100000) {
            return res.status(400).json({ error: 'Input too large (max 100KB)' });
        }

        let valid = true;
        let parsed = null;
        let errorMsg = null;

        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            valid = false;
            errorMsg = err.message;
        }

        logActivity('api_call', `JSON Validator API: ${valid ? 'valid' : 'invalid'} (${raw.length} chars)`);

        const result = { success: true, valid, input_length: raw.length };
        if (valid) {
            result.formatted = JSON.stringify(parsed, null, 2);
            result.type = Array.isArray(parsed) ? 'array' : typeof parsed;
            if (typeof parsed === 'object' && parsed !== null) {
                result.keys_count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
            }
        } else {
            result.error_message = errorMsg;
        }
        res.json(result);
    }

    router.get('/api/json-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JSON Validator API"), handleJsonValidate);
    router.post('/api/json-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JSON Validator API"), handleJsonValidate);

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

    // ============================================================
    // BATCH 3 — NEW HIGH-VALUE APIs (session 21)
    // ============================================================

    // --- NEWS / RSS FEED API (0.005 USDC) ---
    router.get('/api/news', paidEndpointLimiter, paymentMiddleware(10000, 0.005, "News API"), async (req, res) => {
        const topic = (req.query.topic || req.query.q || '').trim().slice(0, 100);
        const lang = (req.query.lang || 'en').trim().slice(0, 5);

        if (!topic) {
            return res.status(400).json({ error: "Parameter 'topic' required. Ex: /api/news?topic=artificial+intelligence" });
        }

        try {
            // Use Google News RSS feed (free, no API key)
            const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=${encodeURIComponent(lang)}&gl=US&ceid=US:en`;
            const rssRes = await fetchWithTimeout(rssUrl, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 8000);
            const xml = await rssRes.text();

            // Parse RSS XML with regex (no extra deps)
            const items = [];
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;
            while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
                const itemXml = match[1];
                const getTag = (tag) => {
                    const m = itemXml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
                    return m ? m[1].trim() : '';
                };
                items.push({
                    title: getTag('title'),
                    link: getTag('link'),
                    source: getTag('source'),
                    published: getTag('pubDate')
                });
            }

            if (items.length === 0) {
                return res.status(404).json({ error: 'No news found for this topic', topic });
            }

            logActivity('api_call', `News API: "${topic}" -> ${items.length} articles`);
            res.json({ success: true, topic, language: lang, count: items.length, articles: items });
        } catch (err) {
            logger.error('News API', err.message);
            return res.status(500).json({ error: 'News API request failed' });
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

    // --- REDDIT API (0.005 USDC) ---
    router.get('/api/reddit', paidEndpointLimiter, paymentMiddleware(10000, 0.005, "Reddit API"), async (req, res) => {
        const subreddit = (req.query.subreddit || req.query.sub || '').trim().replace(/^r\//, '').slice(0, 50);
        const sort = ['hot', 'new', 'top', 'rising'].includes(req.query.sort) ? req.query.sort : 'hot';
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 25);

        if (!subreddit) {
            return res.status(400).json({ error: "Parameter 'subreddit' required. Ex: /api/reddit?subreddit=programming&sort=hot&limit=10" });
        }
        if (!/^[a-zA-Z0-9_]{2,50}$/.test(subreddit)) {
            return res.status(400).json({ error: 'Invalid subreddit name' });
        }

        try {
            const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`;
            const apiRes = await fetchWithTimeout(url, {
                headers: { 'User-Agent': 'x402-bazaar/1.0 (API marketplace)' }
            }, 8000);
            const data = await apiRes.json();

            if (data.error || !data.data) {
                return res.status(404).json({ error: 'Subreddit not found or private', subreddit });
            }

            const posts = (data.data.children || []).map(c => ({
                title: c.data.title,
                author: c.data.author,
                score: c.data.score,
                url: c.data.url,
                permalink: `https://reddit.com${c.data.permalink}`,
                comments: c.data.num_comments,
                created_utc: c.data.created_utc,
                selftext: (c.data.selftext || '').slice(0, 500)
            }));

            logActivity('api_call', `Reddit API: r/${subreddit} (${sort}) -> ${posts.length} posts`);
            res.json({ success: true, subreddit, sort, count: posts.length, posts });
        } catch (err) {
            logger.error('Reddit API', err.message);
            return res.status(500).json({ error: 'Reddit API request failed' });
        }
    });

    // --- HACKER NEWS API (0.003 USDC) ---
    router.get('/api/hn', paidEndpointLimiter, paymentMiddleware(8000, 0.003, "Hacker News API"), async (req, res) => {
        const type = ['top', 'new', 'best', 'ask', 'show', 'job'].includes(req.query.type) ? req.query.type : 'top';
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 30);

        try {
            const idsUrl = `https://hacker-news.firebaseio.com/v0/${type}stories.json`;
            const idsRes = await fetchWithTimeout(idsUrl, {}, 5000);
            const ids = await idsRes.json();

            const topIds = ids.slice(0, limit);
            const stories = await Promise.all(topIds.map(async (id) => {
                try {
                    const storyRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 3000);
                    const story = await storyRes.json();
                    return {
                        id: story.id,
                        title: story.title,
                        url: story.url || null,
                        author: story.by,
                        score: story.score,
                        comments: story.descendants || 0,
                        time: story.time,
                        hn_url: `https://news.ycombinator.com/item?id=${story.id}`
                    };
                } catch { return null; }
            }));

            const validStories = stories.filter(Boolean);
            logActivity('api_call', `Hacker News API: ${type} -> ${validStories.length} stories`);
            res.json({ success: true, type, count: validStories.length, stories: validStories });
        } catch (err) {
            logger.error('Hacker News API', err.message);
            return res.status(500).json({ error: 'Hacker News API request failed' });
        }
    });

    // --- YOUTUBE VIDEO INFO API (0.005 USDC) ---
    router.get('/api/youtube', paidEndpointLimiter, paymentMiddleware(8000, 0.005, "YouTube Info API"), async (req, res) => {
        const input = (req.query.url || req.query.id || '').trim().slice(0, 200);

        if (!input) {
            return res.status(400).json({ error: "Parameter 'url' or 'id' required. Ex: /api/youtube?url=https://youtube.com/watch?v=dQw4w9WgXcQ" });
        }

        // Extract video ID
        let videoId = input;
        const urlMatch = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (urlMatch) videoId = urlMatch[1];
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return res.status(400).json({ error: 'Invalid YouTube video ID or URL' });
        }

        try {
            // Use oembed (free, no API key)
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const apiRes = await fetchWithTimeout(oembedUrl, {}, 5000);
            if (!apiRes.ok) {
                return res.status(404).json({ error: 'Video not found or private', video_id: videoId });
            }
            const data = await apiRes.json();

            logActivity('api_call', `YouTube Info API: ${videoId}`);
            res.json({
                success: true,
                video_id: videoId,
                title: data.title,
                author: data.author_name,
                author_url: data.author_url,
                thumbnail: data.thumbnail_url,
                width: data.width,
                height: data.height,
                watch_url: `https://www.youtube.com/watch?v=${videoId}`,
                embed_url: `https://www.youtube.com/embed/${videoId}`
            });
        } catch (err) {
            logger.error('YouTube Info API', err.message);
            return res.status(500).json({ error: 'YouTube Info API request failed' });
        }
    });

    // --- WHOIS DOMAIN API (0.005 USDC) ---
    router.get('/api/whois', paidEndpointLimiter, paymentMiddleware(10000, 0.005, "WHOIS API"), async (req, res) => {
        const domain = (req.query.domain || '').trim().toLowerCase().slice(0, 253);

        if (!domain) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/whois?domain=example.com" });
        }
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            // Use RDAP (successor to WHOIS, free, JSON)
            const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
            const apiRes = await fetchWithTimeout(rdapUrl, {
                headers: { 'Accept': 'application/rdap+json' }
            }, 10000);

            if (!apiRes.ok) {
                return res.status(404).json({ error: 'Domain not found in RDAP', domain });
            }
            const data = await apiRes.json();

            const events = data.events || [];
            const getEvent = (action) => (events.find(e => e.eventAction === action) || {}).eventDate || null;
            const nameservers = (data.nameservers || []).map(ns => ns.ldhName).filter(Boolean);
            const statuses = data.status || [];

            logActivity('api_call', `WHOIS API: ${domain}`);
            res.json({
                success: true,
                domain: data.ldhName || domain,
                status: statuses,
                registered: getEvent('registration'),
                expires: getEvent('expiration'),
                last_updated: getEvent('last changed'),
                nameservers,
                registrar: data.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || null
            });
        } catch (err) {
            logger.error('WHOIS API', err.message);
            return res.status(500).json({ error: 'WHOIS API request failed' });
        }
    });

    // --- SSL CERTIFICATE CHECK API (0.003 USDC) ---
    router.get('/api/ssl-check', paidEndpointLimiter, paymentMiddleware(10000, 0.003, "SSL Check API"), async (req, res) => {
        const hostname = (req.query.domain || req.query.host || '').trim().toLowerCase().slice(0, 253);

        if (!hostname) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/ssl-check?domain=google.com" });
        }
        if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(hostname)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            const tls = require('tls');
            const socket = tls.connect(443, hostname, { servername: hostname, timeout: 8000 });

            const result = await new Promise((resolve, reject) => {
                socket.on('secureConnect', () => {
                    const cert = socket.getPeerCertificate();
                    socket.destroy();
                    if (!cert || !cert.subject) {
                        return reject(new Error('No certificate'));
                    }
                    const now = Date.now();
                    const validFrom = new Date(cert.valid_from);
                    const validTo = new Date(cert.valid_to);
                    const daysRemaining = Math.floor((validTo - now) / 86400000);

                    resolve({
                        subject: cert.subject.CN || cert.subject.O || hostname,
                        issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
                        valid_from: validFrom.toISOString(),
                        valid_to: validTo.toISOString(),
                        days_remaining: daysRemaining,
                        is_valid: daysRemaining > 0,
                        serial_number: cert.serialNumber,
                        fingerprint: cert.fingerprint256 || cert.fingerprint,
                        san: (cert.subjectaltname || '').split(', ').map(s => s.replace('DNS:', ''))
                    });
                });
                socket.on('error', reject);
                socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')); });
            });

            logActivity('api_call', `SSL Check API: ${hostname} -> ${result.days_remaining} days`);
            res.json({ success: true, domain: hostname, certificate: result });
        } catch (err) {
            logger.error('SSL Check API', err.message);
            return res.status(500).json({ error: 'SSL check failed', domain: hostname, details: err.message });
        }
    });

    // --- REGEX TESTER API (0.001 USDC) ---
    router.get('/api/regex', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Regex Tester API"), async (req, res) => {
        const pattern = (req.query.pattern || '').slice(0, 500);
        const text = (req.query.text || '').slice(0, 5000);
        const flags = (req.query.flags || 'g').slice(0, 10);

        if (!pattern || !text) {
            return res.status(400).json({ error: "Parameters 'pattern' and 'text' required. Ex: /api/regex?pattern=\\d+&text=abc123def456&flags=g" });
        }

        try {
            // Validate flags
            if (!/^[gimsuy]*$/.test(flags)) {
                return res.status(400).json({ error: 'Invalid flags. Allowed: g, i, m, s, u, y' });
            }
            const regex = new RegExp(pattern, flags);
            const matches = [];
            let m;
            let safety = 0;
            if (flags.includes('g')) {
                while ((m = regex.exec(text)) !== null && safety < 100) {
                    matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
                    safety++;
                    if (m.index === regex.lastIndex) regex.lastIndex++;
                }
            } else {
                m = regex.exec(text);
                if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
            }

            logActivity('api_call', `Regex Tester API: /${pattern}/${flags} -> ${matches.length} matches`);
            res.json({ success: true, pattern, flags, text_length: text.length, match_count: matches.length, matches });
        } catch (err) {
            return res.status(400).json({ error: 'Invalid regex pattern', details: err.message });
        }
    });

    // --- TEXT DIFF API (0.001 USDC) ---
    router.get('/api/diff', paidEndpointLimiter, paymentMiddleware(2000, 0.001, "Text Diff API"), async (req, res) => {
        const text1 = (req.query.text1 || '');
        const text2 = (req.query.text2 || '');

        if (!text1 && !text2) {
            return res.status(400).json({ error: "Parameters 'text1' and 'text2' required. Ex: /api/diff?text1=hello+world&text2=hello+earth" });
        }
        if (text1.length > 10000 || text2.length > 10000) {
            return res.status(400).json({ error: 'Texts too long (max 10000 chars each)' });
        }

        // Simple line-by-line diff (no external deps)
        const lines1 = text1.split('\n');
        const lines2 = text2.split('\n');
        const changes = [];
        const maxLen = Math.max(lines1.length, lines2.length);

        for (let i = 0; i < maxLen; i++) {
            const l1 = lines1[i];
            const l2 = lines2[i];
            if (l1 === undefined) {
                changes.push({ line: i + 1, type: 'added', content: l2 });
            } else if (l2 === undefined) {
                changes.push({ line: i + 1, type: 'removed', content: l1 });
            } else if (l1 !== l2) {
                changes.push({ line: i + 1, type: 'modified', old: l1, new: l2 });
            }
        }

        const identical = changes.length === 0;
        logActivity('api_call', `Text Diff API: ${lines1.length} vs ${lines2.length} lines -> ${changes.length} changes`);
        res.json({
            success: true,
            identical,
            lines_text1: lines1.length,
            lines_text2: lines2.length,
            changes_count: changes.length,
            changes
        });
    });

    // --- MATH EXPRESSION API (0.001 USDC) ---
    router.get('/api/math', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Math Expression API"), async (req, res) => {
        const expr = (req.query.expr || req.query.expression || '').trim().slice(0, 500);

        if (!expr) {
            return res.status(400).json({ error: "Parameter 'expr' required. Ex: /api/math?expr=2*pi*5+sqrt(16)" });
        }

        try {
            // Safe math evaluation using mathjs (no eval/new Function)
            const result = evaluate(expr);

            if (typeof result !== 'number' || !isFinite(result)) {
                return res.status(400).json({ error: 'Expression resulted in invalid number (Infinity or NaN)' });
            }

            logActivity('api_call', `Math Expression API: ${expr} = ${result}`);
            res.json({ success: true, expression: expr, result, result_formatted: result.toLocaleString('en-US', { maximumFractionDigits: 10 }) });
        } catch (err) {
            return res.status(400).json({ error: 'Invalid math expression', details: err.message });
        }
    });

    // ============================================================
    // BATCH 4 — UTILITY APIs (session 21)
    // ============================================================

    // --- UNIT CONVERTER API (0.001 USDC) ---
    router.get('/api/unit-convert', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Unit Converter API"), async (req, res) => {
        const value = parseFloat(req.query.value);
        const from = (req.query.from || '').trim().toLowerCase();
        const to = (req.query.to || '').trim().toLowerCase();

        if (isNaN(value) || !from || !to) {
            return res.status(400).json({ error: "Parameters 'value', 'from', 'to' required. Ex: /api/unit-convert?value=100&from=km&to=miles" });
        }

        // Conversion factors to base unit per category
        const conversions = {
            // Length (base: meters)
            km: { base: 'm', factor: 1000 }, m: { base: 'm', factor: 1 }, cm: { base: 'm', factor: 0.01 },
            mm: { base: 'm', factor: 0.001 }, miles: { base: 'm', factor: 1609.344 }, mi: { base: 'm', factor: 1609.344 },
            yards: { base: 'm', factor: 0.9144 }, yd: { base: 'm', factor: 0.9144 },
            feet: { base: 'm', factor: 0.3048 }, ft: { base: 'm', factor: 0.3048 },
            inches: { base: 'm', factor: 0.0254 }, in: { base: 'm', factor: 0.0254 },
            nm: { base: 'm', factor: 1852 },
            // Weight (base: kg)
            kg: { base: 'kg', factor: 1 }, g: { base: 'kg', factor: 0.001 }, mg: { base: 'kg', factor: 0.000001 },
            lb: { base: 'kg', factor: 0.453592 }, lbs: { base: 'kg', factor: 0.453592 },
            oz: { base: 'kg', factor: 0.0283495 }, ton: { base: 'kg', factor: 1000 },
            // Temperature (special handling below)
            c: { base: 'temp', factor: 0 }, f: { base: 'temp', factor: 0 }, k: { base: 'temp', factor: 0 },
            celsius: { base: 'temp', factor: 0 }, fahrenheit: { base: 'temp', factor: 0 }, kelvin: { base: 'temp', factor: 0 },
            // Volume (base: liters)
            l: { base: 'l', factor: 1 }, ml: { base: 'l', factor: 0.001 },
            gal: { base: 'l', factor: 3.78541 }, gallon: { base: 'l', factor: 3.78541 },
            qt: { base: 'l', factor: 0.946353 }, pt: { base: 'l', factor: 0.473176 },
            cup: { base: 'l', factor: 0.236588 }, floz: { base: 'l', factor: 0.0295735 },
            // Speed (base: m/s)
            'km/h': { base: 'speed', factor: 0.277778 }, 'mph': { base: 'speed', factor: 0.44704 },
            'm/s': { base: 'speed', factor: 1 }, knots: { base: 'speed', factor: 0.514444 },
            // Data (base: bytes)
            b: { base: 'data', factor: 1 }, kb: { base: 'data', factor: 1024 },
            mb: { base: 'data', factor: 1048576 }, gb: { base: 'data', factor: 1073741824 },
            tb: { base: 'data', factor: 1099511627776 }
        };

        const fromUnit = conversions[from];
        const toUnit = conversions[to];

        if (!fromUnit || !toUnit) {
            const supported = Object.keys(conversions).join(', ');
            return res.status(400).json({ error: `Unknown unit. Supported: ${supported}` });
        }

        if (fromUnit.base !== toUnit.base) {
            return res.status(400).json({ error: `Cannot convert between different unit types (${from} -> ${to})` });
        }

        let result;
        const fromNorm = from.replace('celsius', 'c').replace('fahrenheit', 'f').replace('kelvin', 'k');
        const toNorm = to.replace('celsius', 'c').replace('fahrenheit', 'f').replace('kelvin', 'k');

        if (fromUnit.base === 'temp') {
            // Temperature special conversion
            let celsius;
            if (fromNorm === 'c') celsius = value;
            else if (fromNorm === 'f') celsius = (value - 32) * 5 / 9;
            else if (fromNorm === 'k') celsius = value - 273.15;
            else return res.status(400).json({ error: 'Invalid temperature unit' });

            if (toNorm === 'c') result = celsius;
            else if (toNorm === 'f') result = celsius * 9 / 5 + 32;
            else if (toNorm === 'k') result = celsius + 273.15;
            else return res.status(400).json({ error: 'Invalid temperature unit' });
        } else {
            // Standard conversion: value * fromFactor / toFactor
            result = value * fromUnit.factor / toUnit.factor;
        }

        logActivity('api_call', `Unit Converter API: ${value} ${from} -> ${result} ${to}`);
        res.json({ success: true, value, from, to, result: +result.toFixed(10), formula: `${value} ${from} = ${+result.toFixed(10)} ${to}` });
    });

    // --- CSV TO JSON API (0.001 USDC) ---
    router.get('/api/csv-to-json', paidEndpointLimiter, paymentMiddleware(2000, 0.001, "CSV to JSON API"), async (req, res) => {
        const csv = (req.query.csv || '');
        const delimiter = req.query.delimiter || ',';
        const hasHeader = req.query.header !== 'false';

        if (!csv) {
            return res.status(400).json({ error: "Parameter 'csv' required. Ex: /api/csv-to-json?csv=name,age\\nAlice,30\\nBob,25" });
        }
        if (csv.length > 50000) {
            return res.status(400).json({ error: 'CSV too large (max 50KB)' });
        }

        try {
            const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return res.status(400).json({ error: 'Empty CSV input' });
            }

            const parseLine = (line) => {
                const result = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    if (line[i] === '"') { inQuotes = !inQuotes; }
                    else if (line[i] === delimiter && !inQuotes) { result.push(current.trim()); current = ''; }
                    else { current += line[i]; }
                }
                result.push(current.trim());
                return result;
            };

            let data;
            if (hasHeader && lines.length > 1) {
                const headers = parseLine(lines[0]);
                data = lines.slice(1).map(line => {
                    const values = parseLine(line);
                    const obj = {};
                    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
                    return obj;
                });
            } else {
                data = lines.map(line => parseLine(line));
            }

            logActivity('api_call', `CSV to JSON API: ${lines.length} lines -> ${data.length} records`);
            res.json({ success: true, rows: data.length, columns: hasHeader ? parseLine(lines[0]).length : (data[0] || []).length, data });
        } catch (err) {
            return res.status(400).json({ error: 'Failed to parse CSV', details: err.message });
        }
    });

    // --- JWT DECODE API (0.001 USDC) ---
    router.get('/api/jwt-decode', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JWT Decode API"), async (req, res) => {
        const token = (req.query.token || '').trim().slice(0, 10000);

        if (!token) {
            return res.status(400).json({ error: "Parameter 'token' required. Ex: /api/jwt-decode?token=eyJhbGciOiJIUzI1NiIs..." });
        }

        const parts = token.split('.');
        if (parts.length !== 3) {
            return res.status(400).json({ error: 'Invalid JWT format (expected 3 parts separated by dots)' });
        }

        try {
            const decodeBase64Url = (str) => {
                const padded = str.replace(/-/g, '+').replace(/_/g, '/');
                return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
            };

            const header = decodeBase64Url(parts[0]);
            const payload = decodeBase64Url(parts[1]);

            const now = Math.floor(Date.now() / 1000);
            let expired = null;
            let expires_in = null;
            if (payload.exp) {
                expired = now > payload.exp;
                expires_in = payload.exp - now;
            }

            logActivity('api_call', `JWT Decode API: alg=${header.alg}`);
            res.json({
                success: true,
                header,
                payload,
                expired,
                expires_in_seconds: expires_in,
                issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
                expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
                note: 'Signature NOT verified (decode only, no secret key)'
            });
        } catch (err) {
            return res.status(400).json({ error: 'Failed to decode JWT', details: err.message });
        }
    });

    // --- CRON EXPRESSION PARSER API (0.001 USDC) ---
    router.get('/api/cron-parse', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Cron Parser API"), async (req, res) => {
        const expr = (req.query.expr || req.query.expression || '').trim().slice(0, 200);

        if (!expr) {
            return res.status(400).json({ error: "Parameter 'expr' required. Ex: /api/cron-parse?expr=0 9 * * 1-5" });
        }

        const parts = expr.split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
            return res.status(400).json({ error: 'Invalid cron expression. Expected 5 fields: minute hour day month weekday (optional: second)' });
        }

        const fieldNames = parts.length === 6
            ? ['second', 'minute', 'hour', 'day_of_month', 'month', 'day_of_week']
            : ['minute', 'hour', 'day_of_month', 'month', 'day_of_week'];

        const descriptions = {
            minute: { range: '0-59', special: ', - * /' },
            hour: { range: '0-23', special: ', - * /' },
            day_of_month: { range: '1-31', special: ', - * / ?' },
            month: { range: '1-12 or JAN-DEC', special: ', - * /' },
            day_of_week: { range: '0-7 or SUN-SAT (0=7=Sunday)', special: ', - * / ?' },
            second: { range: '0-59', special: ', - * /' }
        };

        const fields = {};
        fieldNames.forEach((name, i) => {
            fields[name] = { value: parts[parts.length === 6 ? i : i], ...descriptions[name] };
        });

        // Human-readable description
        const min = fields.minute?.value || parts[0];
        const hour = fields.hour?.value || parts[1];
        let description = '';
        if (min === '0' && hour === '0') description = 'At midnight every day';
        else if (min === '0' && hour !== '*') description = `At ${hour}:00`;
        else if (min !== '*' && hour !== '*') description = `At ${hour}:${min.padStart(2, '0')}`;
        else if (min === '*' && hour === '*') description = 'Every minute';
        else if (min.startsWith('*/')) description = `Every ${min.slice(2)} minutes`;
        else description = `Cron: ${expr}`;

        const dow = fields.day_of_week?.value || parts[parts.length === 6 ? 5 : 4];
        if (dow === '1-5') description += ' (weekdays only)';
        else if (dow === '0,6' || dow === '6,0') description += ' (weekends only)';

        logActivity('api_call', `Cron Parser API: ${expr}`);
        res.json({ success: true, expression: expr, fields, description, field_count: parts.length });
    });

    // --- PASSWORD STRENGTH API (0.001 USDC) ---
    router.get('/api/password-strength', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Password Strength API"), async (req, res) => {
        const password = (req.query.password || req.query.pw || '').slice(0, 200);

        if (!password) {
            return res.status(400).json({ error: "Parameter 'password' required. Ex: /api/password-strength?password=MyP@ssw0rd!" });
        }

        const checks = {
            length: password.length,
            has_lowercase: /[a-z]/.test(password),
            has_uppercase: /[A-Z]/.test(password),
            has_digits: /\d/.test(password),
            has_special: /[^a-zA-Z0-9]/.test(password),
            has_spaces: /\s/.test(password),
            is_common: ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome', 'monkey', 'dragon',
                '12345678', 'abc123', 'password1', 'iloveyou', 'trustno1', 'sunshine', 'princess',
                'football', 'charlie', 'shadow', 'master', '1234567890'].includes(password.toLowerCase())
        };

        // Score calculation (0-100)
        let score = 0;
        if (checks.length >= 8) score += 20;
        if (checks.length >= 12) score += 10;
        if (checks.length >= 16) score += 10;
        if (checks.has_lowercase) score += 10;
        if (checks.has_uppercase) score += 10;
        if (checks.has_digits) score += 10;
        if (checks.has_special) score += 15;
        if (!checks.is_common) score += 15;

        // Entropy estimation (bits)
        let charsetSize = 0;
        if (checks.has_lowercase) charsetSize += 26;
        if (checks.has_uppercase) charsetSize += 26;
        if (checks.has_digits) charsetSize += 10;
        if (checks.has_special) charsetSize += 32;
        const entropy = charsetSize > 0 ? +(checks.length * Math.log2(charsetSize)).toFixed(1) : 0;

        let strength;
        if (checks.is_common || score < 30) strength = 'very_weak';
        else if (score < 50) strength = 'weak';
        else if (score < 70) strength = 'fair';
        else if (score < 90) strength = 'strong';
        else strength = 'very_strong';

        const suggestions = [];
        if (checks.length < 12) suggestions.push('Use at least 12 characters');
        if (!checks.has_uppercase) suggestions.push('Add uppercase letters');
        if (!checks.has_digits) suggestions.push('Add numbers');
        if (!checks.has_special) suggestions.push('Add special characters (!@#$%...)');
        if (checks.is_common) suggestions.push('Avoid common passwords');

        logActivity('api_call', `Password Strength API: strength=${strength}`);
        res.json({ success: true, strength, score, entropy_bits: entropy, checks, suggestions });
    });

    // --- PHONE VALIDATE API (0.001 USDC) ---
    router.get('/api/phone-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Phone Validate API"), async (req, res) => {
        const phone = (req.query.phone || req.query.number || '').trim().slice(0, 30);

        if (!phone) {
            return res.status(400).json({ error: "Parameter 'phone' required. Ex: /api/phone-validate?phone=+33612345678" });
        }

        // Strip all non-digit chars except leading +
        const cleaned = phone.replace(/(?!^\+)\D/g, '');
        const digits = cleaned.replace('+', '');

        // Country code detection (common codes)
        const countryCodes = {
            '1': { country: 'US/CA', format: '+1 (XXX) XXX-XXXX', len: [10] },
            '33': { country: 'FR', format: '+33 X XX XX XX XX', len: [9] },
            '44': { country: 'GB', format: '+44 XXXX XXXXXX', len: [10] },
            '49': { country: 'DE', format: '+49 XXX XXXXXXXX', len: [10, 11] },
            '81': { country: 'JP', format: '+81 XX XXXX XXXX', len: [10] },
            '86': { country: 'CN', format: '+86 XXX XXXX XXXX', len: [11] },
            '91': { country: 'IN', format: '+91 XXXXX XXXXX', len: [10] },
            '55': { country: 'BR', format: '+55 XX XXXXX XXXX', len: [10, 11] },
            '7': { country: 'RU', format: '+7 XXX XXX XX XX', len: [10] },
            '39': { country: 'IT', format: '+39 XXX XXX XXXX', len: [9, 10] },
            '34': { country: 'ES', format: '+34 XXX XXX XXX', len: [9] },
            '61': { country: 'AU', format: '+61 XXX XXX XXX', len: [9] }
        };

        let detectedCountry = null;
        let expectedFormat = null;
        const hasPlus = phone.startsWith('+');

        if (hasPlus) {
            for (const [code, info] of Object.entries(countryCodes).sort((a, b) => b[0].length - a[0].length)) {
                if (digits.startsWith(code)) {
                    const national = digits.slice(code.length);
                    if (info.len.includes(national.length)) {
                        detectedCountry = info.country;
                        expectedFormat = info.format;
                    }
                    break;
                }
            }
        }

        const valid = digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits);

        logActivity('api_call', `Phone Validate API: ${detectedCountry || 'unknown'}`);
        res.json({
            success: true,
            input: phone,
            cleaned: hasPlus ? `+${digits}` : digits,
            digits_only: digits,
            digit_count: digits.length,
            valid,
            has_country_code: hasPlus,
            country: detectedCountry,
            expected_format: expectedFormat,
            type: digits.length <= 8 ? 'landline' : 'mobile'
        });
    });

    // --- URL PARSE API (0.001 USDC) ---
    router.get('/api/url-parse', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "URL Parse API"), async (req, res) => {
        const input = (req.query.url || '').trim().slice(0, 2000);

        if (!input) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/url-parse?url=https://example.com:8080/path?q=test#section" });
        }

        try {
            const parsed = new URL(input);
            const params = {};
            parsed.searchParams.forEach((v, k) => { params[k] = v; });

            logActivity('api_call', `URL Parse API: ${parsed.hostname}`);
            res.json({
                success: true,
                url: input,
                protocol: parsed.protocol.replace(':', ''),
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
                pathname: parsed.pathname,
                search: parsed.search,
                hash: parsed.hash,
                origin: parsed.origin,
                params,
                param_count: Object.keys(params).length,
                is_https: parsed.protocol === 'https:'
            });
        } catch (err) {
            return res.status(400).json({ error: 'Invalid URL', details: err.message });
        }
    });

    // --- URL SHORTENER API (0.003 USDC) ---
    router.get('/api/url-shorten', paidEndpointLimiter, paymentMiddleware(5000, 0.003, "URL Shortener API"), async (req, res) => {
        const url = (req.query.url || '').trim().slice(0, 2000);

        if (!url) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/url-shorten?url=https://example.com/very-long-path" });
        }

        try {
            new URL(url); // Validate URL
        } catch {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        try {
            const apiUrl = `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.errorcode) {
                return res.status(400).json({ error: 'URL shortening failed', details: data.errormessage });
            }

            logActivity('api_call', `URL Shortener API: ${url.slice(0, 50)}...`);
            res.json({ success: true, original_url: url, short_url: data.shorturl });
        } catch (err) {
            logger.error('URL Shortener API', err.message);
            return res.status(500).json({ error: 'URL Shortener API request failed' });
        }
    });

    // --- HTML TO TEXT API (0.001 USDC) ---
    router.get('/api/html-to-text', paidEndpointLimiter, paymentMiddleware(2000, 0.001, "HTML to Text API"), async (req, res) => {
        const html = (req.query.html || '');

        if (!html) {
            return res.status(400).json({ error: "Parameter 'html' required. Ex: /api/html-to-text?html=<h1>Title</h1><p>Content</p>" });
        }
        if (html.length > 100000) {
            return res.status(400).json({ error: 'HTML too large (max 100KB)' });
        }

        try {
            const $ = cheerio.load(html);
            $('script, style, noscript').remove();
            const text = $.text().replace(/\s+/g, ' ').trim();

            // Also extract links and images
            const links = [];
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href');
                const label = $(el).text().trim();
                if (href && label) links.push({ text: label, href });
            });

            const images = [];
            $('img[src]').each((_, el) => {
                images.push({ src: $(el).attr('src'), alt: $(el).attr('alt') || '' });
            });

            logActivity('api_call', `HTML to Text API: ${html.length} chars -> ${text.length} chars`);
            res.json({
                success: true,
                text,
                text_length: text.length,
                html_length: html.length,
                links_count: links.length,
                links: links.slice(0, 20),
                images_count: images.length,
                images: images.slice(0, 10)
            });
        } catch (err) {
            return res.status(400).json({ error: 'Failed to parse HTML', details: err.message });
        }
    });

    // --- HTTP STATUS CODE API (0.001 USDC) ---
    router.get('/api/http-status', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "HTTP Status API"), async (req, res) => {
        const code = parseInt(req.query.code || '');

        if (!code || code < 100 || code > 599) {
            return res.status(400).json({ error: "Parameter 'code' required (100-599). Ex: /api/http-status?code=404" });
        }

        const statuses = {
            100: { name: 'Continue', description: 'The server has received the request headers and the client should proceed to send the request body.', category: 'Informational' },
            101: { name: 'Switching Protocols', description: 'The server is switching protocols as requested by the client.', category: 'Informational' },
            200: { name: 'OK', description: 'The request was successful.', category: 'Success' },
            201: { name: 'Created', description: 'The request was successful and a new resource was created.', category: 'Success' },
            204: { name: 'No Content', description: 'The request was successful but there is no content to return.', category: 'Success' },
            301: { name: 'Moved Permanently', description: 'The resource has been permanently moved to a new URL.', category: 'Redirection' },
            302: { name: 'Found', description: 'The resource has been temporarily moved to a different URL.', category: 'Redirection' },
            304: { name: 'Not Modified', description: 'The resource has not been modified since the last request.', category: 'Redirection' },
            307: { name: 'Temporary Redirect', description: 'The resource has been temporarily moved. The client should use the same HTTP method.', category: 'Redirection' },
            308: { name: 'Permanent Redirect', description: 'The resource has been permanently moved. The client should use the same HTTP method.', category: 'Redirection' },
            400: { name: 'Bad Request', description: 'The server could not understand the request due to invalid syntax.', category: 'Client Error' },
            401: { name: 'Unauthorized', description: 'Authentication is required and has failed or not been provided.', category: 'Client Error' },
            402: { name: 'Payment Required', description: 'Payment is required to access this resource. Used by x402 protocol for machine-to-machine payments.', category: 'Client Error' },
            403: { name: 'Forbidden', description: 'The server understood the request but refuses to authorize it.', category: 'Client Error' },
            404: { name: 'Not Found', description: 'The requested resource could not be found on the server.', category: 'Client Error' },
            405: { name: 'Method Not Allowed', description: 'The HTTP method used is not allowed for this resource.', category: 'Client Error' },
            408: { name: 'Request Timeout', description: 'The server timed out waiting for the request.', category: 'Client Error' },
            409: { name: 'Conflict', description: 'The request conflicts with the current state of the resource.', category: 'Client Error' },
            410: { name: 'Gone', description: 'The resource is no longer available and will not be available again.', category: 'Client Error' },
            413: { name: 'Payload Too Large', description: 'The request body is larger than the server is willing to process.', category: 'Client Error' },
            418: { name: "I'm a Teapot", description: 'The server refuses to brew coffee because it is a teapot (RFC 2324).', category: 'Client Error' },
            422: { name: 'Unprocessable Entity', description: 'The request was well-formed but could not be followed due to semantic errors.', category: 'Client Error' },
            429: { name: 'Too Many Requests', description: 'The user has sent too many requests in a given amount of time (rate limiting).', category: 'Client Error' },
            500: { name: 'Internal Server Error', description: 'The server encountered an unexpected condition that prevented it from fulfilling the request.', category: 'Server Error' },
            501: { name: 'Not Implemented', description: 'The server does not support the functionality required to fulfill the request.', category: 'Server Error' },
            502: { name: 'Bad Gateway', description: 'The server received an invalid response from an upstream server.', category: 'Server Error' },
            503: { name: 'Service Unavailable', description: 'The server is currently unable to handle the request (overloaded or down for maintenance).', category: 'Server Error' },
            504: { name: 'Gateway Timeout', description: 'The server did not receive a timely response from an upstream server.', category: 'Server Error' }
        };

        const info = statuses[code];
        if (!info) {
            // Generic category
            let category;
            if (code < 200) category = 'Informational';
            else if (code < 300) category = 'Success';
            else if (code < 400) category = 'Redirection';
            else if (code < 500) category = 'Client Error';
            else category = 'Server Error';

            logActivity('api_call', `HTTP Status API: ${code} (unknown)`);
            return res.json({ success: true, code, name: 'Unknown', description: 'Non-standard or uncommon HTTP status code.', category });
        }

        logActivity('api_call', `HTTP Status API: ${code} ${info.name}`);
        res.json({ success: true, code, ...info });
    });

    return router;
}

module.exports = createWrappersRouter;
