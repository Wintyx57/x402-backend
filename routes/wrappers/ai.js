// routes/wrappers/ai.js — AI-powered API wrappers
// image (DALL-E), sentiment, code, readability, math

const express = require('express');
const dns = require('dns');
const cheerio = require('cheerio');
const { evaluate } = require('mathjs');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { openaiRetry } = require('../../lib/openai-retry');
const { ImageGenerationSchema, SentimentAnalysisSchema, CodeExecutionSchema } = require('../../schemas/index');

function createAiRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- IMAGE GENERATION API (DALL-E 3) - 0.05 USDC ---
    const IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024'];
    const IMAGE_QUALITIES = ['standard', 'hd'];

    router.get('/api/image', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Image Generation API"), async (req, res) => {
        try {
            // Validate query parameters using Zod
            const parseResult = ImageGenerationSchema.safeParse({
                prompt: req.query.prompt || '',
                size: req.query.size || '1024x1024',
                quality: req.query.quality || 'standard'
            });

            if (!parseResult.success) {
                const errors = parseResult.error.errors.map(err => err.message).join(', ');
                return res.status(400).json({ error: errors });
            }

            const prompt = parseResult.data.prompt;
            const size = parseResult.data.size;
            const quality = parseResult.data.quality;

            const response = await openaiRetry(() => getOpenAI().images.generate({
                model: 'dall-e-3',
                prompt,
                size,
                quality,
                n: 1,
            }), 'Image API');

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

    // --- SENTIMENT ANALYSIS API WRAPPER (0.005 USDC) ---
    router.get('/api/sentiment', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Sentiment Analysis API"), async (req, res) => {
        // Validate query parameter using Zod
        const parseResult = SentimentAnalysisSchema.safeParse({ text: req.query.text || '' });

        if (!parseResult.success) {
            const errors = parseResult.error.errors.map(err => err.message).join(', ');
            return res.status(400).json({ error: errors });
        }

        const text = parseResult.data.text;

        try {
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
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
            }), 'Sentiment API');

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

    // --- CODE EXECUTION API WRAPPER (0.005 USDC) ---
    router.post('/api/code', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Code Execution API"), async (req, res) => {
        // Validate request body using Zod
        const parseResult = CodeExecutionSchema.safeParse({
            code: req.body.code || '',
            language: req.body.language || 'python',
            timeout: req.body.timeout || '5000'
        });

        if (!parseResult.success) {
            const errors = parseResult.error.errors.map(err => err.message).join(', ');
            return res.status(400).json({ error: errors });
        }

        const language = parseResult.data.language;
        const code = parseResult.data.code;
        const timeout = parseInt(parseResult.data.timeout);

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

    return router;
}

module.exports = createAiRouter;
