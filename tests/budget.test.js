// tests/budget.test.js — Unit tests for Budget Guardian
// NOTE: checkAndRecord() is the production path (proxy.js:110, payment.js:410).
//       recordSpending() is @internal and only used in legacy tests below.
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BudgetManager } = require('../lib/budget');

// ---------------------------------------------------------------------------
// Suite 1: setBudget / getBudget (invariants de base)
// ---------------------------------------------------------------------------

describe('BudgetManager — setBudget / getBudget', () => {
    let mgr;

    beforeEach(() => { mgr = new BudgetManager(); });

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

    it('should normalize wallet address to lowercase', () => {
        mgr.setBudget('0xABCDEF1234567890abcdef1234567890ABCDEF12', 5, 'weekly');
        const b = mgr.getBudget('0xabcdef1234567890abcdef1234567890abcdef12');
        assert.ok(b);
        assert.strictEqual(b.maxUsdc, 5);
    });

    it('should return null for unknown wallet', () => {
        assert.strictEqual(mgr.getBudget('0x0000000000000000000000000000000000000000'), null);
    });

    it('should preserve spending when updating budget ceiling', () => {
        mgr.setBudget('0xhhh', 10, 'daily');
        mgr.recordSpending('0xhhh', 3);
        mgr.setBudget('0xhhh', 20, 'daily');
        const b = mgr.getBudget('0xhhh');
        assert.strictEqual(b.maxUsdc, 20);
        assert.strictEqual(b.spentUsdc, 3);
    });
});

// ---------------------------------------------------------------------------
// Suite 2: checkAndRecord() — chemin de production (proxy.js + payment.js)
// ---------------------------------------------------------------------------

describe('BudgetManager — checkAndRecord() [production path]', () => {
    let mgr;

    beforeEach(() => { mgr = new BudgetManager(); });

    // --- Cas nominal : budget suffisant ---

    it('should return allowed:true and record spending when budget is sufficient', () => {
        // Arrange
        mgr.setBudget('0xAAA', 10, 'daily');

        // Act
        const result = mgr.checkAndRecord('0xAAA', 3);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.ok(result.budget, 'result.budget should be present on success');
        assert.strictEqual(result.remaining, 7);
        assert.ok(Math.abs(result.pct - 30) < 0.01, `pct should be ~30, got ${result.pct}`);
        assert.deepStrictEqual(result.alerts, []);
    });

    it('should mutate the in-memory budget after a successful call', () => {
        // Arrange
        mgr.setBudget('0xBBB', 10, 'daily');

        // Act
        mgr.checkAndRecord('0xBBB', 4);

        // Assert — le Map interne doit refléter la dépense
        const stored = mgr.budgets.get('0xbbb');
        assert.strictEqual(stored.spentUsdc, 4);
    });

    it('should accumulate spending across multiple successive calls', () => {
        // Arrange
        mgr.setBudget('0xCCC', 10, 'daily');

        // Act
        mgr.checkAndRecord('0xCCC', 2);
        mgr.checkAndRecord('0xCCC', 3);
        const result = mgr.checkAndRecord('0xCCC', 1);

        // Assert — 2 + 3 + 1 = 6 USDC dépensés
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.remaining, 4);
    });

    // --- Cas nominal : pas de budget configuré ---

    it('should return allowed:true with null budget when no cap is set', () => {
        // Arrange — aucun setBudget pour ce wallet

        // Act
        const result = mgr.checkAndRecord('0xNOBUDGET', 999);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.budget, null);
    });

    it('should normalize wallet to lowercase before lookup', () => {
        // Arrange
        mgr.setBudget('0xddd', 10, 'daily');

        // Act — on passe le wallet en MAJUSCULES
        const result = mgr.checkAndRecord('0XDDD', 5);

        // Assert — doit trouver le budget et enregistrer la dépense
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(mgr.budgets.get('0xddd').spentUsdc, 5);
    });

    // --- Cas limite : budget dépassé ---

    it('should return allowed:false and block when spending would exceed budget', () => {
        // Arrange — 8 déjà dépensés sur 10
        mgr.setBudget('0xEEE', 10, 'daily');
        mgr.checkAndRecord('0xEEE', 8);

        // Act — tente de dépenser 3 de plus (total 11 > limite 10)
        const result = mgr.checkAndRecord('0xEEE', 3);

        // Assert
        assert.strictEqual(result.allowed, false);
        assert.ok(result.reason, 'reason message should be set on denial');
        assert.ok(result.reason.includes('Budget exceeded'), `Unexpected reason: ${result.reason}`);
        assert.ok(result.budget, 'budget snapshot should be included in denial');
    });

    it('should NOT mutate the in-memory balance when a call is blocked', () => {
        // Arrange
        mgr.setBudget('0xFFF', 5, 'daily');
        mgr.checkAndRecord('0xFFF', 4); // 4 dépensés

        // Act — tente de dépenser 2 de plus (total 6 > 5)
        mgr.checkAndRecord('0xFFF', 2);

        // Assert — le solde doit rester à 4, pas 6
        const stored = mgr.budgets.get('0xfff');
        assert.strictEqual(stored.spentUsdc, 4);
    });

    it('should expose remaining and usedPercent on denial response', () => {
        // Arrange — 6 sur 10 dépensés
        mgr.setBudget('0x111', 10, 'daily');
        mgr.checkAndRecord('0x111', 6);

        // Act
        const result = mgr.checkAndRecord('0x111', 10);

        // Assert
        assert.strictEqual(result.allowed, false);
        assert.strictEqual(result.budget.remainingUsdc, 4);
        assert.ok(Math.abs(result.budget.usedPercent - 60) < 0.01);
    });

    // --- Edge case : montant exactement égal au reste ---

    it('should allow spending when amount equals exactly the remaining budget', () => {
        // Arrange — budget de 10, 3 déjà dépensés → reste 7
        mgr.setBudget('0x222', 10, 'daily');
        mgr.checkAndRecord('0x222', 3);

        // Act — dépense exactement les 7 restants
        const result = mgr.checkAndRecord('0x222', 7);

        // Assert — newTotal = 10 = maxUsdc → allowed (condition est strict >)
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.remaining, 0);
        assert.ok(Math.abs(result.pct - 100) < 0.01);
    });

    it('should block when amount is one unit above the remaining budget', () => {
        // Arrange — reste 7
        mgr.setBudget('0x333', 10, 'daily');
        mgr.checkAndRecord('0x333', 3);

        // Act — dépense 7.0001, légèrement au-dessus
        const result = mgr.checkAndRecord('0x333', 7.0001);

        // Assert
        assert.strictEqual(result.allowed, false);
    });

    // --- Edge case : budget à 0 ---

    it('should block any spending when budget is set to 0', () => {
        // Arrange — plafond de 0 USDC
        mgr.setBudget('0x444', 0, 'daily');

        // Act
        const result = mgr.checkAndRecord('0x444', 0.001);

        // Assert — 0.001 > 0 → bloqué
        assert.strictEqual(result.allowed, false);
        assert.ok(result.reason.includes('Budget exceeded'));
    });

    it('should block a zero-amount call when budget is also 0 plus prior spending', () => {
        // Arrange — budget 0, rien dépensé
        mgr.setBudget('0x555', 0, 'daily');

        // Act — 0 + 0 = 0 qui n'est PAS > 0 → allowed
        const result = mgr.checkAndRecord('0x555', 0);

        // Assert — 0 exactement égal au plafond → autorisé (not >)
        assert.strictEqual(result.allowed, true);
    });

    // --- Alertes : 50%, 75%, 90% ---

    it('should trigger 50% alert when spending reaches 50% threshold', () => {
        // Arrange
        mgr.setBudget('0xAAA1', 10, 'daily');

        // Act — 5.5 USDC = 55% → déclenche alerte 50%
        const result = mgr.checkAndRecord('0xAAA1', 5.5);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, [50]);
    });

    it('should trigger 75% alert when spending crosses 75% threshold', () => {
        // Arrange — déjà à 50% (alerte 50 déjà déclenchée)
        mgr.setBudget('0xBBB1', 10, 'daily');
        mgr.checkAndRecord('0xBBB1', 5); // 50% → alerte 50

        // Act — 3 de plus = 80% → déclenche alerte 75
        const result = mgr.checkAndRecord('0xBBB1', 3);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, [75]);
    });

    it('should trigger 90% alert when spending crosses 90% threshold', () => {
        // Arrange — traverser 50% et 75% au préalable
        mgr.setBudget('0xCCC1', 10, 'daily');
        mgr.checkAndRecord('0xCCC1', 5); // 50%
        mgr.checkAndRecord('0xCCC1', 3); // 80%

        // Act — 1.5 de plus = 95% → déclenche alerte 90
        const result = mgr.checkAndRecord('0xCCC1', 1.5);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, [90]);
    });

    it('should not re-trigger an alert already fired at the same threshold', () => {
        // Arrange — alerte 50 déjà déclenchée
        mgr.setBudget('0xDDD1', 10, 'daily');
        mgr.checkAndRecord('0xDDD1', 6); // 60% → alerte 50

        // Act — 0.5 de plus = 65% → toujours dans la zone 50%, pas de nouvelle alerte
        const result = mgr.checkAndRecord('0xDDD1', 0.5);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, []);
    });

    it('should not trigger alerts when spending is below 50%', () => {
        // Arrange
        mgr.setBudget('0xEEE1', 10, 'daily');

        // Act — 40% → sous les seuils d'alerte
        const result = mgr.checkAndRecord('0xEEE1', 4);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, []);
    });

    // --- Réinitialisation de période ---

    it('should reset accumulated spending when the billing period expires', () => {
        // Arrange — budget presque épuisé
        mgr.setBudget('0xFFF1', 10, 'daily');
        mgr.checkAndRecord('0xFFF1', 9);

        // Simuler l'expiration de la période en antidatant periodStart
        const stored = mgr.budgets.get('0xfff1');
        stored.periodStart = new Date(Date.now() - 90_000_000).toISOString(); // 25h ago

        // Act — après reset la dépense de 9 repart à 0, donc 5 passe
        const result = mgr.checkAndRecord('0xFFF1', 5);

        // Assert
        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.remaining, 5);
    });

    // --- Idempotence du résultat de refus ---

    it('should consistently block after first refusal (spending not corrupted)', () => {
        // Arrange
        mgr.setBudget('0xGGG1', 10, 'daily');
        mgr.checkAndRecord('0xGGG1', 10); // budget épuisé exactement

        // Act — deux tentatives consécutives bloquées
        const r1 = mgr.checkAndRecord('0xGGG1', 0.01);
        const r2 = mgr.checkAndRecord('0xGGG1', 0.01);

        // Assert
        assert.strictEqual(r1.allowed, false);
        assert.strictEqual(r2.allowed, false);
        // Le solde ne doit pas avoir bougé (pas d'accumulation silencieuse)
        const stored = mgr.budgets.get('0xggg1');
        assert.strictEqual(stored.spentUsdc, 10);
    });

    // --- Isolation entre wallets ---

    it('should track spending independently for different wallets', () => {
        // Arrange
        mgr.setBudget('0xWALLET_A', 10, 'daily');
        mgr.setBudget('0xWALLET_B', 10, 'daily');

        // Act — A dépasse son budget, B ne dépense qu'un peu
        mgr.checkAndRecord('0xWALLET_A', 10);
        const resultA = mgr.checkAndRecord('0xWALLET_A', 1); // doit être bloqué
        const resultB = mgr.checkAndRecord('0xWALLET_B', 3); // doit être autorisé

        // Assert
        assert.strictEqual(resultA.allowed, false, 'Wallet A should be blocked');
        assert.strictEqual(resultB.allowed, true, 'Wallet B should be independent');
        assert.strictEqual(resultB.remaining, 7);
    });
});

// ---------------------------------------------------------------------------
// Suite 3: checkBudget() — lecture seule (lecture avant paiement)
// ---------------------------------------------------------------------------

describe('BudgetManager — checkBudget() [read-only check]', () => {
    let mgr;

    beforeEach(() => { mgr = new BudgetManager(); });

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

    it('should NOT record spending (purely read-only)', () => {
        // checkBudget ne doit jamais muter le solde
        mgr.setBudget('0xreadonly', 10, 'daily');
        mgr.checkBudget('0xreadonly', 4);
        mgr.checkBudget('0xreadonly', 4);
        const stored = mgr.budgets.get('0xreadonly');
        assert.strictEqual(stored.spentUsdc, 0, 'checkBudget must not mutate spentUsdc');
    });
});

// ---------------------------------------------------------------------------
// Suite 4: recordSpending() — @internal, gardé pour compatibilité legacy
// ---------------------------------------------------------------------------

describe('BudgetManager — recordSpending() [@internal, legacy helper]', () => {
    let mgr;

    beforeEach(() => { mgr = new BudgetManager(); });

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

    it('should trigger 50% alert', () => {
        mgr.setBudget('0xddd', 10, 'daily');
        const r = mgr.recordSpending('0xddd', 5.5);
        assert.deepStrictEqual(r.alerts, [50]);
    });

    it('should trigger 75% alert', () => {
        mgr.setBudget('0xeee', 10, 'daily');
        mgr.recordSpending('0xeee', 5); // 50%
        const r = mgr.recordSpending('0xeee', 3); // 80%
        assert.deepStrictEqual(r.alerts, [75]);
    });

    it('should trigger 90% alert', () => {
        mgr.setBudget('0xfff', 10, 'daily');
        mgr.recordSpending('0xfff', 5);
        mgr.recordSpending('0xfff', 3);
        const r = mgr.recordSpending('0xfff', 1.5);
        assert.deepStrictEqual(r.alerts, [90]);
    });

    it('should not re-trigger already triggered alerts', () => {
        mgr.setBudget('0xabc', 10, 'daily');
        mgr.recordSpending('0xabc', 6); // 60% → triggers 50
        const r2 = mgr.recordSpending('0xabc', 0.5);
        assert.deepStrictEqual(r2.alerts, []);
    });
});

// ---------------------------------------------------------------------------
// Suite 5: removeBudget / getAllBudgets / période auto-reset
// ---------------------------------------------------------------------------

describe('BudgetManager — removeBudget / getAllBudgets / period reset', () => {
    let mgr;

    beforeEach(() => { mgr = new BudgetManager(); });

    it('should remove a budget', () => {
        mgr.setBudget('0xggg', 10, 'daily');
        assert.strictEqual(mgr.removeBudget('0xggg'), true);
        assert.strictEqual(mgr.getBudget('0xggg'), null);
    });

    it('should return false removing non-existent budget', () => {
        assert.strictEqual(mgr.removeBudget('0xnope'), false);
    });

    it('should list all budgets', () => {
        mgr.setBudget('0x111', 5, 'daily');
        mgr.setBudget('0x222', 10, 'weekly');
        const all = mgr.getAllBudgets();
        assert.strictEqual(all.length, 2);
        assert.ok(all.some(b => b.wallet === '0x111'));
        assert.ok(all.some(b => b.wallet === '0x222'));
    });

    it('should reset spending when period expires (via getBudget)', () => {
        mgr.setBudget('0xjjj', 10, 'daily');
        mgr.recordSpending('0xjjj', 8);

        const budget = mgr.budgets.get('0xjjj');
        budget.periodStart = new Date(Date.now() - 90_000_000).toISOString(); // 25h ago

        const b = mgr.getBudget('0xjjj');
        assert.strictEqual(b.spentUsdc, 0);
        assert.strictEqual(b.remainingUsdc, 10);
    });

    it('should reset alerts when period expires (via checkAndRecord)', () => {
        // Arrange — monter les alertes au max, puis expirer la période
        mgr.setBudget('0xRESET', 10, 'daily');
        mgr.checkAndRecord('0xRESET', 5);   // 50% alert
        mgr.checkAndRecord('0xRESET', 3);   // 75% alert
        mgr.checkAndRecord('0xRESET', 1.5); // 90% alert

        const stored = mgr.budgets.get('0xreset');
        stored.periodStart = new Date(Date.now() - 90_000_000).toISOString();

        // Act — premier appel après expiration
        const result = mgr.checkAndRecord('0xRESET', 5);

        // Assert — les alertes ont été réinitialisées, 50% redéclenche
        assert.strictEqual(result.allowed, true);
        assert.deepStrictEqual(result.alerts, [50], 'Alerts should reset after period expiry');
    });
});
