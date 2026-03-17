// routes/wrappers/science.js — Science & Space API wrappers
// arxiv, nasa, iss, spacex, crossref

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createScienceRouter(logActivity, paymentMiddleware, paidEndpointLimiter) {
    const router = express.Router();

    // --- ARXIV SEARCH API (0.005 USDC) ---
    router.get('/api/arxiv', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "ArXiv Search API"), async (req, res) => {
        const query = (req.query.query || '').trim().slice(0, 300);
        const maxResults = Math.min(Math.max(parseInt(req.query.max) || 5, 1), 20);

        if (!query) {
            return res.status(400).json({ error: "Parameter 'query' required. Ex: /api/arxiv?query=transformer+attention&max=5" });
        }

        try {
            const apiUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 10000);
            const xml = await apiRes.text();

            // Parse Atom XML → JSON (simple regex-based, no deps)
            const entries = [];
            const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
            let match;
            while ((match = entryRegex.exec(xml)) !== null) {
                const entry = match[1];
                const get = (tag) => {
                    const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
                    return m ? m[1].trim() : '';
                };
                const authors = [];
                const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
                let am;
                while ((am = authorRegex.exec(entry)) !== null) {
                    authors.push(am[1].trim());
                }
                const categories = [];
                const catRegex = /category[^>]*term="([^"]+)"/g;
                let cm;
                while ((cm = catRegex.exec(entry)) !== null) {
                    categories.push(cm[1]);
                }
                entries.push({
                    title: get('title').replace(/\s+/g, ' '),
                    summary: get('summary').replace(/\s+/g, ' ').slice(0, 500),
                    authors: authors.slice(0, 5),
                    published: get('published'),
                    updated: get('updated'),
                    id: get('id'),
                    categories: categories.slice(0, 5)
                });
            }

            logActivity('api_call', `ArXiv Search API: "${query}" -> ${entries.length} results`);
            res.json({ success: true, query, results_count: entries.length, results: entries });
        } catch (err) {
            logger.error('ArXiv Search API', err.message);
            return res.status(500).json({ error: 'ArXiv Search API request failed' });
        }
    });

    // --- NASA APOD API (0.005 USDC) ---
    router.get('/api/nasa', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "NASA APOD API"), async (req, res) => {
        try {
            const apiUrl = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY';
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (!data.title) {
                return res.status(500).json({ error: 'Invalid NASA APOD data' });
            }

            logActivity('api_call', `NASA APOD API: "${data.title}"`);
            res.json({
                success: true,
                title: data.title,
                explanation: data.explanation || '',
                date: data.date,
                media_type: data.media_type || 'image',
                url: data.url || '',
                hdurl: data.hdurl || '',
                copyright: data.copyright || ''
            });
        } catch (err) {
            logger.error('NASA APOD API', err.message);
            return res.status(500).json({ error: 'NASA APOD API request failed' });
        }
    });

    // --- ISS TRACKER API (0.003 USDC) ---
    router.get('/api/iss', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "ISS Tracker API"), async (req, res) => {
        try {
            // Fetch position and astronauts in parallel
            const [posRes, crewRes] = await Promise.all([
                fetchWithTimeout('http://api.open-notify.org/iss-now.json', {}, 5000),
                fetchWithTimeout('http://api.open-notify.org/astros.json', {}, 5000)
            ]);
            const posData = await posRes.json();
            const crewData = await crewRes.json();

            const issPos = posData.iss_position || {};
            const issCrew = (crewData.people || []).filter(p => p.craft === 'ISS');

            logActivity('api_call', `ISS Tracker API: ${issPos.latitude},${issPos.longitude}`);
            res.json({
                success: true,
                position: {
                    latitude: parseFloat(issPos.latitude) || 0,
                    longitude: parseFloat(issPos.longitude) || 0
                },
                timestamp: posData.timestamp || Math.floor(Date.now() / 1000),
                crew: {
                    count: issCrew.length,
                    members: issCrew.map(p => p.name)
                },
                total_in_space: crewData.number || 0
            });
        } catch (err) {
            logger.error('ISS Tracker API', err.message);
            return res.status(500).json({ error: 'ISS Tracker API request failed' });
        }
    });

    // --- SPACEX LAUNCHES API (0.005 USDC) ---
    router.get('/api/spacex', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "SpaceX Launches API"), async (req, res) => {
        const type = (req.query.type || 'latest').trim().toLowerCase();

        if (!['latest', 'upcoming'].includes(type)) {
            return res.status(400).json({ error: "Parameter 'type' must be 'latest' or 'upcoming'. Default: latest" });
        }

        try {
            const endpoint = type === 'upcoming' ? 'upcoming' : 'latest';
            const apiUrl = `https://api.spacexdata.com/v4/launches/${endpoint}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (Array.isArray(data)) {
                // Upcoming returns an array
                const launches = data.slice(0, 5).map(l => ({
                    name: l.name,
                    date_utc: l.date_utc,
                    flight_number: l.flight_number,
                    details: (l.details || '').slice(0, 200),
                    success: l.success
                }));
                logActivity('api_call', `SpaceX Launches API: upcoming -> ${launches.length}`);
                return res.json({ success: true, type: 'upcoming', count: launches.length, launches });
            }

            logActivity('api_call', `SpaceX Launches API: latest -> ${data.name}`);
            res.json({
                success: true,
                type: 'latest',
                name: data.name,
                date_utc: data.date_utc,
                flight_number: data.flight_number,
                details: (data.details || '').slice(0, 500),
                launch_success: data.success,
                rocket: data.rocket,
                links: {
                    webcast: data.links?.webcast || '',
                    article: data.links?.article || '',
                    wikipedia: data.links?.wikipedia || '',
                    patch: data.links?.patch?.small || ''
                }
            });
        } catch (err) {
            logger.error('SpaceX Launches API', err.message);
            return res.status(500).json({ error: 'SpaceX Launches API request failed' });
        }
    });

    // --- CROSSREF ACADEMIC SEARCH API (0.005 USDC) ---
    router.get('/api/crossref', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Crossref Academic Search API"), async (req, res) => {
        const query = (req.query.query || '').trim().slice(0, 300);
        const rows = Math.min(Math.max(parseInt(req.query.max) || 5, 1), 20);

        if (!query) {
            return res.status(400).json({ error: "Parameter 'query' required. Ex: /api/crossref?query=machine+learning&max=5" });
        }

        try {
            const apiUrl = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${rows}&select=DOI,title,author,published-print,container-title,type,is-referenced-by-count`;
            const apiRes = await fetchWithTimeout(apiUrl, {
                headers: { 'User-Agent': 'x402-bazaar/1.0 (mailto:contact@x402bazaar.org)' }
            }, 10000);
            const data = await apiRes.json();

            const items = (data.message?.items || []).map(item => ({
                title: (item.title || [])[0] || 'Untitled',
                doi: item.DOI || '',
                authors: (item.author || []).slice(0, 5).map(a => `${a.given || ''} ${a.family || ''}`.trim()),
                published: item['published-print']?.['date-parts']?.[0]?.join('-') || '',
                journal: (item['container-title'] || [])[0] || '',
                type: item.type || '',
                citations: item['is-referenced-by-count'] || 0
            }));

            logActivity('api_call', `Crossref Search API: "${query}" -> ${items.length} results`);
            res.json({ success: true, query, results_count: items.length, results: items });
        } catch (err) {
            logger.error('Crossref Search API', err.message);
            return res.status(500).json({ error: 'Crossref Search API request failed' });
        }
    });

    return router;
}

module.exports = createScienceRouter;
