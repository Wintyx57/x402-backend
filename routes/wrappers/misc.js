// routes/wrappers/misc.js — Miscellaneous API wrappers
// joke, wikipedia, dictionary, countries, github, npm, ip, qrcode, time, holidays, geocoding, airquality, quote, facts, dogs

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createMiscRouter(logActivity, paymentMiddleware, paidEndpointLimiter) {
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
                part_of_speech: m.partOfSpeech,
                definitions: (m.definitions || []).slice(0, 3).map(d => d.definition)
            }));

            logActivity('api_call', `Dictionary API: "${word}"`);

            res.json({
                success: true,
                word: entry.word,
                phonetic: entry.phonetic || '',
                meanings,
                source_url: entry.sourceUrls?.[0] || ''
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
            let geoResult = null;

            // Primary: ip-api.com (45 req/min free tier)
            try {
                const apiUrl = `https://ip-api.com/json/${encodeURIComponent(address)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as`;
                const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
                const data = await apiRes.json();
                if (data.status !== 'fail') {
                    geoResult = {
                        country: data.country || '', country_code: data.countryCode || '',
                        region: data.regionName || '', city: data.city || '', zip: data.zip || '',
                        latitude: data.lat || 0, longitude: data.lon || 0, timezone: data.timezone || '',
                        isp: data.isp || '', org: data.org || '',
                    };
                }
            } catch (primaryErr) {
                logger.warn('IP Geolocation API', `ip-api.com failed: ${primaryErr.message}, trying fallback`);
            }

            // Fallback: ipwho.is (free, no key, unlimited)
            if (!geoResult) {
                try {
                    const fbUrl = `https://ipwho.is/${encodeURIComponent(address)}`;
                    const fbRes = await fetchWithTimeout(fbUrl, {}, 5000);
                    const fb = await fbRes.json();
                    if (fb.success !== false) {
                        geoResult = {
                            country: fb.country || '', country_code: fb.country_code || '',
                            region: fb.region || '', city: fb.city || '', zip: fb.postal || '',
                            latitude: fb.latitude || 0, longitude: fb.longitude || 0,
                            timezone: fb.timezone?.id || '', isp: fb.connection?.isp || '', org: fb.connection?.org || '',
                        };
                    }
                } catch (fbErr) {
                    logger.warn('IP Geolocation API', `ipwho.is fallback also failed: ${fbErr.message}`);
                }
            }

            // Fallback 2: ipinfo.io (free 50K/month, reliable)
            if (!geoResult) {
                try {
                    const fb2Url = `https://ipinfo.io/${encodeURIComponent(address)}/json`;
                    const fb2Res = await fetchWithTimeout(fb2Url, {}, 5000);
                    const fb2 = await fb2Res.json();
                    if (!fb2.bogon && fb2.ip) {
                        const [lat, lon] = (fb2.loc || '0,0').split(',').map(Number);
                        geoResult = {
                            country: fb2.country || '', country_code: fb2.country || '',
                            region: fb2.region || '', city: fb2.city || '', zip: fb2.postal || '',
                            latitude: lat || 0, longitude: lon || 0,
                            timezone: fb2.timezone || '', isp: fb2.org || '', org: fb2.org || '',
                        };
                    }
                } catch (fb2Err) {
                    logger.warn('IP Geolocation API', `ipinfo.io fallback also failed: ${fb2Err.message}`);
                }
            }

            if (!geoResult) {
                return res.status(404).json({ error: 'IP lookup failed', address });
            }

            logActivity('api_call', `IP Geolocation API: ${address}`);
            res.json({ success: true, ip: address, ...geoResult });
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

    // --- SVG AVATAR GENERATOR API (0.005 USDC) ---
    // Generates unique, deterministic SVG avatars from any name/seed string
    router.get('/api/avatar', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "SVG Avatar Generator API"), async (req, res) => {
        const name = (req.query.name || '').trim().slice(0, 100);
        const sizeParam = parseInt(req.query.size) || 128;
        const style = (req.query.style || 'geometric').toLowerCase();

        if (!name) {
            return res.status(400).json({ error: "Parameter 'name' required. Ex: /api/avatar?name=Wintyx57&size=128&style=geometric" });
        }

        if (!['geometric', 'pixel', 'initials'].includes(style)) {
            return res.status(400).json({ error: "Invalid style. Choose: geometric, pixel, initials" });
        }

        const size = Math.max(32, Math.min(512, sizeParam));

        // Deterministic hash from name (simple djb2)
        function hash(str) {
            let h = 5381;
            for (let i = 0; i < str.length; i++) {
                h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
            }
            return h;
        }

        // Generate deterministic colors from hash
        function hashColor(seed, offset) {
            const h = hash(seed + String(offset));
            const hue = h % 360;
            const sat = 50 + (h % 30);
            const lit = 45 + (h % 25);
            return `hsl(${hue}, ${sat}%, ${lit}%)`;
        }

        const h = hash(name);
        const bgColor = hashColor(name, 0);
        const fgColor = hashColor(name, 42);
        const accentColor = hashColor(name, 99);

        let svgContent;

        if (style === 'initials') {
            // Clean initials avatar with gradient background
            const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
            const fontSize = initials.length === 1 ? size * 0.5 : size * 0.38;
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${bgColor}"/>
    <stop offset="100%" stop-color="${fgColor}"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#bg)"/>
  <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-weight="600" font-size="${fontSize}">${initials}</text>
</svg>`;
        } else if (style === 'pixel') {
            // 5x5 symmetric pixel grid (mirrored horizontally)
            const cellSize = size / 5;
            let rects = '';
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 3; col++) {
                    const bit = hash(name + row + col) % 3;
                    if (bit > 0) {
                        const color = bit === 1 ? fgColor : accentColor;
                        rects += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`;
                        // Mirror horizontally
                        if (col < 2) {
                            rects += `<rect x="${(4 - col) * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`;
                        }
                    }
                }
            }
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}" rx="8"/>
  ${rects}
</svg>`;
        } else {
            // Geometric: circles, triangles, arcs layered
            const shapes = [];
            const numShapes = 3 + (h % 4); // 3-6 shapes
            for (let i = 0; i < numShapes; i++) {
                const sh = hash(name + 'shape' + i);
                const cx = (sh % size * 0.8) + size * 0.1;
                const cy = (hash(name + 'y' + i) % (size * 0.8)) + size * 0.1;
                const r = size * 0.1 + (sh % (size * 0.25));
                const color = hashColor(name, i * 17);
                const opacity = 0.5 + (sh % 40) / 100;
                const shapeType = sh % 3;

                if (shapeType === 0) {
                    shapes.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`);
                } else if (shapeType === 1) {
                    const half = r * 0.8;
                    shapes.push(`<polygon points="${cx.toFixed(1)},${(cy - half).toFixed(1)} ${(cx - half).toFixed(1)},${(cy + half).toFixed(1)} ${(cx + half).toFixed(1)},${(cy + half).toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`);
                } else {
                    shapes.push(`<rect x="${(cx - r / 2).toFixed(1)}" y="${(cy - r / 2).toFixed(1)}" width="${r.toFixed(1)}" height="${r.toFixed(1)}" rx="${(r * 0.2).toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`);
                }
            }
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}" rx="${(size * 0.1).toFixed(0)}"/>
  ${shapes.join('\n  ')}
</svg>`;
        }

        logActivity('api_call', `SVG Avatar API: "${name}" (${style}, ${size}px)`);

        // Return SVG directly with correct content type
        if (req.query.format === 'json') {
            return res.json({
                success: true,
                name,
                style,
                size,
                svg: svgContent,
                data_uri: `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`,
            });
        }

        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(svgContent);
    });

    // --- CAT IMAGE API (0.003 USDC) ---
    router.get('/api/cat', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Cat Image API"), async (req, res) => {
        try {
            const apiRes = await fetchWithTimeout('https://cataas.com/cat?json=true', {}, 5000);
            const data = await apiRes.json();

            logActivity('api_call', 'Cat Image API');
            res.json({
                success: true,
                image_url: data.url ? `https://cataas.com${data.url}` : `https://cataas.com/cat/${data._id}`,
                tags: data.tags || [],
                id: data._id || ''
            });
        } catch (err) {
            logger.error('Cat Image API', err.message);
            return res.status(500).json({ error: 'Cat Image API request failed' });
        }
    });

    // --- COLOR PALETTE API (0.005 USDC) ---
    router.get('/api/color-palette', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Color Palette API"), async (req, res) => {
        try {
            const seed = (req.query.seed || '').trim().replace(/^#/, '');
            let model = 'default';
            let input = [[Math.random() * 255 | 0, Math.random() * 255 | 0, Math.random() * 255 | 0], 'N', 'N', 'N', 'N'];

            if (seed && /^[0-9a-fA-F]{6}$/.test(seed)) {
                const r = parseInt(seed.substring(0, 2), 16);
                const g = parseInt(seed.substring(2, 4), 16);
                const b = parseInt(seed.substring(4, 6), 16);
                input = [[r, g, b], 'N', 'N', 'N', 'N'];
            }

            const apiRes = await fetchWithTimeout('http://colormind.io/api/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, input })
            }, 8000);
            const data = await apiRes.json();

            if (!data.result || !Array.isArray(data.result)) {
                return res.status(500).json({ error: 'Invalid color palette response' });
            }

            const palette = data.result.map(rgb => ({
                rgb: { r: rgb[0], g: rgb[1], b: rgb[2] },
                hex: `#${rgb[0].toString(16).padStart(2, '0')}${rgb[1].toString(16).padStart(2, '0')}${rgb[2].toString(16).padStart(2, '0')}`
            }));

            logActivity('api_call', `Color Palette API: ${seed || 'random'}`);
            res.json({ success: true, seed: seed || null, palette });
        } catch (err) {
            logger.error('Color Palette API', err.message);
            return res.status(500).json({ error: 'Color Palette API request failed' });
        }
    });

    // --- OPENVERSE IMAGE SEARCH API (0.005 USDC) ---
    router.get('/api/openverse', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Openverse Image Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().slice(0, 200);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 20);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/openverse?q=sunset+mountain" });
        }

        try {
            const apiUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${limit}`;
            const apiRes = await fetchWithTimeout(apiUrl, {
                headers: { 'User-Agent': 'x402-bazaar/1.0' }
            }, 10000);
            const data = await apiRes.json();

            const images = (data.results || []).map(img => ({
                title: img.title || '',
                url: img.url || '',
                thumbnail: img.thumbnail || '',
                creator: img.creator || '',
                license: img.license || '',
                license_url: img.license_url || '',
                source: img.source || '',
                width: img.width || null,
                height: img.height || null
            }));

            logActivity('api_call', `Openverse Image Search API: "${q}" -> ${images.length} results`);
            res.json({ success: true, query: q, results_count: images.length, results: images });
        } catch (err) {
            logger.error('Openverse Image Search API', err.message);
            return res.status(500).json({ error: 'Openverse Image Search API request failed' });
        }
    });

    // --- RANDOM USER API (0.003 USDC) ---
    router.get('/api/random-user', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Random User API"), async (req, res) => {
        try {
            const apiRes = await fetchWithTimeout('https://randomuser.me/api/', {}, 5000);
            const data = await apiRes.json();

            const user = data.results?.[0];
            if (!user) {
                return res.status(500).json({ error: 'Invalid random user data' });
            }

            logActivity('api_call', 'Random User API');
            res.json({
                success: true,
                name: `${user.name?.first || ''} ${user.name?.last || ''}`.trim(),
                email: user.email || '',
                gender: user.gender || '',
                phone: user.phone || '',
                nationality: user.nat || '',
                location: {
                    city: user.location?.city || '',
                    state: user.location?.state || '',
                    country: user.location?.country || ''
                },
                picture: user.picture?.large || '',
                username: user.login?.username || '',
                age: user.dob?.age || null
            });
        } catch (err) {
            logger.error('Random User API', err.message);
            return res.status(500).json({ error: 'Random User API request failed' });
        }
    });

    // --- EMOJI SEARCH API (0.001 USDC) ---
    router.get('/api/emoji', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Emoji Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().toLowerCase().slice(0, 50);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/emoji?q=smile" });
        }

        try {
            const apiRes = await fetchWithTimeout('https://emojihub.yurace.pro/api/all', {}, 8000);
            const data = await apiRes.json();

            if (!Array.isArray(data)) {
                return res.status(500).json({ error: 'Invalid emoji data' });
            }

            const filtered = data
                .filter(e => e.name?.toLowerCase().includes(q) || e.category?.toLowerCase().includes(q) || e.group?.toLowerCase().includes(q))
                .slice(0, 20)
                .map(e => ({
                    name: e.name || '',
                    emoji: e.htmlCode?.[0] ? String.fromCodePoint(parseInt(e.htmlCode[0].replace('&#', '').replace(';', ''))) : '',
                    category: e.category || '',
                    group: e.group || '',
                    unicode: (e.unicode || []).join(' ')
                }));

            logActivity('api_call', `Emoji Search API: "${q}" -> ${filtered.length} results`);
            res.json({ success: true, query: q, results_count: filtered.length, results: filtered });
        } catch (err) {
            logger.error('Emoji Search API', err.message);
            return res.status(500).json({ error: 'Emoji Search API request failed' });
        }
    });

    // --- POKEMON API (0.003 USDC) ---
    router.get('/api/pokemon', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Pokemon API"), async (req, res) => {
        const name = (req.query.name || '').trim().toLowerCase().slice(0, 50);

        if (!name) {
            return res.status(400).json({ error: "Parameter 'name' required. Ex: /api/pokemon?name=pikachu" });
        }

        if (!/^[a-z0-9-]+$/.test(name)) {
            return res.status(400).json({ error: 'Invalid Pokemon name format' });
        }

        try {
            const apiUrl = `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);

            if (!apiRes.ok) {
                return res.status(404).json({ error: 'Pokemon not found', name });
            }

            const data = await apiRes.json();

            logActivity('api_call', `Pokemon API: ${name}`);
            res.json({
                success: true,
                name: data.name,
                id: data.id,
                height: data.height,
                weight: data.weight,
                types: (data.types || []).map(t => t.type?.name).filter(Boolean),
                abilities: (data.abilities || []).map(a => a.ability?.name).filter(Boolean),
                stats: (data.stats || []).map(s => ({ name: s.stat?.name, value: s.base_stat })),
                sprite: data.sprites?.front_default || '',
                sprite_shiny: data.sprites?.front_shiny || ''
            });
        } catch (err) {
            logger.error('Pokemon API', err.message);
            return res.status(500).json({ error: 'Pokemon API request failed' });
        }
    });

    return router;
}

module.exports = createMiscRouter;
