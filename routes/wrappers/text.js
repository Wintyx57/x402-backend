// routes/wrappers/text.js — Text processing API wrappers
// translate, summarize, markdown, html-to-text, csv-to-json, base64, diff

const express = require('express');
const cheerio = require('cheerio');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { openaiRetry } = require('../../lib/openai-retry');

function createTextRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

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
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
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
            }), 'Summarize API');

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

    return router;
}

module.exports = createTextRouter;
