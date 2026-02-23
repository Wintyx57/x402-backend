// routes/budget.js — Budget Guardian API endpoints

const express = require('express');

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const VALID_PERIODS = ['daily', 'weekly', 'monthly'];

function createBudgetRouter(budgetManager, logActivity, adminAuth) {
    const router = express.Router();

    // All budget endpoints require admin authentication
    router.use('/api/budget', adminAuth);
    router.use('/api/budgets', adminAuth);

    // POST /api/budget — Set or update a budget for a wallet
    router.post('/api/budget', (req, res) => {
        const { wallet, max_budget_usdc, period } = req.body;

        if (!wallet || max_budget_usdc == null) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Required: wallet (0x address), max_budget_usdc (positive number)',
            });
        }
        if (!WALLET_REGEX.test(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }
        const maxBudget = parseFloat(max_budget_usdc);
        if (isNaN(maxBudget) || maxBudget <= 0) {
            return res.status(400).json({ error: 'max_budget_usdc must be a positive number' });
        }
        if (period && !VALID_PERIODS.includes(period)) {
            return res.status(400).json({
                error: `Invalid period. Accepted: ${VALID_PERIODS.join(', ')}`,
            });
        }

        budgetManager.setBudget(wallet, maxBudget, period || 'daily');
        const budget = budgetManager.getBudget(wallet);
        logActivity('budget', `Budget set: ${wallet.slice(0, 10)}... → $${maxBudget}/${period || 'daily'}`);

        res.json({
            message: 'Budget set successfully',
            budget: formatBudget(wallet, budget),
        });
    });

    // GET /api/budget/:wallet — Get budget status
    router.get('/api/budget/:wallet', (req, res) => {
        const { wallet } = req.params;
        if (!WALLET_REGEX.test(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const budget = budgetManager.getBudget(wallet);
        if (!budget) {
            return res.json({
                message: 'No budget set for this wallet',
                budget: null,
            });
        }

        res.json({ budget: formatBudget(wallet, budget) });
    });

    // DELETE /api/budget/:wallet — Remove budget cap
    router.delete('/api/budget/:wallet', (req, res) => {
        const { wallet } = req.params;
        const removed = budgetManager.removeBudget(wallet);
        if (removed) {
            logActivity('budget', `Budget removed: ${wallet.slice(0, 10)}...`);
        }
        res.json({
            message: removed ? 'Budget removed' : 'No budget found for this wallet',
            removed,
        });
    });

    // GET /api/budgets — List all active budgets
    router.get('/api/budgets', (req, res) => {
        const budgets = budgetManager.getAllBudgets();
        res.json({
            count: budgets.length,
            budgets: budgets.map(b => ({
                wallet: b.wallet,
                max_budget_usdc: b.maxUsdc,
                spent_usdc: round(b.spentUsdc),
                remaining_usdc: round(b.remainingUsdc),
                used_percent: round(b.usedPercent),
                period: b.period,
            })),
        });
    });

    // POST /api/budget/check — Pre-flight check (can this wallet afford this call?)
    router.post('/api/budget/check', (req, res) => {
        const { wallet, amount_usdc } = req.body;
        if (!wallet || amount_usdc == null) {
            return res.status(400).json({
                error: 'Required: wallet, amount_usdc',
            });
        }

        const result = budgetManager.checkBudget(wallet, amount_usdc);
        res.json({
            allowed: result.allowed,
            reason: result.reason || null,
            budget: result.budget ? formatBudget(wallet, result.budget) : null,
        });
    });

    return router;
}

function formatBudget(wallet, budget) {
    return {
        wallet: wallet.toLowerCase(),
        max_budget_usdc: budget.maxUsdc,
        spent_usdc: round(budget.spentUsdc),
        remaining_usdc: round(budget.remainingUsdc),
        used_percent: round(budget.usedPercent),
        period: budget.period,
        period_start: budget.periodStart,
        alerts_triggered: Object.entries(budget.alerts)
            .filter(([, v]) => v)
            .map(([k]) => `${k}%`),
    };
}

function round(n) {
    return Math.round(n * 10000) / 10000;
}

module.exports = createBudgetRouter;
