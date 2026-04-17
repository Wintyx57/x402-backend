# Provider Guide — Monetize your API with x402 Bazaar

**Time to first payout**: 15 minutes
**Revenue split**: You keep 95%, platform keeps 5%
**No listing fee**. **No monthly fee**. **No API key management on our side** — we proxy your existing auth.

This guide walks you from "I have an API" to "I got my first USDC payout" in 4 steps.

---

## Step 1 — Register your API (3 min)

You have 3 ways to list your API, pick the one that matches what you already have.

### Option A — OpenAPI spec (recommended, 1 click)

If your API already publishes an OpenAPI / Swagger spec, we'll import every endpoint automatically:

```bash
curl -X POST https://x402-api.onrender.com/api/openapi/import \
  -H 'Content-Type: application/json' \
  -d '{
    "specUrl": "https://your-api.example.com/openapi.json",
    "ownerAddress": "0xYourWallet...",
    "priceUsdc": 0.01,
    "signature": "...",
    "timestamp": 1710000000
  }'
```

Every path in the spec becomes a separately priced service. You can override the price per endpoint later via `/api/services/:id`.

**In the UI**: go to `/register` → tab **Import OpenAPI** → paste your spec URL.

### Option B — Single endpoint

Register one URL at a time:

```bash
curl -X POST https://x402-api.onrender.com/api/register \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://your-api.example.com/v1/weather",
    "name": "Weather API",
    "description": "Real-time weather for any coordinates",
    "priceUsdc": 0.02,
    "ownerAddress": "0xYourWallet...",
    "signature": "...",
    "timestamp": 1710000000
  }'
```

### Option C — RapidAPI migration

If you already sell your API on RapidAPI, import your whole catalog in one call:

```bash
curl -X POST https://x402-api.onrender.com/api/rapidapi/import \
  -H 'Content-Type: application/json' \
  -d '{
    "catalogUrl": "https://rapidapi.com/provider/yourname",
    "ownerAddress": "0xYourWallet...",
    "signature": "...",
    "timestamp": 1710000000
  }'
```

You keep your RapidAPI listing AND publish on x402 Bazaar — zero risk.

---

## Step 2 — Set up credential passthrough (if your API needs auth, 5 min)

Most provider APIs require an API key to authenticate. You DON'T share that key with us in plaintext — we encrypt it at rest and inject it on each call.

**Flow**:

1. Register your service with `credential_type: "bearer"` (or `"api-key"`, `"basic"`, `"none"`)
2. We encrypt your secret using AES-256-GCM
3. On every paid call, we decrypt in-memory only and inject into the upstream request
4. Your secret is never logged, never returned in responses

Example with a Bearer token:

```bash
curl -X POST https://x402-api.onrender.com/api/register \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://your-api.example.com/v1/data",
    "name": "Your Service",
    "priceUsdc": 0.05,
    "ownerAddress": "0xYourWallet...",
    "credential_type": "bearer",
    "credential_value": "sk_prod_xxxxxxxxxxxx",
    "signature": "...",
    "timestamp": 1710000000
  }'
```

At registration time we **pre-ping your API** with the credential to validate it. If your API rejects it (401/403), registration is blocked — you can't accidentally list a broken service.

---

## Step 3 — Verify your listing (2 min)

Open https://x402bazaar.org/services and find your API. Check:

- ✅ Name, description, price correct
- ✅ Status badge = **online** (we run a health-check every 5 min)
- ✅ Test the endpoint directly from the page

If your status shows **offline** or **quarantined**, check our status page (link below) — we might have flagged a 5xx or a bare-402 response.

---

## Step 4 — Receive your first payout (5 min)

Once a user calls your API:

1. They pay the full price in USDC (Base, SKALE, or Polygon)
2. We verify the transaction on-chain and release the upstream call
3. **95% goes to your wallet**, 5% to the platform fee wallet
4. Payouts are settled every 6 hours for wallets with pending > $1 USDC

**See your earnings** at `/my-apis` (connect with the wallet you registered with):
- Total earned
- By-service breakdown
- Daily revenue chart (last 30 days)
- By-chain distribution
- Pending vs paid

### Self-service withdrawal

For pending totals under $50, you can trigger an instant on-chain payout yourself:

```
POST /api/payouts/withdraw
X-Wallet-Address: 0xYourWallet...
X-Wallet-Signature: ...
```

Above $50, we settle through the auto-payout cron (every 6h).

---

## Pricing strategy — what to charge?

| Call complexity | Suggested price |
|-----------------|-----------------|
| Simple data lookup (weather, crypto price) | $0.001 – $0.005 |
| ML inference, image gen, transcription | $0.01 – $0.10 |
| Premium / enterprise data (financial, medical) | $0.10 – $1.00 |
| Long-running compute | per-second metered (coming soon) |

**Important**: your price must cover your own infra cost at scale. If you charge $0.001/call but your AWS bill is $0.01/call, you're losing money on every sale.

---

## Free tier — how it works for your API

If your price is **≤ $0.01** AND your wallet is `WALLET_ADDRESS` (platform-owned), users get **5 free calls per day per IP**. This only applies to platform-native services.

**Your API is NOT enrolled in the free tier by default** — users always pay you the full price. If you want to opt in for marketing purposes, contact us.

---

## Trust signals — getting featured

Your listing gets a **trust score** based on:

- Uptime (7-day window, from our health-check)
- Response latency p95
- Schema consistency (daily-tester probes your endpoint)
- Content quality (Gemini cross-check on output structure)
- User reviews (star ratings)

Services scoring > 90/100 get a **Gold badge** on the marketplace. Gold services rank first in search.

You can see your score in `/my-apis` → tab **Quality**.

---

## Support

- **Docs** : https://x402bazaar.org/docs
- **Status page** : https://x402bazaar.org/status
- **Issues** : https://github.com/Wintyx57/x402-backend/issues
- **Contact** : robin.fuchs57@hotmail.com

---

## Common questions

**Q: Do I need to hold crypto to receive payouts?**
Yes — you receive USDC on Base, SKALE or Polygon. You can bridge to fiat via Coinbase, Trails, or any DEX.

**Q: What chains should my wallet support?**
Register on any of Base, SKALE, or Polygon. We recommend Base for low friction + deep liquidity, or SKALE for ultra-low gas if you expect high call volume.

**Q: Can I change my price?**
Yes, anytime, via `PATCH /api/services/:id` with a wallet signature. The new price applies to all future calls.

**Q: How do I deprecate a service?**
Set status to `deprecated` via the dashboard. The listing is hidden from the public marketplace but existing integrations keep working until you explicitly offline it.

**Q: What happens if my API returns a 5xx or empty body?**
We auto-refund the user on-chain (within 60s) and DON'T credit you the call. This is "consumer protection" and is intentional — it protects your reputation too.

**Q: Is there a setup fee, listing fee, or monthly fee?**
No. 5% platform fee on successful calls is our only revenue.

**Q: How quickly does registration go live?**
Instant if OpenAPI import + credentials validate. Otherwise 5-10 minutes for health-check to confirm your endpoint responds.
