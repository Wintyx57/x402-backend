/**
 * Test script for the new API wrapper endpoints
 * Tests the 3 new endpoints: weather, crypto, and joke
 *
 * Note: These tests will return 402 Payment Required without a valid transaction hash
 */

const API_BASE = 'http://localhost:3000';

async function testEndpoint(name, url, expectedStatus = 402) {
    console.log(`\nTesting ${name}...`);
    console.log(`URL: ${url}`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        console.log(`Status: ${response.status}`);
        console.log('Response:', JSON.stringify(data, null, 2));

        if (response.status === expectedStatus) {
            console.log(`✓ ${name} test passed`);
        } else {
            console.log(`✗ ${name} test failed: expected status ${expectedStatus}, got ${response.status}`);
        }

        return { success: response.status === expectedStatus, data };
    } catch (error) {
        console.error(`✗ ${name} test failed:`, error.message);
        return { success: false, error: error.message };
    }
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('x402 Bazaar - API Wrapper Tests');
    console.log('='.repeat(60));

    const tests = [
        { name: 'Weather API (with city)', url: `${API_BASE}/api/weather?city=Paris` },
        { name: 'Weather API (no city)', url: `${API_BASE}/api/weather` },
        { name: 'Crypto API (bitcoin)', url: `${API_BASE}/api/crypto?coin=bitcoin` },
        { name: 'Crypto API (ethereum)', url: `${API_BASE}/api/crypto?coin=ethereum` },
        { name: 'Crypto API (no coin)', url: `${API_BASE}/api/crypto` },
        { name: 'Joke API', url: `${API_BASE}/api/joke` },
        { name: 'Discovery route', url: `${API_BASE}/`, expectedStatus: 200 },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = await testEndpoint(test.name, test.url, test.expectedStatus || 402);
        if (result.success) {
            passed++;
        } else {
            failed++;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Tests completed: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));
}

// Run tests
runTests().catch(console.error);
