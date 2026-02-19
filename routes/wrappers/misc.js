// routes/wrappers/misc.js — Miscellaneous API wrappers
// joke, wikipedia, dictionary, countries, github, npm, ip, qrcode, time, holidays, geocoding, airquality, quote, facts, dogs

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createMiscRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

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

    return router;
}

module.exports = createMiscRouter;
