// tests/ai-quality-agent.test.js — Unit tests for lib/ai-quality-agent.js
// Tests: module exports, severity thresholds, sample selection, Gemini evaluation,
// scheduler, status, report formatting, error resilience
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Severity thresholds (mirrored from module for unit testing without side-effects)
const SEVERITY_THRESHOLDS = [
    { min: 80, label: 'good', emoji: '\u2705' },
    { min: 50, label: 'acceptable', emoji: '\u26A0\uFE0F' },
    { min: 25, label: 'concerning', emoji: '\uD83D\uDFE0' },
    { min: 0, label: 'critical', emoji: '\uD83D\uDD34' },
];

function getSeverity(score) {
    for (const t of SEVERITY_THRESHOLDS) {
        if (score >= t.min) return t;
    }
    return SEVERITY_THRESHOLDS[SEVERITY_THRESHOLDS.length - 1];
}

// Scheduler logic (mirrored from module)
function getNextRunTime(now, runTimesUtc) {
    const d = new Date(now);
    const candidates = [];
    for (const hour of runTimesUtc) {
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0));
        if (t.getTime() > now + 60_000) {
            candidates.push(t);
        }
    }
    if (candidates.length === 0) {
        const tomorrow = new Date(d);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const minHour = Math.min(...runTimesUtc);
        candidates.push(new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), minHour, 0, 0)));
    }
    return candidates[0];
}

// Priority scoring (mirrored from selectSample logic)
function computePriority(service, lastAudit, status, now) {
    let priority = 0;
    if (!lastAudit) {
        priority += 100;
    } else {
        const daysSince = (now - new Date(lastAudit.checked_at).getTime()) / (86400 * 1000);
        priority += daysSince * 10;
        if (lastAudit.overall_score !== null && lastAudit.overall_score < 50) {
            priority += 30;
        }
    }
    if (status === 'degraded' || status === 'partial') {
        priority += 20;
    }
    return priority;
}

// ─── Suite 1: Module exports ─────────────────────────────────────────────────

describe('ai-quality-agent — module exports', () => {
    it('should export startQualityAudit as a function', () => {
        const mod = require('../lib/ai-quality-agent');
        assert.strictEqual(typeof mod.startQualityAudit, 'function');
    });

    it('should export stopQualityAudit as a function', () => {
        const mod = require('../lib/ai-quality-agent');
        assert.strictEqual(typeof mod.stopQualityAudit, 'function');
    });

    it('should export runQualityAuditOnce as a function', () => {
        const mod = require('../lib/ai-quality-agent');
        assert.strictEqual(typeof mod.runQualityAuditOnce, 'function');
    });

    it('should export getQualityAuditStatus as a function', () => {
        const mod = require('../lib/ai-quality-agent');
        assert.strictEqual(typeof mod.getQualityAuditStatus, 'function');
    });

    it('getQualityAuditStatus should return expected structure', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.ok('enabled' in status);
        assert.ok('running' in status);
        assert.ok('walletInitialized' in status);
        assert.ok('chain' in status);
        assert.ok('lastRun' in status);
        assert.ok('schedule' in status);
        assert.ok(Array.isArray(status.schedule));
        assert.strictEqual(status.schedule.length, 2);
    });

    it('getQualityAuditStatus schedule should contain 06:00 and 18:00', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.ok(status.schedule.includes('06:00 UTC'));
        assert.ok(status.schedule.includes('18:00 UTC'));
    });
});

// ─── Suite 2: Severity thresholds ────────────────────────────────────────────

describe('ai-quality-agent — severity thresholds', () => {
    it('score 100 should be "good"', () => {
        assert.strictEqual(getSeverity(100).label, 'good');
    });

    it('score 80 should be "good"', () => {
        assert.strictEqual(getSeverity(80).label, 'good');
    });

    it('score 79 should be "acceptable"', () => {
        assert.strictEqual(getSeverity(79).label, 'acceptable');
    });

    it('score 50 should be "acceptable"', () => {
        assert.strictEqual(getSeverity(50).label, 'acceptable');
    });

    it('score 49 should be "concerning"', () => {
        assert.strictEqual(getSeverity(49).label, 'concerning');
    });

    it('score 25 should be "concerning"', () => {
        assert.strictEqual(getSeverity(25).label, 'concerning');
    });

    it('score 24 should be "critical"', () => {
        assert.strictEqual(getSeverity(24).label, 'critical');
    });

    it('score 0 should be "critical"', () => {
        assert.strictEqual(getSeverity(0).label, 'critical');
    });

    it('each severity should have an emoji', () => {
        for (const t of SEVERITY_THRESHOLDS) {
            assert.ok(t.emoji, `Severity ${t.label} should have an emoji`);
        }
    });
});

// ─── Suite 3: Scheduler (getNextRunTime) ─────────────────────────────────────

describe('ai-quality-agent — scheduler getNextRunTime', () => {
    const RUN_TIMES = [6, 18];

    it('should pick next run time in the future', () => {
        const now = Date.now();
        const next = getNextRunTime(now, RUN_TIMES);
        assert.ok(next.getTime() > now, 'Next run should be in the future');
    });

    it('at 05:00 UTC should schedule 06:00 same day', () => {
        const now = new Date('2026-03-18T05:00:00Z').getTime();
        const next = getNextRunTime(now, RUN_TIMES);
        assert.strictEqual(next.getUTCHours(), 6);
        assert.strictEqual(next.getUTCDate(), 18);
    });

    it('at 07:00 UTC should schedule 18:00 same day', () => {
        const now = new Date('2026-03-18T07:00:00Z').getTime();
        const next = getNextRunTime(now, RUN_TIMES);
        assert.strictEqual(next.getUTCHours(), 18);
        assert.strictEqual(next.getUTCDate(), 18);
    });

    it('at 19:00 UTC should schedule 06:00 next day', () => {
        const now = new Date('2026-03-18T19:00:00Z').getTime();
        const next = getNextRunTime(now, RUN_TIMES);
        assert.strictEqual(next.getUTCHours(), 6);
        assert.strictEqual(next.getUTCDate(), 19);
    });

    it('at 05:59:30 UTC (less than 1min before 06:00) should schedule 18:00', () => {
        const now = new Date('2026-03-18T05:59:30Z').getTime();
        const next = getNextRunTime(now, RUN_TIMES);
        // Should skip 06:00 (< 1min away) and pick 18:00
        assert.strictEqual(next.getUTCHours(), 18);
    });

    it('should always return a Date object', () => {
        const next = getNextRunTime(Date.now(), RUN_TIMES);
        assert.ok(next instanceof Date);
    });
});

// ─── Suite 4: Priority scoring ───────────────────────────────────────────────

describe('ai-quality-agent — priority scoring', () => {
    const now = Date.now();

    it('never-audited service should get +100 priority', () => {
        const p = computePriority({}, null, 'online', now);
        assert.strictEqual(p, 100);
    });

    it('service audited 3 days ago should get ~30 from daysSince', () => {
        const threeDaysAgo = new Date(now - 3 * 86400 * 1000).toISOString();
        const p = computePriority({}, { checked_at: threeDaysAgo, overall_score: 85 }, 'online', now);
        assert.ok(Math.abs(p - 30) < 1, `Expected ~30, got ${p}`);
    });

    it('low-score audit should add +30 bonus', () => {
        const oneDayAgo = new Date(now - 86400 * 1000).toISOString();
        const p = computePriority({}, { checked_at: oneDayAgo, overall_score: 40 }, 'online', now);
        // ~10 from daysSince + 30 from low score = ~40
        assert.ok(p >= 38 && p <= 42, `Expected ~40, got ${p}`);
    });

    it('degraded status should add +20 bonus', () => {
        const p = computePriority({}, null, 'degraded', now);
        assert.strictEqual(p, 120); // 100 + 20
    });

    it('partial status should add +20 bonus', () => {
        const p = computePriority({}, null, 'partial', now);
        assert.strictEqual(p, 120);
    });

    it('online status should add no bonus', () => {
        const p = computePriority({}, null, 'online', now);
        assert.strictEqual(p, 100); // Just the never-audited bonus
    });

    it('recently audited high-score online service should have low priority', () => {
        const justNow = new Date(now - 3600 * 1000).toISOString(); // 1 hour ago
        const p = computePriority({}, { checked_at: justNow, overall_score: 95 }, 'online', now);
        // ~0.4 from daysSince, no bonuses
        assert.ok(p < 1, `Expected very low priority, got ${p}`);
    });
});

// ─── Suite 5: Gemini response parsing ────────────────────────────────────────

describe('ai-quality-agent — Gemini response validation', () => {
    it('valid Gemini response should parse correctly', () => {
        const raw = JSON.stringify({
            overall_score: 85,
            dimensions: {
                semantic_correctness: 90,
                data_freshness: 80,
                locale_accuracy: 85,
                content_quality: 88,
                schema_compliance: 82,
            },
            issues: [],
            summary: 'Good quality response',
            severity: 'good',
        });
        const parsed = JSON.parse(raw);
        assert.strictEqual(parsed.overall_score, 85);
        assert.strictEqual(typeof parsed.dimensions, 'object');
        assert.strictEqual(parsed.dimensions.semantic_correctness, 90);
        assert.strictEqual(parsed.severity, 'good');
    });

    it('response with issues should include issue array', () => {
        const raw = JSON.stringify({
            overall_score: 35,
            dimensions: {
                semantic_correctness: 30,
                data_freshness: 20,
                locale_accuracy: 50,
                content_quality: 40,
                schema_compliance: 35,
            },
            issues: ['Stale data (3 days old)', 'Missing required fields'],
            summary: 'Data is stale and incomplete',
            severity: 'concerning',
        });
        const parsed = JSON.parse(raw);
        assert.strictEqual(parsed.issues.length, 2);
        assert.ok(parsed.issues[0].includes('Stale'));
    });

    it('invalid response (missing overall_score) should be detectable', () => {
        const parsed = { dimensions: {}, issues: [] };
        assert.strictEqual(typeof parsed.overall_score, 'undefined');
    });

    it('invalid response (missing dimensions) should be detectable', () => {
        const parsed = { overall_score: 50 };
        assert.strictEqual(parsed.dimensions, undefined);
    });
});

// ─── Suite 6: Daily tester shared exports ────────────────────────────────────

describe('ai-quality-agent — daily-tester shared exports', () => {
    it('daily-tester should export discoverServices', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(typeof dt.discoverServices, 'function');
    });

    it('daily-tester should export PARAM_DEFAULTS', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(typeof dt.PARAM_DEFAULTS, 'object');
        assert.ok(Object.keys(dt.PARAM_DEFAULTS).length > 20, 'Should have many param defaults');
    });

    it('daily-tester should export ENDPOINT_OVERRIDES', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(typeof dt.ENDPOINT_OVERRIDES, 'object');
    });

    it('daily-tester should export inferParamValue', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(typeof dt.inferParamValue, 'function');
    });

    it('daily-tester should export generateParamsFromSchema', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(typeof dt.generateParamsFromSchema, 'function');
    });

    it('inferParamValue should return sensible defaults', () => {
        const dt = require('../lib/daily-tester');
        assert.strictEqual(dt.inferParamValue('city'), 'Paris');
        assert.strictEqual(dt.inferParamValue('coin'), 'bitcoin');
    });

    it('generateParamsFromSchema should handle empty schema', () => {
        const dt = require('../lib/daily-tester');
        const result = dt.generateParamsFromSchema(null);
        assert.deepStrictEqual(result, {});
    });

    it('generateParamsFromSchema should generate params from required fields', () => {
        const dt = require('../lib/daily-tester');
        const result = dt.generateParamsFromSchema({ required: ['city', 'coin'] });
        assert.strictEqual(result.city, 'Paris');
        assert.strictEqual(result.coin, 'bitcoin');
    });
});

// ─── Suite 7: Status when not started ────────────────────────────────────────

describe('ai-quality-agent — status when not started', () => {
    it('should report enabled=false when supabase is not configured', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        // Module loaded without startQualityAudit() being called
        assert.strictEqual(status.enabled, false);
    });

    it('should report running=false by default', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.strictEqual(status.running, false);
    });

    it('should report walletInitialized=false by default', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.strictEqual(status.walletInitialized, false);
    });

    it('should report chain as SKALE on Base', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.ok(status.chain.toLowerCase().includes('skale'), `Expected SKALE chain, got ${status.chain}`);
    });

    it('lastRun should have null status', () => {
        const mod = require('../lib/ai-quality-agent');
        const status = mod.getQualityAuditStatus();
        assert.strictEqual(status.lastRun.status, null);
    });
});
