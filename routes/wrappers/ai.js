// routes/wrappers/ai.js — AI-powered API wrappers
// sentiment, code, readability, math
// (Image generation removed — no free upstream provider)

const express = require('express');
const cheerio = require('cheerio');
const { evaluate } = require('mathjs');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { openaiRetry } = require('../../lib/openai-retry');
const { safeUrl } = require('../../lib/safe-url');
const { SentimentAnalysisSchema, CodeExecutionSchema } = require('../../schemas/index');

function createAiRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getGemini) {
    const router = express.Router();

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
            const model = getGemini().getGenerativeModel({
                model: 'gemini-2.0-flash',
                systemInstruction: 'You are a sentiment analysis assistant. Analyze the sentiment of the provided text and respond ONLY with valid JSON in this exact format: {"sentiment": "positive|negative|neutral", "score": 0.0-1.0, "keywords": ["word1", "word2", "word3"]}. The score represents confidence (0=low, 1=high). Extract 3-5 keywords that influenced the sentiment.'
            });

            const response = await openaiRetry(() => model.generateContent({
                contents: [{ role: 'user', parts: [{ text }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 200,
                    responseMimeType: 'application/json'
                }
            }), 'Sentiment API');

            const resultText = response.response.text().trim();
            let analysis;

            try {
                analysis = JSON.parse(resultText);
            } catch {
                // Fallback if Gemini doesn't return valid JSON
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

            if (err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED')) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'AI rate limit reached. Please try again in a few seconds.'
                });
            }

            return res.status(500).json({ error: 'Sentiment Analysis API request failed' });
        }
    });

    // --- CODE EXECUTION API WRAPPER (0.005 USDC) ---
    // Uses Wandbox (wandbox.org) — free, open-source, no API key required
    const WANDBOX_COMPILER_MAP = {
        python:     'cpython-3.12.7',
        python3:    'cpython-3.12.7',
        javascript: 'nodejs-20.17.0',
        js:         'nodejs-20.17.0',
        typescript: 'typescript-5.6.2',
        ts:         'typescript-5.6.2',
        ruby:       'ruby-3.3.6',
        go:         'go-1.22.8',
        rust:       'rust-1.82.0',
        php:        'php-8.3.12',
        bash:       'bash',
        lua:        'lua-5.4.7',
        r:          'r-4.4.1',
    };

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

        const language = parseResult.data.language.toLowerCase();
        const code = parseResult.data.code;

        const compiler = WANDBOX_COMPILER_MAP[language];
        if (!compiler) {
            const supported = Object.keys(WANDBOX_COMPILER_MAP).join(', ');
            return res.status(400).json({ error: `Unsupported language "${language}". Supported: ${supported}` });
        }

        try {
            const apiUrl = 'https://wandbox.org/api/compile.json';
            const apiRes = await fetchWithTimeout(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compiler, code })
            }, 20000); // 20s timeout for code execution

            if (!apiRes.ok) {
                const errText = await apiRes.text().catch(() => '');
                logger.error('Code Execution API', `Wandbox HTTP ${apiRes.status}: ${errText.slice(0, 100)}`);
                return res.status(500).json({ error: 'Code execution failed', details: errText.slice(0, 200) });
            }

            const data = await apiRes.json();

            logActivity('api_call', `Code Execution API: ${language} (${code.length} chars)`);

            res.json({
                success: true,
                language,
                output: data.program_output || '',
                stderr: data.program_error || '',
                compiler_error: data.compiler_error || '',
                exit_code: data.status || '0'
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
            parsed = await safeUrl(targetUrl);
        } catch (e) {
            return res.status(400).json({ error: e.message });
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
                word_count: wordCount,
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
