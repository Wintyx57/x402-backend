// routes/wrappers/advanced.js — Advanced AI + web tools
// screenshot, pdf-extract, rss, chart, barcode, classify, extract, keywords, ocr, embeddings, sitemap, page-speed, random-color, sql-format, nft-metadata

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createAdvancedRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- SCREENSHOT (0.05 USDC) ---
    router.get('/api/screenshot', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "Screenshot API"), async (req, res) => {
        const url = (req.query.url || '').trim().slice(0, 500);
        if (!url) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/screenshot?url=https://example.com" });
        if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal|169\.254/i;
        if (blocked.test(url)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`;
            const r = await fetchWithTimeout(apiUrl, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 15000);
            const data = await r.json();
            if (data.status !== 'success') return res.status(502).json({ error: 'Screenshot failed', detail: data.message });
            logActivity('api_call', `Screenshot: ${url.slice(0, 60)}`);
            res.json({ success: true, url, screenshot_url: data.data?.screenshot?.url, width: data.data?.screenshot?.width, height: data.data?.screenshot?.height });
        } catch (err) {
            logger.error('Screenshot API', err.message);
            res.status(500).json({ error: 'Screenshot request failed' });
        }
    });

    // --- PDF EXTRACT (0.02 USDC) ---
    router.get('/api/pdf-extract', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "PDF Extract API"), async (req, res) => {
        const pdfUrl = (req.query.url || '').trim().slice(0, 500);
        if (!pdfUrl) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/pdf-extract?url=https://example.com/file.pdf" });
        if (!/^https?:\/\//.test(pdfUrl)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal/i;
        if (blocked.test(pdfUrl)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const r = await fetchWithTimeout(pdfUrl, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 10000);
            if (!r.ok) return res.status(404).json({ error: 'Could not fetch PDF from URL' });
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('pdf') && !pdfUrl.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'URL does not appear to be a PDF' });
            const buffer = Buffer.from(await r.arrayBuffer());
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(buffer, { max: 5 });
            logActivity('api_call', `PDF Extract: ${pdfUrl.slice(0, 60)}`);
            res.json({ success: true, url: pdfUrl, pages: data.numpages, text: data.text.slice(0, 10000), text_length: data.text.length, info: data.info });
        } catch (err) {
            logger.error('PDF Extract API', err.message);
            res.status(500).json({ error: 'Failed to extract PDF: ' + err.message });
        }
    });

    // --- RSS FEED (0.01 USDC) ---
    router.get('/api/rss', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "RSS Feed API"), async (req, res) => {
        const feedUrl = (req.query.url || '').trim().slice(0, 500);
        const max = Math.min(parseInt(req.query.max || '10'), 50);
        if (!feedUrl) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/rss?url=https://hnrss.org/frontpage" });
        if (!/^https?:\/\//.test(feedUrl)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal/i;
        if (blocked.test(feedUrl)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const Parser = require('rss-parser');
            const parser = new Parser({ timeout: 8000, maxRedirects: 3 });
            const feed = await parser.parseURL(feedUrl);
            logActivity('api_call', `RSS: ${feedUrl.slice(0, 60)}`);
            res.json({
                success: true, title: feed.title, description: feed.description, url: feed.link,
                items: feed.items.slice(0, max).map(i => ({ title: i.title, link: i.link, date: i.pubDate, summary: (i.contentSnippet || '').slice(0, 300) }))
            });
        } catch (err) {
            logger.error('RSS API', err.message);
            res.status(500).json({ error: 'Failed to parse RSS feed: ' + err.message });
        }
    });

    // --- CHART GENERATION (0.01 USDC) ---
    router.get('/api/chart', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Chart API"), async (req, res) => {
        const type = (req.query.type || 'bar').trim();
        const labels = (req.query.labels || '').split(',').map(l => l.trim().slice(0, 30)).slice(0, 20);
        const values = (req.query.values || '').split(',').map(Number).slice(0, 20);
        const title = (req.query.title || '').trim().slice(0, 100);
        const validTypes = ['bar', 'line', 'pie', 'doughnut', 'radar', 'horizontalBar'];
        if (!validTypes.includes(type)) return res.status(400).json({ error: `Invalid chart type. Accepted: ${validTypes.join(', ')}` });
        if (!labels.length || !values.length) return res.status(400).json({ error: "Parameters 'labels' and 'values' required. Ex: /api/chart?type=bar&labels=A,B,C&values=10,20,30" });
        if (labels.length !== values.length) return res.status(400).json({ error: 'labels and values must have the same count' });
        if (values.some(isNaN)) return res.status(400).json({ error: 'values must be numbers' });
        const config = { type, data: { labels, datasets: [{ label: title || 'Dataset', data: values, backgroundColor: ['#FF9900','#36A2EB','#FF6384','#4BC0C0','#9966FF','#FF9F40','#C9CBCF','#7CB9E8','#FFD700','#98FB98'] }] }, options: { plugins: { title: { display: !!title, text: title } } } };
        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&width=600&height=400&bkg=white`;
        logActivity('api_call', `Chart API: ${type} chart`);
        res.json({ success: true, type, chart_url: chartUrl, labels, values });
    });

    // --- BARCODE GENERATION (0.005 USDC) ---
    router.get('/api/barcode', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Barcode API"), async (req, res) => {
        const data = (req.query.data || '').trim().slice(0, 200);
        const type = (req.query.type || 'qr').trim().toLowerCase();
        const validTypes = { qr: 'qr', ean13: 'ean13', ean8: 'ean8', code128: 'code128', code39: 'code39', upca: 'upca', datamatrix: 'dm' };
        if (!data) return res.status(400).json({ error: "Parameter 'data' required. Ex: /api/barcode?data=Hello&type=qr" });
        if (!validTypes[type]) return res.status(400).json({ error: `Invalid type. Accepted: ${Object.keys(validTypes).join(', ')}` });
        if (/[\x00-\x1F\x7F<>]/.test(data)) return res.status(400).json({ error: 'Invalid characters in data' });
        const barcodeUrl = `https://barcodeapi.org/api/${validTypes[type]}/${encodeURIComponent(data)}`;
        logActivity('api_call', `Barcode API: ${type}`);
        res.json({ success: true, type, data, barcode_url: barcodeUrl });
    });

    // --- TEXT CLASSIFY (0.02 USDC) ---
    router.get('/api/classify', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Text Classify API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 2000);
        const categories = (req.query.categories || 'technology,finance,health,sports,politics,entertainment,science,business').split(',').map(c => c.trim()).slice(0, 15);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/classify?text=Bitcoin+hits+new+all+time+high" });
        try {
            const completion = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: `Classify this text into one or more of these categories: ${categories.join(', ')}.\n\nText: "${text}"\n\nRespond with JSON: {"primary": "category", "secondary": ["cat1","cat2"], "confidence": 0.0-1.0, "reasoning": "brief reason"}` }],
                response_format: { type: 'json_object' }, max_tokens: 150
            });
            const result = JSON.parse(completion.choices[0].message.content);
            logActivity('api_call', `Classify API: "${text.slice(0, 40)}..."`);
            res.json({ success: true, text: text.slice(0, 100) + (text.length > 100 ? '...' : ''), categories: result });
        } catch (err) {
            logger.error('Classify API', err.message);
            res.status(500).json({ error: 'Classification failed' });
        }
    });

    // --- ENTITY EXTRACTION (0.02 USDC) ---
    router.get('/api/extract', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Entity Extract API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 3000);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/extract?text=Elon+Musk+lives+in+Austin+Texas" });
        try {
            const completion = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: `Extract named entities from this text. Return JSON: {"persons":[],"organizations":[],"locations":[],"dates":[],"emails":[],"urls":[],"amounts":[],"other":[]}\n\nText: "${text}"` }],
                response_format: { type: 'json_object' }, max_tokens: 400
            });
            const entities = JSON.parse(completion.choices[0].message.content);
            logActivity('api_call', `Extract API: "${text.slice(0, 40)}..."`);
            res.json({ success: true, text: text.slice(0, 100) + (text.length > 100 ? '...' : ''), entities });
        } catch (err) {
            logger.error('Extract API', err.message);
            res.status(500).json({ error: 'Entity extraction failed' });
        }
    });

    // --- KEYWORDS EXTRACTION (0.01 USDC) ---
    router.get('/api/keywords', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Keywords API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 5000);
        const max = Math.min(parseInt(req.query.max || '10'), 20);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required." });
        try {
            const completion = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: `Extract the ${max} most important keywords/keyphrases from this text, ordered by relevance. Return JSON: {"keywords":[{"keyword":"word","relevance":0.0-1.0}]}\n\nText: "${text}"` }],
                response_format: { type: 'json_object' }, max_tokens: 300
            });
            const result = JSON.parse(completion.choices[0].message.content);
            logActivity('api_call', `Keywords API: "${text.slice(0, 40)}..."`);
            res.json({ success: true, count: result.keywords?.length, keywords: result.keywords });
        } catch (err) {
            logger.error('Keywords API', err.message);
            res.status(500).json({ error: 'Keyword extraction failed' });
        }
    });

    // --- OCR — TEXT FROM IMAGE (0.05 USDC) ---
    router.get('/api/ocr', paidEndpointLimiter, paymentMiddleware(50000, 0.05, "OCR API"), async (req, res) => {
        const imageUrl = (req.query.url || '').trim().slice(0, 500);
        if (!imageUrl) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/ocr?url=https://example.com/image.png" });
        if (!/^https?:\/\//.test(imageUrl)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal/i;
        if (blocked.test(imageUrl)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const completion = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: [{ type: 'text', text: 'Extract ALL text from this image exactly as it appears. Return just the extracted text, no explanations.' }, { type: 'image_url', image_url: { url: imageUrl } }] }],
                max_tokens: 1000
            });
            const extracted = completion.choices[0].message.content;
            logActivity('api_call', `OCR API: ${imageUrl.slice(0, 60)}`);
            res.json({ success: true, url: imageUrl, text: extracted, length: extracted.length });
        } catch (err) {
            logger.error('OCR API', err.message);
            res.status(500).json({ error: 'OCR failed: ' + err.message });
        }
    });

    // --- EMBEDDINGS (0.02 USDC) ---
    router.get('/api/embeddings', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Embeddings API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 8000);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required." });
        try {
            const response = await getOpenAI().embeddings.create({ model: 'text-embedding-3-small', input: text });
            const vector = response.data[0].embedding;
            logActivity('api_call', `Embeddings API: "${text.slice(0, 40)}..."`);
            res.json({ success: true, text: text.slice(0, 100), dimensions: vector.length, embedding: vector, model: 'text-embedding-3-small' });
        } catch (err) {
            logger.error('Embeddings API', err.message);
            res.status(500).json({ error: 'Embeddings failed' });
        }
    });

    // --- SITEMAP PARSE (0.01 USDC) ---
    router.get('/api/sitemap', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Sitemap API"), async (req, res) => {
        const siteUrl = (req.query.url || '').trim().slice(0, 500);
        if (!siteUrl) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/sitemap?url=https://example.com" });
        if (!/^https?:\/\//.test(siteUrl)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal/i;
        if (blocked.test(siteUrl)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const base = siteUrl.replace(/\/$/, '');
            const r = await fetchWithTimeout(`${base}/sitemap.xml`, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 8000);
            if (!r.ok) return res.status(404).json({ error: 'No sitemap.xml found at this URL' });
            const xml = await r.text();
            const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim()).slice(0, 100);
            logActivity('api_call', `Sitemap: ${base}`);
            res.json({ success: true, url: base, count: urls.length, urls });
        } catch (err) {
            logger.error('Sitemap API', err.message);
            res.status(500).json({ error: 'Failed to fetch sitemap' });
        }
    });

    // --- PAGE SPEED (0.02 USDC) ---
    router.get('/api/page-speed', paidEndpointLimiter, paymentMiddleware(20000, 0.02, "Page Speed API"), async (req, res) => {
        const pageUrl = (req.query.url || '').trim().slice(0, 500);
        const strategy = ['mobile', 'desktop'].includes(req.query.strategy) ? req.query.strategy : 'mobile';
        if (!pageUrl) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/page-speed?url=https://example.com" });
        if (!/^https?:\/\//.test(pageUrl)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        try {
            const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&strategy=${strategy}`;
            const r = await fetchWithTimeout(apiUrl, { headers: { 'User-Agent': 'x402-bazaar/1.0' } }, 20000);
            if (!r.ok) return res.status(502).json({ error: 'PageSpeed API request failed' });
            const data = await r.json();
            const cats = data.lighthouseResult?.categories;
            logActivity('api_call', `Page Speed: ${pageUrl.slice(0, 60)}`);
            res.json({
                success: true, url: pageUrl, strategy,
                scores: { performance: Math.round((cats?.performance?.score || 0) * 100), accessibility: Math.round((cats?.accessibility?.score || 0) * 100), seo: Math.round((cats?.seo?.score || 0) * 100), best_practices: Math.round((cats?.['best-practices']?.score || 0) * 100) },
                metrics: { fcp: data.lighthouseResult?.audits?.['first-contentful-paint']?.displayValue, lcp: data.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue, cls: data.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue, tti: data.lighthouseResult?.audits?.['interactive']?.displayValue }
            });
        } catch (err) {
            logger.error('Page Speed API', err.message);
            res.status(500).json({ error: 'Page speed check failed' });
        }
    });

    // --- RANDOM COLOR PALETTE (free) ---
    router.get('/api/random-color', paidEndpointLimiter, paymentMiddleware(0, 0, "Random Color API"), async (req, res) => {
        const count = Math.min(parseInt(req.query.count || '5'), 10);
        const scheme = ['complementary', 'analogous', 'triadic', 'random'].includes(req.query.scheme) ? req.query.scheme : 'random';
        const hslToHex = (h, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l); const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`; };
        const baseH = Math.floor(Math.random() * 360);
        const baseS = 60 + Math.floor(Math.random() * 30);
        const baseL = 40 + Math.floor(Math.random() * 30);
        const hues = scheme === 'complementary' ? [baseH, (baseH + 180) % 360] : scheme === 'analogous' ? [baseH, (baseH + 30) % 360, (baseH - 30 + 360) % 360] : scheme === 'triadic' ? [baseH, (baseH + 120) % 360, (baseH + 240) % 360] : Array.from({ length: count }, () => Math.floor(Math.random() * 360));
        const palette = hues.slice(0, count).map(h => { const hex = hslToHex(h, baseS, baseL); return { hex, hsl: `hsl(${h}, ${baseS}%, ${baseL}%)`, rgb: `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})` }; });
        logActivity('api_call', 'Random Color API');
        res.json({ success: true, scheme, count: palette.length, palette });
    });

    // --- SQL FORMAT (free) ---
    router.get('/api/sql-format', paidEndpointLimiter, paymentMiddleware(0, 0, "SQL Format API"), async (req, res) => {
        const sql = (req.query.sql || '').trim().slice(0, 10000);
        if (!sql) return res.status(400).json({ error: "Parameter 'sql' required." });
        const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION', 'WITH'];
        let formatted = sql;
        keywords.forEach(kw => { formatted = formatted.replace(new RegExp(`\\b${kw}\\b`, 'gi'), `\n${kw}`); });
        formatted = formatted.replace(/,\s*/g, ',\n  ').replace(/^\n/, '').replace(/\n\n+/g, '\n').trim();
        logActivity('api_call', 'SQL Format API');
        res.json({ success: true, original: sql.slice(0, 200), formatted });
    });

    // --- NFT METADATA (0.01 USDC) ---
    router.get('/api/nft-metadata', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "NFT Metadata API"), async (req, res) => {
        const contract = (req.query.contract || '').trim().toLowerCase();
        const tokenId = (req.query.token_id || '').trim();
        if (!contract || !tokenId) return res.status(400).json({ error: "Parameters 'contract' and 'token_id' required. Ex: /api/nft-metadata?contract=0x...&token_id=1" });
        if (!/^0x[a-f0-9]{40}$/.test(contract)) return res.status(400).json({ error: 'Invalid contract address' });
        if (!/^\d+$/.test(tokenId)) return res.status(400).json({ error: 'token_id must be a positive integer' });
        try {
            const r = await fetchWithTimeout(
                `https://api.reservoir.tools/tokens/v7?tokens=${contract}:${tokenId}`,
                { headers: { 'User-Agent': 'x402-bazaar/1.0', 'accept': 'application/json' } }, 8000
            );
            if (!r.ok) return res.status(502).json({ error: 'NFT metadata fetch failed' });
            const data = await r.json();
            const token = data.tokens?.[0]?.token;
            if (!token) return res.status(404).json({ error: 'NFT not found' });
            logActivity('api_call', `NFT Metadata: ${contract.slice(0, 10)}...#${tokenId}`);
            res.json({ success: true, contract, token_id: tokenId, name: token.name, description: token.description, image: token.image, attributes: token.attributes, collection: token.collection?.name });
        } catch (err) {
            logger.error('NFT Metadata API', err.message);
            res.status(500).json({ error: 'NFT metadata lookup failed' });
        }
    });

    return router;
}

module.exports = createAdvancedRouter;
