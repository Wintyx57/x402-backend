// lib/protocolAdapter.js — Universal 402 Protocol Adapter: Layer 1 Normalizer
// Detects 402 payment protocol format and normalizes to a unified object.
'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const USDC_CONTRACTS = new Set([
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // Polygon
]);

const NETWORK_MAP = {
  'base-mainnet': 'base',
  'polygon-mainnet': 'polygon',
  'ethereum-mainnet': 'ethereum',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize headers to lowercase keys.
 */
function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * Safely parse body — ensure it's an object.
 */
function safeBody(body) {
  if (!body || typeof body !== 'object') return {};
  return body;
}

/**
 * Try base64 decode + JSON parse. Returns null on failure.
 */
function tryBase64Json(str) {
  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Map network string to short chain name.
 */
function mapNetwork(network) {
  if (!network) return null;
  return NETWORK_MAP[network] || network;
}

/**
 * Check if asset address is a known USDC contract.
 */
function isUSDC(asset) {
  if (!asset) return false;
  return USDC_CONTRACTS.has(asset.toLowerCase());
}

/**
 * Build empty NormalizedPayment template.
 */
function emptyResult() {
  return {
    format: 'unknown',
    payable: false,
    amount: null,
    currency: null,
    recipient: null,
    chain: null,
    asset: null,
    description: null,
    providerWallet: null,
    paymentMode: null,
    scheme: null,
    mppChallengeId: null,
    mppMethod: null,
    mppRealm: null,
    l402Macaroon: null,
    l402Invoice: null,
    raw: {},
    detectionPath: 'none',
  };
}

/**
 * Parse WWW-Authenticate params: key="value" pairs.
 */
function parseAuthParams(str) {
  const params = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    params[m[1]] = m[2];
  }
  return params;
}

/**
 * Pick best accepts entry — prefer USDC asset.
 */
function pickBestAccept(accepts) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const usdc = accepts.find((a) => a.asset && isUSDC(a.asset));
  return usdc || accepts[0];
}

// ─── Detection Chain ─────────────────────────────────────────────────────────

/**
 * Prio 1: x402-v2 — Payment-Required header base64 JSON with x402Version
 */
function detectX402V2(headers) {
  const pr = headers['payment-required'];
  if (!pr) return null;
  const parsed = tryBase64Json(pr);
  if (!parsed || !parsed.x402Version) return null;

  const result = emptyResult();
  result.format = 'x402-v2';
  result.payable = true;
  result.raw = parsed;

  const accept = pickBestAccept(parsed.accepts);
  if (accept) {
    result.amount = String(accept.maxAmountRequired || accept.amount || '');
    result.recipient = accept.payTo || null;
    result.chain = mapNetwork(accept.network);
    result.scheme = accept.scheme || null;
    result.asset = accept.asset || null;
    result.currency = isUSDC(accept.asset) ? 'USDC' : (accept.currency || null);
    result.description = accept.extra?.description || null;
  }

  // External payable: auto-set split_platform
  result.paymentMode = 'split_platform';
  result.providerWallet = result.recipient;
  result.detectionPath = 'header:payment-required→base64→x402Version';
  return result;
}

/**
 * Prio 2: L402 — WWW-Authenticate starts with "L402"
 */
function detectL402(headers) {
  const auth = headers['www-authenticate'];
  if (!auth || !auth.startsWith('L402')) return null;

  const params = parseAuthParams(auth);
  const result = emptyResult();
  result.format = 'l402';
  result.payable = false;
  result.l402Macaroon = params.macaroon || null;
  result.l402Invoice = params.invoice || null;
  result.raw = params;
  result.detectionPath = 'header:www-authenticate→L402';
  return result;
}

/**
 * Prio 3: MPP — WWW-Authenticate starts with "Payment "
 */
function detectMPP(headers) {
  const auth = headers['www-authenticate'];
  if (!auth || !auth.startsWith('Payment ')) return null;

  const params = parseAuthParams(auth);
  const result = emptyResult();
  result.format = 'mpp';
  result.payable = false;
  result.mppChallengeId = params.challengeId || null;
  result.mppMethod = params.method || null;
  result.mppRealm = params.realm || null;
  result.raw = params;
  result.detectionPath = 'header:www-authenticate→Payment';
  return result;
}

/**
 * Prio 4: stripe402 — Payment-Required header base64 with stripePublishableKey or (price + currency)
 */
function detectStripe402(headers) {
  const pr = headers['payment-required'];
  if (!pr) return null;
  const parsed = tryBase64Json(pr);
  if (!parsed) return null;
  // Skip if x402Version (already handled by prio 1)
  if (parsed.x402Version) return null;

  const isStripe = parsed.stripePublishableKey || (parsed.price != null && parsed.currency);
  if (!isStripe) return null;

  const result = emptyResult();
  result.format = 'stripe402';
  result.payable = false;
  result.amount = String(parsed.price || parsed.amount || '');
  result.currency = parsed.currency || null;
  result.raw = parsed;
  result.detectionPath = 'header:payment-required→base64→stripe';
  return result;
}

/**
 * Prio 5: x402-v1 — Body x402Version + accepts[]
 */
function detectX402V1(body) {
  if (!body.x402Version || !Array.isArray(body.accepts)) return null;

  const result = emptyResult();
  result.format = 'x402-v1';
  result.payable = true;
  result.raw = body;

  const accept = pickBestAccept(body.accepts);
  if (accept) {
    result.amount = String(accept.maxAmountRequired || accept.amount || '');
    result.recipient = accept.payTo || null;
    result.chain = mapNetwork(accept.network);
    result.scheme = accept.scheme || null;
    result.asset = accept.asset || null;
    result.currency = isUSDC(accept.asset) ? 'USDC' : (accept.currency || null);
    result.description = accept.extra?.description || null;
  }

  // External payable: auto-set split_platform
  result.paymentMode = 'split_platform';
  result.providerWallet = result.recipient;
  result.detectionPath = 'body:x402Version+accepts[]';
  return result;
}

/**
 * Prio 5b: x402-variant — Body accepts[] without x402Version (Ozark Capital style)
 * Format: { accepts: [{ address, amount, currency, x402: true, description }] }
 */
function detectX402Variant(body) {
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) return null;
  // Only match if at least one entry has x402:true or looks like a payment entry with address
  const hasX402Entry = body.accepts.some((a) => a.x402 === true || (a.address && a.amount));
  if (!hasX402Entry) return null;

  const result = emptyResult();
  result.format = 'x402-v1';  // treat as x402-v1 variant
  result.payable = true;
  result.raw = body;

  // Pick best entry — prefer USDC currency or USDC asset
  let accept = body.accepts.find((a) => a.asset && isUSDC(a.asset));
  if (!accept) accept = body.accepts.find((a) => (a.currency || '').toUpperCase() === 'USDC');
  if (!accept) accept = body.accepts[0];

  result.amount = String(accept.amount || accept.maxAmountRequired || '');
  result.recipient = accept.address || accept.payTo || null;
  result.chain = mapNetwork(accept.network || accept.chain);
  result.scheme = accept.scheme || 'exact';
  result.asset = accept.asset || null;
  result.currency = accept.currency || (accept.asset && isUSDC(accept.asset) ? 'USDC' : null);
  result.description = accept.description || null;

  // External payable: auto-set split_platform
  if (result.recipient && WALLET_PATTERN.test(result.recipient)) {
    result.paymentMode = 'split_platform';
    result.providerWallet = result.recipient;
  }

  result.detectionPath = 'body:accepts[]';
  return result;
}

/**
 * Prio 6: x402-bazaar — Body payment_details object
 */
function detectX402Bazaar(body) {
  if (!body.payment_details || typeof body.payment_details !== 'object') return null;

  const pd = body.payment_details;
  const result = emptyResult();
  result.format = 'x402-bazaar';
  result.payable = true;
  result.amount = pd.amount != null ? String(pd.amount) : null;
  result.currency = pd.currency || null;
  result.recipient = pd.recipient || null;
  result.chain = pd.chain || null;
  result.asset = pd.asset || null;
  result.description = pd.description || null;
  result.scheme = pd.scheme || null;

  // Preserve original paymentMode and providerWallet
  result.providerWallet = pd.provider_wallet || pd.providerWallet || null;
  result.paymentMode = pd.payment_mode || pd.paymentMode || null;

  result.raw = body;
  result.detectionPath = 'body:payment_details';
  return result;
}

/**
 * Prio 7: l402-protocol — Body offers[] + payment_request_url
 */
function detectL402Protocol(body) {
  if (!Array.isArray(body.offers) || !body.payment_request_url) return null;

  const offer = body.offers[0] || {};
  const result = emptyResult();
  result.format = 'l402-protocol';
  result.payable = false;
  result.amount = offer.amount != null ? String(offer.amount) : null;
  result.currency = offer.currency || null;
  result.raw = body;
  result.detectionPath = 'body:offers[]+payment_request_url';
  return result;
}

/**
 * Prio 8: flat — Body amount + recipient at root
 */
function detectFlat(body) {
  if (body.amount == null || body.recipient == null) return null;

  const recipient = String(body.recipient);
  const isWallet = WALLET_PATTERN.test(recipient);

  const result = emptyResult();
  result.format = 'flat';
  result.payable = isWallet;
  result.amount = String(body.amount);
  result.recipient = recipient;
  result.currency = body.currency || null;
  result.chain = body.chain || null;
  result.description = body.description || null;
  result.raw = body;

  if (isWallet) {
    result.paymentMode = 'split_platform';
    result.providerWallet = recipient;
  }

  result.detectionPath = 'body:amount+recipient';
  return result;
}

/**
 * Prio 9: header-based — x-payment-amount header
 */
function detectHeaderBased(headers) {
  const amount = headers['x-payment-amount'];
  if (!amount) return null;

  const recipient = headers['x-payment-recipient'] || null;
  const isWallet = recipient && WALLET_PATTERN.test(recipient);

  const result = emptyResult();
  result.format = 'header-based';
  result.payable = isWallet;
  result.amount = String(amount);
  result.recipient = recipient;
  result.currency = headers['x-payment-currency'] || null;
  result.chain = headers['x-payment-chain'] || null;
  result.raw = { amount, recipient, currency: result.currency, chain: result.chain };
  result.detectionPath = 'header:x-payment-amount';

  if (isWallet) {
    result.paymentMode = 'split_platform';
    result.providerWallet = recipient;
  }

  return result;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Normalize a 402 response into a unified NormalizedPayment object.
 *
 * @param {number} statusCode - HTTP status code (expected 402)
 * @param {object} responseHeaders - Response headers (case-insensitive)
 * @param {object|string|null} body - Parsed response body
 * @returns {object} NormalizedPayment
 */
function normalize402(statusCode, responseHeaders, body) {
  const headers = normalizeHeaders(responseHeaders);
  const b = safeBody(body);

  // Detection chain — strict priority order
  const detectors = [
    () => detectX402V2(headers),       // Prio 1
    () => detectL402(headers),         // Prio 2
    () => detectMPP(headers),          // Prio 3
    () => detectStripe402(headers),    // Prio 4
    () => detectX402V1(b),             // Prio 5
    () => detectX402Variant(b),        // Prio 5b (Ozark-style accepts[] without x402Version)
    () => detectX402Bazaar(b),         // Prio 6
    () => detectL402Protocol(b),       // Prio 7
    () => detectFlat(b),              // Prio 8
    () => detectHeaderBased(headers),  // Prio 9
  ];

  for (const detect of detectors) {
    try {
      const result = detect();
      if (result) return result;
    } catch {
      // Skip failed detectors — continue chain
    }
  }

  // Prio 10: Nothing matches
  return emptyResult();
}

// ─── Layer 2: Proof Adapter ──────────────────────────────────────────────────

const CHAIN_KEY_MAP = { base: 'base', skale: 'skale', polygon: 'polygon' };

/**
 * Build protocol-native proof headers from a normalized 402 response.
 *
 * @param {object} normalized - Result of normalize402()
 * @param {string|null} txHash - On-chain transaction hash
 * @param {string} chainKey - Chain key (base, skale, polygon)
 * @param {string} agentWallet - Agent wallet address (0x...)
 * @returns {{ headers: object|null, supported: boolean, message: string|null }}
 */
function buildProofHeaders(normalized, txHash, chainKey, agentWallet) {
  // Guard: txHash is required for any proof
  if (!txHash) {
    return { headers: null, supported: false, message: 'Cannot build proof: txHash is required' };
  }

  const format = normalized?.format || 'unknown';
  const chain = CHAIN_KEY_MAP[chainKey] || chainKey;

  switch (format) {
    case 'x402-bazaar':
    case 'flat':
    case 'header-based': {
      return {
        headers: {
          'X-Payment-TxHash': txHash,
          'X-Payment-Chain': chain,
          'X-Agent-Wallet': agentWallet,
        },
        supported: true,
        message: null,
      };
    }

    case 'x402-v1': {
      const payload = {
        x402Version: 1,
        scheme: normalized.scheme || 'exact',
        network: normalized.chain || chain,
        payload: { txHash },
      };
      return {
        headers: {
          'X-PAYMENT': Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        supported: true,
        message: null,
      };
    }

    case 'x402-v2': {
      const payload = {
        txHash,
        chain,
        payer: agentWallet,
      };
      return {
        headers: {
          'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        supported: true,
        message: null,
      };
    }

    case 'mpp': {
      const mppMethod = normalized.mppMethod || 'unknown';
      return {
        headers: null,
        supported: false,
        message: `MPP protocol not supported for auto-proof (method: ${mppMethod})`,
      };
    }

    case 'l402': {
      const invoice = normalized.l402Invoice || 'none';
      return {
        headers: null,
        supported: false,
        message: `L402 requires Lightning payment (invoice: ${invoice})`,
      };
    }

    case 'l402-protocol': {
      return {
        headers: null,
        supported: false,
        message: 'L402-protocol requires multi-step flow (offer selection + payment request)',
      };
    }

    case 'stripe402': {
      return {
        headers: null,
        supported: false,
        message: 'Stripe 402 requires Stripe checkout (not on-chain)',
      };
    }

    default: {
      return {
        headers: null,
        supported: false,
        message: null,
      };
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  normalize402,
  buildProofHeaders,
  WALLET_PATTERN,
  USDC_CONTRACTS,
  NETWORK_MAP,
};
