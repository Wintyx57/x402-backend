// routes/wrappers/web.js — Web-related API wrappers
// search, scrape, twitter (+ twitter-search), news, reddit, hn, youtube

const express = require('express');
const dns = require('dns');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { WebSearchQuerySchema, ScraperUrlSchema } = require('../../schemas/index');

function createWebRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- WEB SEARCH API WRAPPER (0.005 USDC) ---
    router.get('/api/search', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Web Search API"), async (req, res) => {
        // Validate query parameters using Zod
        const parseResult = WebSearchQuerySchema.safeParse({
            q: req.query.q || '',
            max: req.query.max || '10'
        });

        if (!parseResult.success) {
            const errors = parseResult.error.errors.map(err => err.message).join(', ');
            return res.status(400).json({ error: errors });
        }

        const query = parseResult.data.q;
        const maxResults = parseInt(parseResult.data.max);

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
                } catch { /* intentionally silent — malformed URLs fall back to rawHref */ }
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
        // Validate URL parameter using Zod
        const parseResult = ScraperUrlSchema.safeParse({ url: req.query.url || '' });

        if (!parseResult.success) {
            const errors = parseResult.error.errors.map(err => err.message).join(', ');
            return res.status(400).json({ error: errors });
        }

        const targetUrl = parseResult.data.url;

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

            const contentHtml = $('article').html() || $('main').html() || $('[role="main"]').html() || $('body').html() || '';

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

    return router;
}

module.exports = createWebRouter;
