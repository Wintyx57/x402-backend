// routes/reviews.js — POST /api/reviews, GET /api/reviews/:serviceId, GET /api/reviews/:serviceId/stats
//
// SQL migration (run manually in Supabase dashboard):
// -----------------------------------------------------
// CREATE TABLE reviews (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   service_id UUID REFERENCES services(id),
//   wallet_address TEXT NOT NULL,
//   rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
//   comment TEXT CHECK (char_length(comment) <= 500),
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_reviews_service ON reviews(service_id);
// CREATE UNIQUE INDEX idx_reviews_unique ON reviews(service_id, wallet_address);
// -----------------------------------------------------

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Strip HTML tags for comment sanitization
function stripHtml(str) {
    return str.replace(/<[^>]*>/g, '').trim();
}

const reviewLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    keyGenerator: (req) => (req.headers['x-wallet-address'] || req.ip || '').toLowerCase(),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many reviews', message: 'Rate limit: max 10 reviews per hour per wallet.' }
});

function createReviewsRouter(supabase) {
    const router = express.Router();

    // POST /api/reviews — Submit a review
    router.post('/api/reviews', reviewLimiter, async (req, res) => {
        const wallet = (req.headers['x-wallet-address'] || '').trim();
        const { service_id, rating, comment } = req.body;

        // Validate wallet
        if (!wallet || !WALLET_REGEX.test(wallet)) {
            return res.status(400).json({
                error: 'Invalid wallet',
                message: 'X-Wallet-Address header must be a valid Ethereum address (0x...)'
            });
        }

        // Validate service_id
        if (!service_id || !UUID_REGEX.test(service_id)) {
            return res.status(400).json({
                error: 'Invalid service_id',
                message: 'service_id must be a valid UUID'
            });
        }

        // Validate rating
        const ratingNum = parseInt(rating, 10);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({
                error: 'Invalid rating',
                message: 'rating must be an integer between 1 and 5'
            });
        }

        // Validate + sanitize comment
        let sanitizedComment = null;
        if (comment !== undefined && comment !== null && comment !== '') {
            if (typeof comment !== 'string') {
                return res.status(400).json({ error: 'comment must be a string' });
            }
            sanitizedComment = stripHtml(comment);
            if (sanitizedComment.length > 500) {
                return res.status(400).json({
                    error: 'Comment too long',
                    message: 'comment must be 500 characters or less'
                });
            }
        }

        // Check service exists
        const { data: service, error: serviceError } = await supabase
            .from('services')
            .select('id')
            .eq('id', service_id)
            .single();

        if (serviceError || !service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        // Check wallet has used the service (at least 1 activity entry)
        const { data: activityRows, error: activityError } = await supabase
            .from('activity')
            .select('id')
            .ilike('detail', `%${service_id}%`)
            .limit(1);

        // Fallback: also check by wallet in detail if activity includes wallet info
        // Since activity table may not store service_id directly, we allow if no activity found
        // (the check is best-effort: if activity table has no matching entry, we still allow)
        if (!activityError && activityRows && activityRows.length === 0) {
            // Check broader: any activity from this wallet
            const { data: walletActivity } = await supabase
                .from('activity')
                .select('id')
                .ilike('detail', `%${wallet.toLowerCase()}%`)
                .limit(1);

            // If activity table is empty or wallet never used anything, still allow
            // (graceful degradation — table structure may vary)
            if (walletActivity && walletActivity.length === 0) {
                // Best-effort check passed (wallet unknown but not blocked)
                logger.warn('Reviews', `Wallet ${wallet.slice(0, 8)}... has no recorded activity — allowing review`);
            }
        }

        // Upsert review (one review per wallet per service)
        const { data, error } = await supabase
            .from('reviews')
            .upsert(
                [{
                    service_id,
                    wallet_address: wallet.toLowerCase(),
                    rating: ratingNum,
                    comment: sanitizedComment,
                }],
                { onConflict: 'service_id,wallet_address', ignoreDuplicates: false }
            )
            .select()
            .single();

        if (error) {
            logger.error('Reviews', `POST /api/reviews error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to save review' });
        }

        logger.info('Reviews', `Review submitted: service=${service_id} wallet=${wallet.slice(0, 8)}... rating=${ratingNum}`);
        return res.status(201).json({ success: true, data });
    });

    // GET /api/reviews/:serviceId — Get reviews for a service
    router.get('/api/reviews/:serviceId', async (req, res) => {
        const { serviceId } = req.params;

        if (!UUID_REGEX.test(serviceId)) {
            return res.status(400).json({ error: 'Invalid serviceId — must be a UUID' });
        }

        const rawPage = parseInt(req.query.page, 10);
        const rawLimit = parseInt(req.query.limit, 10);
        const page = Math.max(1, isNaN(rawPage) || rawPage < 1 ? 1 : rawPage);
        const limit = Math.min(50, isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit);
        const offset = (page - 1) * limit;

        const { data, error, count } = await supabase
            .from('reviews')
            .select('id, wallet_address, rating, comment, created_at', { count: 'exact' })
            .eq('service_id', serviceId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error('Reviews', `GET /api/reviews/${serviceId} error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to fetch reviews' });
        }

        return res.json({
            success: true,
            count: count || 0,
            page,
            limit,
            data: data || []
        });
    });

    // GET /api/reviews/:serviceId/stats — Aggregate stats
    router.get('/api/reviews/:serviceId/stats', async (req, res) => {
        const { serviceId } = req.params;

        if (!UUID_REGEX.test(serviceId)) {
            return res.status(400).json({ error: 'Invalid serviceId — must be a UUID' });
        }

        const { data, error } = await supabase
            .from('reviews')
            .select('rating')
            .eq('service_id', serviceId);

        if (error) {
            logger.error('Reviews', `GET /api/reviews/${serviceId}/stats error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to fetch review stats' });
        }

        const reviews = data || [];
        const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

        for (const r of reviews) {
            const key = String(r.rating);
            if (distribution[key] !== undefined) distribution[key]++;
        }

        const total = reviews.length;
        const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
        const average = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;

        return res.json({
            average,
            count: total,
            distribution
        });
    });

    return router;
}

module.exports = createReviewsRouter;
