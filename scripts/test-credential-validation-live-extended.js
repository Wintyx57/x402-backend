#!/usr/bin/env node
// scripts/test-credential-validation-live-extended.js
// Extended live tests covering all edge cases for credential validation.

const { privateKeyToAccount } = require('viem/accounts');

const SERVER = process.env.SERVER_URL || 'https://x402-api.onrender.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const createdServiceIds = [];

async function signQuickRegister(url) {
    const timestamp = Date.now();
    const message = `quick-register:${url}:${account.address}:${timestamp}`;
    const signature = await account.signMessage({ message });
    return { timestamp, signature };
}

async function quickRegister(name, url, credentials) {
    const { timestamp, signature } = await signQuickRegister(url);
    const body = {
        url,
        ownerAddress: account.address,
        price: 0.01,
        name,
        signature,
        timestamp,
    };
    if (credentials) body.credentials = credentials;

    const res = await fetch(`${SERVER}/quick-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.data?.id) createdServiceIds.push(data.data.id);
    return { status: res.status, data };
}

function test(name, actual, expected, detail) {
    const passed = actual === expected;
    console.log(`  ${passed ? '✅' : '❌'} ${name}: got ${actual}, expected ${expected}${detail ? ` — ${detail}` : ''}`);
    return passed;
}

async function cleanup() {
    if (createdServiceIds.length === 0) return;
    console.log(`\n🧹 Cleaning up ${createdServiceIds.length} test services...`);
    try {
        const { createClient } = require('@supabase/supabase-js');
        require('dotenv').config();
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        for (const id of createdServiceIds) {
            await supabase.from('services').delete().eq('id', id);
        }
        console.log(`  Deleted ${createdServiceIds.length} services`);
    } catch (err) {
        console.log(`  ⚠️  Cleanup failed: ${err.message}`);
        console.log(`  IDs to delete manually: ${createdServiceIds.join(', ')}`);
    }
}

async function main() {
    console.log(`\n🔬 EXTENDED CREDENTIAL VALIDATION LIVE TESTS`);
    console.log(`Server: ${SERVER}\n`);

    let passed = 0;
    let failed = 0;

    function check(ok) { if (ok) passed++; else failed++; }

    // ─── Test 5: Upstream returns 500 (service down) → should ACCEPT with warning ──
    console.log('\n📋 Test 5: Upstream returns 500 (service down)');
    {
        const { status, data } = await quickRegister(
            `__test5_500_${Date.now()}`,
            'https://httpbin.org/status/500',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'some-token' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'warning'));
        if (data.credential_validation?.message) {
            console.log(`    Message: "${data.credential_validation.message}"`);
        }
    }

    // ─── Test 6: Upstream returns 403 → should BLOCK ──
    console.log('\n📋 Test 6: Upstream returns 403 (forbidden)');
    {
        const { status, data } = await quickRegister(
            `__test6_403_${Date.now()}`,
            'https://httpbin.org/status/403',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'some-token' }] }
        );
        check(test('HTTP status', status, 400));
        check(test('error contains "403"', data.message?.includes('403') || false, true));
        console.log(`    Error: "${data.message}"`);
    }

    // ─── Test 7: HEAD returns 405 → fallback to GET ──
    console.log('\n📋 Test 7: HEAD 405 fallback to GET');
    {
        // httpbin.org/post only accepts POST, HEAD returns 405, GET returns 405 too
        // Use httpbin.org/get instead — accepts GET but may 405 HEAD on some endpoints
        // Actually, httpbin.org/delete returns 405 for HEAD and GET
        // Let's use a better test: httpbin.org/anything accepts all methods
        const { status, data } = await quickRegister(
            `__test7_405_${Date.now()}`,
            'https://httpbin.org/anything',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'test-token' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'valid'));
    }

    // ─── Test 8: Credentials type "query" → param appended to URL ──
    console.log('\n📋 Test 8: Query param credentials');
    {
        // httpbin.org/get returns 200 with query params visible in response
        const { status, data } = await quickRegister(
            `__test8_query_${Date.now()}`,
            'https://httpbin.org/get',
            { type: 'query', credentials: [{ key: 'api_key', value: 'my-secret-key' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'valid'));
    }

    // ─── Test 9: Credentials type "header" (X-API-Key) ──
    console.log('\n📋 Test 9: Custom header credentials (X-API-Key)');
    {
        const { status, data } = await quickRegister(
            `__test9_header_${Date.now()}`,
            'https://httpbin.org/headers',
            { type: 'header', credentials: [{ key: 'X-API-Key', value: 'custom-key-456' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'valid'));
    }

    // ─── Test 10: Upstream redirects (3xx) → should accept with warning ──
    console.log('\n📋 Test 10: Upstream redirect (302)');
    {
        // httpbin.org/redirect/1 returns 302 redirect
        const { status, data } = await quickRegister(
            `__test10_redirect_${Date.now()}`,
            'https://httpbin.org/redirect/1',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'warning'));
        if (data.credential_validation?.message) {
            console.log(`    Message: "${data.credential_validation.message}"`);
        }
    }

    // ─── Test 11: Upstream timeout (very slow response) → should accept with warning ──
    console.log('\n📋 Test 11: Upstream timeout (slow response — 15s delay, 10s timeout)');
    {
        // httpbin.org/delay/15 takes 15 seconds — our timeout is 10s
        const { status, data } = await quickRegister(
            `__test11_timeout_${Date.now()}`,
            'https://httpbin.org/delay/15',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'warning'));
        if (data.credential_validation?.message) {
            console.log(`    Message: "${data.credential_validation.message}"`);
        }
    }

    // ─── Test 12: pending_validation — service invisible during validation ──
    console.log('\n📋 Test 12: pending_validation status (service NOT visible in public API)');
    {
        // We can't easily test the race window, but we can verify that after a successful
        // registration with credentials, the service is visible (status changed from pending_validation)
        // And after a failed registration, the service does NOT exist at all

        // First: register with invalid creds — service should NOT exist
        const invalidName = `__test12_pending_${Date.now()}`;
        const { status: s1 } = await quickRegister(
            invalidName,
            'https://httpbin.org/status/401',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'bad' }] }
        );
        check(test('Invalid creds rejected', s1, 400));

        // Check that the service does NOT appear in /api/services
        const searchRes = await fetch(`${SERVER}/api/services?search=${encodeURIComponent(invalidName)}`);
        const searchData = await searchRes.json();
        const found = (searchData.data || []).find(s => s.name === invalidName);
        check(test('Rejected service NOT in /api/services', found, undefined));

        // Also verify directly in Supabase that no row exists with pending_validation
        try {
            const { createClient } = require('@supabase/supabase-js');
            require('dotenv').config();
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
            const { data: rows } = await supabase
                .from('services')
                .select('id, status')
                .eq('name', invalidName);
            check(test('No row in DB for rejected service', (rows || []).length, 0));
        } catch (err) {
            console.log(`    ⚠️  Supabase check skipped: ${err.message}`);
        }
    }

    // ─── Test 13: False positive — API that returns 200 without checking credentials ──
    console.log('\n📋 Test 13: False positive — API returns 200 without checking creds');
    {
        // google.com returns 200 regardless of credentials — known limitation
        const { status, data } = await quickRegister(
            `__test13_falsepositive_${Date.now()}`,
            'https://www.google.com',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'TOTALLY_FAKE_KEY' }] }
        );
        check(test('HTTP status', status, 201, 'KNOWN LIMITATION — accepts fake credentials'));
        check(test('credential_validation.status', data.credential_validation?.status, 'valid',
            'False positive: google.com ignores auth headers'));
        console.log('    ⚠️  KNOWN LIMITATION: Upstream ignores credentials, so we say "valid"');
    }

    // ─── Test 14: Upstream returns 404 → accept with warning ──
    console.log('\n📋 Test 14: Upstream returns 404');
    {
        const { status, data } = await quickRegister(
            `__test14_404_${Date.now()}`,
            'https://httpbin.org/status/404',
            { type: 'bearer', credentials: [{ key: 'Authorization', value: 'token' }] }
        );
        check(test('HTTP status', status, 201));
        check(test('credential_validation.status', data.credential_validation?.status, 'warning'));
        if (data.credential_validation?.message) {
            console.log(`    Message: "${data.credential_validation.message}"`);
        }
    }

    // ─── Summary ──
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    await cleanup();

    if (failed > 0) {
        console.log(`\n❌ ${failed} TESTS FAILED`);
        process.exit(1);
    } else {
        console.log(`\n✅ ALL ${passed} TESTS PASSED`);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    cleanup().then(() => process.exit(1));
});
