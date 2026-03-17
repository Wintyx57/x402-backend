// routes/wrappers/media.js — Media & Entertainment API wrappers
// tvshow, books, itunes, anime

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createMediaRouter(logActivity, paymentMiddleware, paidEndpointLimiter) {
    const router = express.Router();

    // --- TV SHOW SEARCH API (0.005 USDC) ---
    router.get('/api/tvshow', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "TV Show Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().slice(0, 200);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/tvshow?q=breaking+bad" });
        }

        try {
            const apiUrl = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(404).json({ error: 'No TV shows found', query: q });
            }

            const shows = data.slice(0, 10).map(item => ({
                name: item.show?.name || '',
                type: item.show?.type || '',
                language: item.show?.language || '',
                genres: item.show?.genres || [],
                status: item.show?.status || '',
                premiered: item.show?.premiered || '',
                rating: item.show?.rating?.average || null,
                summary: (item.show?.summary || '').replace(/<[^>]+>/g, '').slice(0, 300),
                image: item.show?.image?.medium || '',
                url: item.show?.url || '',
                score: item.score || 0
            }));

            logActivity('api_call', `TV Show Search API: "${q}" -> ${shows.length} results`);
            res.json({ success: true, query: q, results_count: shows.length, results: shows });
        } catch (err) {
            logger.error('TV Show Search API', err.message);
            return res.status(500).json({ error: 'TV Show Search API request failed' });
        }
    });

    // --- BOOKS SEARCH API (0.005 USDC) ---
    router.get('/api/books', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Books Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().slice(0, 200);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/books?q=dune+frank+herbert" });
        }

        try {
            const apiUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 10000);
            const data = await apiRes.json();

            if (!data.docs || data.docs.length === 0) {
                return res.status(404).json({ error: 'No books found', query: q });
            }

            const books = data.docs.slice(0, limit).map(doc => ({
                title: doc.title || '',
                author: (doc.author_name || [])[0] || 'Unknown',
                first_publish_year: doc.first_publish_year || null,
                isbn: (doc.isbn || [])[0] || '',
                pages: doc.number_of_pages_median || null,
                subjects: (doc.subject || []).slice(0, 5),
                languages: (doc.language || []).slice(0, 3),
                cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
                key: doc.key || ''
            }));

            logActivity('api_call', `Books Search API: "${q}" -> ${books.length} results`);
            res.json({ success: true, query: q, total_found: data.numFound || 0, results_count: books.length, results: books });
        } catch (err) {
            logger.error('Books Search API', err.message);
            return res.status(500).json({ error: 'Books Search API request failed' });
        }
    });

    // --- ITUNES SEARCH API (0.005 USDC) ---
    router.get('/api/itunes', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "iTunes Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().slice(0, 200);
        const media = (req.query.media || 'music').trim().toLowerCase();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 25);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/itunes?q=radiohead&media=music" });
        }

        const validMedia = ['music', 'movie', 'podcast', 'audiobook', 'tvShow', 'software', 'ebook', 'all'];
        if (!validMedia.includes(media)) {
            return res.status(400).json({ error: `Invalid media type. Accepted: ${validMedia.join(', ')}` });
        }

        try {
            const apiUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=${media}&limit=${limit}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 8000);
            const data = await apiRes.json();

            const items = (data.results || []).map(item => ({
                name: item.trackName || item.collectionName || '',
                artist: item.artistName || '',
                kind: item.kind || item.wrapperType || '',
                genre: item.primaryGenreName || '',
                price: item.trackPrice || item.collectionPrice || null,
                currency: item.currency || 'USD',
                release_date: item.releaseDate || '',
                artwork: item.artworkUrl100 || '',
                preview_url: item.previewUrl || '',
                url: item.trackViewUrl || item.collectionViewUrl || ''
            }));

            logActivity('api_call', `iTunes Search API: "${q}" (${media}) -> ${items.length} results`);
            res.json({ success: true, query: q, media, results_count: items.length, results: items });
        } catch (err) {
            logger.error('iTunes Search API', err.message);
            return res.status(500).json({ error: 'iTunes Search API request failed' });
        }
    });

    // --- ANIME SEARCH API (0.005 USDC) ---
    router.get('/api/anime', paidEndpointLimiter, paymentMiddleware(5000, 0.005, "Anime Search API"), async (req, res) => {
        const q = (req.query.q || '').trim().slice(0, 200);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 10);

        if (!q) {
            return res.status(400).json({ error: "Parameter 'q' required. Ex: /api/anime?q=naruto" });
        }

        try {
            const apiUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=${limit}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 10000);
            const data = await apiRes.json();

            if (!data.data || data.data.length === 0) {
                return res.status(404).json({ error: 'No anime found', query: q });
            }

            const anime = data.data.map(item => ({
                title: item.title || '',
                title_english: item.title_english || '',
                type: item.type || '',
                episodes: item.episodes || null,
                status: item.status || '',
                score: item.score || null,
                scored_by: item.scored_by || 0,
                synopsis: (item.synopsis || '').slice(0, 400),
                year: item.year || null,
                genres: (item.genres || []).map(g => g.name),
                image: item.images?.jpg?.image_url || '',
                url: item.url || ''
            }));

            logActivity('api_call', `Anime Search API: "${q}" -> ${anime.length} results`);
            res.json({ success: true, query: q, results_count: anime.length, results: anime });
        } catch (err) {
            logger.error('Anime Search API', err.message);
            return res.status(500).json({ error: 'Anime Search API request failed' });
        }
    });

    return router;
}

module.exports = createMediaRouter;
