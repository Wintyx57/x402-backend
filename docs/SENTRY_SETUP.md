# Sentry setup — backend + frontend

Goal: capture every unhandled error, 5xx response, and frontend crash with enough context to debug without redeploying.

Time to set up: **30 minutes total**.

---

## Prerequisites

1. Create a free Sentry account: https://sentry.io
2. Create **two separate projects**:
   - `x402-bazaar-backend` (Platform: Node.js)
   - `x402-bazaar-frontend` (Platform: React)
3. Copy each project's DSN (you'll paste them into Render + Vercel env vars)

---

## Backend (Node.js / Express)

### 1. Install

```bash
cd x402-bazaar
npm install @sentry/node @sentry/profiling-node
git add package.json package-lock.json
```

### 2. Add at the very top of `server.js`

Before **any other import**, add:

```js
require("dotenv").config();
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    release: require("./package.json").version,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.1,  // 10% of transactions — adjust if noisy
    profilesSampleRate: 0.1,
    beforeSend(event) {
      // Do not ever send request bodies or wallet-related data
      if (event.request?.data) delete event.request.data;
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
  });
}
```

### 3. Register the error handler **after all routes** (near the end of `server.js`)

```js
// All route registration above this line...

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Your existing global error handler stays AFTER Sentry's handler
app.use((err, req, res, next) => {
  // ...existing code
});
```

### 4. Add env var in Render

Render dashboard → `x402-bazaar` service → Environment → Add:

- **Key**: `SENTRY_DSN`
- **Value**: (DSN from Sentry project `x402-bazaar-backend`)

### 5. Test

After deploy, force an error:

```bash
curl https://x402-api.onrender.com/api/nonexistent-endpoint-to-404
```

You should see the 404 (+maybe a breadcrumb) in Sentry within 30s.

For a real crash, create a temporary route:

```js
app.get("/test-sentry-crash", () => {
  throw new Error("Sentry smoke test — safe to ignore");
});
```

Call it once, confirm it lands in Sentry, remove the route.

---

## Frontend (React / Vite)

`@sentry/react` is already in `package.json`. We just need to initialize it.

### 1. Init in `src/main.tsx` (very top, before React rendering)

```tsx
import * as Sentry from "@sentry/react";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,     // never send user-visible text
        blockAllMedia: true,   // never send images
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,     // only record on errors
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Drop anything that might contain a wallet / token
      if (event.request?.url?.includes("token=")) return null;
      return event;
    },
  });
}
```

### 2. Wrap the app with the ErrorBoundary

In `src/App.tsx`, replace the existing `ErrorBoundary` import / usage with Sentry's wrapper:

```tsx
import * as Sentry from "@sentry/react";

// ...

export default Sentry.withErrorBoundary(App, {
  fallback: <div>Something went wrong. Please refresh.</div>,
  showDialog: false,
});
```

Or keep your custom `ErrorBoundary` and wrap it:

```tsx
<Sentry.ErrorBoundary fallback={<YourFallback />}>
  <ErrorBoundary>
    ...
  </ErrorBoundary>
</Sentry.ErrorBoundary>
```

### 3. Add env var in Vercel

Vercel dashboard → `x402-frontend` project → Settings → Environment Variables → Add:

- **Name**: `VITE_SENTRY_DSN`
- **Value**: (DSN from Sentry project `x402-bazaar-frontend`)
- **Environment**: Production (+ Preview if you want)

### 4. Test

After redeploy, open the live site, open DevTools console, run:

```js
throw new Error("Sentry frontend smoke test");
```

You should see the error appear in Sentry within 60s.

---

## What to monitor (alerts to set up)

In Sentry → Alerts → Create alert:

### Backend
- **Any new issue** → Slack / Telegram / email
- **5xx errors > 10 / minute** → immediate page (critical)
- **Wallet-related errors** (search `wallet` OR `payment`) → immediate page

### Frontend
- **Any unhandled error with > 100 users affected in 1 hour**
- **Failed wallet connections > 20 / hour**
- **White-screen of death (ErrorBoundary caught)**

---

## Cost

- Sentry free tier: 5k errors/month, 10k transactions/month — enough for our current volume
- Paid tier starts at $26/month — defer until we cross free limits

---

## Rollout

1. Install + init locally, verify no breakage
2. Deploy to staging first if available
3. Deploy to prod, verify smoke tests land in Sentry
4. Set up alerts
5. Add `SENTRY_DSN` to the repo README as a required env var for new maintainers

That's it. You now have a visible eye on every error in production.
