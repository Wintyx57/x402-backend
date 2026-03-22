// tests/protocolAdapter.test.js — Unit tests for Universal 402 Protocol Adapter normalizer
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalize402, buildProofHeaders } = require('../lib/protocolAdapter');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// ─── 1. x402-bazaar: standard payment_details body ──────────────────────────

describe('normalize402', () => {

  it('1. x402-bazaar: detects payment_details body', () => {
    const body = {
      payment_details: {
        amount: '0.01',
        currency: 'USDC',
        recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
        chain: 'base',
        description: 'Web Search API',
      },
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-bazaar');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.01');
    assert.equal(result.currency, 'USDC');
    assert.equal(result.recipient, '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430');
    assert.equal(result.chain, 'base');
    assert.equal(result.description, 'Web Search API');
    assert.equal(result.detectionPath, 'body:payment_details');
  });

  // ─── 2. x402-bazaar split: preserves provider_wallet + payment_mode ──────

  it('2. x402-bazaar split: preserves provider_wallet and payment_mode', () => {
    const body = {
      payment_details: {
        amount: '0.05',
        currency: 'USDC',
        recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
        chain: 'base',
        provider_wallet: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        payment_mode: 'split_native',
      },
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-bazaar');
    assert.equal(result.providerWallet, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(result.paymentMode, 'split_native');
  });

  // ─── 3. x402-v1: x402Version + accepts[] ────────────────────────────────

  it('3. x402-v1: detects x402Version + accepts[] in body', () => {
    const body = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base-mainnet',
          maxAmountRequired: '50000',
          resource: 'https://example.com/api',
          payTo: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          extra: { description: 'Premium API' },
        },
      ],
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-v1');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '50000');
    assert.equal(result.recipient, '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    assert.equal(result.chain, 'base');
    assert.equal(result.scheme, 'exact');
    assert.equal(result.asset, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    assert.equal(result.paymentMode, 'split_platform');
    assert.equal(result.providerWallet, '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    assert.equal(result.detectionPath, 'body:x402Version+accepts[]');
  });

  // ─── 4. x402-v1 multi-accepts: picks USDC entry ─────────────────────────

  it('4. x402-v1 multi-accepts: picks USDC entry over non-USDC', () => {
    const body = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base-mainnet',
          maxAmountRequired: '100',
          payTo: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
          asset: '0x0000000000000000000000000000000000000001', // not USDC
        },
        {
          scheme: 'exact',
          network: 'base-mainnet',
          maxAmountRequired: '200',
          payTo: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC Base
        },
      ],
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-v1');
    assert.equal(result.amount, '200');
    assert.equal(result.recipient, '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
    assert.equal(result.asset, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  // ─── 5. x402-v2: PAYMENT-REQUIRED header base64 ─────────────────────────

  it('5. x402-v2: detects base64 Payment-Required header with x402Version', () => {
    const payload = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'base-mainnet',
          maxAmountRequired: '75000',
          payTo: '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
      ],
    };
    const headers = { 'Payment-Required': b64(payload) };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'x402-v2');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '75000');
    assert.equal(result.recipient, '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
    assert.equal(result.paymentMode, 'split_platform');
    assert.equal(result.detectionPath, 'header:payment-required→base64→x402Version');
  });

  // ─── 6. x402-v2 corrupted base64: fallback to body ──────────────────────

  it('6. x402-v2 corrupted base64: falls back to body detection', () => {
    const headers = { 'Payment-Required': '!!!not-base64!!!' };
    const body = {
      payment_details: {
        amount: '0.02',
        currency: 'USDC',
        recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
        chain: 'base',
      },
    };
    const result = normalize402(402, headers, body);
    assert.equal(result.format, 'x402-bazaar');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.02');
  });

  // ─── 7. MPP: WWW-Authenticate: Payment ──────────────────────────────────

  it('7. MPP: detects WWW-Authenticate: Payment header', () => {
    const headers = {
      'WWW-Authenticate': 'Payment realm="api.example.com", method="usdc", challengeId="abc123"',
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'mpp');
    assert.equal(result.payable, false);
    assert.equal(result.mppChallengeId, 'abc123');
    assert.equal(result.mppMethod, 'usdc');
    assert.equal(result.mppRealm, 'api.example.com');
    assert.equal(result.detectionPath, 'header:www-authenticate→Payment');
  });

  // ─── 8. L402: WWW-Authenticate: L402 ────────────────────────────────────

  it('8. L402: detects WWW-Authenticate: L402 header', () => {
    const headers = {
      'WWW-Authenticate': 'L402 macaroon="abc123macaroon", invoice="lnbc1pvjluezpp5qqqsyq"',
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'l402');
    assert.equal(result.payable, false);
    assert.equal(result.l402Macaroon, 'abc123macaroon');
    assert.equal(result.l402Invoice, 'lnbc1pvjluezpp5qqqsyq');
    assert.equal(result.detectionPath, 'header:www-authenticate→L402');
  });

  // ─── 9. l402-protocol: offers[] + payment_request_url ───────────────────

  it('9. l402-protocol: detects offers[] + payment_request_url', () => {
    const body = {
      offers: [
        { id: 'offer-1', amount: 100, currency: 'sats' },
      ],
      payment_request_url: 'https://pay.example.com/request',
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'l402-protocol');
    assert.equal(result.payable, false);
    assert.equal(result.amount, '100');
    assert.equal(result.currency, 'sats');
    assert.equal(result.detectionPath, 'body:offers[]+payment_request_url');
  });

  // ─── 10. stripe402: Payment-Required with stripePublishableKey ──────────

  it('10. stripe402: detects Payment-Required header with stripePublishableKey', () => {
    const payload = { stripePublishableKey: 'pk_live_xxx', price: 500, currency: 'usd' };
    const headers = { 'Payment-Required': b64(payload) };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'stripe402');
    assert.equal(result.payable, false);
    assert.equal(result.amount, '500');
    assert.equal(result.currency, 'usd');
    assert.equal(result.detectionPath, 'header:payment-required→base64→stripe');
  });

  // ─── 11. flat with wallet recipient → payable ──────────────────────────

  it('11. flat: detects amount + wallet recipient → payable', () => {
    const body = {
      amount: '0.10',
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'flat');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.10');
    assert.equal(result.recipient, '0x1234567890abcdef1234567890abcdef12345678');
    assert.equal(result.paymentMode, 'split_platform');
    assert.equal(result.providerWallet, '0x1234567890abcdef1234567890abcdef12345678');
    assert.equal(result.detectionPath, 'body:amount+recipient');
  });

  // ─── 12. flat with email recipient → not payable ────────────────────────

  it('12. flat: email recipient → payable false', () => {
    const body = {
      amount: '5.00',
      recipient: 'user@example.com',
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'flat');
    assert.equal(result.payable, false);
    assert.equal(result.recipient, 'user@example.com');
    assert.equal(result.paymentMode, null);
  });

  // ─── 13. header-based: x-payment-amount + x-payment-recipient ──────────

  it('13. header-based: x-payment-amount + x-payment-recipient → payable', () => {
    const headers = {
      'X-Payment-Amount': '0.25',
      'X-Payment-Recipient': '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'header-based');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.25');
    assert.equal(result.recipient, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(result.paymentMode, 'split_platform');
    assert.equal(result.detectionPath, 'header:x-payment-amount');
  });

  // ─── 14. unknown: random body ───────────────────────────────────────────

  it('14. unknown: random body → format unknown', () => {
    const body = { foo: 'bar', baz: 42 };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'unknown');
    assert.equal(result.payable, false);
    assert.equal(result.detectionPath, 'none');
  });

  // ─── 15. empty/null body → no crash ─────────────────────────────────────

  it('15. empty/null body → no crash, returns unknown', () => {
    const r1 = normalize402(402, {}, null);
    assert.equal(r1.format, 'unknown');
    assert.equal(r1.payable, false);

    const r2 = normalize402(402, null, undefined);
    assert.equal(r2.format, 'unknown');
    assert.equal(r2.payable, false);

    const r3 = normalize402(402, {}, '');
    assert.equal(r3.format, 'unknown');
    assert.equal(r3.payable, false);
  });

  // ─── 16. case-insensitive headers ───────────────────────────────────────

  it('16. case-insensitive headers', () => {
    const payload = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'base-mainnet',
          maxAmountRequired: '999',
          payTo: '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
          asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
      ],
    };
    // Mixed case header keys
    const headers = {
      'PAYMENT-REQUIRED': b64(payload),
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'x402-v2');
    assert.equal(result.amount, '999');
    assert.equal(result.recipient, '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  });

  // ─── 17. x402-variant: Ozark Capital style (accepts[] without x402Version) ──

  it('17. x402-variant (Ozark): accepts[] with address + amount + x402:true', () => {
    const body = {
      accepts: [{
        address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        amount: '0.005',
        currency: 'USDC',
        description: 'Ozark Capital data: /signal/btc required',
        x402: true,
      }],
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-v1');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.005');
    assert.equal(result.recipient, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(result.currency, 'USDC');
    assert.equal(result.paymentMode, 'split_platform');
    assert.equal(result.providerWallet, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(result.detectionPath, 'body:accepts[]');
  });

  it('18. x402-variant: accepts[] with address but no x402 flag still detected', () => {
    const body = {
      accepts: [{
        address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '0.01',
      }],
    };
    const result = normalize402(402, {}, body);
    assert.equal(result.format, 'x402-v1');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '0.01');
  });

});

// ─── buildProofHeaders ──────────────────────────────────────────────────────

describe('buildProofHeaders', () => {

  const TX = '0xabc123def456';
  const WALLET = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('17. x402-bazaar: returns X-Payment-TxHash, X-Payment-Chain, X-Agent-Wallet', () => {
    const normalized = { format: 'x402-bazaar' };
    const result = buildProofHeaders(normalized, TX, 'base', WALLET);
    assert.equal(result.supported, true);
    assert.equal(result.message, null);
    assert.equal(result.headers['X-Payment-TxHash'], TX);
    assert.equal(result.headers['X-Payment-Chain'], 'base');
    assert.equal(result.headers['X-Agent-Wallet'], WALLET);
  });

  it('18. x402-v1: returns X-PAYMENT base64 JSON with x402Version:1 and payload.txHash', () => {
    const normalized = { format: 'x402-v1', scheme: 'exact', chain: 'base' };
    const result = buildProofHeaders(normalized, TX, 'base', WALLET);
    assert.equal(result.supported, true);
    assert.equal(result.message, null);
    assert.ok(result.headers['X-PAYMENT']);
    const decoded = JSON.parse(Buffer.from(result.headers['X-PAYMENT'], 'base64').toString('utf-8'));
    assert.equal(decoded.x402Version, 1);
    assert.equal(decoded.payload.txHash, TX);
    assert.equal(decoded.scheme, 'exact');
  });

  it('19. x402-v2: returns PAYMENT-SIGNATURE header', () => {
    const normalized = { format: 'x402-v2' };
    const result = buildProofHeaders(normalized, TX, 'skale', WALLET);
    assert.equal(result.supported, true);
    assert.ok(result.headers['PAYMENT-SIGNATURE']);
    const decoded = JSON.parse(Buffer.from(result.headers['PAYMENT-SIGNATURE'], 'base64').toString('utf-8'));
    assert.equal(decoded.txHash, TX);
    assert.equal(decoded.chain, 'skale');
    assert.equal(decoded.payer, WALLET);
  });

  it('20. flat: same headers as x402-bazaar (fallback)', () => {
    const normalized = { format: 'flat' };
    const result = buildProofHeaders(normalized, TX, 'polygon', WALLET);
    assert.equal(result.supported, true);
    assert.equal(result.headers['X-Payment-TxHash'], TX);
    assert.equal(result.headers['X-Payment-Chain'], 'polygon');
    assert.equal(result.headers['X-Agent-Wallet'], WALLET);
  });

  it('21. mpp: supported=false, message includes "MPP"', () => {
    const normalized = { format: 'mpp', mppMethod: 'usdc' };
    const result = buildProofHeaders(normalized, TX, 'base', WALLET);
    assert.equal(result.supported, false);
    assert.equal(result.headers, null);
    assert.ok(result.message.includes('MPP'));
    assert.ok(result.message.includes('usdc'));
  });

  it('22. l402: supported=false, message includes invoice string', () => {
    const normalized = { format: 'l402', l402Invoice: 'lnbc1pvjluezpp5qqqsyq' };
    const result = buildProofHeaders(normalized, TX, 'base', WALLET);
    assert.equal(result.supported, false);
    assert.equal(result.headers, null);
    assert.ok(result.message.includes('L402'));
    assert.ok(result.message.includes('lnbc1pvjluezpp5qqqsyq'));
  });

  it('23. unknown: supported=false', () => {
    const normalized = { format: 'unknown' };
    const result = buildProofHeaders(normalized, TX, 'base', WALLET);
    assert.equal(result.supported, false);
    assert.equal(result.headers, null);
  });

  it('24. null txHash: supported=false, message includes "txHash"', () => {
    const normalized = { format: 'x402-bazaar' };
    const result = buildProofHeaders(normalized, null, 'base', WALLET);
    assert.equal(result.supported, false);
    assert.equal(result.headers, null);
    assert.ok(result.message.includes('txHash'));
  });

});
