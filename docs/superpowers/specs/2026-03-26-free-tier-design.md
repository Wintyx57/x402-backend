# Free Tier — Zero-Friction API Trial

**Date:** 2026-03-26
**Status:** Approved
**Goal:** Allow anyone to test x402 Bazaar APIs without a wallet, crypto, or signup — 5 free calls/day per IP on native services ≤ $0.01.

---

## Context

x402 Bazaar has 107 APIs, 2092 tests, and best-in-class agent payment tech. But 90%+ of developers can't try it because every call requires a crypto wallet + USDC. The free tier removes this barrier entirely.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Quota scope | Per IP (anonymous) | Zero friction — no wallet, no signup, no account |
| Eligible services | Native wrappers only (no `owner_address`) | Don't give away external providers' paid APIs |
| Price threshold | ≤ $0.01 USDC | Excludes costly wrappers (image $0.05, summarize $0.02) automatically |
| Trigger mechanism | Absence of payment headers | Zero client changes — just call the API, it works |
| Daily limit | 5 calls/day per IP | Enough to evaluate, not enough to abuse |
| IP storage | SHA-256 hash | GDPR compliant — no plaintext IPs in DB |

## Architecture

### Request Flow (modified proxy.js)

```
POST /api/call/:serviceId
  1. Validate serviceId (UUID)
  2. Fetch service from DB
  3. Validate required parameters (gatekeeper)
  ──── NEW: FREE TIER CHECK ────
  4. No payment headers present?
     ├─ YES → checkFreeTier(supabase, ipHash, service)
     │   ├─ eligible → executeProxyCall() + recordFreeUsage() + skip payment
     │   └─ not eligible → continue to step 5 (normal 402 flow)
     └─ NO → continue to step 5 (payment headers present, normal flow)
  ──── END NEW ────
  5. Rate limit + budget checks (existing)
  6. Split mode or legacy payment verification (existing)
  7. Proxy call upstream (existing)
```

### New Component: `lib/free-tier.js` (~80 lines)

```javascript
// Configuration (env overridable)
const FREE_TIER_DAILY_LIMIT = parseInt(process.env.FREE_TIER_LIMIT, 10) || 5;
const FREE_TIER_MAX_PRICE = parseFloat(process.env.FREE_TIER_MAX_PRICE) || 0.01;

// checkFreeTier(supabase, ipHash, service)
// Returns: { eligible: boolean, remaining: number, reason?: string }
//
// Eligibility:
//   1. service.owner_address is NULL (native wrapper)
//   2. service.price_usdc <= FREE_TIER_MAX_PRICE
//   3. Daily usage count for this IP hash < FREE_TIER_DAILY_LIMIT
//
// recordFreeUsage(supabase, ipHash)
// Upserts free_usage row: increment count or insert with count=1
//
// hashIp(ip)
// SHA-256 hash of IP string (GDPR: no plaintext IP storage)
```

### New Supabase Table: `free_usage`

```sql
CREATE TABLE IF NOT EXISTS free_usage (
  ip_hash TEXT NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(ip_hash, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_free_usage_date ON free_usage(usage_date);
```

- **Upsert on use:** `INSERT ... ON CONFLICT (ip_hash, usage_date) DO UPDATE SET count = count + 1`
- **Cleanup:** Rows older than 7 days deleted on startup + daily via existing retention job

### Modified: `routes/proxy.js`

Insert free tier check after parameter gatekeeper (line ~80), before split mode check (line ~119):

```javascript
// --- FREE TIER CHECK ---
const hasPaymentHeaders = !!(req.headers['x-payment-txhash'] || req.headers['x-payment-txhash-provider']);
if (!hasPaymentHeaders) {
    const ipHash = hashIp(req.ip);
    const freeTierResult = await checkFreeTier(supabase, ipHash, service);
    if (freeTierResult.eligible) {
        // Execute proxy call without payment
        await executeProxyCall(req, res, { service, price: 0, ... });
        await recordFreeUsage(supabase, ipHash);
        return;
    }
    // Not eligible — fall through to normal 402 payment flow
    // Add hint to 402 response
    res._freeTierExhausted = freeTierResult.reason;
}
```

Response headers on free tier calls:
- `X-Free-Tier: true`
- `X-Free-Tier-Remaining: <N>`

402 response when quota exhausted:
```json
{
  "payment_details": { ... },
  "free_tier": {
    "exhausted": true,
    "reason": "daily_limit_reached",
    "limit": 5,
    "resets_at": "2026-03-27T00:00:00Z"
  }
}
```

### Modified: Frontend

**ServiceCard.tsx** — Add "Free to try" badge:
- Condition: `!service.owner_address && service.price_usdc <= 0.01`
- Small green badge next to the price

**Services.tsx** — Add "Free" filter toggle:
- Quick filter to show only free-tier-eligible services

### NOT Modified

- **MCP server** — No changes needed. Absence of payment headers triggers free tier automatically.
- **CLI** — No changes needed. `npx x402-bazaar call` without `--key` will use free tier.
- **SDK** — No changes needed.

## Edge Cases

| Case | Behavior |
|------|----------|
| Shared IP (NAT/office) | Shared quota — acceptable for a trial tier |
| VPN rotation abuse | Limited by daily global rate limit on free tier endpoint |
| Service at $0.05 (image/DALL-E) | Not eligible — returns 402 normally |
| External service (has owner_address) | Not eligible — returns 402 normally |
| 6th call of the day | 402 with `free_tier.exhausted: true` + payment details |
| Call WITH payment headers | Skips free tier entirely, normal paid flow |
| IP spoofing | Mitigated by `trust proxy: 1` (Render first hop) |
| Free tier call fails upstream | No usage recorded (record only on success) |

## Testing Plan

- Unit tests for `lib/free-tier.js`: checkFreeTier eligibility logic, hashIp, recordFreeUsage
- Integration tests in proxy: free tier call succeeds, quota exhaustion returns 402, paid call bypasses free tier
- Edge case tests: external service rejected, expensive service rejected, 6th call blocked
- Supabase table creation + upsert + cleanup

## Files Changed

| File | Change |
|------|--------|
| `lib/free-tier.js` | **NEW** — checkFreeTier, recordFreeUsage, hashIp, config |
| `routes/proxy.js` | Insert free tier check before payment flow |
| `routes/health.js` | Migration for `free_usage` table + cleanup in retention |
| `lib/retention.js` | Add free_usage cleanup (>7 days) |
| `tests/free-tier.test.js` | **NEW** — unit + integration tests |
| Frontend: `ServiceCard.tsx` | "Free to try" badge |
| Frontend: `Services.tsx` | Free filter toggle |
| Frontend: `i18n/translations.ts` | Free tier labels EN+FR |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `FREE_TIER_LIMIT` | `5` | Max free calls per IP per day |
| `FREE_TIER_MAX_PRICE` | `0.01` | Max service price eligible for free tier |
