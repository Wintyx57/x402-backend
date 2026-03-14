// routes/provider.js — Provider self-service endpoints (Wallet-as-Account)
//
// Public (no auth):
//   GET /api/provider/:address/services  — list services owned by wallet
//   GET /api/provider/:address/revenue   — revenue aggregated from pending_payouts
//
// Authenticated (EIP-191 wallet signature):
//   PATCH /api/services/:id              — update editable fields of a service
//   DELETE /api/services/:id             — delete a service

const express = require('express');
const { walletAuth } = require('../lib/wallet-auth');
const { ServiceUpdateSchema } = require('../schemas');
const logger = require('../lib/logger');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Columns returned for service listings (mirrors services.js SERVICE_COLUMNS)
const SERVICE_COLUMNS = [
    'id', 'name', 'url', 'description', 'price_usdc', 'owner_address',
    'tags', 'verified_status', 'created_at', 'status', 'last_checked_at',
    'trust_score', 'required_parameters', 'quick_registered',
].join(', ');

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Function} logActivity
 * @param {import('express-rate-limit').RateLimitRequestHandler} rateLimiter
 */
function createProviderRouter(supabase, logActivity, rateLimiter) {
    const router = express.Router();

    // Apply rate limiter to all provider endpoints
    router.use(rateLimiter);

    // ──────────────────────────────────────────────────────────────────────
    // GET /api/provider/:address/services
    // Public — no auth required.
    // Returns all services where owner_address matches :address (case-insensitive).
    // ──────────────────────────────────────────────────────────────────────
    router.get('/api/provider/:address/services', async (req, res) => {
        const { address } = req.params;

        if (!WALLET_REGEX.test(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        try {
            const { data, error } = await supabase
                .from('services')
                .select(SERVICE_COLUMNS)
                .ilike('owner_address', address)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Provider', `GET /api/provider/:address/services error: ${error.message}`);
                return res.status(500).json({ error: 'Failed to fetch services' });
            }

            return res.json({ services: data || [], count: (data || []).length });
        } catch (err) {
            logger.error('Provider', `GET /api/provider/:address/services unexpected: ${err.message}`);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ──────────────────────────────────────────────────────────────────────
    // GET /api/provider/:address/revenue
    // Public — no auth required.
    // Returns aggregated revenue from pending_payouts for the given wallet.
    // ──────────────────────────────────────────────────────────────────────
    router.get('/api/provider/:address/revenue', async (req, res) => {
        const { address } = req.params;

        if (!WALLET_REGEX.test(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        try {
            const { data, error } = await supabase
                .from('pending_payouts')
                .select('service_id, service_name, provider_amount, chain')
                .ilike('provider_wallet', address)
                .order('created_at', { ascending: false })
                .limit(10000);

            if (error) {
                logger.error('Provider', `GET /api/provider/:address/revenue error: ${error.message}`);
                return res.status(500).json({ error: 'Failed to fetch revenue' });
            }

            const rows = data || [];

            let total_earned = 0;
            const byServiceMap = {};
            const by_chain = {};

            for (const row of rows) {
                const amount = Number(row.provider_amount) || 0;
                total_earned += amount;

                const sid = row.service_id;
                if (!byServiceMap[sid]) {
                    byServiceMap[sid] = {
                        service_id: sid,
                        service_name: row.service_name || sid,
                        earned: 0,
                        calls: 0,
                    };
                }
                byServiceMap[sid].earned += amount;
                byServiceMap[sid].calls += 1;

                const chain = row.chain || 'base';
                by_chain[chain] = (by_chain[chain] || 0) + amount;
            }

            // Round float drift (integer micro-USDC)
            total_earned = Math.round(total_earned * 1e6) / 1e6;
            const by_service = Object.values(byServiceMap).map(s => ({
                ...s,
                earned: Math.round(s.earned * 1e6) / 1e6,
            }));
            for (const chain of Object.keys(by_chain)) {
                by_chain[chain] = Math.round(by_chain[chain] * 1e6) / 1e6;
            }

            return res.json({
                total_earned,
                total_calls: rows.length,
                by_service,
                by_chain,
            });
        } catch (err) {
            logger.error('Provider', `GET /api/provider/:address/revenue unexpected: ${err.message}`);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ──────────────────────────────────────────────────────────────────────
    // PATCH /api/services/:id
    // Requires wallet signature. Wallet must own the service.
    // Only allows updating: name, description, price_usdc, tags, required_parameters.
    // ──────────────────────────────────────────────────────────────────────
    router.patch('/api/services/:id', walletAuth('update-service'), async (req, res) => {
        const { id } = req.params;
        const wallet = req.verifiedWallet; // set by walletAuth middleware

        // Validate update payload
        const parseResult = ServiceUpdateSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
            });
        }

        try {
            // Verify ownership
            const { data: existing, error: fetchError } = await supabase
                .from('services')
                .select('id, owner_address, name')
                .eq('id', id)
                .single();

            if (fetchError || !existing) {
                return res.status(404).json({ error: 'Service not found' });
            }

            if (existing.owner_address.toLowerCase() !== wallet) {
                return res.status(403).json({ error: 'Forbidden: you do not own this service' });
            }

            // Build update object from validated data (only allowed fields)
            const { name, description, price_usdc, tags, required_parameters } = parseResult.data;
            const updates = {};
            if (name !== undefined) updates.name = name;
            if (description !== undefined) updates.description = description;
            if (price_usdc !== undefined) updates.price_usdc = price_usdc;
            if (tags !== undefined) updates.tags = tags;
            if (required_parameters !== undefined) updates.required_parameters = required_parameters;
            updates.updated_at = new Date().toISOString();

            const { data: updated, error: updateError } = await supabase
                .from('services')
                .update(updates)
                .eq('id', id)
                .select(SERVICE_COLUMNS)
                .single();

            if (updateError) {
                logger.error('Provider', `PATCH /api/services/:id update error: ${updateError.message}`);
                return res.status(500).json({ error: 'Failed to update service' });
            }

            logActivity('service_updated', `Service ${id} (${existing.name}) updated by ${wallet.slice(0, 10)}...`);
            logger.info('Provider', `Service ${id} updated by ${wallet.slice(0, 10)}...`);

            return res.json({ service: updated });
        } catch (err) {
            logger.error('Provider', `PATCH /api/services/:id unexpected: ${err.message}`);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ──────────────────────────────────────────────────────────────────────
    // DELETE /api/services/:id
    // Requires wallet signature. Wallet must own the service.
    // ──────────────────────────────────────────────────────────────────────
    router.delete('/api/services/:id', walletAuth('delete-service'), async (req, res) => {
        const { id } = req.params;
        const wallet = req.verifiedWallet; // set by walletAuth middleware

        try {
            // Verify ownership
            const { data: existing, error: fetchError } = await supabase
                .from('services')
                .select('id, owner_address, name')
                .eq('id', id)
                .single();

            if (fetchError || !existing) {
                return res.status(404).json({ error: 'Service not found' });
            }

            if (existing.owner_address.toLowerCase() !== wallet) {
                return res.status(403).json({ error: 'Forbidden: you do not own this service' });
            }

            const { error: deleteError } = await supabase
                .from('services')
                .delete()
                .eq('id', id);

            if (deleteError) {
                logger.error('Provider', `DELETE /api/services/:id delete error: ${deleteError.message}`);
                return res.status(500).json({ error: 'Failed to delete service' });
            }

            logActivity('service_deleted', `Service ${id} (${existing.name}) deleted by ${wallet.slice(0, 10)}...`);
            logger.info('Provider', `Service ${id} (${existing.name}) deleted by ${wallet.slice(0, 10)}...`);

            return res.json({ deleted: true, id, name: existing.name });
        } catch (err) {
            logger.error('Provider', `DELETE /api/services/:id unexpected: ${err.message}`);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}

module.exports = createProviderRouter;
