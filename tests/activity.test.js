// tests/activity.test.js — Unit tests for lib/activity.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createActivityLogger } = require('../lib/activity');

// Helper: wait for next microtask tick (fire-and-forget pattern)
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('createActivityLogger', () => {
    it('should be a function', () => {
        assert.equal(typeof createActivityLogger, 'function');
    });

    it('should return a function (logActivity)', () => {
        const fakeSupabase = { from: () => ({ insert: () => ({ then: () => {} }) }) };
        const logActivity = createActivityLogger(fakeSupabase);
        assert.equal(typeof logActivity, 'function');
    });

    it('logActivity should call supabase.from("activity").insert()', async () => {
        let insertedTable = null;
        let insertedData = null;

        const fakeSupabase = {
            from: (table) => {
                insertedTable = table;
                return {
                    insert: (data) => {
                        insertedData = data;
                        return Promise.resolve({});
                    }
                };
            }
        };

        const logActivity = createActivityLogger(fakeSupabase);
        logActivity('payment', 'Test payment', 0.05, '0x' + 'a'.repeat(64));
        await tick();

        assert.equal(insertedTable, 'activity');
        assert.ok(Array.isArray(insertedData));
        assert.equal(insertedData.length, 1);
        assert.equal(insertedData[0].type, 'payment');
        assert.equal(insertedData[0].detail, 'Test payment');
        assert.equal(insertedData[0].amount, 0.05);
        assert.equal(insertedData[0].tx_hash, '0x' + 'a'.repeat(64));
    });

    it('should NOT include tx_hash when txHash is null', async () => {
        let insertedData = null;

        const fakeSupabase = {
            from: () => ({
                insert: (data) => {
                    insertedData = data;
                    return Promise.resolve({});
                }
            })
        };

        const logActivity = createActivityLogger(fakeSupabase);
        logActivity('search', 'Search query', 0);
        await tick();

        assert.equal(insertedData[0].type, 'search');
        assert.equal(insertedData[0].detail, 'Search query');
        assert.equal(insertedData[0].amount, 0);
        assert.ok(!('tx_hash' in insertedData[0]), 'tx_hash should not be present when null');
    });

    it('should include tx_hash when txHash is provided', async () => {
        let insertedData = null;

        const fakeSupabase = {
            from: () => ({
                insert: (data) => {
                    insertedData = data;
                    return Promise.resolve({});
                }
            })
        };

        const logActivity = createActivityLogger(fakeSupabase);
        logActivity('payment', 'Paid', 1, '0xabc123');
        await tick();

        assert.ok('tx_hash' in insertedData[0], 'tx_hash should be present');
        assert.equal(insertedData[0].tx_hash, '0xabc123');
    });

    it('should use default amount of 0 when not provided', async () => {
        let insertedData = null;

        const fakeSupabase = {
            from: () => ({
                insert: (data) => {
                    insertedData = data;
                    return Promise.resolve({});
                }
            })
        };

        const logActivity = createActivityLogger(fakeSupabase);
        logActivity('register', 'New service');
        await tick();

        assert.equal(insertedData[0].amount, 0);
    });

    it('should NOT throw when supabase insert fails synchronously', () => {
        const fakeSupabase = {
            from: () => ({
                insert: () => {
                    // Return a rejected promise (fire-and-forget catches it)
                    return Promise.reject(new Error('Supabase connection failed'));
                }
            })
        };

        const logActivity = createActivityLogger(fakeSupabase);
        // Should not throw synchronously
        assert.doesNotThrow(() => {
            logActivity('test', 'should not throw');
        });
    });

    it('should NOT throw when supabase returns error object', async () => {
        const fakeSupabase = {
            from: () => ({
                insert: () => Promise.reject(new Error('Insert failed'))
            })
        };

        const logActivity = createActivityLogger(fakeSupabase);
        // Should not throw — error is caught by .then(null, handler)
        assert.doesNotThrow(() => {
            logActivity('test', 'should not throw');
        });
        await tick(); // Let the rejection handler run
    });
});
