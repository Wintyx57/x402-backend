// lib/budget.js — Budget Guardian: spending controls for AI agents

const logger = require('./logger');

class BudgetManager {
    constructor() {
        this.budgets = new Map(); // wallet -> { maxUsdc, spentUsdc, period, periodStart, alerts }
    }

    setBudget(wallet, maxUsdc, period = 'daily') {
        const normalized = wallet.toLowerCase();
        const existing = this.budgets.get(normalized);
        this.budgets.set(normalized, {
            maxUsdc: parseFloat(maxUsdc),
            spentUsdc: existing?.spentUsdc || 0,
            period,
            periodStart: existing?.periodStart || new Date().toISOString(),
            alerts: existing?.alerts || { 50: false, 75: false, 90: false },
        });
        logger.info('Budget', `Set budget for ${normalized.slice(0, 10)}...: $${maxUsdc} USDC/${period}`);
    }

    getBudget(wallet) {
        const normalized = wallet.toLowerCase();
        const budget = this.budgets.get(normalized);
        if (!budget) return null;
        this._resetIfExpired(normalized, budget);
        return {
            ...budget,
            remainingUsdc: Math.max(0, budget.maxUsdc - budget.spentUsdc),
            usedPercent: budget.maxUsdc > 0 ? (budget.spentUsdc / budget.maxUsdc) * 100 : 0,
        };
    }

    removeBudget(wallet) {
        return this.budgets.delete(wallet.toLowerCase());
    }

    /**
     * Check if a wallet can spend the given amount.
     * Returns { allowed, budget, reason }
     */
    checkBudget(wallet, amountUsdc) {
        const budget = this.getBudget(wallet);
        if (!budget) return { allowed: true, budget: null };

        const amount = parseFloat(amountUsdc);
        const newTotal = budget.spentUsdc + amount;
        if (newTotal > budget.maxUsdc) {
            logger.warn('Budget', `Blocked: ${wallet.slice(0, 10)}... tried $${amount} but only $${budget.remainingUsdc.toFixed(4)} remaining`);
            return {
                allowed: false,
                budget,
                reason: `Budget exceeded: $${budget.spentUsdc.toFixed(4)} spent of $${budget.maxUsdc.toFixed(2)} limit. Remaining: $${budget.remainingUsdc.toFixed(4)}`,
            };
        }
        return { allowed: true, budget };
    }

    /**
     * Record spending after a successful payment.
     * Returns { alerts, pct, remaining } or null if no budget set.
     */
    recordSpending(wallet, amountUsdc) {
        const normalized = wallet.toLowerCase();
        const budget = this.budgets.get(normalized);
        if (!budget) return null;

        this._resetIfExpired(normalized, budget);
        budget.spentUsdc += parseFloat(amountUsdc);

        const pct = (budget.spentUsdc / budget.maxUsdc) * 100;
        const remaining = Math.max(0, budget.maxUsdc - budget.spentUsdc);
        const alerts = [];

        if (pct >= 90 && !budget.alerts[90]) {
            budget.alerts[90] = true;
            alerts.push(90);
            logger.warn('Budget', `CRITICAL: ${normalized.slice(0, 10)}... at ${pct.toFixed(1)}% of budget`);
        } else if (pct >= 75 && !budget.alerts[75]) {
            budget.alerts[75] = true;
            alerts.push(75);
            logger.warn('Budget', `WARNING: ${normalized.slice(0, 10)}... at ${pct.toFixed(1)}% of budget`);
        } else if (pct >= 50 && !budget.alerts[50]) {
            budget.alerts[50] = true;
            alerts.push(50);
            logger.info('Budget', `INFO: ${normalized.slice(0, 10)}... at ${pct.toFixed(1)}% of budget`);
        }

        return { alerts, pct, remaining };
    }

    getAllBudgets() {
        const result = [];
        for (const [wallet, budget] of this.budgets) {
            this._resetIfExpired(wallet, budget);
            result.push({
                wallet,
                maxUsdc: budget.maxUsdc,
                spentUsdc: budget.spentUsdc,
                remainingUsdc: Math.max(0, budget.maxUsdc - budget.spentUsdc),
                usedPercent: budget.maxUsdc > 0 ? (budget.spentUsdc / budget.maxUsdc) * 100 : 0,
                period: budget.period,
                periodStart: budget.periodStart,
            });
        }
        return result;
    }

    _resetIfExpired(wallet, budget) {
        const now = Date.now();
        const start = new Date(budget.periodStart).getTime();
        const diffMs = now - start;

        const periods = {
            daily: 86400000,
            weekly: 604800000,
            monthly: 2592000000,
        };

        if (diffMs > (periods[budget.period] || periods.daily)) {
            budget.spentUsdc = 0;
            budget.periodStart = new Date().toISOString();
            budget.alerts = { 50: false, 75: false, 90: false };
            logger.info('Budget', `Period reset for ${wallet.slice(0, 10)}...`);
        }
    }
}

module.exports = { BudgetManager };
