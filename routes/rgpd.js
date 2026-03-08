// routes/rgpd.js — RGPD data access & deletion endpoints (Art. 15 & 17 GDPR)

const express = require('express');
const { ethers } = require('ethers');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Verify a signed message to prove wallet ownership
// Message format: "x402 RGPD request: <action> <wallet> <timestamp>"
function verifyWalletOwnership(wallet, message, signature) {
    try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === wallet.toLowerCase();
    } catch {
        return false;
    }
}

function createRgpdRouter(supabase) {
    const router = express.Router();

    // GET /api/user/:wallet/data — Data access (Art. 15 GDPR)
    // Requires: ?message=<signed_message>&signature=<sig>
    router.get('/api/user/:wallet/data', async (req, res) => {
        const { wallet } = req.params;
        const { message, signature } = req.query;

        if (!WALLET_REGEX.test(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        // Require signature to prove wallet ownership
        if (!message || !signature) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Provide ?message=<signed_msg>&signature=<sig> to prove wallet ownership',
                example_message: `x402 RGPD request: data-access ${wallet} ${Date.now()}`
            });
        }

        if (!verifyWalletOwnership(wallet, message, signature)) {
            return res.status(401).json({ error: 'Signature verification failed. Sign the message with your wallet.' });
        }

        try {
            // Fetch all data for this wallet
            const [activityRes, budgetRes] = await Promise.all([
                supabase.from('activity').select('*').or(`detail.like.%${wallet}%,type.eq.payment`).limit(500),
                supabase.from('budgets').select('*').eq('wallet', wallet)
            ]);

            const activities = (activityRes.data || []).filter(a =>
                a.detail && a.detail.toLowerCase().includes(wallet.toLowerCase())
            );

            const budgets = budgetRes.data || [];

            const totalSpend = activities
                .filter(a => a.amount > 0)
                .reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);

            return res.json({
                wallet,
                data_retrieved_at: new Date().toISOString(),
                call_count: activities.length,
                total_spend_usdc: totalSpend.toFixed(6),
                activities: activities.slice(0, 100),
                budgets,
                data_retention: '90 days for logs, permanent for tx hashes (blockchain)',
                legal_basis: 'Art. 6(1)(f) GDPR — legitimate interest',
                your_rights: {
                    access: 'GET /api/user/:wallet/data (this endpoint)',
                    deletion: 'DELETE /api/user/:wallet',
                    contact: 'https://github.com/Wintyx57/x402-backend/issues'
                }
            });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to retrieve data', details: err.message });
        }
    });

    // DELETE /api/user/:wallet — Data deletion (Art. 17 GDPR)
    // Requires: body { message, signature }
    router.delete('/api/user/:wallet', async (req, res) => {
        const { wallet } = req.params;
        const { message, signature } = req.body;

        if (!WALLET_REGEX.test(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        if (!message || !signature) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Provide body { message, signature } to prove wallet ownership',
                example_message: `x402 RGPD request: data-deletion ${wallet} ${Date.now()}`
            });
        }

        if (!verifyWalletOwnership(wallet, message, signature)) {
            return res.status(401).json({ error: 'Signature verification failed.' });
        }

        try {
            // Delete activity rows (mutable data only — tx hashes kept for compliance)
            const { error: activityErr } = await supabase
                .from('activity')
                .delete()
                .filter('detail', 'ilike', `%${wallet}%`);

            // Delete budget rows
            const { error: budgetErr } = await supabase
                .from('budgets')
                .delete()
                .eq('wallet', wallet);

            if (activityErr || budgetErr) {
                return res.status(500).json({
                    error: 'Partial deletion failure',
                    activity_error: activityErr?.message,
                    budget_error: budgetErr?.message
                });
            }

            return res.json({
                status: 'deleted',
                wallet,
                deleted_at: new Date().toISOString(),
                note: 'On-chain transaction hashes cannot be deleted (immutable blockchain data, Art. 17(3)(e) GDPR exception for legal obligations).',
                contact: 'https://github.com/Wintyx57/x402-backend/issues'
            });
        } catch (err) {
            return res.status(500).json({ error: 'Deletion failed', details: err.message });
        }
    });

    return router;
}

module.exports = { createRgpdRouter };
