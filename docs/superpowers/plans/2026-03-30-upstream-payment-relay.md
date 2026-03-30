# Universal Upstream Payment Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a proxied service has its own payment wall upstream, the proxy pays automatically via a relay wallet, retries with proof headers, and returns real data — transparent to the agent.

**Architecture:** New `lib/upstreamPayer.js` handles USDC payments via viem + `RELAY_PRIVATE_KEY`. `proxy.js` replaces the 502 block with a pay→retry flow. `protocolAdapter.js` extends MPP detection to parse `request` base64. Services with payable upstream protocols use forced legacy mode (100% to platform) so the relay wallet can be reimbursed. Provider payouts are recorded via existing `payoutManager.recordPayout()` with upstream cost deducted.

**Tech Stack:** Node.js, viem, Express, Supabase (existing `pending_payouts` table)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/upstreamPayer.js` | **CREATE** | Pay upstream USDC via relay wallet, nonce manager, balance check |
| `lib/protocolAdapter.js` | **MODIFY** | Extend `detectMPP()` to parse `request` base64 → payable if chain supported |
| `routes/proxy.js` | **MODIFY** | Force legacy mode for relay services + pay→retry flow on upstream 402 |
| `routes/register.js` | **MODIFY** | Price warning when service price < upstream cost |
| `lib/monitor.js` | **MODIFY** | Relay wallet balance monitoring + Telegram alert |
| `tests/upstreamPayer.test.js` | **CREATE** | Unit tests for upstreamPayer |

---

### Task 1: Create `lib/upstreamPayer.js` — Relay Wallet Payment Module

**Files:**
- Create: `lib/upstreamPayer.js`
- Create: `tests/upstreamPayer.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/upstreamPayer.test.js
const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('upstreamPayer', () => {
  describe('isRelayConfigured', () => {
    it('should return false when RELAY_PRIVATE_KEY is not set', () => {
      delete process.env.RELAY_PRIVATE_KEY;
      // Clear require cache to re-evaluate
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { isRelayConfigured } = require('../lib/upstreamPayer');
      assert.equal(isRelayConfigured(), false);
    });

    it('should return true when RELAY_PRIVATE_KEY is set', () => {
      process.env.RELAY_PRIVATE_KEY = '0x' + 'ab'.repeat(32);
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { isRelayConfigured } = require('../lib/upstreamPayer');
      assert.equal(isRelayConfigured(), true);
      delete process.env.RELAY_PRIVATE_KEY;
    });
  });

  describe('canPayUpstream', () => {
    it('should return true for x402-v2 on base', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'x402-v2',
        payable: true,
        amount: '10000',
        recipient: '0x' + 'ab'.repeat(20),
        chain: 'base',
      };
      assert.equal(canPayUpstream(normalized), true);
    });

    it('should return false for l402 (Lightning)', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'l402',
        payable: false,
        amount: null,
        recipient: null,
        chain: null,
      };
      assert.equal(canPayUpstream(normalized), false);
    });

    it('should return false for amount > MAX_UPSTREAM_COST', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'x402-v2',
        payable: true,
        amount: '2000000', // $2 > $1 cap
        recipient: '0x' + 'ab'.repeat(20),
        chain: 'base',
      };
      assert.equal(canPayUpstream(normalized), false);
    });

    it('should return false for invalid recipient', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'x402-v2',
        payable: true,
        amount: '10000',
        recipient: 'not-a-wallet',
        chain: 'base',
      };
      assert.equal(canPayUpstream(normalized), false);
    });

    it('should return false for unsupported chain', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'x402-v2',
        payable: true,
        amount: '10000',
        recipient: '0x' + 'ab'.repeat(20),
        chain: 'arbitrum',
      };
      assert.equal(canPayUpstream(normalized), false);
    });

    it('should return true for polygon', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'flat',
        payable: true,
        amount: '50000',
        recipient: '0x' + 'cd'.repeat(20),
        chain: 'polygon',
      };
      assert.equal(canPayUpstream(normalized), true);
    });

    it('should return true for skale', () => {
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { canPayUpstream } = require('../lib/upstreamPayer');
      const normalized = {
        format: 'x402-bazaar',
        payable: true,
        amount: '5000',
        recipient: '0x' + 'ef'.repeat(20),
        chain: 'skale',
      };
      assert.equal(canPayUpstream(normalized), true);
    });
  });

  describe('getRelayAddress', () => {
    it('should return null when not configured', () => {
      delete process.env.RELAY_PRIVATE_KEY;
      delete require.cache[require.resolve('../lib/upstreamPayer')];
      const { getRelayAddress } = require('../lib/upstreamPayer');
      assert.equal(getRelayAddress(), null);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && node --test tests/upstreamPayer.test.js`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement `lib/upstreamPayer.js`**

```javascript
// lib/upstreamPayer.js — Universal Upstream Payment Relay
'use strict';

const { createPublicClient, createWalletClient, http, parseAbi } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base, polygon } = require('viem/chains');
const logger = require('./logger');
const { CHAINS } = require('./chains');

// Max upstream cost: $1.00 USDC (1,000,000 raw units with 6 decimals)
const MAX_UPSTREAM_COST = 1_000_000;

const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const SUPPORTED_RELAY_CHAINS = new Set(['base', 'polygon', 'skale']);

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

// Viem chain definitions
const VIEM_CHAINS = {
  base: base,
  polygon: polygon,
  skale: {
    id: 1187947933,
    name: 'SKALE on Base',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: { default: { http: [CHAINS.skale.rpcUrl] } },
  },
};

// Lazy-initialized clients (per chain)
const _clients = {};
let _account = null;

function _getAccount() {
  if (_account) return _account;
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) return null;
  _account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  return _account;
}

function _getClients(chainKey) {
  if (_clients[chainKey]) return _clients[chainKey];
  const account = _getAccount();
  if (!account) return null;

  const chainCfg = CHAINS[chainKey];
  if (!chainCfg) return null;

  const viemChain = VIEM_CHAINS[chainKey];
  if (!viemChain) return null;

  const transport = http(chainCfg.rpcUrl);
  const publicClient = createPublicClient({ chain: viemChain, transport });
  const walletClient = createWalletClient({ account, chain: viemChain, transport });

  _clients[chainKey] = { publicClient, walletClient, usdcContract: chainCfg.usdcContract };
  return _clients[chainKey];
}

// Nonce mutex per chain — prevents concurrent TX nonce collisions
const _nonceLocks = {};

function _acquireLock(chainKey) {
  if (!_nonceLocks[chainKey]) {
    _nonceLocks[chainKey] = Promise.resolve();
  }
  let release;
  const prev = _nonceLocks[chainKey];
  _nonceLocks[chainKey] = new Promise(r => { release = r; });
  return prev.then(() => release);
}

/**
 * Check if the relay wallet is configured.
 */
function isRelayConfigured() {
  return !!process.env.RELAY_PRIVATE_KEY;
}

/**
 * Get the relay wallet address (or null if not configured).
 */
function getRelayAddress() {
  const account = _getAccount();
  return account ? account.address : null;
}

/**
 * Check if we can pay upstream for a given normalized 402 response.
 *
 * @param {object} normalized - Result of normalize402()
 * @returns {boolean}
 */
function canPayUpstream(normalized) {
  if (!normalized.payable) return false;
  if (!normalized.amount || !normalized.recipient) return false;
  if (!WALLET_PATTERN.test(normalized.recipient)) return false;
  if (!normalized.chain || !SUPPORTED_RELAY_CHAINS.has(normalized.chain)) return false;
  if (Number(normalized.amount) > MAX_UPSTREAM_COST) return false;
  return true;
}

/**
 * Pay upstream via USDC transfer from the relay wallet.
 *
 * @param {object} normalized - Result of normalize402()
 * @returns {Promise<{ success: boolean, txHash?: string, chain?: string, amount?: string, error?: string }>}
 */
async function payUpstream(normalized) {
  if (!isRelayConfigured()) {
    return { success: false, error: 'Relay wallet not configured' };
  }

  if (!canPayUpstream(normalized)) {
    return { success: false, error: `Cannot pay upstream: format=${normalized.format}, chain=${normalized.chain}, amount=${normalized.amount}` };
  }

  const chainKey = normalized.chain;
  const clients = _getClients(chainKey);
  if (!clients) {
    return { success: false, error: `No client for chain ${chainKey}` };
  }

  const amount = BigInt(normalized.amount);
  const recipient = normalized.recipient;

  // Acquire nonce lock for this chain
  const release = await _acquireLock(chainKey);

  try {
    // Check balance first
    const balance = await clients.publicClient.readContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [_getAccount().address],
    });

    if (balance < amount) {
      return { success: false, error: `Insufficient relay balance on ${chainKey}: ${balance.toString()} < ${amount.toString()}` };
    }

    // Send USDC transfer
    const txHash = await clients.walletClient.writeContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient, amount],
    });

    // Wait for receipt
    const receipt = await clients.publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: chainKey === 'skale' ? 0 : chainKey === 'polygon' ? 5 : 2,
      timeout: 30_000,
    });

    if (receipt.status !== 'success') {
      return { success: false, error: `TX reverted: ${txHash}` };
    }

    logger.info('UpstreamPayer', `Paid upstream ${Number(amount) / 1e6} USDC to ${recipient.slice(0, 10)}... on ${chainKey} (tx: ${txHash.slice(0, 18)}...)`);

    return {
      success: true,
      txHash,
      chain: chainKey,
      amount: normalized.amount,
    };
  } catch (err) {
    logger.error('UpstreamPayer', `Failed to pay upstream on ${chainKey}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    release();
  }
}

/**
 * Get relay wallet USDC balance on a specific chain.
 *
 * @param {string} chainKey - 'base', 'polygon', or 'skale'
 * @returns {Promise<{ balance: number, address: string } | null>}
 */
async function getRelayBalance(chainKey) {
  const clients = _getClients(chainKey);
  if (!clients) return null;

  try {
    const raw = await clients.publicClient.readContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [_getAccount().address],
    });
    return {
      balance: Number(raw) / 1e6,
      address: _getAccount().address,
    };
  } catch {
    return null;
  }
}

module.exports = {
  isRelayConfigured,
  getRelayAddress,
  canPayUpstream,
  payUpstream,
  getRelayBalance,
  MAX_UPSTREAM_COST,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && node --test tests/upstreamPayer.test.js`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add lib/upstreamPayer.js tests/upstreamPayer.test.js
git commit -m "feat: add upstreamPayer.js — relay wallet payment module for upstream APIs"
```

---

### Task 2: Extend `detectMPP()` in protocolAdapter.js — Parse MPP request base64

**Files:**
- Modify: `lib/protocolAdapter.js:190-205`
- Test: `tests/protocolSniffer.test.js`

- [ ] **Step 1: Write failing test for MPP with supported chain**

Add to `tests/protocolSniffer.test.js`:

```javascript
describe('MPP request base64 parsing', () => {
  it('should mark MPP payable when chainId is supported and currency is USDC', () => {
    const { normalize402 } = require('../lib/protocolAdapter');

    const request = Buffer.from(JSON.stringify({
      amount: '10000',
      currency: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      methodDetails: { chainId: 8453 },
      recipient: '0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb',
    })).toString('base64');

    const headers = {
      'www-authenticate': `Payment id="abc", realm="test.com", method="tempo", intent="charge", request="${request}"`,
    };

    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'mpp');
    assert.equal(result.payable, true);
    assert.equal(result.amount, '10000');
    assert.equal(result.recipient, '0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb');
    assert.equal(result.chain, 'base');
  });

  it('should keep MPP not payable when chainId is unsupported', () => {
    const { normalize402 } = require('../lib/protocolAdapter');

    const request = Buffer.from(JSON.stringify({
      amount: '10000',
      currency: '0x20C000000000000000000000b9537d11c60E8b50',
      methodDetails: { chainId: 4217 },
      recipient: '0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb',
    })).toString('base64');

    const headers = {
      'www-authenticate': `Payment id="abc", realm="test.com", method="tempo", intent="charge", request="${request}"`,
    };

    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'mpp');
    assert.equal(result.payable, false);
  });

  it('should keep MPP not payable when no request param', () => {
    const { normalize402 } = require('../lib/protocolAdapter');
    const headers = {
      'www-authenticate': 'Payment id="abc", realm="test.com", method="tempo"',
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, 'mpp');
    assert.equal(result.payable, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && node --test tests/protocolSniffer.test.js`
Expected: First test FAILS (payable is false, expected true)

- [ ] **Step 3: Extend `detectMPP()` in protocolAdapter.js**

In `lib/protocolAdapter.js`, replace the `detectMPP` function (lines 190-205):

```javascript
/**
 * Prio 3: MPP — WWW-Authenticate starts with "Payment "
 */
function detectMPP(headers) {
  const auth = headers['www-authenticate'];
  if (!auth || !auth.startsWith('Payment ')) return null;

  const params = parseAuthParams(auth);
  const result = emptyResult();
  result.format = 'mpp';
  result.mppChallengeId = params.challengeId || params.id || null;
  result.mppMethod = params.method || null;
  result.mppRealm = params.realm || null;
  result.raw = params;
  result.protocolType = 'direct';
  result.detectionPath = 'header:www-authenticate→Payment';

  // Try to parse the request base64 to extract payment details
  if (params.request) {
    try {
      const decoded = JSON.parse(Buffer.from(params.request, 'base64').toString('utf-8'));
      if (decoded.amount) result.amount = String(decoded.amount);
      if (decoded.recipient && WALLET_PATTERN.test(decoded.recipient)) {
        result.recipient = decoded.recipient;
      }
      // Map chainId to supported chain
      if (decoded.methodDetails?.chainId) {
        const chainId = decoded.methodDetails.chainId;
        const CHAINID_MAP = { 8453: 'base', 137: 'polygon', 1187947933: 'skale' };
        if (CHAINID_MAP[chainId]) {
          result.chain = CHAINID_MAP[chainId];
        }
      }
      // Check if currency is a known USDC contract
      if (decoded.currency && isUSDC(decoded.currency)) {
        result.asset = decoded.currency;
        result.currency = 'USDC';
      }
      // Mark payable if we have amount + recipient + supported chain + USDC
      if (result.amount && result.recipient && result.chain && result.currency === 'USDC') {
        result.payable = true;
        result.paymentMode = 'split_platform';
        result.providerWallet = result.recipient;
      }
    } catch { /* request parsing is best-effort */ }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && node --test tests/protocolSniffer.test.js`
Expected: All tests PASS (including new MPP tests)

- [ ] **Step 5: Run full test suite**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add lib/protocolAdapter.js tests/protocolSniffer.test.js
git commit -m "feat: extend MPP detection — parse request base64 for payable upstream (chainId + USDC)"
```

---

### Task 3: Force Legacy Mode for Relay-Eligible Services in proxy.js

**Files:**
- Modify: `routes/proxy.js:254-301` (402 response generation)

- [ ] **Step 1: Add imports at top of proxy.js**

After existing imports, add:

```javascript
const { isRelayConfigured, canPayUpstream, payUpstream, getRelayAddress } = require("../lib/upstreamPayer");
const { buildUniversalProofHeaders } = require("../lib/protocolAdapter");
```

- [ ] **Step 2: Add relay-eligible check helper**

After the `UNPAYABLE_PROTOCOLS` set (around line 127), add:

```javascript
    // Protocols where our relay can pay upstream automatically
    const RELAY_PAYABLE_PROTOCOLS = new Set([
      "x402-v2", "x402-v1", "x402-bazaar", "x402-variant", "flat", "header-based", "mpp",
    ]);
    const isRelayEligible = service.payment_protocol
      && RELAY_PAYABLE_PROTOCOLS.has(service.payment_protocol)
      && isRelayConfigured();
```

- [ ] **Step 3: Replace UNPAYABLE_PROTOCOLS block**

Replace the current `UNPAYABLE_PROTOCOLS` check block with relay-aware logic:

```javascript
    // --- PROTOCOL SNIFFER: handle upstream payment protocols BEFORE payment ---
    const UNPAYABLE_PROTOCOLS = new Set(["l402", "l402-protocol", "stripe402"]);
    const RELAY_PAYABLE_PROTOCOLS = new Set([
      "x402-v2", "x402-v1", "x402-bazaar", "x402-variant", "flat", "header-based", "mpp",
    ]);
    const isRelayEligible = service.payment_protocol
      && RELAY_PAYABLE_PROTOCOLS.has(service.payment_protocol)
      && isRelayConfigured();

    // Block truly unpayable protocols
    if (service.payment_protocol && UNPAYABLE_PROTOCOLS.has(service.payment_protocol)) {
      logger.warn(
        "Proxy",
        `Blocked call to "${service.name}" — upstream uses unpayable protocol: ${service.payment_protocol}`,
        { correlationId: req.correlationId },
      );
      return res.status(502).json({
        error: "UPSTREAM_PROTOCOL_UNSUPPORTED",
        message: `Service "${service.name}" uses the ${service.payment_protocol} payment protocol upstream, which x402 Bazaar cannot pay automatically. Contact the provider to resolve this.`,
        upstream_protocol: service.payment_protocol,
        _payment_status: "not_charged",
      });
    }
```

- [ ] **Step 4: Force legacy mode for relay-eligible services**

In the 402 response interception (around line 257), modify the `if (service.owner_address)` block. Before the `res.json` override, add a condition to suppress provider_wallet for relay services:

Find this line (around line 257):
```javascript
    if (service.owner_address) {
```

Replace the entire `if (service.owner_address)` block (lines 257-300) with:

```javascript
    if (service.owner_address) {
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (res.statusCode === 402 && body && body.payment_details) {
          const _chainCfg = getChainConfig(chainKey);
          const _isFacilitator = !!(
            _chainCfg &&
            _chainCfg.facilitator &&
            _chainCfg.feeSplitterContract
          );

          // Relay-eligible services: force legacy mode (no provider_wallet, no split info)
          // so the MCP pays 100% to platform. The relay wallet handles upstream payment.
          if (isRelayEligible) {
            body.payment_details.payment_mode = "relay_upstream";
            body.payment_details.note = "This service uses upstream payment relay. 100% paid to platform, provider receives net payout after upstream cost deduction.";
            // No provider_wallet → MCP falls back to legacy mode automatically
          } else if (_isFacilitator) {
            body.payment_details.payment_mode = "fee_splitter";
            body.payment_details.fee_splitter_contract =
              _chainCfg.feeSplitterContract;
            body.payment_details.facilitator = _chainCfg.facilitator;
            body.payment_details.split = {
              provider_percent: 95,
              platform_percent: 5,
              note: "Split handled automatically by FeeSplitter contract on-chain",
            };
          } else {
            body.payment_details.provider_wallet = service.owner_address;
            const grossRaw = Math.round(price * 1e6);
            const platformRaw = Math.floor((grossRaw * 5) / 100);
            const providerRaw = grossRaw - platformRaw;
            body.payment_details.split = {
              provider_amount: providerRaw / 1e6,
              platform_amount: platformRaw / 1e6,
              provider_percent: 95,
              platform_percent: 5,
            };
            body.payment_details.payment_mode = "split_native";
          }
        }
        return originalJson(body);
      };
    }
```

- [ ] **Step 5: Run full test suite**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add routes/proxy.js
git commit -m "feat: force legacy mode for relay-eligible services + import upstreamPayer"
```

---

### Task 4: Pay→Retry Flow in executeProxyCall() — The Core Relay Logic

**Files:**
- Modify: `routes/proxy.js:991-1050` (replace 502 block with pay→retry)

- [ ] **Step 1: Replace the upstream 402 block in executeProxyCall()**

Find the current block (around lines 991-1050) that starts with `// --- PROTOCOL SNIFFER: detect 402 upstream (self-healing) ---`. Replace it entirely:

```javascript
        // --- UPSTREAM PAYMENT RELAY: detect 402, pay upstream, retry ---
        if (proxyRes.status === 402) {
          let headers402 = {};
          try {
            headers402 = Object.fromEntries(proxyRes.headers);
          } catch { /* empty */ }
          let body402 = {};
          const rawText = await proxyRes.text().catch(() => "");
          try {
            body402 = JSON.parse(rawText);
          } catch { /* not JSON */ }

          const normalized = normalize402(402, headers402, body402);
          logger.info(
            "Proxy",
            `Upstream 402 for "${service.name}" — protocol: ${normalized.format}, payable: ${normalized.payable}`,
            { correlationId: cid, protocol: normalized.format, detectionPath: normalized.detectionPath },
          );

          // Update payment_protocol in DB (fire-and-forget)
          if (normalized.format !== "unknown" && supabase) {
            supabase
              .from("services")
              .update({ payment_protocol: normalized.format })
              .eq("id", service.id)
              .then(null, () => { /* intentionally silent */ });
          }

          // Attempt upstream payment relay
          if (isRelayConfigured() && canPayUpstream(normalized)) {
            const upstreamCostUsdc = Number(normalized.amount) / 1e6;

            // Price guard: refuse if service price doesn't cover upstream cost
            if (price < upstreamCostUsdc) {
              logger.warn("Proxy", `Price guard: service price ${price} < upstream cost ${upstreamCostUsdc} for "${service.name}"`);
              if (inflightKey) _proxyInFlight.delete(inflightKey);
              return res.status(502).json({
                error: "UPSTREAM_PRICE_EXCEEDS_SERVICE",
                message: `Service price ($${price}) is less than upstream cost ($${upstreamCostUsdc}). Provider must increase the price.`,
                upstream_cost: upstreamCostUsdc,
                service_price: price,
                _payment_status: "not_charged",
              });
            }

            logger.info("Proxy", `Paying upstream ${upstreamCostUsdc} USDC for "${service.name}" on ${normalized.chain}`, { correlationId: cid });

            const payResult = await payUpstream(normalized);

            if (payResult.success) {
              // Build proof headers (all 8 formats simultaneously)
              const proofResult = buildUniversalProofHeaders(
                normalized,
                payResult.txHash,
                payResult.chain,
                getRelayAddress(),
              );

              if (proofResult.supported && proofResult.headers) {
                // Retry upstream with proof headers
                const retryHeaders = { ...proxyHeaders, ...proofResult.headers };
                logger.info("Proxy", `Retrying upstream with proof headers for "${service.name}"`, { correlationId: cid });

                try {
                  const retryController = new AbortController();
                  const retryTimeout = setTimeout(() => retryController.abort(), 30000);

                  const retryRes = await fetch(targetUrl, {
                    method: upstreamMethod,
                    headers: retryHeaders,
                    body: fetchBody,
                    signal: retryController.signal,
                  });
                  clearTimeout(retryTimeout);

                  if (retryRes.status >= 200 && retryRes.status < 400) {
                    // Success! Parse response data
                    const retryContentType = retryRes.headers.get("content-type") || "";
                    let retryData;
                    if (retryContentType.includes("application/json")) {
                      retryData = await retryRes.json();
                    } else {
                      retryData = { raw: await retryRes.text() };
                    }

                    logger.info("Proxy", `Upstream relay SUCCESS for "${service.name}" — data received`, { correlationId: cid });

                    // Record payout with upstream cost deducted
                    if (payoutManager && service.owner_address) {
                      const platformFee = price * 0.05;
                      const providerNet = price - upstreamCostUsdc - platformFee;
                      if (providerNet > 0) {
                        payoutManager
                          .recordPayout({
                            serviceId: service.id,
                            serviceName: service.name,
                            providerWallet: service.owner_address,
                            grossAmount: providerNet,
                            txHashIn: txHash,
                            chain,
                          })
                          .catch((err) => {
                            logger.error("Proxy", `Failed to record relay payout for "${service.name}": ${err.message}`);
                          });
                      }
                    }

                    // Claim the agent's TX
                    if (onSuccess) await onSuccess();

                    logActivity(
                      "proxy_relay",
                      `Relay call to "${service.name}" (${price} USDC, upstream ${upstreamCostUsdc} USDC)`,
                      price,
                      txHash,
                    );

                    if (inflightKey) _proxyInFlight.delete(inflightKey);

                    return res.status(200).json({
                      ...retryData,
                      _x402: {
                        payment: `${price} USDC`,
                        upstream_relay: {
                          paid: `${upstreamCostUsdc} USDC`,
                          tx_hash: payResult.txHash,
                          chain: payResult.chain,
                          protocol: normalized.format,
                          provider_net: `${Math.max(0, price - upstreamCostUsdc - price * 0.05).toFixed(6)} USDC`,
                        },
                      },
                    });
                  }

                  // Retry failed (still 402 or error)
                  logger.warn("Proxy", `Upstream retry failed for "${service.name}" — status ${retryRes.status}`, { correlationId: cid });
                } catch (retryErr) {
                  logger.error("Proxy", `Upstream retry error for "${service.name}": ${retryErr.message}`, { correlationId: cid });
                }
              }
            } else {
              logger.warn("Proxy", `Upstream payment failed for "${service.name}": ${payResult.error}`, { correlationId: cid });
            }
          }

          // Fallback: relay not configured, payment failed, or retry failed
          if (inflightKey) _proxyInFlight.delete(inflightKey);
          return res.status(502).json({
            error: "UPSTREAM_PAYMENT_REQUIRED",
            message: `Upstream service "${service.name}" requires its own payment (${normalized.format} protocol).`,
            upstream_protocol: normalized.format,
            upstream_price: normalized.amount || null,
            upstream_recipient: normalized.recipient || null,
            upstream_chain: normalized.chain || null,
            _payment_status: "not_charged",
            _x402: {
              upstream_402: true,
              protocol: normalized.format,
              detection_path: normalized.detectionPath,
            },
          });
        }
```

- [ ] **Step 2: Ensure `isRelayEligible`, `targetUrl`, `proxyHeaders`, `fetchBody`, `upstreamMethod` are accessible in this scope**

These variables are already defined earlier in `executeProxyCall()`:
- `targetUrl` — line ~864
- `proxyHeaders` — line ~910
- `fetchBody` — line ~876-891
- `upstreamMethod` — line ~861
- `isRelayConfigured`, `canPayUpstream`, `payUpstream`, `getRelayAddress` — imported at top
- `buildUniversalProofHeaders` — imported at top
- `normalize402` — already imported

No changes needed — all variables are in scope.

- [ ] **Step 3: Run full test suite**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add routes/proxy.js
git commit -m "feat: upstream payment relay — pay→retry flow in proxy for 402 upstream"
```

---

### Task 5: Price Warning at Registration

**Files:**
- Modify: `routes/register.js:431-444` (quick-register probe else branch)

- [ ] **Step 1: Add price warning when upstream cost detected**

In `routes/register.js`, find the quick-register else branch (probe without credentials). Currently it stores `payment_protocol`. Extend it to also warn about pricing:

Find:
```javascript
        } else {
            // No credentials — probe the URL to detect upstream payment protocol
            const protocolProbe = await probeProtocol(validatedData.url);
            if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
                await supabase.from('services')
                    .update({ payment_protocol: protocolProbe.protocol })
                    .eq('id', service.id);
                logger.info('ProtocolSniffer', `Detected ${protocolProbe.protocol} for "${derivedName}" at registration`);
            }
        }
```

Replace with:

```javascript
        } else {
            // No credentials — probe the URL to detect upstream payment protocol
            protocolProbe = await probeProtocol(validatedData.url);
            if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
                await supabase.from('services')
                    .update({ payment_protocol: protocolProbe.protocol })
                    .eq('id', service.id);
                logger.info('ProtocolSniffer', `Detected ${protocolProbe.protocol} for "${derivedName}" at registration`);
            }
        }
```

Then, in the response block where `protocol_detected` is already added, extend it with a price warning. Find:

```javascript
        if (protocolProbe?.is402) {
            response.protocol_detected = {
```

Add `price_warning` to the protocol_detected block:

```javascript
        if (protocolProbe?.is402) {
            const upstreamCostUsdc = protocolProbe.upstreamPrice ? Number(protocolProbe.upstreamPrice) / 1e6 : null;
            const minRecommended = upstreamCostUsdc ? (upstreamCostUsdc * 1.2).toFixed(4) : null;
            response.protocol_detected = {
                protocol: protocolProbe.protocol,
                upstream_price: protocolProbe.upstreamPrice,
                upstream_recipient: protocolProbe.upstreamRecipient,
                upstream_chain: protocolProbe.upstreamChain,
                warning: protocolProbe.protocol !== 'unknown'
                    ? `Upstream uses ${protocolProbe.protocol} payment protocol. Your price must cover upstream cost.`
                    : 'Upstream requires payment (unknown protocol). Manual configuration may be needed.',
            };
            if (upstreamCostUsdc && validatedData.price < upstreamCostUsdc) {
                response.protocol_detected.price_warning = `Upstream costs $${upstreamCostUsdc.toFixed(4)}. Your price $${validatedData.price} may not cover upstream payment. Recommended minimum: $${minRecommended}.`;
            }
        }
```

- [ ] **Step 2: Run full test suite**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add routes/register.js
git commit -m "feat: price warning at registration when service price < upstream cost"
```

---

### Task 6: Relay Wallet Balance Monitoring + Telegram Alert

**Files:**
- Modify: `lib/monitor.js:490-517` (runCheck function)

- [ ] **Step 1: Add import and monitoring logic**

At the top of `lib/monitor.js`, add:

```javascript
const { isRelayConfigured, getRelayBalance } = require('./upstreamPayer');
```

In `runCheck()`, after the `updateServicesStatus()` call (around line 507), add relay balance monitoring:

```javascript
    // Check relay wallet balance (if configured)
    if (isRelayConfigured()) {
      const RELAY_LOW_THRESHOLD = 10; // $10 USDC
      for (const chainKey of ['base', 'polygon', 'skale']) {
        const bal = await getRelayBalance(chainKey).catch(() => null);
        if (bal && bal.balance < RELAY_LOW_THRESHOLD) {
          logger.warn('Monitor', `Relay wallet LOW on ${chainKey}: $${bal.balance.toFixed(2)} USDC (threshold: $${RELAY_LOW_THRESHOLD})`);
          // Telegram alert
          const token = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_CHAT_ID;
          if (token && chatId) {
            const text = [
              `🔴 *RELAY WALLET LOW*`,
              ``,
              `*Chain:* ${chainKey}`,
              `*Balance:* $${bal.balance.toFixed(2)} USDC`,
              `*Threshold:* $${RELAY_LOW_THRESHOLD}`,
              `*Address:* \`${bal.address.slice(0, 10)}...\``,
              `*Action:* Top up manually`,
            ].join('\n');
            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
            }).catch(() => { /* best-effort */ });
          }
        }
      }
    }
```

- [ ] **Step 2: Run full test suite**

Run: `cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar && npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git add lib/monitor.js
git commit -m "feat: relay wallet balance monitoring with Telegram low-balance alert"
```

---

### Task 7: Create Relay Wallet + Fund + Deploy

**Files:**
- No code files — operational setup

- [ ] **Step 1: Create relay wallet**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
node -e "
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
console.log('Address:', account.address);
console.log('Private Key:', key);
console.log('');
console.log('SAVE THIS KEY SECURELY — add as RELAY_PRIVATE_KEY env var on Render');
"
```

- [ ] **Step 2: Add RELAY_PRIVATE_KEY to Render env vars**

Go to Render dashboard → x402-api → Environment → add `RELAY_PRIVATE_KEY` with the generated key.

- [ ] **Step 3: Fund relay wallet**

Send ~$15 USDC to the relay wallet address:
- $5 USDC on Base
- $5 USDC on Polygon
- $5 USDC on SKALE

- [ ] **Step 4: Push all code and verify deploy**

```bash
cd C:/Users/robin/OneDrive/Bureau/HACKATHON/x402-bazaar
git push origin main
```

Wait for Render deploy, then verify:

```bash
curl -s https://x402-api.onrender.com/health | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).status))"
```

- [ ] **Step 5: Live test — call Interzoid (x402-v2 on Base)**

Use MCP `call_service` on the Interzoid service (payment_protocol: x402-v2). Should:
1. Pay Bazaar in legacy mode (100% to platform)
2. Proxy detects 402 upstream
3. Relay pays upstream on Base
4. Retry with proof headers
5. Return real data with `_x402.upstream_relay` metadata
