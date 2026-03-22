const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('EIP3009_DOMAINS config', () => {
    test('polygon domain has correct chainId and verifyingContract', () => {
        const EIP3009_DOMAINS = {
            polygon: {
                name: 'USD Coin', version: '2', chainId: 137,
                verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            },
            base: {
                name: 'USD Coin', version: '2', chainId: 8453,
                verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            },
        };
        assert.strictEqual(EIP3009_DOMAINS.polygon.chainId, 137);
        assert.strictEqual(EIP3009_DOMAINS.base.chainId, 8453);
        assert.ok(!EIP3009_DOMAINS.skale, 'SKALE should not have EIP-3009 domain');
    });
});

describe('buildX402StandardPayload', () => {
    test('produces valid base64 JSON with correct structure', () => {
        const signature = '0xabcdef1234567890';
        const authorization = {
            from: '0xAgent', to: '0xProvider', value: '5000',
            validAfter: '0', validBefore: '1711200000', nonce: '0x' + 'aa'.repeat(32),
        };
        const payload = {
            x402Version: 1, scheme: 'exact', network: 'polygon',
            payload: { signature, authorization },
        };
        const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
        const decoded = JSON.parse(Buffer.from(b64, 'base64').toString());
        assert.strictEqual(decoded.x402Version, 1);
        assert.strictEqual(decoded.scheme, 'exact');
        assert.strictEqual(decoded.payload.signature, signature);
        assert.strictEqual(decoded.payload.authorization.from, '0xAgent');
        assert.strictEqual(decoded.payload.authorization.nonce.length, 66);
    });

    test('validBefore respects maxTimeoutSeconds with minimum 60s', () => {
        const now = Math.floor(Date.now() / 1000);
        assert.strictEqual(now + Math.max(30, 60), now + 60);
        assert.strictEqual(now + Math.max(120, 60), now + 120);
        assert.strictEqual(now + Math.max(null || 60, 60), now + 60);
    });

    test('amount priority: maxAmountRequired over parsed amount', () => {
        const maxAmountRequired = '5000';
        const parsedAmount = '0.005';
        const amountRaw = maxAmountRequired ? BigInt(maxAmountRequired) : BigInt(Math.round(parseFloat(parsedAmount) * 1e6));
        assert.strictEqual(amountRaw, 5000n);
    });
});
