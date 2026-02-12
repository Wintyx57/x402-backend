// routes/wrappers.js — ALL /api/* wrapper endpoints

const express = require('express');
const dns = require('dns');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
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
            const apiUrl = `https://worldtimeapi.org/api/timezone/${encodeURIComponent(timezone)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.error) {
                return res.status(404).json({ error: 'Timezone not found', timezone });
            }

            logActivity('api_call', `World Time API: ${timezone}`);

            res.json({
                success: true,
                timezone: data.timezone,
                datetime: data.datetime,
                utc_offset: data.utc_offset,
                day_of_week: data.day_of_week,
                week_number: data.week_number,
                abbreviation: data.abbreviation,
                dst: data.dst
            });
        } catch (err) {
            logger.error('World Time API', err.message);
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

    return router;
}

module.exports = createWrappersRouter;
