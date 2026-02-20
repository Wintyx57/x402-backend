// routes/wrappers/utils.js — Pure JS + lightweight utility APIs
// slug, html-validate, ip-geolocation, timezone-convert, morse, roman, text-stats, yaml-validate, cron-next, anagram, palindrome, base64-encode, colorname, isbn, recipe

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createUtilsRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- SLUG GENERATOR (free) ---
    router.get('/api/slug', paidEndpointLimiter, paymentMiddleware(0, 0, "Slug API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 500);
        const sep = (req.query.sep || '-').slice(0, 1);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/slug?text=Hello+World" });
        if (!/^[-_.]$/.test(sep) && sep !== '-') return res.status(400).json({ error: "sep must be '-', '_', or '.'" });
        const slug = text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, '')
            .trim().replace(/\s+/g, sep);
        logActivity('api_call', 'Slug API');
        res.json({ success: true, input: text, slug, separator: sep });
    });

    // --- HTML VALIDATE (0.01 USDC) ---
    router.get('/api/html-validate', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "HTML Validate API"), async (req, res) => {
        const url = (req.query.url || '').trim().slice(0, 500);
        if (!url) return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/html-validate?url=https://example.com" });
        if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
        const blocked = /localhost|127\.|192\.168\.|10\.|\.internal/i;
        if (blocked.test(url)) return res.status(400).json({ error: 'Private/internal URLs not allowed' });
        try {
            const r = await fetchWithTimeout(
                `https://validator.w3.org/nu/?doc=${encodeURIComponent(url)}&out=json`,
                { headers: { 'User-Agent': 'x402-bazaar/1.0', 'Accept': 'application/json' } }, 15000
            );
            if (!r.ok) return res.status(502).json({ error: 'W3C validator request failed' });
            const data = await r.json();
            const errors = data.messages?.filter(m => m.type === 'error').slice(0, 20) || [];
            const warnings = data.messages?.filter(m => m.type === 'info' || m.type === 'warning').slice(0, 20) || [];
            logActivity('api_call', `HTML Validate: ${url.slice(0, 60)}`);
            res.json({ success: true, url, valid: errors.length === 0, error_count: errors.length, warning_count: warnings.length, errors, warnings });
        } catch (err) {
            logger.error('HTML Validate API', err.message);
            res.status(500).json({ error: 'HTML validation failed' });
        }
    });

    // --- IP GEOLOCATION (0.005 USDC) ---
    router.get('/api/ip-geolocation', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "IP Geolocation API"), async (req, res) => {
        const ip = (req.query.ip || '').trim().slice(0, 45);
        if (!ip) return res.status(400).json({ error: "Parameter 'ip' required. Ex: /api/ip-geolocation?ip=8.8.8.8" });
        if (!/^[\d.:a-fA-F]+$/.test(ip)) return res.status(400).json({ error: 'Invalid IP address format' });
        const privateRanges = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|127\.|fd|fc)/;
        if (privateRanges.test(ip)) return res.status(400).json({ error: 'Private IP addresses not supported' });
        try {
            const r = await fetchWithTimeout(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as`, {}, 5000);
            const data = await r.json();
            if (data.status !== 'success') return res.status(404).json({ error: `IP not found: ${ip}` });
            logActivity('api_call', `IP Geolocation: ${ip}`);
            res.json({ success: true, ip, country: data.country, country_code: data.countryCode, region: data.regionName, city: data.city, zip: data.zip, lat: data.lat, lon: data.lon, timezone: data.timezone, isp: data.isp, org: data.org });
        } catch (err) {
            logger.error('IP Geolocation API', err.message);
            res.status(500).json({ error: 'IP geolocation failed' });
        }
    });

    // --- TIMEZONE CONVERT (free) ---
    router.get('/api/timezone-convert', paidEndpointLimiter, paymentMiddleware(0, 0, "Timezone Convert API"), async (req, res) => {
        const from = (req.query.from || 'UTC').trim().slice(0, 60);
        const to = (req.query.to || 'UTC').trim().slice(0, 60);
        const dt = req.query.dt ? new Date(req.query.dt) : new Date();
        if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid datetime. Use ISO format: 2026-02-20T10:00:00' });
        try {
            const fmt = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(dt);
            const fromStr = fmt(from);
            const toStr = fmt(to);
            logActivity('api_call', `Timezone Convert: ${from} -> ${to}`);
            res.json({ success: true, input: dt.toISOString(), from: { zone: from, datetime: fromStr }, to: { zone: to, datetime: toStr } });
        } catch (err) {
            res.status(400).json({ error: `Invalid timezone. Use IANA format (e.g. America/New_York, Europe/Paris)` });
        }
    });

    // --- MORSE CODE (free) ---
    const MORSE = { A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',0:'-----',1:'.----',2:'..---',3:'...--',4:'....-',5:'.....',6:'-....',7:'--...',8:'---..',9:'----.',' ':'/'};
    const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));
    router.get('/api/morse', paidEndpointLimiter, paymentMiddleware(0, 0, "Morse Code API"), async (req, res) => {
        const text = (req.query.text || '').slice(0, 500);
        const decode = req.query.decode === 'true';
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/morse?text=HELLO or ?text=....+.+.-.+...&decode=true" });
        if (decode) {
            const decoded = text.trim().split(' ').map(c => MORSE_REV[c] || '?').join('');
            return res.json({ success: true, input: text, decoded, mode: 'decode' });
        }
        const encoded = text.toUpperCase().split('').map(c => MORSE[c] || '').filter(Boolean).join(' ');
        logActivity('api_call', 'Morse Code API');
        res.json({ success: true, input: text, encoded, mode: 'encode' });
    });

    // --- ROMAN NUMERALS (free) ---
    router.get('/api/roman', paidEndpointLimiter, paymentMiddleware(0, 0, "Roman Numerals API"), async (req, res) => {
        const num = req.query.num;
        const roman = (req.query.roman || '').trim().toUpperCase().slice(0, 20);
        if (!num && !roman) return res.status(400).json({ error: "Parameter 'num' (integer→roman) or 'roman' (roman→integer) required. Ex: /api/roman?num=2024 or ?roman=MMXXIV" });
        const vals = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
        if (num !== undefined) {
            const n = parseInt(num);
            if (isNaN(n) || n < 1 || n > 3999) return res.status(400).json({ error: 'Number must be between 1 and 3999' });
            let result = ''; let rem = n;
            for (const [v, r] of vals) { while (rem >= v) { result += r; rem -= v; } }
            return res.json({ success: true, integer: n, roman: result });
        }
        if (!/^[MDCLXVI]+$/.test(roman)) return res.status(400).json({ error: 'Invalid roman numeral characters' });
        const map = { M:1000, D:500, C:100, L:50, X:10, V:5, I:1 };
        let result = 0;
        for (let i = 0; i < roman.length; i++) {
            const cur = map[roman[i]], next = map[roman[i+1]];
            result += (next && cur < next) ? -cur : cur;
        }
        logActivity('api_call', 'Roman Numerals API');
        res.json({ success: true, roman, integer: result });
    });

    // --- TEXT STATS ADVANCED (free) ---
    router.get('/api/text-stats', paidEndpointLimiter, paymentMiddleware(0, 0, "Text Stats API"), async (req, res) => {
        const text = (req.query.text || '').slice(0, 50000);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required." });
        const words = text.trim().split(/\s+/).filter(Boolean);
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 2);
        const syllables = words.reduce((acc, w) => acc + (w.toLowerCase().match(/[aeiouy]+/g) || []).length, 0);
        const fleschKincaid = sentences.length && words.length ? Math.max(0, Math.min(100, 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length))) : 0;
        const grade = fleschKincaid >= 90 ? '5th grade' : fleschKincaid >= 70 ? '7th grade' : fleschKincaid >= 60 ? '8-9th grade' : fleschKincaid >= 50 ? '10-12th grade' : fleschKincaid >= 30 ? 'College' : 'Professional';
        logActivity('api_call', 'Text Stats API');
        res.json({ success: true, words: words.length, sentences: sentences.length, characters: text.length, characters_no_spaces: text.replace(/\s/g, '').length, syllables, paragraphs: text.split(/\n\s*\n/).filter(p => p.trim()).length, avg_words_per_sentence: sentences.length ? +(words.length / sentences.length).toFixed(1) : 0, avg_syllables_per_word: words.length ? +(syllables / words.length).toFixed(2) : 0, flesch_reading_ease: +fleschKincaid.toFixed(1), reading_level: grade, reading_time_minutes: Math.ceil(words.length / 200) });
    });

    // --- YAML VALIDATE (free) ---
    router.get('/api/yaml-validate', paidEndpointLimiter, paymentMiddleware(0, 0, "YAML Validate API"), async (req, res) => {
        const yaml = (req.query.yaml || '').slice(0, 50000);
        if (!yaml) return res.status(400).json({ error: "Parameter 'yaml' required." });
        try {
            const jsYaml = require('js-yaml');
            const parsed = jsYaml.load(yaml);
            logActivity('api_call', 'YAML Validate API');
            res.json({ success: true, valid: true, parsed, type: Array.isArray(parsed) ? 'array' : typeof parsed });
        } catch (err) {
            res.json({ success: true, valid: false, error: err.message, mark: err.mark ? { line: err.mark.line, column: err.mark.column } : null });
        }
    });

    // --- CRON NEXT RUNS (free) ---
    router.get('/api/cron-next', paidEndpointLimiter, paymentMiddleware(0, 0, "Cron Next Runs API"), async (req, res) => {
        const expression = (req.query.expr || '').trim().slice(0, 100);
        const count = Math.min(parseInt(req.query.count || '5'), 10);
        if (!expression) return res.status(400).json({ error: "Parameter 'expr' required. Ex: /api/cron-next?expr=0+9+*+*+1-5" });
        const parts = expression.split(/\s+/);
        if (parts.length !== 5) return res.status(400).json({ error: 'Cron expression must have 5 fields: minute hour day-of-month month day-of-week' });
        // Simple next-run calculation for common patterns
        try {
            const cronParser = require('cron-parser');
            const interval = cronParser.parseExpression(expression, { iterator: true });
            const runs = [];
            for (let i = 0; i < count; i++) {
                runs.push(interval.next().value.toISOString());
            }
            logActivity('api_call', `Cron Next: ${expression}`);
            res.json({ success: true, expression, count, next_runs: runs });
        } catch (err) {
            res.status(400).json({ error: 'Invalid cron expression: ' + err.message });
        }
    });

    // --- ANAGRAM CHECK (free) ---
    router.get('/api/anagram', paidEndpointLimiter, paymentMiddleware(0, 0, "Anagram API"), async (req, res) => {
        const word1 = (req.query.a || '').trim().toLowerCase().slice(0, 100);
        const word2 = (req.query.b || '').trim().toLowerCase().slice(0, 100);
        if (!word1 || !word2) return res.status(400).json({ error: "Parameters 'a' and 'b' required. Ex: /api/anagram?a=listen&b=silent" });
        const clean = s => s.replace(/[^a-z]/g, '').split('').sort().join('');
        const isAnagram = clean(word1) === clean(word2);
        logActivity('api_call', 'Anagram API');
        res.json({ success: true, a: word1, b: word2, is_anagram: isAnagram, shared_letters: clean(word1) });
    });

    // --- PALINDROME CHECK (free) ---
    router.get('/api/palindrome', paidEndpointLimiter, paymentMiddleware(0, 0, "Palindrome API"), async (req, res) => {
        const text = (req.query.text || '').trim().slice(0, 500);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/palindrome?text=racecar" });
        const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        const reversed = clean.split('').reverse().join('');
        const isPalindrome = clean === reversed;
        logActivity('api_call', 'Palindrome API');
        res.json({ success: true, text, is_palindrome: isPalindrome, cleaned: clean, reversed });
    });

    // --- BASE64 ENCODE (free) ---
    router.get('/api/base64-encode', paidEndpointLimiter, paymentMiddleware(0, 0, "Base64 Encode API"), async (req, res) => {
        const text = (req.query.text || '').slice(0, 10000);
        if (!text) return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/base64-encode?text=Hello+World" });
        const encoded = Buffer.from(text, 'utf8').toString('base64');
        logActivity('api_call', 'Base64 Encode API');
        res.json({ success: true, input: text.slice(0, 100), encoded, length: encoded.length });
    });

    // --- COLOR NAME (0.005 USDC) ---
    router.get('/api/colorname', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Color Name API"), async (req, res) => {
        const hex = (req.query.hex || '').trim().replace('#', '').toLowerCase().slice(0, 6);
        if (!hex) return res.status(400).json({ error: "Parameter 'hex' required. Ex: /api/colorname?hex=FF9900" });
        if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(hex)) return res.status(400).json({ error: 'Invalid hex color. Use 3 or 6 hex characters (without #)' });
        try {
            const r = await fetchWithTimeout(`https://www.thecolorapi.com/id?hex=${hex}&format=json`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 5000);
            const data = await r.json();
            logActivity('api_call', `Color Name: #${hex}`);
            res.json({ success: true, hex: `#${hex}`, name: data.name?.value, rgb: data.rgb?.value, hsl: data.hsl?.value, cmyk: data.cmyk?.value });
        } catch (err) {
            logger.error('Color Name API', err.message);
            res.status(500).json({ error: 'Color name lookup failed' });
        }
    });

    // --- ISBN LOOKUP (0.01 USDC) ---
    router.get('/api/isbn', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "ISBN Lookup API"), async (req, res) => {
        const isbn = (req.query.isbn || '').trim().replace(/[-\s]/g, '').slice(0, 17);
        if (!isbn) return res.status(400).json({ error: "Parameter 'isbn' required. Ex: /api/isbn?isbn=9780143127741" });
        if (!/^\d{10}$|^\d{13}$/.test(isbn)) return res.status(400).json({ error: 'ISBN must be 10 or 13 digits' });
        try {
            const r = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 6000);
            const data = await r.json();
            const book = data[`ISBN:${isbn}`];
            if (!book) return res.status(404).json({ error: `Book not found for ISBN: ${isbn}` });
            logActivity('api_call', `ISBN: ${isbn}`);
            res.json({ success: true, isbn, title: book.title, authors: book.authors?.map(a => a.name), publishers: book.publishers?.map(p => p.name), year: book.publish_date, pages: book.number_of_pages, cover: book.cover?.large || book.cover?.medium, subjects: book.subjects?.slice(0, 10).map(s => s.name) });
        } catch (err) {
            logger.error('ISBN API', err.message);
            res.status(500).json({ error: 'ISBN lookup failed' });
        }
    });

    // --- RECIPE SEARCH (0.01 USDC) ---
    router.get('/api/recipe', paidEndpointLimiter, paymentMiddleware(10000, 0.01, "Recipe API"), async (req, res) => {
        const query = (req.query.q || '').trim().slice(0, 100);
        if (!query) return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/recipe?q=pasta" });
        if (/[\x00-\x1F\x7F<>]/.test(query)) return res.status(400).json({ error: 'Invalid characters in query' });
        try {
            const r = await fetchWithTimeout(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 5000);
            const data = await r.json();
            const meals = data.meals?.slice(0, 5) || [];
            if (!meals.length) return res.status(404).json({ error: `No recipes found for: ${query}` });
            logActivity('api_call', `Recipe: ${query}`);
            const recipes = meals.map(m => ({ name: m.strMeal, category: m.strCategory, cuisine: m.strArea, instructions: m.strInstructions?.slice(0, 500), thumbnail: m.strMealThumb, youtube: m.strYoutube, ingredients: Array.from({ length: 20 }, (_, i) => m[`strIngredient${i+1}`]).filter(Boolean).slice(0, 10) }));
            res.json({ success: true, query, count: recipes.length, recipes });
        } catch (err) {
            logger.error('Recipe API', err.message);
            res.status(500).json({ error: 'Recipe search failed' });
        }
    });

    return router;
}

module.exports = createUtilsRouter;
