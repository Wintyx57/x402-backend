# Changelog

All notable changes to x402 Bazaar will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.8.0] - 2026-05-05

### Added — Observability
- **Sentry backend**: `instrument.js` initialised before any other require; `Sentry.setupExpressErrorHandler(app)` after routes; PII scrubbed in `beforeSend` (Authorization, Cookie, X-Admin-Token, X-Payment headers; query-string secrets). Activated by `SENTRY_DSN` env var.
- **PostHog backend**: `lib/analytics.js` — best-effort capture, no-ops when `POSTHOG_PROJECT_API_KEY` unset. 3 critical events wired:
  - `api_call_paid_succeeded` in `lib/payment.js` after successful on-chain verification (service, amount_usdc, chain, facilitator).
  - `provider_registered` in `routes/register.js` after full registration (service_name, price, has_credentials).
  - `service_quarantined` in `routes/admin-quarantine.js` after manual quarantine (service_name, reason).
- Test endpoint `GET /__sentry-test` — forces a 500 + Sentry capture (only when SENTRY_DSN set). Remove after first verified event.
- Graceful shutdown now flushes PostHog and closes Sentry with 2s timeout.

### Added — Operations
- `migrations/033_quarantine_no_x402_bulk.sql` — idempotent SQL bulk-quarantine of services with `verified_status='no_x402'` (catalog cleanup).
- `scripts/cleanup-catalog.js` — Node script that calls `POST /api/admin/quarantine/:id` for each `no_x402` service. Reports JSON. Supports `--dry-run`.

### Env vars to add
- `SENTRY_DSN` (Render)
- `POSTHOG_PROJECT_API_KEY` (Render)
- `POSTHOG_HOST` (optional, defaults to `https://us.i.posthog.com`)
- `SENTRY_TRACES_SAMPLE_RATE` (optional, defaults to `0.1`)

## [2.7.0] - 2026-04-17

### Security (from full audit — 4 P0 + 11 P1)
- **[P0]** Hardened mathjs sandbox in `/api/math` — blocked RCE vector via import/createUnit/parse/simplify/derivative/resolve (GHSA-jvff-x2qm-6286 class). Strict character whitelist as defense-in-depth.
- **[P0]** Fixed EIP-3009 header swap (`X-PAYMENT` vs `PAYMENT-SIGNATURE`) in proxy upstream retry. Previously burned USDC on every retry because upstream rejected the v2 payload under the v1 header.
- **[P0]** Fixed refund rollback `replayKey` format drift between `proxy-split.js` (insert) and `proxy-execute.js` (rollback). `req._claimedReplayKeys` is now the single source of truth.
- **[P0]** MCP wallet encryption: added `WALLET_PASSPHRASE` via PBKDF2-SHA256 (100k iterations, per-wallet random salt). Legacy machine-key fallback retained with warning on every decryption. `export_private_key` no longer returns a ready-to-run decryption command (prevented leak via LLM conversation logs).
- RLS on `services` table now filters `quarantined` / `pending_validation` at the DB level, not only in the backend code (anon key can no longer bypass).
- Free-tier IP hashing: migrated from plain SHA-256 (rainbow-table reversible) to HMAC-SHA256 with a required `IP_HASH_SECRET` env var.
- Free-tier increment: migrated from SELECT-then-UPDATE (TOCTOU) to an atomic Postgres RPC (`increment_free_usage`) — concurrent requests from the same IP can no longer double-count free quota.
- Admin session: new httpOnly cookie endpoint `POST/DELETE /api/admin/session`. Legacy `X-Admin-Token` header still supported for CI/server-to-server. Frontend migrated away from sessionStorage (XSS-proof).
- CRON_SECRET no longer passed in the URL query string — migrated to `Authorization: Bearer` header.
- Widened URL secret scrubbing in access logs (token, key, apikey, sig, auth, password, credential, access_token).
- CSP + `X-Content-Type-Options: nosniff` now sent on every proxied response to neutralize malicious upstream HTML/JS.

### Fixed
- Eliminated double-charge of agent budget in legacy flow (`proxy.js` + `payment.js` were both calling `checkAndRecord`).
- `upstreamPayer._getClients` now uses viem's `fallback()` transport over all `rpcUrls` instead of only the primary — relay survives primary RPC outage.
- `monitor.fetchExternalServices` now skips `quarantined` / `pending_validation` services.
- `owner_address` / `provider_wallet` normalized to lowercase at write-time via Zod `.transform()`. All reads now use indexed `eq()` instead of sequential-scan `ilike()`.
- `getRelayBalance` catch block now logs the error instead of silently returning `null` (low-balance alert was invisibly disabled on RPC errors).
- HeroScene: old `CanvasTexture` now disposed before font-ready replacement (GPU leak).
- HeroScene: `requestAnimationFrame` paused on `document.hidden` (battery + CPU on hidden tabs).
- Carousel3D: `onNavigate` captured via `useRef` to avoid stale closure when parent re-renders.
- MyApis: 3 `address!` non-null assertions removed; `handleDelete` surfaces errors in the modal; chart data/options `useMemo`'d; shadowed `t` variable renamed; `deactivateError` reset before each attempt.
- ConfirmModal: added `role="dialog"` + `aria-modal` + focus trap + ESC to close.
- App.tsx: skip link + `<main>` landmark + `<h1 sr-only>` on homepage (WCAG 2.4.1 / 1.3.1).

### Added
- New package `lib/http-client.js` — single shared `fetchWithTimeout` implementation (AbortController-based, dedup MCP + backend).
- 6 new migrations: `028` (RLS filter), `029` (atomic free-tier increment), `030` (wallet address normalization + indexes), `031` (aggregate RPCs: `activity_payment_stats`, `payouts_revenue_overview`), `032` (CHECK constraints on enums), `033` (`used_transactions.created_at` + index for retention).
- `lib/retention.js` now purges `used_transactions` older than 180 days.
- New doc: `docs/PROVIDER_GUIDE.md` — complete provider onboarding.
- New doc: `SECURITY.md` — public security posture.
- New cookbooks: LangGraph agent, OpenAI Assistants, Vercel AI SDK.
- Dashboard aggregate stats now use Postgres RPC instead of loading 10k rows to sum in JS.
- Dependabot config: weekly scans for npm + github-actions, grouped by ecosystem.

### Changed
- `mathjs` bumped to 15.2.0 (patched), `axios` to ≥1.15, `follow-redirects` to ≥1.15.11, `hono` + `@hono/node-server` to latest (closed 4 moderate npm audit findings).
- README: corrected APIs count (69 native + 43 marketplace = 112), test count (2136), Node engine (≥20), MCP version (2.7.0).
- MCP_SETUP.md: corrected tool pricing (search/list/find/schema are FREE), added Polygon chain, updated tool list to 15.

### Deprecated
- `FAUCET_PRIVATE_KEY` and `FEE_SPLITTER_OPERATOR_KEY` marked for removal from render.yaml pending code-path cleanup.

### Migrations to apply manually (via Supabase SQL Editor)
- Migrations 028 → 033 must be applied in order. All are idempotent and additive.

### Required env vars (new)
- `IP_HASH_SECRET` (required, 32+ hex chars) — HMAC salt for free-tier IP hashing
- `WALLET_PASSPHRASE` (optional, recommended) — passphrase for MCP wallet PBKDF2 encryption

## [2.6.0] - 2026-03-30

### Added
- Protocol Sniffer "Zero Surprise" — 3-layer protocol detection (register probe, runtime 402 detection, monitor re-sniff)
- Universal Upstream Relay — platform pays upstream on behalf of agents (EIP-3009 off-chain signing on Base/Polygon, direct transfer elsewhere). Agent pays platform legacy, platform pays upstream, net payout to provider.
- EIP-3009 signing: `transferWithAuthorization` for x402-standard facilitators. X-PAYMENT (v1) + PAYMENT-SIGNATURE (v2) dual headers for max compatibility.
- Universal 402 Protocol Adapter — detects 10 formats (x402-v2, x402-standard, L402, MPP, stripe402, direct-wallet, etc.), normalizes into single shape.
- Thirdweb Connect + Fiat Onramp (replaced RainbowKit).
- Python SDK v1.3.0 on PyPI (`pip install x402-bazaar`) — async CrewAI, enriched LangChain, 147 tests.
- ERC-8004 on-chain identity + reputation for 74 agents on SKALE.
- Trails SDK bridge at /fund (Base → SKALE USDC bridge).

## [2.5.0] - 2026-03-18

### Added
- Budget Guardian — per-wallet spending caps with 50/75/90% alerts.
- Parameter Gatekeeper — validates required params BEFORE payment (returns 400 + `_payment_status: not_charged`).
- Payment Links — shareable pay-per-call URLs for off-catalog endpoints.
- Payouts system — 95/5 split, pending_payouts table, auto-payout cron every 6h, self-service withdrawal.
- Provider analytics at `/my-apis` — revenue charts, by-service, by-chain, pending vs paid.
- OpenAPI + RapidAPI one-click import.

## [2.4.1] - 2026-03-13

### Added
- Polygon mainnet integration (Phase 1: direct on-chain RPC verification).
- MCP v2.4.1 — 15 tools, multi-chain Base+SKALE+Polygon.
- CLI v3.6 — `npx x402-bazaar call` with auto-payment, `--chain polygon` flag.

## [1.3.0] - 2026-02-26

### Added
- Bazaar Discovery: 69 `declareDiscoveryExtension()` declarations via @x402/extensions v2.5.0 (official Coinbase SDK) — AI agents can now auto-discover all endpoints from 402 responses
- Reviews API: ratings & reviews system for marketplace services
- Dynamic public-stats endpoint now includes live payment count, API call count, and provider wallet breakdown
- SKALE on Base badge on README and /health response
- Wallet rate limit (60 req/min per wallet, configurable via WALLET_RATE_LIMIT)
- Swagger UI interactive docs at /api-docs
- ReDoS protection on /api/regex endpoint
- MIT LICENSE file added

### Changed
- Discovery sync verified: 69 wrapper keys exactly match 69 registered endpoints (phantom routes removed)
- 8 integrations total (added TypeScript SDK + Reviews API)
- Test suite expanded to 478 tests across 14 test suites

### Security
- X-Monitor bypass now requires localhost IP (no more external bypass)
- Admin auth log no longer exposes expected token length
- openapi.json and /health exempt from global rate limit

## [1.2.0] - 2026-02-25

### Added
- 8 intelligence API wrappers (contract-risk, email-parse, code-review, table-insights, domain-report, seo-audit, lead-score, crypto-intelligence)
- Community agent proxy and SSE streams
- Structured JSON logging with correlation IDs
- Data retention auto-purge (90d activity, 30d monitoring)

### Security
- Timing-safe admin token comparison (S1)
- Anti-replay atomic INSERT race protection (S2)
- Budget auth enforcement (S3)
- SSRF protection on scrape/readability endpoints (S4)

## [1.1.0] - 2026-02-13

### Added
- Budget Guardian: spending caps for AI agents (5 API endpoints)
- Monitoring engine: 61 endpoints checked every 5min
- Interactive Telegram bot (11 commands)
- Auto-test on service registration
- 20 new API wrappers (batch 2: hash, uuid, base64, etc.)
- OpenAPI 3.1 spec for ChatGPT Actions (30 operations)
- Public stats endpoint (GET /api/public-stats)

## [1.0.0] - 2026-02-09

### Added
- HTTP 402 payment protocol with on-chain USDC verification
- Multi-chain support (Base mainnet + SKALE on Base)
- 41 native API wrappers
- Anti-replay protection (Supabase persistence + in-memory cache)
- MCP Server v2.1.0 for Claude/Cursor
- Admin dashboard with analytics
- Rate limiting (3 tiers: general, paid, register)
- Helmet.js security headers
- CORS strict whitelist
- 79 E2E tests (node:test, zero deps)
