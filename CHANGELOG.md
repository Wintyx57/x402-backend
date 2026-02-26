# Changelog

All notable changes to x402 Bazaar will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [1.3.0] - 2026-02-26

### Added
- Bazaar Discovery: 69 `declareDiscoveryExtension()` declarations via @x402/extensions v2.5.0 (official Coinbase SDK) — AI agents can now auto-discover all endpoints from 402 responses
- Reviews API: ratings & reviews system for marketplace services
- Dynamic public-stats endpoint now includes live payment count, API call count, and provider wallet breakdown
- SKALE Europa badge on README and /health response
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
- Multi-chain support (Base mainnet + SKALE Europa)
- 41 native API wrappers
- Anti-replay protection (Supabase persistence + in-memory cache)
- MCP Server v2.1.0 for Claude/Cursor
- Admin dashboard with analytics
- Rate limiting (3 tiers: general, paid, register)
- Helmet.js security headers
- CORS strict whitelist
- 79 E2E tests (node:test, zero deps)
