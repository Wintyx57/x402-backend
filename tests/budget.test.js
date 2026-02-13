// tests/budget.test.js — Unit tests for Budget Guardian
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BudgetManager } = require('../lib/budget');

describe('BudgetManager', () => {
    let mgr;

    beforeEach(() => {
        mgr = new BudgetManager();
    });

    // --- setBudget / getBudget ---
    it('should set and get a budget', () => {
        mgr.setBudget('0xAbC123', 10, 'daily');
        const b = mgr.getBudget('0xabc123');
        assert.ok(b);
        assert.strictEqual(b.maxUsdc, 10);
        assert.strictEqual(b.spentUsdc, 0);
        assert.strictEqual(b.period, 'daily');
        assert.strictEqual(b.remainingUsdc, 10);
        assert.strictEqual(b.usedPercent, 0);
    });

    it('should normalize wallet to lowercase', () => {
        mgr.setBudget('0xABCDEF1234567890abcdef1234567890ABCDEF12', 5, 'weekly');
        const b = mgr.getBudget('0xabcdef1234567890abcdef1234567890abcdef12');
        assert.ok(b);
        assert.strictEqual(b.maxUsdc, 5);
    });

    it('should return null for unknown wallet', () => {
        assert.strictEqual(mgr.getBudget('0x0000000000000000000000000000000000000000'), null);
    });

    // --- checkBudget ---
    it('should allow spending within budget', () => {
        mgr.setBudget('0xaaa', 10, 'daily');
        const result = mgr.checkBudget('0xaaa', 5);
        assert.strictEqual(result.allowed, true);
        assert.ok(result.budget);
    });

    it('should block spending over budget', () => {
        mgr.setBudget('0xbbb', 1, 'daily');
        mgr.recordSpending('0xbbb', 0.9);
        const result = mgr.checkBudget('0xbbb', 0.2);
        assert.strictEqual(result.allowed, false);
        assert.ok(result.reason);
        assert.ok(result.reason.includes('Budget exceeded'));
    });

    it('should allow spending when no budget is set', () => {
        const result = mgr.checkBudget('0xnobudget', 100);
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.budget, null);
    });

    // --- recordSpending ---
    it('should track spending correctly', () => {
        mgr.setBudget('0xccc', 10, 'daily');
        mgr.recordSpending('0xccc', 3);
        const b = mgr.getBudget('0xccc');
        assert.strictEqual(b.spentUsdc, 3);
        assert.strictEqual(b.remainingUsdc, 7);
        assert.ok(Math.abs(b.usedPercent - 30) < 0.01);
    });

    it('should return null when recording for unknown wallet', () => {
        const result = mgr.recordSpending('0xunknown', 5);
        assert.strictEqual(result, null);
    });

    // --- Alert thresholds ---
    it('should trigger 50% alert', () => {
        mgr.setBudget('0xddd', 10, 'daily');
        const r = mgr.recordSpending('0xddd', 5.5);
        assert.deepStrictEqual(r.alerts, [50]);
    });

    it('should trigger 75% alert', () => {
        mgr.setBudget('0xeee', 10, 'daily');
        mgr.recordSpending('0xeee', 5); // 50% — triggers 50
        const r = mgr.recordSpending('0xeee', 3); // 80% — triggers 75
        assert.deepStrictEqual(r.alerts, [75]);
    });

    it('should trigger 90% alert', () => {
        mgr.setBudget('0xfff', 10, 'daily');
        mgr.recordSpending('0xfff', 5); // 50%
        mgr.recordSpending('0xfff', 3); // 80%
        const r = mgr.recordSpending('0xfff', 1.5); // 95%
        assert.deepStrictEqual(r.alerts, [90]);
    });

    it('should not re-trigger already triggered alerts', () => {
        mgr.setBudget('0xabc', 10, 'daily');
        mgr.recordSpending('0xabc', 6); // 60% → triggers 50
        const r2 = mgr.recordSpending('0xabc', 0.5); // 65% → no new alert
        assert.deepStrictEqual(r2.alerts, []);
    });

    // --- removeBudget ---
    it('should remove a budget', () => {
        mgr.setBudget('0xggg', 10, 'daily');
        assert.strictEqual(mgr.removeBudget('0xggg'), true);
        assert.strictEqual(mgr.getBudget('0xggg'), null);
    });

    it('should return false removing non-existent budget', () => {
        assert.strictEqual(mgr.removeBudget('0xnope'), false);
    });

    // --- Period update preserves spending ---
    it('should preserve spending when updating budget amount', () => {
        mgr.setBudget('0xhhh', 10, 'daily');
        mgr.recordSpending('0xhhh', 3);
        mgr.setBudget('0xhhh', 20, 'daily');
        const b = mgr.getBudget('0xhhh');
        assert.strictEqual(b.maxUsdc, 20);
        assert.strictEqual(b.spentUsdc, 3);
    });

    // --- getAllBudgets ---
    it('should list all budgets', () => {
        mgr.setBudget('0x111', 5, 'daily');
        mgr.setBudget('0x222', 10, 'weekly');
        const all = mgr.getAllBudgets();
        assert.strictEqual(all.length, 2);
        assert.ok(all.some(b => b.wallet === '0x111'));
        assert.ok(all.some(b => b.wallet === '0x222'));
    });

    // --- Period auto-reset ---
    it('should reset spending when period expires', () => {
        mgr.setBudget('0xjjj', 10, 'daily');
        mgr.recordSpending('0xjjj', 8);

        // Manually expire the period by backdating
        const budget = mgr.budgets.get('0xjjj');
        budget.periodStart = new Date(Date.now() - 90000000).toISOString(); // 25h ago

        const b = mgr.getBudget('0xjjj');
        assert.strictEqual(b.spentUsdc, 0);
        assert.strictEqual(b.remainingUsdc, 10);
    });
});
