// routes/wrappers/intelligence.js — High-value intelligence APIs
// contract-risk, email-parse, code-review, table-insights,
// domain-report, seo-audit, lead-score, crypto-intelligence

const express = require('express');
const dns = require('node:dns');
const cheerio = require('cheerio');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');
const { openaiRetry } = require('../../lib/openai-retry');

const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|169\.254\.|fc00:|fe80:|::1)/i;

async function safeUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS URLs allowed');
    } catch (e) {
        throw new Error(e.message.includes('Only') ? e.message : 'Invalid URL format');
    }
    if (BLOCKED_HOST.test(parsed.hostname)) throw new Error('Internal URLs not allowed');
    try {
        const { address } = await dns.promises.lookup(parsed.hostname);
        if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(address)) {
            throw new Error('Internal IPs not allowed');
        }
    } catch (e) {
        if (e.message.includes('Internal')) throw e;
        throw new Error('Could not resolve hostname');
    }
    return parsed;
}

function createIntelligenceRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- 1. CONTRACT RISK ANALYSIS (POST) - 0.01 USDC ---
    router.post('/api/contract-risk', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'Contract Risk Analysis'), async (req, res) => {
        const text = (req.body.text || '').trim();
        if (!text) return res.status(400).json({ error: "Body param 'text' required" });
        if (text.length > 30000) return res.status(400).json({ error: 'Text too long (max 30000 chars)' });

        try {
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a legal contract analyst. Analyze the contract text and identify risky clauses. Respond ONLY with valid JSON in this exact format:
{"overall_risk":"high|medium|low","risk_score":0-100,"summary":"brief overall assessment","clauses":[{"text":"exact problematic text (max 200 chars)","risk_level":"high|medium|low","category":"liability|privacy|termination|payment|ip|non-compete|arbitration|other","explanation":"why this is risky"}]}
Focus on: unlimited liability, data sharing, automatic renewals, unilateral changes, IP ownership transfers, non-compete, mandatory arbitration.`
                    },
                    { role: 'user', content: text }
                ],
                temperature: 0.2,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            }), 'ContractRisk');

            let result;
            try { result = JSON.parse(response.choices[0].message.content); }
            catch { result = { overall_risk: 'unknown', risk_score: 0, summary: 'Parse error', clauses: [] }; }

            logActivity('api_call', `Contract Risk: ${result.overall_risk} score=${result.risk_score} clauses=${result.clauses?.length || 0}`);
            res.json({ success: true, ...result });
        } catch (err) {
            logger.error('ContractRisk', err.message);
            if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded' });
            res.status(500).json({ error: 'Contract analysis failed' });
        }
    });

    // --- 2. EMAIL → CRM PARSE (POST) - 0.005 USDC ---
    router.post('/api/email-parse', paidEndpointLimiter, paymentMiddleware(5000, 0.005, 'Email CRM Parser'), async (req, res) => {
        const email = (req.body.email || '').trim();
        if (!email) return res.status(400).json({ error: "Body param 'email' required" });
        if (email.length > 10000) return res.status(400).json({ error: 'Email too long (max 10000 chars)' });

        try {
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Extract CRM data from this email. Respond ONLY with valid JSON:
{"sender_name":"full name or null","sender_email":"email or null","company":"company name or null","phone":"phone or null","intent":"inquiry|complaint|purchase|partnership|support|other","sentiment":"positive|neutral|negative","urgency":"high|medium|low","key_topics":["topic1","topic2"],"follow_up_action":"suggested action in one sentence","summary":"2-sentence summary of the email"}`
                    },
                    { role: 'user', content: email }
                ],
                temperature: 0.1,
                max_tokens: 500,
                response_format: { type: 'json_object' }
            }), 'EmailParse');

            let result;
            try { result = JSON.parse(response.choices[0].message.content); }
            catch { result = {}; }

            logActivity('api_call', `Email Parse: ${result.intent || 'unknown'} from ${result.company || 'unknown'}`);
            res.json({ success: true, ...result });
        } catch (err) {
            logger.error('EmailParse', err.message);
            if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded' });
            res.status(500).json({ error: 'Email parsing failed' });
        }
    });

    // --- 3. AI CODE REVIEW (POST) - 0.01 USDC ---
    router.post('/api/code-review', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'AI Code Review'), async (req, res) => {
        const code = (req.body.code || '').trim();
        const language = (req.body.language || 'auto').trim().slice(0, 30);
        if (!code) return res.status(400).json({ error: "Body param 'code' required" });
        if (code.length > 20000) return res.status(400).json({ error: 'Code too long (max 20000 chars)' });

        try {
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a senior code reviewer. Review the provided code and respond ONLY with valid JSON:
{"language":"detected language","quality_score":0-100,"summary":"one sentence overall assessment","issues":[{"line":line_number_or_null,"severity":"critical|major|minor|info","type":"bug|security|performance|style|maintainability","message":"description of the issue","suggestion":"how to fix it"}],"strengths":["thing done well"]}
Be thorough. Focus on bugs, security vulnerabilities, performance, and maintainability.`
                    },
                    { role: 'user', content: `Language: ${language}\n\n${code}` }
                ],
                temperature: 0.2,
                max_tokens: 2000,
                response_format: { type: 'json_object' }
            }), 'CodeReview');

            let result;
            try { result = JSON.parse(response.choices[0].message.content); }
            catch { result = { quality_score: 0, summary: 'Parse error', issues: [], strengths: [] }; }

            logActivity('api_call', `Code Review: ${result.language || language} score=${result.quality_score} issues=${result.issues?.length || 0}`);
            res.json({ success: true, ...result });
        } catch (err) {
            logger.error('CodeReview', err.message);
            if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded' });
            res.status(500).json({ error: 'Code review failed' });
        }
    });

    // --- 4. TABLE / CSV AI INSIGHTS (POST) - 0.01 USDC ---
    router.post('/api/table-insights', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'Table/CSV AI Insights'), async (req, res) => {
        const csv = (req.body.csv || req.body.data || '').trim();
        if (!csv) return res.status(400).json({ error: "Body param 'csv' or 'data' required" });
        if (csv.length > 20000) return res.status(400).json({ error: 'Data too large (max 20000 chars)' });

        try {
            const response = await openaiRetry(() => getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a data analyst. Analyze the CSV/table data and respond ONLY with valid JSON:
{"rows":total_row_count,"columns":["col1","col2"],"insights":["insight 1","insight 2","insight 3"],"anomalies":["anomaly 1"],"trends":["trend 1"],"recommendations":["action 1"],"summary":"2-sentence overview of the dataset"}`
                    },
                    { role: 'user', content: csv }
                ],
                temperature: 0.3,
                max_tokens: 1000,
                response_format: { type: 'json_object' }
            }), 'TableInsights');

            let result;
            try { result = JSON.parse(response.choices[0].message.content); }
            catch { result = { summary: 'Parse error', insights: [], anomalies: [], trends: [], recommendations: [] }; }

            logActivity('api_call', `Table Insights: ${result.rows || '?'} rows ${result.columns?.length || '?'} cols`);
            res.json({ success: true, ...result });
        } catch (err) {
            logger.error('TableInsights', err.message);
            if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded' });
            res.status(500).json({ error: 'Table analysis failed' });
        }
    });

    // --- 5. DOMAIN INTELLIGENCE REPORT (GET) - 0.01 USDC ---
    router.get('/api/domain-report', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'Domain Intelligence Report'), async (req, res) => {
        let domain = (req.query.domain || '').trim().toLowerCase()
            .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!domain) return res.status(400).json({ error: "Param 'domain' required. Ex: /api/domain-report?domain=example.com" });
        if (!/^[a-z0-9][a-z0-9\-.]{0,250}[a-z0-9]$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            // SECURITY: DNS rebinding check — block internal IPs
            try {
                const { address } = await dns.promises.lookup(domain);
                if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(address)) {
                    return res.status(400).json({ error: 'Internal IPs not allowed' });
                }
            } catch {
                return res.status(400).json({ error: 'Could not resolve domain' });
            }

            // Parallel data gathering — individual failures are expected and intentionally silent
            const [rdapRes, dnsRes, pageRes] = await Promise.allSettled([
                fetchWithTimeout(`https://rdap.org/domain/${domain}`, {}, 8000)
                    .then(r => r.json()).catch(() => null), // intentionally silent — RDAP may be unavailable
                Promise.all([
                    dns.promises.resolve4(domain).catch(() => []), // intentionally silent — record type may not exist
                    dns.promises.resolveMx(domain).catch(() => []), // intentionally silent
                    dns.promises.resolveNs(domain).catch(() => []), // intentionally silent
                    dns.promises.resolveTxt(domain).catch(() => []), // intentionally silent
                ]),
                fetchWithTimeout(`https://${domain}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
                }, 8000).then(async r => ({
                    status: r.status,
                    ssl: r.url.startsWith('https://'),
                    headers: Object.fromEntries([...r.headers.entries()].slice(0, 20)),
                    html: (await r.text()).slice(0, 15000)
                })).catch(() => null), // intentionally silent — site may be unreachable
            ]);

            const rdap = rdapRes.status === 'fulfilled' ? rdapRes.value : null;
            const [aRecords, mxRecords, nsRecords, txtRecords] = dnsRes.status === 'fulfilled' ? dnsRes.value : [[], [], [], []];
            const page = pageRes.status === 'fulfilled' ? pageRes.value : null;

            // Parse RDAP dates
            const createdEvent = rdap?.events?.find(e => e.eventAction === 'registration');
            const expiresEvent = rdap?.events?.find(e => e.eventAction === 'expiration');
            const created = createdEvent?.eventDate || null;
            const expires = expiresEvent?.eventDate || null;
            const ageDays = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86400000) : null;
            const registrar = rdap?.entities?.find(e => e.roles?.includes('registrar'))
                ?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || null;

            // Tech detection via HTML patterns
            const tech = [];
            if (page?.html) {
                const $ = cheerio.load(page.html);
                const html = page.html;
                if (html.includes('wp-content') || html.includes('wp-json')) tech.push('WordPress');
                if (html.includes('shopify')) tech.push('Shopify');
                if (html.includes('__NEXT_DATA__')) tech.push('Next.js');
                if (html.includes('_nuxt')) tech.push('Nuxt.js');
                if (html.includes('gatsby')) tech.push('Gatsby');
                if (html.includes('react')) tech.push('React');
                if (html.includes('angular.min') || html.includes('ng-version')) tech.push('Angular');
                if (html.includes('vue.min') || html.includes('__vue__')) tech.push('Vue.js');
                if (page.headers?.['x-powered-by']) tech.push(page.headers['x-powered-by']);
                if (page.headers?.server && page.headers.server !== 'cloudflare') tech.push(`Server: ${page.headers.server}`);
                const generator = $('meta[name="generator"]').attr('content');
                if (generator) tech.push(generator);
            }

            // Trust score
            let score = 0;
            if (ageDays && ageDays > 1825) score += 25;
            else if (ageDays && ageDays > 365) score += 15;
            else if (ageDays && ageDays > 90) score += 5;
            if (mxRecords.length > 0) score += 20;
            if (page?.ssl) score += 20;
            if (aRecords.length > 0) score += 15;
            if (nsRecords.length > 0) score += 10;
            if (tech.length > 0) score += 10;

            logActivity('api_call', `Domain Report: ${domain} score=${score} tech=${[...new Set(tech)].slice(0, 3).join(',')}`);
            res.json({
                success: true,
                domain,
                trust_score: Math.min(score, 100),
                registrar,
                created,
                expires,
                age_days: ageDays,
                dns: {
                    a: aRecords,
                    mx: mxRecords.map(r => ({ priority: r.priority, exchange: r.exchange })),
                    ns: nsRecords,
                    txt: txtRecords.map(r => r.join(' ')).slice(0, 10),
                },
                ssl: page?.ssl || false,
                http_status: page?.status || null,
                tech: [...new Set(tech)],
            });
        } catch (err) {
            logger.error('DomainReport', err.message);
            res.status(500).json({ error: 'Domain report failed' });
        }
    });

    // --- 6. SEO AUDIT (GET) - 0.01 USDC ---
    router.get('/api/seo-audit', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'SEO Audit'), async (req, res) => {
        const targetUrl = (req.query.url || '').trim();
        if (!targetUrl) return res.status(400).json({ error: "Param 'url' required. Ex: /api/seo-audit?url=https://example.com" });

        let parsed;
        try { parsed = await safeUrl(targetUrl); }
        catch (e) { return res.status(400).json({ error: e.message }); }

        try {
            const pageRes = await fetchWithTimeout(targetUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
            }, 10000);
            const html = await pageRes.text();
            if (html.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Page too large (max 5MB)' });

            const $ = cheerio.load(html);
            const issues = [];

            // Title
            const title = $('title').text().trim();
            if (!title) issues.push({ severity: 'critical', message: 'Missing <title> tag' });
            else if (title.length < 30) issues.push({ severity: 'major', message: `Title too short (${title.length} chars, min 30)` });
            else if (title.length > 60) issues.push({ severity: 'minor', message: `Title too long (${title.length} chars, max 60)` });

            // Meta description
            const desc = $('meta[name="description"]').attr('content') || '';
            if (!desc) issues.push({ severity: 'major', message: 'Missing meta description' });
            else if (desc.length < 120) issues.push({ severity: 'minor', message: `Meta description too short (${desc.length} chars, min 120)` });
            else if (desc.length > 160) issues.push({ severity: 'minor', message: `Meta description too long (${desc.length} chars, max 160)` });

            // H1
            const h1s = $('h1');
            if (h1s.length === 0) issues.push({ severity: 'major', message: 'No <h1> tag found' });
            else if (h1s.length > 1) issues.push({ severity: 'minor', message: `Multiple <h1> tags (${h1s.length}), should have exactly 1` });

            // Canonical
            if (!$('link[rel="canonical"]').attr('href')) issues.push({ severity: 'minor', message: 'No canonical tag' });

            // OG tags
            if (!$('meta[property="og:title"]').attr('content')) issues.push({ severity: 'info', message: 'Missing og:title' });
            if (!$('meta[property="og:description"]').attr('content')) issues.push({ severity: 'info', message: 'Missing og:description' });
            if (!$('meta[property="og:image"]').attr('content')) issues.push({ severity: 'info', message: 'Missing og:image' });

            // Images without alt
            const imgsWithoutAlt = $('img:not([alt])').length;
            if (imgsWithoutAlt > 0) issues.push({ severity: 'major', message: `${imgsWithoutAlt} image(s) missing alt attribute` });

            // Schema.org
            const hasSchema = $('script[type="application/ld+json"]').length > 0;

            // Links
            const internalLinks = $('a[href]').filter((_, el) => {
                const href = $(el).attr('href') || '';
                return href.startsWith('/') || href.startsWith(parsed.origin);
            }).length;
            const externalLinks = $('a[href]').filter((_, el) => {
                const href = $(el).attr('href') || '';
                return href.startsWith('http') && !href.startsWith(parsed.origin);
            }).length;

            const criticals = issues.filter(i => i.severity === 'critical').length;
            const majors = issues.filter(i => i.severity === 'major').length;
            const minors = issues.filter(i => i.severity === 'minor').length;
            const score = Math.max(0, 100 - (criticals * 25) - (majors * 10) - (minors * 5));

            logActivity('api_call', `SEO Audit: ${parsed.hostname} score=${score} issues=${issues.length}`);
            res.json({
                success: true,
                url: targetUrl,
                score,
                grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F',
                issues,
                meta: {
                    title,
                    description: desc,
                    canonical: $('link[rel="canonical"]').attr('href') || null,
                },
                headings: {
                    h1: h1s.map((_, el) => $(el).text().trim()).get(),
                    h2_count: $('h2').length,
                    h3_count: $('h3').length,
                },
                links: { internal: internalLinks, external: externalLinks },
                schema_org: hasSchema,
                page_size_kb: Math.round(html.length / 1024),
            });
        } catch (err) {
            logger.error('SEOAudit', err.message);
            res.status(500).json({ error: 'SEO audit failed' });
        }
    });

    // --- 7. LEAD SCORE (GET) - 0.01 USDC ---
    router.get('/api/lead-score', paidEndpointLimiter, paymentMiddleware(10000, 0.01, 'Lead Scoring'), async (req, res) => {
        let domain = (req.query.domain || '').trim().toLowerCase()
            .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!domain) return res.status(400).json({ error: "Param 'domain' required. Ex: /api/lead-score?domain=stripe.com" });
        if (!/^[a-z0-9][a-z0-9\-.]{0,250}[a-z0-9]$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            // SECURITY: DNS rebinding check — block internal IPs
            try {
                const { address } = await dns.promises.lookup(domain);
                if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(address)) {
                    return res.status(400).json({ error: 'Internal IPs not allowed' });
                }
            } catch {
                return res.status(400).json({ error: 'Could not resolve domain' });
            }

            const orgName = domain.split('.')[0];
            // Parallel data gathering — individual failures are expected and intentionally silent
            const [rdapRes, dnsRes, githubRes, pageRes] = await Promise.allSettled([
                fetchWithTimeout(`https://rdap.org/domain/${domain}`, {}, 6000)
                    .then(r => r.json()).catch(() => null), // intentionally silent — RDAP may be unavailable
                Promise.all([
                    dns.promises.resolve4(domain).catch(() => []), // intentionally silent — record type may not exist
                    dns.promises.resolveMx(domain).catch(() => []), // intentionally silent
                ]),
                fetchWithTimeout(`https://api.github.com/orgs/${orgName}`, {
                    headers: { 'User-Agent': 'x402-bazaar' }
                }, 5000).then(r => r.status === 200 ? r.json() : null).catch(() => null), // intentionally silent — org may not exist
                fetchWithTimeout(`https://${domain}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; x402-bazaar/1.0)' }
                }, 6000).then(r => ({
                    ssl: r.url.startsWith('https://'),
                    status: r.status,
                    server: r.headers.get('server') || r.headers.get('x-powered-by') || null,
                })).catch(() => null), // intentionally silent — site may be unreachable
            ]);

            const rdap = rdapRes.status === 'fulfilled' ? rdapRes.value : null;
            const [aRecords, mxRecords] = dnsRes.status === 'fulfilled' ? dnsRes.value : [[], []];
            const github = githubRes.status === 'fulfilled' ? githubRes.value : null;
            const page = pageRes.status === 'fulfilled' ? pageRes.value : null;

            const signals = [];
            let score = 0;

            // Domain age
            const createdEvent = rdap?.events?.find(e => e.eventAction === 'registration');
            const ageDays = createdEvent
                ? Math.floor((Date.now() - new Date(createdEvent.eventDate).getTime()) / 86400000)
                : null;
            if (ageDays !== null) {
                if (ageDays > 1825) { score += 20; signals.push({ name: 'Domain age', value: `${Math.floor(ageDays / 365)}y`, points: 20 }); }
                else if (ageDays > 365) { score += 15; signals.push({ name: 'Domain age', value: `${Math.floor(ageDays / 365)}y`, points: 15 }); }
                else if (ageDays > 90) { score += 5; signals.push({ name: 'Domain age', value: `${ageDays}d`, points: 5 }); }
                else { signals.push({ name: 'Domain age', value: `${ageDays}d (very new)`, points: 0 }); }
            }

            // MX = company has email setup
            if (mxRecords.length > 0) {
                score += 20;
                signals.push({ name: 'Email configured', value: mxRecords[0].exchange, points: 20 });
            } else {
                signals.push({ name: 'Email configured', value: 'No MX records', points: 0 });
            }

            // SSL
            if (page?.ssl) { score += 15; signals.push({ name: 'HTTPS/SSL', value: 'Valid', points: 15 }); }
            else { signals.push({ name: 'HTTPS/SSL', value: 'Missing or failed', points: 0 }); }

            // DNS resolves
            if (aRecords.length > 0) { score += 15; signals.push({ name: 'DNS resolves', value: aRecords[0], points: 15 }); }

            // GitHub org
            if (github?.public_repos > 0) {
                const pts = Math.min(20, github.public_repos);
                score += pts;
                signals.push({ name: 'GitHub org', value: `${github.public_repos} public repos`, points: pts });
            }

            // Tech stack signal
            if (page?.server) { score += 5; signals.push({ name: 'Tech stack detected', value: page.server, points: 5 }); }

            const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
            logActivity('api_call', `Lead Score: ${domain} score=${score} grade=${grade}`);
            res.json({
                success: true,
                domain,
                score: Math.min(score, 100),
                grade,
                signals,
                age_days: ageDays,
                github_org: github ? { repos: github.public_repos, followers: github.followers } : null,
            });
        } catch (err) {
            logger.error('LeadScore', err.message);
            res.status(500).json({ error: 'Lead scoring failed' });
        }
    });

    // --- 8. CRYPTO INTELLIGENCE (GET) - 0.005 USDC ---
    router.get('/api/crypto-intelligence', paidEndpointLimiter, paymentMiddleware(5000, 0.005, 'Crypto Intelligence'), async (req, res) => {
        const symbol = (req.query.symbol || req.query.id || '').trim().toLowerCase().slice(0, 50);
        if (!symbol) return res.status(400).json({ error: "Param 'symbol' required. Ex: /api/crypto-intelligence?symbol=bitcoin" });

        try {
            // Search for the coin id
            const searchRes = await fetchWithTimeout(
                `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`,
                { headers: { Accept: 'application/json' } },
                8000
            );
            const searchData = await searchRes.json();
            const coin = searchData.coins?.[0];
            if (!coin) return res.status(404).json({ error: `Token '${symbol}' not found on CoinGecko` });

            // Full coin data
            const coinRes = await fetchWithTimeout(
                `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true`,
                { headers: { Accept: 'application/json' } },
                10000
            );
            const data = await coinRes.json();
            if (data.status?.error_code === 429) return res.status(429).json({ error: 'CoinGecko rate limit, retry in 60s' });

            const md = data.market_data;
            const dev = data.developer_data;
            const community = data.community_data;

            logActivity('api_call', `Crypto Intelligence: ${data.symbol?.toUpperCase()} $${md?.current_price?.usd}`);
            res.json({
                success: true,
                id: data.id,
                name: data.name,
                symbol: data.symbol?.toUpperCase(),
                price_usd: md?.current_price?.usd || null,
                market_cap_usd: md?.market_cap?.usd || null,
                volume_24h: md?.total_volume?.usd || null,
                change_24h: md?.price_change_percentage_24h || null,
                change_7d: md?.price_change_percentage_7d || null,
                ath_usd: md?.ath?.usd || null,
                ath_date: md?.ath_date?.usd || null,
                circulating_supply: md?.circulating_supply || null,
                total_supply: md?.total_supply || null,
                github: {
                    stars: dev?.stars || 0,
                    forks: dev?.forks || 0,
                    commits_4w: dev?.commit_count_4_weeks || 0,
                    contributors: dev?.pull_request_contributors || 0,
                },
                community: {
                    twitter_followers: community?.twitter_followers || 0,
                    telegram_users: community?.telegram_channel_user_count || 0,
                    reddit_subscribers: community?.reddit_subscribers || 0,
                },
                links: {
                    homepage: data.links?.homepage?.[0] || null,
                    github: data.links?.repos_url?.github?.[0] || null,
                },
                description: data.description?.en?.replace(/<[^>]+>/g, '').slice(0, 500) || null,
            });
        } catch (err) {
            logger.error('CryptoIntelligence', err.message);
            if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded' });
            res.status(500).json({ error: 'Crypto intelligence failed' });
        }
    });

    return router;
}

module.exports = createIntelligenceRouter;
