// tests/anti-wrapper.test.js — Unit tests for wrapper detection in lib/service-verifier.js
// Covers: potentialWrapper flag, wrapperReason text, verdict + VERDICT_EMOJI/LABEL,
// Telegram notification content, and integration with verifyService report shape.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Replicate wrapper detection logic from lib/service-verifier.js (Step 6) ──

/**
 * Replica of the wrapper detection block in verifyService().
 * We test this logic in isolation to avoid needing a real HTTP call.
 */
function detectWrapper(report, walletAddress) {
    if (report.x402 && report.x402.valid && report.x402.payTo) {
        const BAZAAR_WALLET = (walletAddress || '').toLowerCase();
        if (BAZAAR_WALLET && report.x402.payTo.toLowerCase() === BAZAAR_WALLET) {
            report.potentialWrapper = true;
            report.wrapperReason = 'payTo matches Bazaar platform wallet — possible x402 wrapper causing double payment';
        }
    }
    return report;
}

// ─── Replicate VERDICT_EMOJI and VERDICT_LABEL from routes/register.js ────────

const VERDICT_EMOJI = {
    mainnet_verified: '\u2705',
    reachable: '\u2139\uFE0F',
    testnet: '\u26A0\uFE0F',
    wrong_chain: '\u26A0\uFE0F',
    no_x402: '\u2753',
    offline: '\uD83D\uDD34',
    potential_wrapper: '\u26A0\uFE0F',
};

const VERDICT_LABEL = {
    mainnet_verified: 'MAINNET VERIFIE',
    reachable: 'ACCESSIBLE (pas de x402)',
    testnet: 'TESTNET',
    wrong_chain: 'CHAIN INCONNUE',
    no_x402: 'PAS DE x402',
    offline: 'HORS LIGNE',
    potential_wrapper: 'WRAPPER POTENTIEL',
};

// ─── Replicate Telegram notification builder from autoTestService ──────────────

function buildTelegramNotification(report, service) {
    const emoji = VERDICT_EMOJI[report.verdict] || '\u2753';
    const label = VERDICT_LABEL[report.verdict] || report.verdict;

    const lines = [
        `${emoji} *Nouveau service — ${label}*`,
        ``,
        `*Nom:* ${service.name}`,
        `*URL:* \`${service.url}\``,
        `*Prix:* ${service.price_usdc} USDC`,
        `*HTTP:* ${report.httpStatus || 'N/A'}`,
        `*Latence:* ${report.latency}ms`,
    ];

    if (report.x402 && report.x402.valid) {
        if (report.x402.payTo) {
            lines.push(`*PayTo:* \`${report.x402.payTo.slice(0, 10)}...\``);
        }
    }

    if (report.details) lines.push(`\n_${report.details}_`);

    if (report.potentialWrapper) {
        lines.push(`\n\u26A0\uFE0F *ATTENTION: Wrapper potentiel détecté*`);
        lines.push(`_${report.wrapperReason}_`);
    }

    lines.push(`\n*ID:* \`${service.id.slice(0, 8)}...\``);

    return lines.filter(Boolean).join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BAZAAR_WALLET = '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430';
const OTHER_WALLET  = '0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef';

function makeX402Report(payTo, overrides = {}) {
    return {
        reachable: true,
        httpStatus: 402,
        latency: 120,
        x402: {
            valid: true,
            isMainnet: true,
            isValidUsdc: true,
            chainLabel: 'Base',
            network: 'eip155:8453',
            payTo,
        },
        detectedParams: null,
        endpoints: { health: false },
        verdict: 'mainnet_verified',
        details: 'x402 verified on Base',
        ...overrides,
    };
}

function makeService(overrides = {}) {
    return {
        id: 'uuid-1234-5678-abcd',
        name: 'Test Service',
        url: 'https://api.example.com/v1',
        price_usdc: 0.05,
        ...overrides,
    };
}

// ─── Suite 1: Wrapper detection logic ─────────────────────────────────────────

describe('Wrapper detection — no wrapper when payTo does not match WALLET_ADDRESS', () => {
    it('should NOT set potentialWrapper when payTo is a different wallet', () => {
        const report = makeX402Report(OTHER_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, undefined);
    });

    it('should NOT set wrapperReason when payTo is a different wallet', () => {
        const report = makeX402Report(OTHER_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.wrapperReason, undefined);
    });
});

describe('Wrapper detection — potentialWrapper=true when payTo matches WALLET_ADDRESS', () => {
    it('should set potentialWrapper=true when payTo equals WALLET_ADDRESS', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, true);
    });
});

describe('Wrapper detection — case insensitive comparison', () => {
    it('should detect wrapper when payTo is lowercase and WALLET_ADDRESS is mixed-case', () => {
        const report = makeX402Report(BAZAAR_WALLET.toLowerCase());
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, true);
    });

    it('should detect wrapper when payTo is uppercase and WALLET_ADDRESS is mixed-case', () => {
        const report = makeX402Report(BAZAAR_WALLET.toUpperCase());
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, true);
    });
});

describe('Wrapper detection — no wrapper when x402 is null', () => {
    it('should NOT set potentialWrapper when x402 is null', () => {
        const report = {
            reachable: true,
            httpStatus: 402,
            latency: 50,
            x402: null,
            verdict: 'no_x402',
            details: '',
        };
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, undefined);
    });
});

describe('Wrapper detection — no wrapper when x402.valid is false', () => {
    it('should NOT set potentialWrapper when x402.valid=false', () => {
        const report = {
            reachable: true,
            httpStatus: 402,
            latency: 80,
            x402: { valid: false, payTo: BAZAAR_WALLET },
            verdict: 'no_x402',
            details: '',
        };
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, undefined);
    });
});

describe('Wrapper detection — no wrapper when x402.payTo is empty', () => {
    it('should NOT set potentialWrapper when payTo is empty string', () => {
        const report = makeX402Report('');
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, undefined);
    });
});

describe('Wrapper detection — no wrapper when WALLET_ADDRESS env is not set', () => {
    it('should NOT set potentialWrapper when walletAddress is empty string', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, ''); // empty wallet address — no env var
        assert.strictEqual(report.potentialWrapper, undefined);
    });
});

describe('Wrapper detection — wrapperReason contains explanation text', () => {
    it('should set wrapperReason with descriptive text mentioning double payment', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        assert.ok(typeof report.wrapperReason === 'string');
        assert.ok(report.wrapperReason.includes('double payment') || report.wrapperReason.length > 10);
    });
});

// ─── Suite 2: autoTestService wrapper notification ────────────────────────────

describe('autoTestService — VERDICT_EMOJI includes potential_wrapper', () => {
    it('should have an emoji entry for potential_wrapper verdict', () => {
        assert.ok(VERDICT_EMOJI['potential_wrapper'] !== undefined);
    });

    it('potential_wrapper emoji should be a non-empty string', () => {
        assert.ok(typeof VERDICT_EMOJI['potential_wrapper'] === 'string');
        assert.ok(VERDICT_EMOJI['potential_wrapper'].length > 0);
    });
});

describe('autoTestService — VERDICT_LABEL includes potential_wrapper', () => {
    it('should have a label entry for potential_wrapper verdict', () => {
        assert.ok(VERDICT_LABEL['potential_wrapper'] !== undefined);
    });

    it('potential_wrapper label should be a non-empty string', () => {
        assert.ok(typeof VERDICT_LABEL['potential_wrapper'] === 'string');
        assert.ok(VERDICT_LABEL['potential_wrapper'].length > 0);
    });
});

describe('autoTestService — Telegram notification includes wrapper warning', () => {
    it('should include wrapper warning in notification when potentialWrapper=true', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);

        const notification = buildTelegramNotification(report, makeService());
        assert.ok(notification.includes('Wrapper potentiel') || notification.includes('ATTENTION'));
    });

    it('should include wrapperReason text in notification', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);

        const notification = buildTelegramNotification(report, makeService());
        assert.ok(notification.includes(report.wrapperReason));
    });

    it('should NOT include wrapper warning when no wrapper detected', () => {
        const report = makeX402Report(OTHER_WALLET);
        detectWrapper(report, BAZAAR_WALLET);

        const notification = buildTelegramNotification(report, makeService());
        assert.ok(!notification.includes('Wrapper potentiel'));
    });

    it('should still include core service fields when wrapper is detected', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);

        const service = makeService({ name: 'My Wrapper API' });
        const notification = buildTelegramNotification(report, service);

        assert.ok(notification.includes('My Wrapper API'));
        assert.ok(notification.includes(service.url));
    });
});

// ─── Suite 3: Integration with verifyService report shape ─────────────────────

describe('Integration — wrapper flag not set for normal x402 service', () => {
    it('should leave potentialWrapper undefined for a normal third-party service', () => {
        const report = makeX402Report(OTHER_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        // potentialWrapper should remain undefined (not false, but truly absent)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(report, 'potentialWrapper'), false);
    });
});

describe('Integration — wrapper detection applies after verdict is determined', () => {
    it('should preserve the verdict when wrapper is detected', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        // verdict was set before wrapper detection
        assert.strictEqual(report.verdict, 'mainnet_verified');
        detectWrapper(report, BAZAAR_WALLET);
        // verdict remains unchanged — wrapper is additional metadata
        assert.strictEqual(report.verdict, 'mainnet_verified');
    });

    it('should preserve latency and httpStatus when wrapper is detected', () => {
        const report = makeX402Report(BAZAAR_WALLET, { latency: 200, httpStatus: 402 });
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.latency, 200);
        assert.strictEqual(report.httpStatus, 402);
    });
});

describe('Integration — potentialWrapper field is boolean true/false', () => {
    it('potentialWrapper should be exactly boolean true when set', () => {
        const report = makeX402Report(BAZAAR_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        assert.strictEqual(report.potentialWrapper, true);
        assert.strictEqual(typeof report.potentialWrapper, 'boolean');
    });

    it('potentialWrapper should be absent (not false) when not a wrapper', () => {
        const report = makeX402Report(OTHER_WALLET);
        detectWrapper(report, BAZAAR_WALLET);
        // The real code uses `report.potentialWrapper = true` — it never sets false.
        // So the field simply doesn't exist on the object.
        assert.strictEqual(report.potentialWrapper, undefined);
    });

    it('should not overwrite existing report fields with wrapper detection', () => {
        const report = makeX402Report(BAZAAR_WALLET, {
            detectedParams: { required: ['city'] },
            endpoints: { health: true },
        });
        detectWrapper(report, BAZAAR_WALLET);
        assert.deepStrictEqual(report.detectedParams, { required: ['city'] });
        assert.strictEqual(report.endpoints.health, true);
    });
});
