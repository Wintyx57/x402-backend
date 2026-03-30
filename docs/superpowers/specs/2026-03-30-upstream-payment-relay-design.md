# Universal Upstream Payment Relay — Design Spec

## Problem

When a provider registers an API on x402 Bazaar that has its own payment wall upstream (x402-standard, mpp/tempo, etc.), agents pay Bazaar but receive useless responses (HTML SPA, 402 errors) because the proxy doesn't pay upstream. The Protocol Sniffer (session 101) detects and blocks these services, but the ideal solution is to pay upstream automatically — making it completely transparent for agents and frictionless for providers.

## Solution

A Universal Upstream Payment Relay that automatically pays upstream when the proxy encounters a 402, retries with proof headers, and returns real data to the agent. Self-sustaining economics via forced legacy payment mode for relay services.

## Flow

```
1. Agent requests /api/call/:serviceId
2. Backend generates 402 WITHOUT provider_wallet (forces legacy mode)
3. Agent/MCP pays $0.015 → 100% to WALLET_ADDRESS (platform)
4. Proxy forwards request to upstream
5. Upstream returns 402
6. normalize402() → payable? supported chain? relay funded? price covers upstream?
   YES:
     7. Relay wallet pays upstream ($0.01 USDC transfer)
     8. Wait for on-chain confirmation (chain-dependent)
     9. buildUniversalProofHeaders() → 8 proof header formats
    10. Retry request with proof headers
    11. Upstream returns data → proxy returns to agent
    12. Record pending_payout: service_price - upstream_cost - 5% fee → provider
   NO:
     7. Return 502 UPSTREAM_PROTOCOL_UNSUPPORTED (existing behavior)
```

## Architecture

### 1. `lib/upstreamPayer.js` (NEW — ~150 lines)

Single responsibility: pay upstream and return txHash.

```
payUpstream(normalized) → { success, txHash, chain, amount } | { success: false, error }
getRelayBalance(chain) → { balance, address }
isRelayConfigured() → boolean
```

**Implementation details:**
- Uses viem with `RELAY_PRIVATE_KEY` env var
- Creates walletClient per chain (Base, Polygon, SKALE) — lazy-initialized singletons
- USDC transfer via `transfer(address,uint256)` on each chain's USDC contract
- Nonce manager: sequential queue per chain to prevent nonce collisions on concurrent calls
- Max upstream cost cap: $1.00 per call (1_000_000 raw USDC units). Anything above is refused.
- Recipient must match `WALLET_PATTERN` (0x + 40 hex)

**Chain config (reuse from `lib/chains.js`):**

| Chain | ChainId | USDC Contract | Confirmations | Retry |
|-------|---------|---------------|---------------|-------|
| Base | 8453 | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | 2 | 4x2s |
| Polygon | 137 | 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 | 5 | 8x3s |
| SKALE | 1187947933 | 0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20 | 0 | 4x500ms |

**Nonce manager:**
- Per-chain mutex (simple promise queue)
- Each `payUpstream()` call acquires the lock, sends TX, waits for receipt, releases
- Prevents 2 concurrent calls from using the same nonce

### 2. `lib/protocolAdapter.js` (MODIFY)

Extend `detectMPP()` to parse the `request` base64 parameter from `WWW-Authenticate: Payment` headers.

Current behavior: `detectMPP()` returns `payable: false` for all MPP protocols.

New behavior: if the `request` base64 decodes to JSON with `amount`, `recipient`, and `methodDetails.chainId`, AND chainId maps to a supported chain (Base/Polygon/SKALE), set:
- `payable: true`
- `amount` from decoded JSON
- `recipient` from decoded JSON
- `chain` from chainId mapping
- `asset` from `currency` field (if it matches a known USDC contract)

If chainId is unsupported or currency is not USDC → keep `payable: false`.

**ChainId mapping (add to NETWORK_MAP):**
- 8453 → 'base'
- 137 → 'polygon'
- 1187947933 → 'skale'
- (existing eip155: mappings already cover these)

### 3. `routes/proxy.js` (MODIFY)

**3a. Force legacy payment mode for relay-eligible services**

In the 402 response generation (payment middleware), when the service has a payable `payment_protocol`:
- Omit `provider_wallet` and `split` info from the 402 response
- Set `payment_mode: "legacy"` instead of `split_native`
- The MCP/agent will pay 100% to WALLET_ADDRESS (legacy mode)

This requires reading `payment_protocol` from the service (already done — added in session 101).

To determine if a service needs relay mode: `payment_protocol` is set AND it's in a payable format (x402-v1, x402-v2, x402-variant, x402-bazaar, flat, header-based, or mpp with supported chain). We need a helper: `isRelayEligible(paymentProtocol)`.

**3b. Replace 502 block with upstream payment attempt**

In `executeProxyCall()`, the current upstream 402 handling block:
1. Check `isRelayConfigured()` — if not, fallback to 502 (current behavior)
2. Call `normalize402(402, headers, body)` — already done
3. Check `normalized.payable === true` — can we pay?
4. Check chain is supported — `normalized.chain` maps to base/polygon/skale
5. Check price: `service.price_usdc * 1e6 >= Number(normalized.amount)` — service price covers upstream cost
6. Check relay balance — `getRelayBalance(chain) >= amount`
7. Call `payUpstream(normalized)` — get txHash
8. Build proof headers: `buildUniversalProofHeaders(normalized, txHash, chain, relayAddress)`
9. Retry the upstream request with proof headers (single retry, no loop)
10. If data received → return to agent with `_x402.upstream_relay: { paid: amount, txHash, chain }`
11. If still 402 → return 502 with `upstream_relay_failed: true`

**3c. Record pending payout for provider**

After successful relay call:
```
payout_amount = service.price_usdc - (upstream_cost_usdc) - (service.price_usdc * 0.05)
```
Record in `pending_payouts` table: provider address, payout_amount, service_id, upstream_txHash.

### 4. `routes/register.js` (MODIFY)

At registration, when `probeProtocol()` detects a payable upstream protocol:
- Calculate minimum price: `upstream_cost * 1.2` (20% margin to cover gas + platform fee)
- If service price < minimum: return a **warning** (not blocking):
  ```json
  {
    "protocol_detected": { ... },
    "price_warning": "Upstream costs $0.01. Your price $0.005 may not cover upstream payment. Recommended minimum: $0.012."
  }
  ```
- Store `payment_protocol` in DB (already done)

### 5. `lib/monitor.js` (MODIFY)

Add relay wallet balance monitoring:
- In `runCheck()`, after endpoint checks, call `getRelayBalance()` for each chain
- If any chain balance < $10 USDC → send Telegram alert:
  ```
  🔴 RELAY WALLET LOW
  Chain: Base
  Balance: $8.50 USDC
  Address: 0x...
  Action: Top up manually
  ```
- Log relay balances in monitoring metrics

### 6. Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `RELAY_PRIVATE_KEY` | No (feature flag) | Private key for relay wallet. If absent, upstream payment relay is disabled. |

When `RELAY_PRIVATE_KEY` is not set:
- `isRelayConfigured()` returns false
- Relay-eligible services still use split_native (no forced legacy mode)
- Upstream 402 returns the existing 502 UPSTREAM_PROTOCOL_UNSUPPORTED
- Zero behavior change from current state

### 7. Security

- **Low-balance wallet**: ~$50 USDC max across all chains, recharged manually by Robin
- **Telegram alert** when balance < $10 on any chain
- **$1 max per call**: refuse upstream payments > 1,000,000 raw USDC units
- **Recipient validation**: must match `0x[a-fA-F0-9]{40}` (already in WALLET_PATTERN)
- **Price guard**: refuse to pay upstream if service.price_usdc < upstream_cost_usdc (agent would be subsidizing)
- **Feature flag**: no RELAY_PRIVATE_KEY = no relay. Fail-closed.
- **Nonce manager**: prevents double-spend on concurrent calls

### 8. Protocols Covered vs Not Covered

**Payable (relay will pay automatically):**
- x402-v2 (Coinbase standard) — Base, Polygon
- x402-v1 — Base, Polygon
- x402-variant (Ozark) — if chain supported
- x402-bazaar — if on Base/Polygon/SKALE
- flat (amount + recipient) — if chain supported
- header-based (x-payment-amount) — if chain supported
- mpp/tempo — IF the `request` base64 contains a supported chainId + USDC asset (NEW)

**Not payable (502 as before):**
- mpp/tempo on unsupported chains (e.g., Cascade on chain 4217)
- l402 (Lightning Network — not USDC)
- l402-protocol (multi-step Lightning)
- stripe402 (Stripe checkout — not crypto)
- Any protocol where amount/recipient/chain cannot be extracted

### 9. Response Format

**Successful relay call — agent sees:**
```json
{
  "success": true,
  "service": { "id": "...", "name": "..." },
  "data": { ... actual upstream data ... },
  "_x402": {
    "payment": "0.015 USDC",
    "upstream_relay": {
      "paid": "0.01 USDC",
      "tx_hash": "0xabc...",
      "chain": "base",
      "protocol": "x402-v2",
      "provider_net": "0.00425 USDC"
    }
  }
}
```

**Failed relay — agent sees:**
```json
{
  "error": "UPSTREAM_PROTOCOL_UNSUPPORTED",
  "message": "Service uses mpp protocol on unsupported chain (4217).",
  "upstream_protocol": "mpp",
  "_payment_status": "not_charged"
}
```

### 10. Economics Example

Service price: $0.015 | Upstream cost: $0.01

```
Agent pays:     $0.015 → WALLET_ADDRESS (100% legacy mode)
Relay pays:     $0.010 → upstream recipient
Platform fee:   $0.015 × 5% = $0.00075
Provider payout: $0.015 - $0.010 - $0.00075 = $0.00425
```

The relay wallet is effectively reimbursed: Robin moves funds from WALLET_ADDRESS to relay wallet periodically. The system is self-sustaining as long as service prices cover upstream costs.

### 11. Files Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| `lib/upstreamPayer.js` | CREATE | ~150 |
| `lib/protocolAdapter.js` | MODIFY | ~30 (extend detectMPP) |
| `routes/proxy.js` | MODIFY | ~80 (relay logic + forced legacy) |
| `routes/register.js` | MODIFY | ~10 (price warning) |
| `lib/monitor.js` | MODIFY | ~20 (relay balance alert) |
| `tests/upstreamPayer.test.js` | CREATE | ~100 |
| `tests/protocolSniffer.test.js` | MODIFY | ~30 (relay integration tests) |
