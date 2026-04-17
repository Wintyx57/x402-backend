# Analytics setup — PostHog event tracking

**Why this exists** : today we optimize blind. Nothing on `/quickstart` is A/B tested, we don't know where the funnel leaks, we can't prove retention. Before any GTM work, we need a funnel we can read.

**Goal** : in 3 days, have a live funnel dashboard showing the 9 critical events below, so every GTM action can be measured.

---

## Why PostHog

- Free tier: 1M events/month — we won't come close for 6 months
- Self-hostable if we ever need privacy (EU clients)
- Ships session replay, feature flags, and A/B tests in one SDK
- Plays well with our existing Plausible setup (keep Plausible for page views, PostHog for product events)

Alternative : Mixpanel (same features, free tier smaller). Amplitude (more enterprise, costs more).

**Pick PostHog.** If we outgrow it, migration is painless.

---

## Setup (3 hours)

### 1. Create a PostHog project

https://app.posthog.com → Sign up → New project `x402-bazaar`. Copy the project API key.

### 2. Frontend integration

Install:

```bash
cd x402-frontend
npm install posthog-js
```

Init in `src/main.tsx` (very top):

```tsx
import posthog from "posthog-js";

if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: "https://eu.posthog.com",  // or us.posthog.com depending on region
    autocapture: false,                   // we'll send explicit events only
    capture_pageview: true,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,                // never record wallet addresses typed in forms
      blockClass: "ph-no-capture",
    },
    bootstrap: {
      featureFlags: {},
    },
    respect_dnt: true,
  });
}
```

Add env var in Vercel : `VITE_POSTHOG_KEY = <your key>`.

### 3. Backend integration

Install:

```bash
cd x402-bazaar
npm install posthog-node
```

Create `lib/analytics.js` :

```js
"use strict";

const { PostHog } = require("posthog-node");

let client = null;

if (process.env.POSTHOG_KEY) {
  client = new PostHog(process.env.POSTHOG_KEY, {
    host: process.env.POSTHOG_HOST || "https://eu.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
}

function track(distinctId, event, properties = {}) {
  if (!client || !distinctId) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        $timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    // analytics must never break the request path
  }
}

async function shutdown() {
  if (client) await client.shutdown();
}

module.exports = { track, shutdown };
```

Add env vars in Render :
- `POSTHOG_KEY = <key>`
- `POSTHOG_HOST = https://eu.posthog.com` (optional)

In `server.js` SIGTERM handler, add `await require("./lib/analytics").shutdown();` so buffered events flush on deploy.

---

## The 9 critical events to track

These are the minimum viable set. Don't over-engineer — start here, expand later only if a question requires it.

### Frontend (user-facing funnel)

| # | Event | When | Properties |
|---|-------|------|-----------|
| 1 | `landing_view` | User lands on `/` | `utm_source`, `referrer`, `device` |
| 2 | `quickstart_view` | User reaches `/quickstart` (or `/start`) | same as above |
| 3 | `cli_command_copied` | User clicks "copy" on a CLI command | `command` (which one), `step` |
| 4 | `free_tier_call_requested` | Any call to a platform-native free-tier-eligible endpoint | `endpoint`, `chain` |
| 5 | `wallet_connect_clicked` | User clicks the ConnectButton | — |
| 6 | `wallet_connected` | Wallet connection completed | `chain`, `wallet_type` (thirdweb) |
| 7 | `first_paid_call_initiated` | User initiates a paid call for the first time | `service_id`, `price_usdc`, `chain` |
| 8 | `provider_register_submitted` | Provider clicks "Register" in `/register` | `method`, `with_credentials` (bool) |
| 9 | `payment_link_created` | Successful creation of a payment link | `target_url`, `price_usdc` |

### Backend (server-side, more reliable for money events)

| Event | When | Properties |
|-------|------|-----------|
| `api_call_paid_succeeded` | Proxy successfully delivers a paid response | `service_id`, `price_usdc`, `chain`, `agent_wallet_hash` |
| `api_call_refunded` | Consumer-protection refund issued | `service_id`, `price_usdc`, `reason` |
| `provider_registered` | POST /api/register succeeded | `wallet_hash`, `method`, `with_credentials` |
| `service_quarantined` | Monitor or admin quarantines a service | `service_id`, `reason` |

**Privacy note** : we hash wallet addresses before sending to PostHog (`sha256(addr.toLowerCase())`). PostHog is NOT a wallet explorer.

---

## The funnel to build

Once events flow, set up this single funnel in PostHog :

```
landing_view
  -> quickstart_view
    -> cli_command_copied
      -> free_tier_call_requested
        -> wallet_connected
          -> first_paid_call_initiated
            -> api_call_paid_succeeded (confirmed revenue)
```

This tells you, per week, which step kills conversion the most.

Example diagnosis :
- If `landing_view` -> `quickstart_view` is < 10% : landing page messaging is weak
- If `quickstart_view` -> `cli_command_copied` is < 30% : the CLI instructions aren't clear
- If `free_tier_call_requested` -> `wallet_connected` is < 5% : your "upgrade to paid" CTA is weak — most people churn after the free tier
- If `wallet_connected` -> `first_paid_call_initiated` is < 20% : wallet funding is too much friction (bridge problem)

---

## Cohorts to watch (weekly review)

1. **D7 retention of paying users** : of all wallets that made a paid call this week, how many come back within 7 days?
2. **Provider D30** : of all providers who registered this week, how many have at least one paid call within 30 days?
3. **Free-to-paid conversion** : of all wallets that exhausted the free tier, how many made a paid call within 24h?

---

## A/B tests to queue up (week 2)

Once the funnel is readable, run these tests — each drives a clear decision :

1. **Hero CTA** : "Try in 30 seconds" vs "See how agents pay APIs" vs "npx x402-bazaar init"
2. **Pricing page existence** : show a /pricing with the 95/5 explanation vs keep it invisible
3. **Faucet** : auto-faucet on wallet creation vs "fund yourself" instructions

Each test : 2-week run, minimum 100 users per arm, clear decision criterion written BEFORE the test starts.

---

## What to NOT track

- Email, full wallet addresses, IP addresses (use hashes)
- Free-text inputs in forms (masked)
- Anything related to provider credentials
- PII in URL query strings

PostHog Respects DNT : users who enable "Do Not Track" are auto-excluded.

---

## Privacy page update

Once PostHog is live, add to `/privacy` :

> We use PostHog (EU-hosted) to measure product engagement. We never send your email, full wallet address, or the content of your API calls. Hashed wallet addresses are used only to distinguish unique users in aggregate funnels. We honor the "Do Not Track" browser signal.

Delete old users on request via the `/privacy` RGPD endpoint we already have.

---

## Cost projection

- Current traffic : ~100 users/day, ~50 events/user = 5k events/day = 150k/month
- PostHog free tier : 1M events/month
- Headroom : 6.5× current volume before paying

When crossing 500k events/month, upgrade or start sampling. Not urgent.
