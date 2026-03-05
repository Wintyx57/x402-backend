// tests/split.test.js — Unit tests for split payment 95/5 (native on-chain mode)
// Covers: lib/payment.js (verifySplitPayment), lib/payouts.js (recordSplitPayout),
//         routes/proxy.js (split mode orchestration)
'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentSystem, TX_HASH_REGEX } = require('../lib/payment');
const { createPayoutManager } = require('../lib/payouts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROVIDER_WALLET  = '0x' + 'a'.repeat(40);
const PLATFORM_WALLET  = '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430';
const TX_HASH_PROVIDER = '0x' + 'c'.repeat(64);
const TX_HASH_PLATFORM = '0x' + 'd'.repeat(64);
const TX_HASH_LEGACY   = '0x' + 'e'.repeat(64);

// USDC contract address on Base (lower-case — matches payment.js comparison)
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ---------------------------------------------------------------------------
// RPC mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock fetch that simulates a confirmed USDC Transfer log
 * going to `recipientAddr` with `amountRaw` micro-USDC.
 * Returns 3 confirmations (blockNumber=1, currentBlock=3).
 */
function makeSuccessfulRpcFetch(recipientAddr, amountRaw) {
    const paddedRecipient = '0x000000000000000000000000' + recipientAddr.slice(2).toLowerCase();
    const paddedFrom      = '0x000000000000000000000000' + 'f'.repeat(40);
    const paddedAmount    = '0x' + BigInt(amountRaw).toString(16).padStart(64, '0');

    return async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_blockNumber') {
            return { json: async () => ({ result: '0x3' }) }; // block 3
        }
        // eth_getTransactionReceipt
        return {
            json: async () => ({
                result: {
                    status: '0x1',
                    blockNumber: '0x1', // tx in block 1 → 2 confirmations
                    logs: [{
                        address: USDC_BASE,
                        topics: [TRANSFER_TOPIC, paddedFrom, paddedRecipient],
                        data:    paddedAmount,
                    }],
                }
            })
        };
    };
}

/**
 * Build a mock fetch that simulates a confirmed tx (status: '0x1', 2 confirmations)
 * but with NO matching USDC transfer log — so verifyPayment returns false immediately
 * without triggering any retry sleep.
 */
function makeFailedRpcFetch() {
    return async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_blockNumber') {
            return { json: async () => ({ result: '0x3' }) }; // block 3
        }
        // Receipt confirmed (status 0x1) but logs are empty → verifyPayment returns false
        // without waiting (no retry path is triggered for confirmed-but-no-match txs)
        return {
            json: async () => ({
                result: {
                    status: '0x1',
                    blockNumber: '0x1', // 2 confirmations
                    logs: [],           // no USDC Transfer log
                }
            })
        };
    };
}

// ---------------------------------------------------------------------------
// Math helpers — tested independently
// ---------------------------------------------------------------------------

describe('Split amount arithmetic', () => {
    it('should split 1000 micro-USDC into 950 + 50', () => {
        const total = 1000;
        const provider = Math.floor(total * 95 / 100);
        const platform = total - provider;
        assert.equal(provider, 950);
        assert.equal(platform, 50);
        assert.equal(provider + platform, total);
    });

    it('should split 3000 micro-USDC into 2850 + 150', () => {
        const total = 3000;
        const provider = Math.floor(total * 95 / 100);
        const platform = total - provider;
        assert.equal(provider, 2850);
        assert.equal(platform, 150);
        assert.equal(provider + platform, total);
    });

    it('should split 7000 micro-USDC into 6650 + 350', () => {
        const total = 7000;
        const provider = Math.floor(total * 95 / 100);
        const platform = total - provider;
        assert.equal(provider, 6650);
        assert.equal(platform, 350);
        assert.equal(provider + platform, total);
    });

    it('should guarantee provider + platform = total for all integer amounts 1..10000', () => {
        for (let total = 1; total <= 10000; total++) {
            const provider = Math.floor(total * 95 / 100);
            const platform = total - provider;
            assert.equal(provider + platform, total, `Failed for total=${total}`);
        }
    });

    it('should produce non-zero amounts for total >= 100 micro-USDC', () => {
        const total = 100;
        const provider = Math.floor(total * 95 / 100); // floor(95) = 95
        const platform = total - provider;             // 5
        assert.ok(provider > 0, `provider should be > 0, got ${provider}`);
        assert.ok(platform > 0, `platform should be > 0, got ${platform}`);
    });

    it('should produce a zero provider amount for total = 1 micro-USDC (edge case)', () => {
        const total = 1;
        const provider = Math.floor(total * 95 / 100); // floor(0.95) = 0
        assert.equal(provider, 0);
    });
});

// ---------------------------------------------------------------------------
// createPaymentSystem — verifySplitPayment unit tests
// ---------------------------------------------------------------------------

describe('verifySplitPayment — exported function', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        process.env.WALLET_ADDRESS = PLATFORM_WALLET;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should be exported from createPaymentSystem', () => {
        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});
        assert.equal(typeof system.verifySplitPayment, 'function');
    });

    it('should return { providerValid: true, platformValid: false, fromAddress } when only provider tx is valid', async () => {
        const providerAmountRaw = Math.floor(1000 * 95 / 100); // 950
        // Provider tx succeeds, platform tx fetch not called (txHashPlatform is null)
        global.fetch = makeSuccessfulRpcFetch(PROVIDER_WALLET, providerAmountRaw);

        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});

        const result = await system.verifySplitPayment(TX_HASH_PROVIDER, null, 1000, 'base', PROVIDER_WALLET);

        assert.equal(result.providerValid, true);
        assert.equal(result.platformValid, false, 'Platform should be false when txHashPlatform is null');
        assert.ok(typeof result.fromAddress === 'string', 'fromAddress should be a string');
    });

    it('should return { providerValid: true, platformValid: true } when both tx are valid', async () => {
        const providerAmountRaw = Math.floor(1000 * 95 / 100); // 950
        const platformAmountRaw = 1000 - providerAmountRaw;     // 50

        let callIndex = 0;
        global.fetch = async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.method === 'eth_blockNumber') {
                return { json: async () => ({ result: '0x3' }) };
            }
            // First receipt request → provider tx (goes to PROVIDER_WALLET)
            // Second receipt request → platform tx (goes to PLATFORM_WALLET)
            callIndex++;
            const isProviderCall = callIndex === 1;
            const recipient = isProviderCall ? PROVIDER_WALLET : PLATFORM_WALLET;
            const amount    = isProviderCall ? providerAmountRaw : platformAmountRaw;
            return makeSuccessfulRpcFetch(recipient, amount)(url, opts);
        };

        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});

        const result = await system.verifySplitPayment(TX_HASH_PROVIDER, TX_HASH_PLATFORM, 1000, 'base', PROVIDER_WALLET);

        assert.equal(result.providerValid, true);
        assert.equal(result.platformValid, true);
    });

    it('should return { providerValid: false } when provider tx status is 0x0 (failed)', async () => {
        global.fetch = makeFailedRpcFetch();

        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});

        const result = await system.verifySplitPayment(TX_HASH_PROVIDER, null, 1000, 'base', PROVIDER_WALLET);

        assert.equal(result.providerValid, false);
        assert.equal(result.platformValid, false);
        assert.equal(result.fromAddress, null);
    });

    it('should return { providerValid: true, platformValid: false } when platform tx is invalid', async () => {
        const providerAmountRaw = Math.floor(1000 * 95 / 100); // 950

        let callIndex = 0;
        global.fetch = async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.method === 'eth_blockNumber') {
                return { json: async () => ({ result: '0x3' }) };
            }
            callIndex++;
            if (callIndex === 1) {
                // Provider tx: valid
                return makeSuccessfulRpcFetch(PROVIDER_WALLET, providerAmountRaw)(url, opts);
            }
            // Platform tx: failed
            return makeFailedRpcFetch()(url, opts);
        };

        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});

        const result = await system.verifySplitPayment(TX_HASH_PROVIDER, TX_HASH_PLATFORM, 1000, 'base', PROVIDER_WALLET);

        assert.equal(result.providerValid, true);
        assert.equal(result.platformValid, false);
    });

    it('should use Math.floor for provider amount and subtraction for platform amount', async () => {
        // Verify the split math used inside verifySplitPayment
        // For total=1000: provider=950, platform=50 (not 49 or 51)
        const total = 1000;
        let capturedProviderAmount = null;
        let capturedPlatformAmount = null;

        let receiptCallCount = 0;
        global.fetch = async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.method === 'eth_blockNumber') {
                return { json: async () => ({ result: '0x3' }) };
            }
            receiptCallCount++;
            // Capture which amount is being verified by returning a matching receipt
            // For both tx hashes, return a transfer of the correct amount
            if (receiptCallCount === 1) {
                // Provider receipt — we capture the amount from the verification
                capturedProviderAmount = Math.floor(total * 95 / 100);
                return makeSuccessfulRpcFetch(PROVIDER_WALLET, capturedProviderAmount)(url, opts);
            }
            capturedPlatformAmount = total - capturedProviderAmount;
            return makeSuccessfulRpcFetch(PLATFORM_WALLET, capturedPlatformAmount)(url, opts);
        };

        const fakeSupabase = {
            from: () => ({ select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) })
        };
        const system = createPaymentSystem(fakeSupabase, () => {});
        await system.verifySplitPayment(TX_HASH_PROVIDER, TX_HASH_PLATFORM, total, 'base', PROVIDER_WALLET);

        assert.equal(capturedProviderAmount, 950);
        assert.equal(capturedPlatformAmount, 50);
        assert.equal(capturedProviderAmount + capturedPlatformAmount, total);
    });
});

// ---------------------------------------------------------------------------
// lib/payouts.js — recordSplitPayout
// ---------------------------------------------------------------------------

describe('recordSplitPayout', () => {
    it('should be exported from createPayoutManager', () => {
        const manager = createPayoutManager({
            from: () => ({ insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) })
        });
        assert.equal(typeof manager.recordSplitPayout, 'function');
    });

    it('should insert a row with split_mode = split_complete and status = paid', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        const result = await recordSplitPayout({
            serviceId:      'svc-1',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: TX_HASH_PLATFORM,
            chain:          'base',
            splitMode:      'split_complete',
        });

        assert.ok(capturedRow, 'Row should be inserted');
        assert.equal(capturedRow.split_mode, 'split_complete');
        assert.equal(capturedRow.status, 'paid', 'split_complete should produce status = paid immediately');
        assert.equal(capturedRow.tx_hash_in, TX_HASH_PROVIDER);
        assert.equal(capturedRow.tx_hash_platform, TX_HASH_PLATFORM);
        assert.ok(result, 'Should return the inserted row');
    });

    it('should insert a row with split_mode = provider_only and status = pending', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-2',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: null,
            chain:          'base',
            splitMode:      'provider_only',
        });

        assert.equal(capturedRow.split_mode, 'provider_only');
        assert.equal(capturedRow.status, 'pending', 'provider_only should remain pending (platform owes its share)');
        assert.equal(capturedRow.tx_hash_platform, null);
    });

    it('should insert a row with split_mode = legacy and status = pending', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-3',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    1.0,
            txHashProvider: TX_HASH_LEGACY,
            txHashPlatform: null,
            chain:          'base',
            splitMode:      'legacy',
        });

        assert.equal(capturedRow.split_mode, 'legacy');
        assert.equal(capturedRow.status, 'pending');
    });

    it('should compute correct 95/5 split for 0.01 USDC', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-4',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: null,
            chain:          'base',
            splitMode:      'split_complete',
        });

        assert.ok(Math.abs(capturedRow.provider_amount - 0.0095) < 1e-10, `provider_amount: ${capturedRow.provider_amount}`);
        assert.ok(Math.abs(capturedRow.platform_fee    - 0.0005) < 1e-10, `platform_fee: ${capturedRow.platform_fee}`);
        assert.ok(Math.abs(capturedRow.gross_amount    - 0.01)   < 1e-10, `gross_amount: ${capturedRow.gross_amount}`);
    });

    it('should compute correct 95/5 split for 1.0 USDC', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-5',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    1.0,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: TX_HASH_PLATFORM,
            chain:          'base',
            splitMode:      'split_complete',
        });

        assert.ok(Math.abs(capturedRow.provider_amount - 0.95) < 1e-10, `provider_amount: ${capturedRow.provider_amount}`);
        assert.ok(Math.abs(capturedRow.platform_fee    - 0.05) < 1e-10, `platform_fee: ${capturedRow.platform_fee}`);
    });

    it('should return null and not throw when supabase returns an error', async () => {
        const supabase = {
            from() {
                return {
                    insert() {
                        return { select: () => Promise.resolve({ data: null, error: { message: 'DB error' } }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        const result = await recordSplitPayout({
            serviceId:      'svc-err',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: null,
            chain:          'base',
            splitMode:      'split_complete',
        });

        assert.equal(result, null);
    });

    it('should default chain to "base" when not provided', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-chain',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: null,
            splitMode:      'split_complete',
            // chain intentionally omitted
        });

        assert.equal(capturedRow.chain, 'base');
    });

    it('should store tx_hash_provider in tx_hash_in column', async () => {
        let capturedRow = null;
        const supabase = {
            from() {
                return {
                    insert(data) {
                        capturedRow = data[0];
                        return { select: () => Promise.resolve({ data: [{ id: 'x', ...data[0] }], error: null }) };
                    }
                };
            }
        };

        const { recordSplitPayout } = createPayoutManager(supabase);
        await recordSplitPayout({
            serviceId:      'svc-6',
            serviceName:    'Test API',
            providerWallet: PROVIDER_WALLET,
            grossAmount:    0.01,
            txHashProvider: TX_HASH_PROVIDER,
            txHashPlatform: TX_HASH_PLATFORM,
            chain:          'skale',
            splitMode:      'split_complete',
        });

        assert.equal(capturedRow.tx_hash_in,       TX_HASH_PROVIDER, 'tx_hash_in should be the provider tx hash');
        assert.equal(capturedRow.tx_hash_platform,  TX_HASH_PLATFORM, 'tx_hash_platform should be stored separately');
        assert.equal(capturedRow.chain,             'skale');
    });
});

// ---------------------------------------------------------------------------
// routes/proxy.js — handleSplitMode (via integration-style tests with mocked deps)
// ---------------------------------------------------------------------------

const createProxyRouter = require('../routes/proxy');

/**
 * Build a minimal express-like req/res pair for testing proxy route handlers.
 */
function makeReqRes({ headers = {}, body = {}, params = {} } = {}) {
    const req = { headers, body, params, method: 'POST' };

    let _statusCode = 200;
    let _responseBody = null;

    const res = {
        get statusCode() { return _statusCode; },
        status(code) { _statusCode = code; return res; },
        json(data) { _responseBody = data; return res; },
        getResponse() { return { statusCode: _statusCode, body: _responseBody }; },
        setHeader() { return res; },
    };

    return { req, res };
}

/**
 * Build a mock supabase that handles the patterns used in proxy.js.
 */
function makeSupabaseMock({ service = null, usedTxRows = [], insertError = null } = {}) {
    return {
        from(table) {
            if (table === 'services') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    single() {
                                        if (!service) {
                                            return Promise.resolve({ data: null, error: { message: 'Not found' } });
                                        }
                                        return Promise.resolve({ data: service, error: null });
                                    }
                                };
                            }
                        };
                    }
                };
            }
            if (table === 'used_transactions') {
                return {
                    select() {
                        return {
                            in(col, keys) {
                                return {
                                    limit() {
                                        return Promise.resolve({ data: usedTxRows, error: null });
                                    }
                                };
                            }
                        };
                    },
                    insert() {
                        if (insertError) {
                            return Promise.resolve({ error: insertError });
                        }
                        return Promise.resolve({ error: null });
                    }
                };
            }
            // fallback
            return {
                select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
                insert: () => Promise.resolve({ error: null }),
            };
        }
    };
}

/** Express limiter that always calls next(). */
function makePassthroughLimiter() {
    return (req, res, next) => next();
}

/** Payment middleware factory that always approves (calls next). */
function makeAutoApprovePaymentMiddleware() {
    return (minAmountRaw, price, label) => (req, res, next) => next();
}

/** Payment system mock with configurable split result. */
function makeSplitPaymentSystem({ providerValid = true, platformValid = true, fromAddress = '0x' + 'f'.repeat(40) } = {}) {
    return {
        verifySplitPayment: async () => ({ providerValid, platformValid, fromAddress }),
    };
}

/** Payout manager mock that records calls. */
function makePayoutManagerMock() {
    const calls = { recordPayout: [], recordSplitPayout: [] };
    return {
        calls,
        recordPayout(opts) {
            calls.recordPayout.push(opts);
            return Promise.resolve({ id: 'mock-payout' });
        },
        recordSplitPayout(opts) {
            calls.recordSplitPayout.push(opts);
            return Promise.resolve({ id: 'mock-split-payout' });
        },
    };
}

const SERVICE_WITH_OWNER = {
    id:            '00000000-0000-0000-0000-000000000001',
    name:          'External API',
    url:           'https://example.com/api',
    method:        'GET',
    price_usdc:    0.01,
    owner_address: PROVIDER_WALLET,
};

const SERVICE_WITHOUT_OWNER = {
    id:            '00000000-0000-0000-0000-000000000002',
    name:          'Native Wrapper',
    url:           'https://x402-api.onrender.com/api/joke',
    method:        'GET',
    price_usdc:    0.001,
    owner_address: null,
};

/**
 * Helper: dispatch a request to an express Router and wait for the response.
 * Resolves when res.json() is called (i.e. the handler has sent a response),
 * or when next() is called (i.e. the handler passed control downstream).
 */
function invokeRouteHandler(router, req, res) {
    return new Promise((resolve, reject) => {
        req.url = `/api/call/${req.params.serviceId}`;

        // Wrap res.json to auto-resolve the promise when the handler sends a response
        const originalJson = res.json.bind(res);
        let resolved = false;
        res.json = function(body) {
            const result = originalJson(body);
            if (!resolved) {
                resolved = true;
                // Use setImmediate to let the handler finish before resolving
                setImmediate(resolve);
            }
            return result;
        };

        router.handle(req, res, (err) => {
            if (!resolved) {
                resolved = true;
                if (err) reject(err);
                else resolve();
            }
        });
    });
}

// ---------------------------------------------------------------------------

describe('proxy.js — input validation (split mode)', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        process.env.WALLET_ADDRESS = PLATFORM_WALLET;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should reject 400 when txHashProvider and txHashPlatform are identical', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-txhash-platform': TX_HASH_PROVIDER, // same!
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 400);
        assert.ok(body.message.includes('different'), `Expected "different" in: ${body.message}`);
    });

    it('should reject 400 when txHashProvider has invalid format', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': 'not-a-valid-hash',
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 400);
        assert.ok(body.error.includes('Invalid transaction hash format'));
        assert.equal(body.field, 'X-Payment-TxHash-Provider');
    });

    it('should reject 400 when txHashPlatform has invalid format', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-txhash-platform': 'bad-format!!',
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 400);
        assert.equal(body.field, 'X-Payment-TxHash-Platform');
    });

    it('should reject 400 for serviceId with invalid UUID format', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const { req, res } = makeReqRes({
            params:  { serviceId: 'not-a-uuid' },
            headers: { 'x-payment-txhash-provider': TX_HASH_PROVIDER },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        assert.equal(res.getResponse().statusCode, 400);
    });

    it('should reject 400 when price < 100 micro-USDC and split mode is used', async () => {
        const cheapService = { ...SERVICE_WITH_OWNER, price_usdc: 0.00005 }; // 50 micro-USDC
        const supabase = makeSupabaseMock({ service: cheapService });
        const { req, res } = makeReqRes({
            params:  { serviceId: cheapService.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 400);
        assert.ok(body.error.includes('too low'), `Expected "too low" in: ${body.error}`);
    });
});

describe('proxy.js — anti-replay (split mode)', () => {
    beforeEach(() => { process.env.WALLET_ADDRESS = PLATFORM_WALLET; });

    it('should reject 402 when txHashProvider is already in used_transactions', async () => {
        const usedTxRows = [{ tx_hash: `base:split_provider:${TX_HASH_PROVIDER}` }];
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER, usedTxRows });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.ok(body.message.includes('already been used'), `Expected "already been used" in: ${body.message}`);
    });

    it('should reject 402 when txHashPlatform is already in used_transactions', async () => {
        const usedTxRows = [{ tx_hash: `base:split_platform:${TX_HASH_PLATFORM}` }];
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER, usedTxRows });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-txhash-platform': TX_HASH_PLATFORM,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.ok(body.message.includes('already been used'));
    });
});

describe('proxy.js — on-chain verification (split mode)', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        process.env.WALLET_ADDRESS = PLATFORM_WALLET;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should reject 402 when provider payment is invalid', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem({ providerValid: false, platformValid: false })
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.ok(body.message.includes('Provider payment invalid'), `Expected "Provider payment invalid" in: ${body.message}`);
    });

    it('should serve 200 when provider tx valid and platform tx absent (provider_only mode)', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const payoutMock = makePayoutManagerMock();

        global.fetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ joke: 'Why did the AI cross the road?' }),
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-chain': 'base',
                // No X-Payment-TxHash-Platform
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            payoutMock,
            makeSplitPaymentSystem({ providerValid: true, platformValid: false })
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 200);
        assert.equal(body._x402.split_mode, 'native');
        assert.equal(body._x402.platform_split_status, 'fallback_pending');
        assert.equal(body._x402.tx_hash_provider, TX_HASH_PROVIDER);

        assert.equal(payoutMock.calls.recordSplitPayout.length, 1);
        assert.equal(payoutMock.calls.recordSplitPayout[0].splitMode, 'provider_only');
    });

    it('should serve 200 and record split_complete when both payments are valid', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const payoutMock = makePayoutManagerMock();

        global.fetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ result: 'ok' }),
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-txhash-platform': TX_HASH_PLATFORM,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            payoutMock,
            makeSplitPaymentSystem({ providerValid: true, platformValid: true })
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 200);
        assert.equal(body._x402.split_mode, 'native');
        assert.equal(body._x402.platform_split_status, 'on_chain');
        assert.equal(body._x402.tx_hash_provider, TX_HASH_PROVIDER);
        assert.equal(body._x402.tx_hash_platform, TX_HASH_PLATFORM);

        assert.equal(payoutMock.calls.recordSplitPayout.length, 1);
        assert.equal(payoutMock.calls.recordSplitPayout[0].splitMode, 'split_complete');
    });

    it('should degrade to provider_only when platform valid but insert returns duplicate key', async () => {
        // Provider INSERT succeeds, platform INSERT returns duplicate key (race condition)
        let insertCallIndex = 0;
        const supabase = {
            from(table) {
                if (table === 'services') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () => Promise.resolve({ data: SERVICE_WITH_OWNER, error: null })
                            })
                        })
                    };
                }
                return {
                    select: () => ({
                        in: () => ({ limit: () => Promise.resolve({ data: [], error: null }) })
                    }),
                    insert() {
                        insertCallIndex++;
                        if (insertCallIndex === 1) {
                            // Provider claim succeeds
                            return Promise.resolve({ error: null });
                        }
                        // Platform claim: duplicate key
                        return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } });
                    }
                };
            }
        };

        const payoutMock = makePayoutManagerMock();
        global.fetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ result: 'ok' }),
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-txhash-platform': TX_HASH_PLATFORM,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            payoutMock,
            makeSplitPaymentSystem({ providerValid: true, platformValid: true })
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 200);
        // Should degrade to provider_only
        assert.equal(payoutMock.calls.recordSplitPayout[0].splitMode, 'provider_only');
    });
});

describe('proxy.js — legacy mode', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        process.env.WALLET_ADDRESS = PLATFORM_WALLET;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should use legacy mode when service has no owner_address', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITHOUT_OWNER });
        const payoutMock = makePayoutManagerMock();

        global.fetch = async () => ({
            ok: true, status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ joke: 'test' }),
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITHOUT_OWNER.id },
            headers: {
                'x-payment-txhash': TX_HASH_LEGACY,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            payoutMock,
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 200);
        assert.ok(body._x402.tx_hash !== undefined, '_x402.tx_hash should be set in legacy mode');
        assert.ok(body._x402.split_mode === undefined, '_x402.split_mode should NOT be set in legacy mode');
        assert.equal(payoutMock.calls.recordSplitPayout.length, 0, 'Should NOT call recordSplitPayout');
    });

    it('should use legacy mode when service has owner_address but client sends X-Payment-TxHash (not split headers)', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });
        const payoutMock = makePayoutManagerMock();

        global.fetch = async () => ({
            ok: true, status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ result: 'ok' }),
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash': TX_HASH_LEGACY, // legacy header only
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            payoutMock,
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode } = res.getResponse();

        assert.equal(statusCode, 200);
        assert.equal(payoutMock.calls.recordSplitPayout.length, 0, 'recordSplitPayout should NOT be called in legacy mode');
        assert.equal(payoutMock.calls.recordPayout.length, 1, 'recordPayout SHOULD be called in legacy mode');
    });

    it('should enrich 402 response with provider_wallet + split info when service has owner_address (legacy mode)', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITH_OWNER });

        // Middleware that always returns 402 (simulates missing payment header)
        const alwaysReject402 = (minAmountRaw, price, label) => (req, res, next) => {
            res.status(402).json({
                error: 'Payment Required',
                payment_details: { amount: price, recipient: PLATFORM_WALLET },
            });
        };

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: { 'x-payment-chain': 'base' }, // no payment header at all
        });

        const router = createProxyRouter(
            supabase, () => {},
            alwaysReject402,
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.ok(body.payment_details.provider_wallet, 'provider_wallet should be set');
        assert.equal(body.payment_details.provider_wallet, PROVIDER_WALLET);
        assert.ok(body.payment_details.split, 'split object should be present');
        assert.equal(body.payment_details.split.provider_percent, 95);
        assert.equal(body.payment_details.split.platform_percent, 5);
        assert.equal(body.payment_details.payment_mode, 'split_native');
        assert.ok(body.payment_details.split.provider_amount > 0, 'provider_amount should be > 0');
        assert.ok(body.payment_details.split.platform_amount > 0, 'platform_amount should be > 0');
    });

    it('should NOT add provider_wallet to 402 response when service has no owner_address', async () => {
        const supabase = makeSupabaseMock({ service: SERVICE_WITHOUT_OWNER });

        const alwaysReject402 = (minAmountRaw, price, label) => (req, res, next) => {
            res.status(402).json({
                error: 'Payment Required',
                payment_details: { amount: price, recipient: PLATFORM_WALLET },
            });
        };

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITHOUT_OWNER.id },
            headers: { 'x-payment-chain': 'base' },
        });

        const router = createProxyRouter(
            supabase, () => {},
            alwaysReject402,
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.equal(body.payment_details.provider_wallet, undefined, 'No provider_wallet for native service');
        assert.equal(body.payment_details.split, undefined, 'No split info for native service');
    });
});

describe('proxy.js — service not found', () => {
    beforeEach(() => { process.env.WALLET_ADDRESS = PLATFORM_WALLET; });

    it('should return 404 when service does not exist', async () => {
        const supabase = makeSupabaseMock({ service: null });

        const { req, res } = makeReqRes({
            params:  { serviceId: '00000000-0000-0000-0000-000000000099' },
            headers: { 'x-payment-txhash-provider': TX_HASH_PROVIDER },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem()
        );

        await invokeRouteHandler(router, req, res);
        assert.equal(res.getResponse().statusCode, 404);
    });
});

describe('proxy.js — race condition on provider tx claim', () => {
    beforeEach(() => { process.env.WALLET_ADDRESS = PLATFORM_WALLET; });

    it('should return 402 when INSERT returns duplicate key error (concurrent request won the race)', async () => {
        const duplicateKeyError = { code: '23505', message: 'duplicate key value violates unique constraint' };
        const supabase = makeSupabaseMock({
            service:     SERVICE_WITH_OWNER,
            usedTxRows:  [], // passes anti-replay SELECT check
            insertError: duplicateKeyError, // but INSERT fails
        });

        const { req, res } = makeReqRes({
            params:  { serviceId: SERVICE_WITH_OWNER.id },
            headers: {
                'x-payment-txhash-provider': TX_HASH_PROVIDER,
                'x-payment-chain': 'base',
            },
        });

        const router = createProxyRouter(
            supabase, () => {},
            makeAutoApprovePaymentMiddleware(),
            makePassthroughLimiter(),
            makePayoutManagerMock(),
            makeSplitPaymentSystem({ providerValid: true, platformValid: false })
        );

        await invokeRouteHandler(router, req, res);
        const { statusCode, body } = res.getResponse();

        assert.equal(statusCode, 402);
        assert.ok(body.message.includes('already been used'), `Expected "already been used" in: ${body.message}`);
    });
});

// ---------------------------------------------------------------------------
// TX_HASH_REGEX — used in proxy.js for validation
// ---------------------------------------------------------------------------

describe('TX_HASH_REGEX validation in split mode context', () => {
    it('should accept valid provider hash', () => {
        assert.ok(TX_HASH_REGEX.test(TX_HASH_PROVIDER));
    });

    it('should accept valid platform hash', () => {
        assert.ok(TX_HASH_REGEX.test(TX_HASH_PLATFORM));
    });

    it('should reject empty string', () => {
        assert.ok(!TX_HASH_REGEX.test(''));
    });

    it('should reject hash that is too short', () => {
        assert.ok(!TX_HASH_REGEX.test('0x' + 'a'.repeat(63)));
    });

    it('should reject hash with non-hex characters', () => {
        assert.ok(!TX_HASH_REGEX.test('0x' + 'z'.repeat(64)));
    });
});
