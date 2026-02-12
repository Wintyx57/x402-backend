// routes/register.js — POST /register

const express = require('express');
const logger = require('../lib/logger');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const URL_REGEX = /^https?:\/\/.+/;

function createRegisterRouter(supabase, logActivity, paymentMiddleware, registerLimiter) {
    const router = express.Router();

    router.post('/register', registerLimiter, paymentMiddleware(1000000, 1, "Enregistrer un service"), async (req, res) => {
        const { name, description, url, price, tags, ownerAddress } = req.body;
        const txHash = req.headers['x-payment-txhash'] || null;

        // Validation
        if (!name || !url || !price || !ownerAddress) {
            return res.status(400).json({
                error: "Champs requis manquants",
                required: { name: "string", url: "string", price: "number (ex: 0.10)", ownerAddress: "string (wallet)" },
                optional: { description: "string", tags: "string[]" }
            });
        }

        // Type & format validation
        if (typeof name !== 'string' || name.length > 200) {
            return res.status(400).json({ error: 'name must be a string (max 200 chars)' });
        }
        if (typeof url !== 'string' || !URL_REGEX.test(url) || url.length > 500) {
            return res.status(400).json({ error: 'url must be a valid HTTP(S) URL (max 500 chars)' });
        }
        if (typeof price !== 'number' || price < 0 || price > 1000) {
            return res.status(400).json({ error: 'price must be a number between 0 and 1000' });
        }
        if (typeof ownerAddress !== 'string' || !WALLET_REGEX.test(ownerAddress)) {
            return res.status(400).json({ error: 'ownerAddress must be a valid Ethereum address (0x...)' });
        }
        if (description && (typeof description !== 'string' || description.length > 1000)) {
            return res.status(400).json({ error: 'description must be a string (max 1000 chars)' });
        }
        if (tags && (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== 'string' || t.length > 50))) {
            return res.status(400).json({ error: 'tags must be an array of strings (max 10 tags, 50 chars each)' });
        }

        const insertData = {
            name: name.trim(),
            description: (description || '').trim(),
            url: url.trim(),
            price_usdc: price,
            owner_address: ownerAddress,
            tags: tags || []
        };
        if (txHash) insertData.tx_hash = txHash;

        const { data, error } = await supabase
            .from('services')
            .insert([insertData])
            .select();

        if (error) {
            logger.error('Supabase', '/register error:', error.message);
            return res.status(500).json({ error: 'Registration failed' });
        }

        logger.info('Bazaar', `Nouveau service enregistre : "${name}" (${data[0].id})`);
        logActivity('register', `Nouveau service : "${name}" (${data[0].id.slice(0, 8)})`);

        res.status(201).json({
            success: true,
            message: `Service "${name}" enregistre avec succes !`,
            data: data[0]
        });
    });

    return router;
}

module.exports = createRegisterRouter;
