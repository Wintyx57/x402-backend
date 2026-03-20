#!/usr/bin/env node
// scripts/test-credential-validation-live.js
// Live test of credential validation at registration against the deployed backend.
// Tests 3 scenarios: valid credentials, invalid credentials, unreachable upstream.

const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { skaleEuropa } = require('viem/chains');

const SERVER = process.env.SERVER_URL || 'https://x402-api.onrender.com';

// Use a throwaway test wallet (no real funds needed for quick-register)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat #0
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

async function signQuickRegister(url, ownerAddress) {
    const timestamp = Date.now();
    const message = `quick-register:${url}:${ownerAddress}:${timestamp}`;
    const signature = await account.signMessage({ message });
    return { timestamp, signature };
}

async function testScenario(name, body, expectStatus) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${name}`);
    console.log(`Expected: HTTP ${expectStatus}`);
    console.log('='.repeat(60));

    try {
        const res = await fetch(`${SERVER}/quick-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        const passed = res.status === expectStatus;

        console.log(`Status: ${res.status} ${passed ? '✅' : '❌ FAIL'}`);

        if (data.credential_validation) {
            console.log(`Credential validation: ${JSON.stringify(data.credential_validation)}`);
        }
        if (data.error) {
            console.log(`Error: ${data.error}`);
            if (data.message) console.log(`Message: ${data.message}`);
        }
        if (data.success) {
            console.log(`Service registered: ${data.data?.name} (${data.data?.id?.slice(0, 8)}...)`);
        }

        // If service was created, clean it up (delete via Supabase would need admin access)
        // For now, just note the ID for manual cleanup
        if (data.data?.id) {
            console.log(`⚠️  Service ID created: ${data.data.id} (may need manual cleanup)`);
        }

        return { passed, status: res.status, data };
    } catch (err) {
        console.log(`❌ NETWORK ERROR: ${err.message}`);
        return { passed: false, error: err.message };
    }
}

async function main() {
    console.log(`\n🔬 CREDENTIAL VALIDATION LIVE TEST`);
    console.log(`Server: ${SERVER}`);
    console.log(`Wallet: ${account.address}`);

    const results = [];

    // ─── Scenario 1: Valid credentials (httpbin.org accepts any Bearer token) ──
    {
        const url = 'https://httpbin.org/get';
        const { timestamp, signature } = await signQuickRegister(url, account.address);
        const result = await testScenario(
            'Valid credentials (httpbin.org — accepts any auth)',
            {
                url,
                ownerAddress: account.address,
                price: 0.01,
                name: `__test_valid_creds_${Date.now()}`,
                signature,
                timestamp,
                credentials: {
                    type: 'bearer',
                    credentials: [{ key: 'Authorization', value: 'test-valid-token-123' }],
                },
            },
            201
        );
        results.push({ name: 'Valid credentials', ...result });
    }

    // ─── Scenario 2: Invalid credentials (httpbin.org/basic-auth requires specific creds) ──
    {
        // httpbin.org/basic-auth/user/pass returns 401 unless correct basic auth is provided
        const url = 'https://httpbin.org/basic-auth/user/correctpassword';
        const { timestamp, signature } = await signQuickRegister(url, account.address);
        const result = await testScenario(
            'Invalid credentials (httpbin basic-auth — wrong password)',
            {
                url,
                ownerAddress: account.address,
                price: 0.01,
                name: `__test_invalid_creds_${Date.now()}`,
                signature,
                timestamp,
                credentials: {
                    type: 'basic',
                    credentials: [{ key: 'credentials', value: 'user:wrongpassword' }],
                },
            },
            400
        );
        results.push({ name: 'Invalid credentials', ...result });
    }

    // ─── Scenario 3: Unreachable upstream ──
    {
        const url = 'https://this-domain-definitely-does-not-exist-xyz123.invalid/api';
        const { timestamp, signature } = await signQuickRegister(url, account.address);
        const result = await testScenario(
            'Unreachable upstream (DNS failure)',
            {
                url,
                ownerAddress: account.address,
                price: 0.01,
                name: `__test_unreachable_${Date.now()}`,
                signature,
                timestamp,
                credentials: {
                    type: 'bearer',
                    credentials: [{ key: 'Authorization', value: 'some-token' }],
                },
            },
            400 // safeUrl will reject unresolvable hostnames before credential validation
        );
        results.push({ name: 'Unreachable upstream', ...result });
    }

    // ─── Scenario 4: No credentials (should register normally, no validation) ──
    {
        const url = 'https://httpbin.org/status/200';
        const { timestamp, signature } = await signQuickRegister(url, account.address);
        const result = await testScenario(
            'No credentials (should skip validation)',
            {
                url,
                ownerAddress: account.address,
                price: 0.01,
                name: `__test_no_creds_${Date.now()}`,
                signature,
                timestamp,
                // No credentials field
            },
            201
        );
        results.push({ name: 'No credentials', ...result });
    }

    // ─── Summary ──
    console.log(`\n${'='.repeat(60)}`);
    console.log('SUMMARY');
    console.log('='.repeat(60));
    let allPassed = true;
    for (const r of results) {
        const icon = r.passed ? '✅' : '❌';
        console.log(`  ${icon} ${r.name}: HTTP ${r.status}`);
        if (!r.passed) allPassed = false;
    }
    console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
