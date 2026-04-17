# Security

x402 Bazaar processes real USDC payments. Security is not an afterthought — it's the product.

This page documents what we do to protect users, providers, and their funds.

## Reporting a vulnerability

If you find a security issue, please email **robin.fuchs57@hotmail.com** with subject `[SECURITY]`. Do not open a public GitHub issue for security-sensitive bugs.

We commit to acknowledging reports within 48 hours. For critical vulnerabilities (RCE, wallet drain, credential leak), we aim to patch within 24h of confirmation.

We're in the process of setting up a formal bug bounty program on Immunefi — stay tuned.

---

## What we protect

### 1. Your wallet private keys

**We never see your private keys.** Ever.

- Agents sign transactions **locally** in the MCP server, SDK, or CLI — the signed transaction is broadcast directly to the chain RPC, never through our backend.
- The MCP local wallet is encrypted at rest with AES-256-GCM. If you set `WALLET_PASSPHRASE`, the key is derived via PBKDF2 (100k iterations, per-wallet random salt). Without a passphrase, a legacy machine-bound key is used and a loud warning is logged.
- `export_private_key` (MCP tool) never returns the key in its response — it only shows where the encrypted file lives on disk.

### 2. Provider API credentials

Providers who need upstream auth (Bearer, API key, Basic) give us their secret **once**. We:

- Encrypt it with AES-256-GCM (random 12-byte IV, 16-byte auth tag) using a key stored only in Render env (`CREDENTIALS_ENCRYPTION_KEY`)
- Decrypt only in-memory at request time
- Never log, never return the plaintext
- Sanitize every `services.*` API response to replace `encrypted_credentials` with `has_credentials: true`

### 3. Payment replay protection

Every transaction hash can only be consumed **once**:

- A compound key `{chain}:{txHash}` (or `{chain}:split_provider:{txHash}` for split mode) is inserted into `used_transactions` **atomically** via an `INSERT` that fails on duplicate
- Before the INSERT, an in-memory `_pendingClaims` set prevents two concurrent requests on the same process from reaching the DB race
- On refund failure, the row is rolled back to `status: rolled_back` rather than deleted, so we keep the audit trail

### 4. Anti-SSRF

Provider URLs are validated via `lib/safe-url.js`:

- DNS resolution forced to IPv4 with `family: 4`
- Private ranges blocked: `10.*`, `172.16–31.*`, `192.168.*`, `127.*`, `169.254.*`, `::1`, `fc00::`, `fe80::`
- 10-second TTL cache on resolved IPs to mitigate DNS rebinding
- Also applied to ai.js, intelligence.js, web.js wrappers

### 5. EIP-3009 off-chain signing (facilitator mode)

- Authorizations carry a `validAfter` of `now - 30s`, `validBefore` of `now + maxTimeoutSeconds` (capped at 300s)
- Nonces are 32 random bytes, kept in an in-memory set for the session
- Signatures are bound to the caller's chain (`chainId` in EIP-712 domain) — cross-chain replay impossible

### 6. Admin authentication

- Legacy: `X-Admin-Token` header compared via `crypto.timingSafeEqual` on equal-length padded buffers (avoids timing leak on length)
- Modern: `admin_session` cookie, `httpOnly` + `Secure` + `SameSite=Strict`. XSS on any frontend page cannot read this cookie.
- 12-hour session lifetime, sliding window
- Failed login attempts logged with IP

### 7. Rate limiting

Three tiers (via `express-rate-limit`):

- General: 500 req / 15 min / IP
- Paid endpoints: 120 req / min / IP (skipped if `X-Payment-TxHash` present)
- Registration: 10 req / hour / IP
- Admin auth: 10 req / min / IP with `skipSuccessfulRequests: false`

Plus a per-wallet rate limit (`walletRateLimitStore`) to prevent a single signer from DoS-ing the proxy.

### 8. Free tier abuse protection

- IPs are hashed with HMAC-SHA256 (`IP_HASH_SECRET` in env, 32 bytes) — never stored plaintext
- Increment uses an atomic Postgres RPC (`increment_free_usage`) with `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` — no TOCTOU window
- Retention: 7 days, then the hash row is deleted (GDPR-friendly)

### 9. Consumer protection refunds

If the upstream API returns a 5xx, empty body, or content that fails schema validation:

- The payment is automatically refunded on-chain within 60 seconds
- The provider does NOT receive their 95% share for that call
- The transaction is marked `used_transactions.status = rolled_back`
- Your wallet balance is restored; you can retry with the same tx hash

See `lib/refund.js`, `routes/proxy-execute.js`.

### 10. Prototype pollution guard

All user-supplied objects (`required_parameters`, `body`, query params) are filtered to strip `__proto__`, `constructor`, `prototype` keys before any assignment. See `routes/proxy-execute.js`.

### 11. CORS

- Strict origin whitelist (x402bazaar.org, www.x402bazaar.org, Vercel preview URLs, localhost for dev)
- Non-browser requests (no `Origin` header — CLI, MCP, server-to-server) are allowed (no browser policy to enforce)
- `credentials: true` for admin cookie

### 12. HTTP security headers

Via `helmet()`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` with strict whitelist of script-src, connect-src, img-src

Proxied upstream responses additionally receive `Content-Security-Policy: default-src 'none'` to neutralize any malicious HTML/JS an upstream could try to inject.

### 13. Supabase Row Level Security

All tables with user data have RLS enabled:

- `activity`, `monitoring_checks`, `used_transactions`, `pending_payouts`: service-role only
- `services`: public read with `status NOT IN ('quarantined', 'pending_validation')` policy (enforced at DB level, not just in the backend code)
- `reviews`, `budgets`: service-role write, public read

### 14. Dependency scanning

- `npm audit --audit-level=high` blocks PRs on the backend CI
- Python SDK: `ruff` + `mypy` + `safety` in CI
- Dependabot (or equivalent) scheduled weekly for all 7 repos

### 15. Smart contract (FeeSplitter)

- Solidity 0.8.24 (built-in overflow protection)
- `ReentrancyGuard` on `distribute()` and `emergencyWithdraw()`
- `SafeERC20` for every token transfer
- 66 Hardhat tests covering nominal + edge cases (`amount = 1`, `amount = 0`, rounding drift)
- Deployed on Polygon mainnet: `0x820d4b07D09e5E07598464E6E36cB12561e0Ba56` — verified on Polygonscan

A third-party audit (Trail of Bits or ConsenSys Diligence) is on the roadmap.

---

## Recent security actions

| Date | Action |
|------|--------|
| 2026-04-17 | Hardened mathjs sandbox (mitigates GHSA-jvff-x2qm-6286 class) |
| 2026-04-17 | Fixed EIP-3009 header swap that burned USDC on upstream retries |
| 2026-04-17 | Migrated admin auth from sessionStorage to httpOnly cookie |
| 2026-04-17 | Added WALLET_PASSPHRASE (PBKDF2) for MCP wallet encryption |
| 2026-04-17 | HMAC-SHA256 IP hashing with server-side salt (was SHA-256 plain) |
| 2026-04-17 | Atomic free-tier increment (closed TOCTOU bypass) |
| 2026-04-17 | RLS policies tightened: anon cannot read quarantined services |
| 2026-04-17 | Wider URL scrubbing in access logs (token, key, apikey, sig, auth, password) |
| 2026-04-17 | Removed `decryptCmd` leak from `export_private_key` MCP tool |
| 2026-04-14 | Quarantine system for bare-402 APIs |
| 2026-04-10 | Webhook SSRF check |
| 2026-04-06 | Payment protection audit + 6 fixes |
| 2026-04-02 | Pre-investor full platform audit + 15 fixes |

Full audit report in `AUDIT_COMPLET_2026-04-17.md`.

---

## Audit reports

- Internal audit (10 specialized agents in parallel, 2026-04-17): `AUDIT_COMPLET_2026-04-17.md`
- Triangulation audit (Claude + Codex + Gemini consensus, 2026-04-14): `docs/triangulations/2026-04-14-complete-platform-audit.md`

External audits planned:
- Trail of Bits / ConsenSys Diligence — FeeSplitter contract (Q2 2026)
- SOC 2 Type II certification process — starting Q3 2026
