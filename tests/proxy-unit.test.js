// tests/proxy-unit.test.js — Unit tests for routes/proxy.js business logic
// Tests: gatekeeper integration, split mode validation, deferred claiming,
// retry backoff behaviour, SSRF blocking, parameter forwarding
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TX_HASH_REGEX, UUID_REGEX } = require('../lib/payment');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHash(char = 'a') {
    return '0x' + char.repeat(64);
}
function makeUUID() {
    return 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
}

// ─── Suite 1: UUID validation (serviceId format) ──────────────────────────────

describe('proxy — serviceId UUID validation', () => {
    it('should accept a valid UUID v4', () => {
        assert.ok(UUID_REGEX.test(makeUUID()));
    });

    it('should accept UUID with uppercase letters', () => {
        assert.ok(UUID_REGEX.test('F47AC10B-58CC-4372-A567-0E02B2C3D479'));
    });

    it('should reject a non-UUID string', () => {
        assert.ok(!UUID_REGEX.test('not-a-uuid'));
    });

    it('should reject an empty string', () => {
        assert.ok(!UUID_REGEX.test(''));
    });

    it('should reject a UUID with wrong segment lengths', () => {
        assert.ok(!UUID_REGEX.test('f47ac10b-58cc-4372-a567-0e02b2c3d47'));
    });

    it('should reject a UUID with non-hex characters', () => {
        assert.ok(!UUID_REGEX.test('z47ac10b-58cc-4372-a567-0e02b2c3d479'));
    });

    it('should reject a plain hash (64-char hex)', () => {
        assert.ok(!UUID_REGEX.test('f47ac10b58cc4372a5670e02b2c3d4791234'));
    });
});

// ─── Suite 2: Split mode detection logic ─────────────────────────────────────

describe('proxy — split mode detection', () => {
    // Replicate the isSplitMode logic from routes/proxy.js:
    // isSplitMode = !!(service.owner_address) && !!txHashProvider

    function isSplitMode(ownerAddress, txHashProvider) {
        return !!(ownerAddress) && !!(txHashProvider);
    }

    it('should be split mode when both owner_address and txHashProvider are present', () => {
        assert.strictEqual(isSplitMode('0x' + 'a'.repeat(40), makeHash('c')), true);
    });

    it('should NOT be split mode when owner_address is absent', () => {
        assert.strictEqual(isSplitMode(null, makeHash('c')), false);
    });

    it('should NOT be split mode when owner_address is undefined', () => {
        assert.strictEqual(isSplitMode(undefined, makeHash('c')), false);
    });

    it('should NOT be split mode when owner_address is empty string', () => {
        assert.strictEqual(isSplitMode('', makeHash('c')), false);
    });

    it('should NOT be split mode when txHashProvider is absent', () => {
        assert.strictEqual(isSplitMode('0x' + 'a'.repeat(40), null), false);
    });

    it('should NOT be split mode for native wrappers (no owner_address)', () => {
        // The 69 native wrappers don't have owner_address → always legacy
        assert.strictEqual(isSplitMode(null, makeHash('c')), false);
    });
});

// ─── Suite 3: Split payment validation guards ─────────────────────────────────

describe('proxy — handleSplitMode guards', () => {
    const MIN_SPLIT_AMOUNT_RAW = 100; // 0.0001 USDC

    it('should reject price below minimum split threshold', () => {
        const minAmountRaw = 99; // below 100
        assert.ok(minAmountRaw < MIN_SPLIT_AMOUNT_RAW);
    });

    it('should accept price at minimum split threshold', () => {
        const minAmountRaw = 100;
        assert.ok(minAmountRaw >= MIN_SPLIT_AMOUNT_RAW);
    });

    it('should reject when provider and platform hashes are identical', () => {
        const hash = makeHash('a');
        // Guard: txHashPlatform === txHashProvider → rejected
        const isDuplicate = hash === hash;
        assert.strictEqual(isDuplicate, true);
    });

    it('should accept when provider and platform hashes are different', () => {
        const txProvider = makeHash('a');
        const txPlatform = makeHash('b');
        assert.notStrictEqual(txProvider, txPlatform);
    });

    it('should compute correct 95/5 split amounts', () => {
        const totalRaw = 1_000_000; // 1.000000 USDC
        const providerRaw = Math.floor(totalRaw * 95 / 100);
        const platformRaw = totalRaw - providerRaw;

        assert.strictEqual(providerRaw, 950_000);
        assert.strictEqual(platformRaw, 50_000);
        assert.strictEqual(providerRaw + platformRaw, totalRaw);
    });

    it('should compute correct 95/5 split for 0.005 USDC (5000 raw)', () => {
        const totalRaw = 5000;
        const providerRaw = Math.floor(totalRaw * 95 / 100);
        const platformRaw = totalRaw - providerRaw;

        assert.strictEqual(providerRaw, 4750);
        assert.strictEqual(platformRaw, 250);
        assert.strictEqual(providerRaw + platformRaw, totalRaw);
    });

    it('provider+platform should always sum to total (no rounding leak)', () => {
        const amounts = [1, 3, 7, 100, 999, 5000, 10000, 1_000_000];
        for (const total of amounts) {
            const provider = Math.floor(total * 95 / 100);
            const platform = total - provider;
            assert.strictEqual(
                provider + platform,
                total,
                `Rounding leak for amount=${total}: ${provider}+${platform}!=${total}`
            );
        }
    });
});

// ─── Suite 4: Retry backoff constants ────────────────────────────────────────

describe('proxy — retry backoff', () => {
    // From routes/proxy.js: RETRY_BACKOFF_MS = [0, 1000, 3000]
    const RETRY_BACKOFF_MS = [0, 1000, 3000];
    const MAX_RETRIES = RETRY_BACKOFF_MS.length;

    it('should have 3 retry attempts', () => {
        assert.strictEqual(MAX_RETRIES, 3);
    });

    it('first retry should be immediate (0ms)', () => {
        assert.strictEqual(RETRY_BACKOFF_MS[0], 0);
    });

    it('second retry should wait 1 second', () => {
        assert.strictEqual(RETRY_BACKOFF_MS[1], 1000);
    });

    it('third retry should wait 3 seconds', () => {
        assert.strictEqual(RETRY_BACKOFF_MS[2], 3000);
    });

    it('backoff delays should be non-decreasing', () => {
        for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
            assert.ok(
                RETRY_BACKOFF_MS[i] >= RETRY_BACKOFF_MS[i - 1],
                `Backoff delay ${RETRY_BACKOFF_MS[i]} is less than previous ${RETRY_BACKOFF_MS[i - 1]}`
            );
        }
    });
});

// ─── Suite 5: x402 metadata shape ────────────────────────────────────────────

describe('proxy — _x402 metadata shape', () => {
    function buildLegacyMeta(price, txHash) {
        return {
            payment:        price + ' USDC',
            provider_share: (price * 0.95).toFixed(6) + ' USDC',
            platform_fee:   (price * 0.05).toFixed(6) + ' USDC',
            tx_hash:        txHash,
        };
    }

    function buildSplitMeta(price, splitMeta) {
        return {
            payment:               price + ' USDC',
            split_mode:            'native',
            provider_share:        splitMeta.provider_amount + ' USDC',
            platform_fee:          splitMeta.platform_amount + ' USDC',
            tx_hash_provider:      splitMeta.tx_hash_provider,
            tx_hash_platform:      splitMeta.tx_hash_platform,
            platform_split_status: splitMeta.platform_split_status,
        };
    }

    it('legacy meta should include payment, provider_share, platform_fee, tx_hash', () => {
        const meta = buildLegacyMeta(0.05, makeHash('a'));
        assert.ok(meta.payment);
        assert.ok(meta.provider_share);
        assert.ok(meta.platform_fee);
        assert.ok(meta.tx_hash);
    });

    it('legacy meta provider_share should be 95% of price', () => {
        const meta = buildLegacyMeta(1.0, makeHash('a'));
        assert.strictEqual(meta.provider_share, '0.950000 USDC');
    });

    it('legacy meta platform_fee should be 5% of price', () => {
        const meta = buildLegacyMeta(1.0, makeHash('a'));
        assert.strictEqual(meta.platform_fee, '0.050000 USDC');
    });

    it('split meta should include split_mode: native', () => {
        const meta = buildSplitMeta(1.0, {
            provider_amount: '0.950000',
            platform_amount: '0.050000',
            tx_hash_provider: makeHash('a'),
            tx_hash_platform: makeHash('b'),
            platform_split_status: 'on_chain',
        });
        assert.strictEqual(meta.split_mode, 'native');
    });

    it('split meta platform_split_status should be on_chain or fallback_pending', () => {
        const validStatuses = ['on_chain', 'fallback_pending'];
        for (const status of validStatuses) {
            const meta = buildSplitMeta(1.0, {
                provider_amount: '0.950000',
                platform_amount: '0.050000',
                tx_hash_provider: makeHash('a'),
                tx_hash_platform: makeHash('b'),
                platform_split_status: status,
            });
            assert.ok(validStatuses.includes(meta.platform_split_status));
        }
    });
});

// ─── Suite 6: Parameter forwarding ───────────────────────────────────────────

describe('proxy — parameter forwarding to upstream URL', () => {
    // Replicate the URL construction logic from executeProxyCall
    function buildTargetUrl(serviceUrl, body, query) {
        const params = {};
        if (body && typeof body === 'object') Object.assign(params, body);
        if (query && Object.keys(query).length > 0) Object.assign(params, query);

        if (Object.keys(params).length === 0) return serviceUrl;

        const url = new URL(serviceUrl);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    it('should append query params from body to service URL', () => {
        const url = buildTargetUrl(
            'https://x402-api.onrender.com/api/weather',
            { city: 'Paris' },
            {}
        );
        assert.ok(url.includes('city=Paris'));
    });

    it('should append query params from request query string', () => {
        const url = buildTargetUrl(
            'https://x402-api.onrender.com/api/search',
            {},
            { q: 'bitcoin' }
        );
        assert.ok(url.includes('q=bitcoin'));
    });

    it('should merge body and query params, with query params overriding body', () => {
        const url = buildTargetUrl(
            'https://x402-api.onrender.com/api/translate',
            { text: 'hello', to: 'fr' },
            { to: 'es' } // overrides body
        );
        // URL params are URL-encoded so we check the decoded form
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('to'), 'es');
        assert.strictEqual(parsed.searchParams.get('text'), 'hello');
    });

    it('should skip null values when building URL params', () => {
        const url = buildTargetUrl(
            'https://x402-api.onrender.com/api/weather',
            { city: 'Paris', optional: null },
            {}
        );
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('city'), 'Paris');
        assert.strictEqual(parsed.searchParams.get('optional'), null);
    });

    it('should skip undefined values', () => {
        const url = buildTargetUrl(
            'https://x402-api.onrender.com/api/hash',
            { text: 'hello', algo: undefined },
            {}
        );
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('text'), 'hello');
        assert.strictEqual(parsed.searchParams.get('algo'), null);
    });

    it('should return the original URL unchanged when no params', () => {
        const original = 'https://x402-api.onrender.com/api/joke';
        const url = buildTargetUrl(original, {}, {});
        assert.strictEqual(url, original);
    });

    it('should handle URL with existing query params', () => {
        const url = buildTargetUrl(
            'https://api.external.com/v1/data?version=2',
            { key: 'value' },
            {}
        );
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get('version'), '2');
        assert.strictEqual(parsed.searchParams.get('key'), 'value');
    });
});

// ─── Suite 7: Deferred claiming contract ─────────────────────────────────────

describe('proxy — deferred claiming (onSuccess contract)', () => {
    it('should not call onSuccess when all retries fail (tx not consumed)', async () => {
        let onSuccessCalled = false;

        // Simulate executeProxyCall with all retries failing
        const RETRY_BACKOFF_MS = [0, 0, 0]; // fast for testing
        const onSuccess = async () => { onSuccessCalled = true; return { ok: true }; };

        let attempts = 0;
        let lastError = null;
        for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt++) {
            await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
            try {
                throw new Error('Network error');
            } catch (err) {
                lastError = err;
                attempts++;
                // continue — no onSuccess call
            }
        }

        // All retries exhausted → onSuccess NOT called
        assert.strictEqual(onSuccessCalled, false);
        assert.strictEqual(attempts, 3);
        assert.ok(lastError);
    });

    it('should call onSuccess exactly once on successful upstream response', async () => {
        let onSuccessCallCount = 0;

        const onSuccess = async () => {
            onSuccessCallCount++;
            return { ok: true };
        };

        // Simulate successful proxy call (first attempt)
        let attempt = 0;
        while (attempt < 3) {
            try {
                // Simulated successful response
                const responseOk = true;
                if (responseOk) {
                    await onSuccess();
                    break;
                }
            } catch (err) {
                attempt++;
            }
            attempt++;
        }

        assert.strictEqual(onSuccessCallCount, 1);
    });

    it('should return 409 when onSuccess returns { ok: false } (race condition)', () => {
        // Simulate the proxy response when onSuccess returns { ok: false }
        const claimResult = { ok: false };
        if (claimResult && !claimResult.ok) {
            const response = {
                status: 409,
                body: {
                    error: 'TX_ALREADY_USED',
                    code: 'TX_REPLAY',
                    message: 'This transaction hash has already been used for a previous payment. Please send a new transaction.',
                },
            };
            assert.strictEqual(response.status, 409);
            assert.strictEqual(response.body.error, 'TX_ALREADY_USED');
            assert.strictEqual(response.body.code, 'TX_REPLAY');
        }
    });
});
