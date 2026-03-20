# Credential Validation at Registration

**Date:** 2026-03-20
**Status:** Approved
**Session:** 90

## Problem

When a provider registers a service with API credentials (bearer token, API key, basic auth, query param), the credentials are stored without verification. If credentials are invalid, consumers only discover this after paying — resulting in wasted payments and bad UX.

## Solution

Pre-ping the upstream service with the provided credentials before accepting registration. If the upstream explicitly rejects the credentials (401/403), block the registration. If the upstream is unreachable or returns server errors, accept with a warning.

## Decision: Block on Invalid Credentials (Approach A)

When credentials are explicitly rejected (HTTP 401/403), the service is NOT created. The provider receives a 400 error with a clear message. This forces providers to supply valid credentials upfront, protecting consumers.

## Architecture

### New Module: `lib/credentialValidator.js`

**Function:** `validateCredentials(upstreamUrl, rawCredentials)`

**Parameters:**
- `upstreamUrl` (string): The upstream service URL to test
- `rawCredentials` (object): Parsed credentials object `{ type, credentials: [{ key, value, location? }] }`

**Returns:** `{ valid: boolean, warning?: string, error?: string }`

**Flow:**
1. If no credentials provided → `{ valid: true }` (skip)
2. Build headers/URL using existing `injectCredentials()` from `lib/credentials.js`
3. Send HTTP HEAD request to upstream URL with injected credentials (timeout: 10s)
4. If HEAD returns 405 Method Not Allowed → retry with GET
5. Interpret response:

| Upstream Response | Result | Rationale |
|---|---|---|
| 2xx | `{ valid: true }` | Credentials accepted |
| 401, 403 | `{ valid: false, error: "Upstream rejected credentials (HTTP {code})" }` | Credentials explicitly invalid |
| 404 | `{ valid: true, warning: "URL returned 404 but credentials were not rejected" }` | URL may be wrong but creds are OK |
| 5xx | `{ valid: true, warning: "Upstream returned {code} — credentials not verified" }` | Service temporarily down |
| Timeout | `{ valid: true, warning: "Upstream unreachable — credentials not verified" }` | Network issue, not auth issue |
| DNS/Network error | `{ valid: true, warning: "Upstream unreachable — credentials not verified" }` | Same as timeout |

**SSRF Protection:** Reuses existing `safeUrl()` from `lib/safe-url.js` (5-layer defense: protocol, hostname regex, DNS resolution, IP block, cache). Validation is rejected if `safeUrl()` fails.

### Integration Points

#### 1. `attachCredentials()` in `routes/register.js`

Currently fire-and-forget. Becomes `await attachCredentials()` that:
1. Validates schema with Zod (`ServiceCredentialsSchema`)
2. Calls `validateCredentials(serviceUrl, parsedCreds)`
3. If `valid: false` → deletes the already-inserted service, throws error
4. If `valid: true` → encrypts and UPDATEs DB as before
5. Returns `{ warning? }` to caller for inclusion in response

#### 2. Routes Modified

- **POST /register** (line ~348): `await attachCredentials()`, handle error → 400
- **POST /quick-register** (line ~255): same
- **POST /batch-register** (line ~474): validate per service, collect errors
- **POST /api/import-openapi** (line ~702): validate ONCE on base URL with shared credentials

### API Response Changes

**Success with valid credentials:**
```json
{
  "success": true,
  "data": { "id": "...", "name": "..." },
  "credential_validation": { "status": "valid" }
}
```

**Success with warning (upstream unreachable):**
```json
{
  "success": true,
  "data": { "id": "...", "name": "..." },
  "credential_validation": { "status": "warning", "message": "Upstream unreachable — credentials not verified" }
}
```

**Failure (credentials rejected):**
```json
{
  "success": false,
  "error": "Credential validation failed: upstream returned 401 Unauthorized. Please check your API credentials."
}
```

**No credentials provided:**
No `credential_validation` field in response (unchanged behavior).

## Security Considerations

- **SSRF:** Blocked by existing `safeUrl()` — internal IPs, metadata endpoints, non-HTTP protocols all rejected
- **Credential logging:** Never log credential values, even on error. Only log service ID and HTTP status
- **Timeout:** 10 seconds max to prevent slow-loris style registration blocking
- **No credential exposure:** Credentials are decrypted in-memory only for the test request, then discarded

## Test Plan (20+ tests)

### Unit Tests: `credentialValidator`
1. No credentials → skip, `{ valid: true }`
2. Bearer credentials + upstream 200 → `{ valid: true }`
3. API-key credentials + upstream 200 → `{ valid: true }`
4. Basic auth credentials + upstream 200 → `{ valid: true }`
5. Query param credentials + upstream 200 → `{ valid: true }`
6. Upstream 401 → `{ valid: false }`
7. Upstream 403 → `{ valid: false }`
8. Upstream 500 → `{ valid: true, warning }`
9. Upstream timeout → `{ valid: true, warning }`
10. DNS failure → `{ valid: true, warning }`
11. HEAD 405 then GET 200 → `{ valid: true }`
12. HEAD 405 then GET 401 → `{ valid: false }`
13. Upstream 404 → `{ valid: true, warning }`
14. SSRF URL (localhost) → `{ valid: false }`

### Integration Tests: Registration Routes
15. POST /register with valid credentials → 201 + `credential_validation.status: "valid"`
16. POST /register with invalid credentials → 400 + service NOT in DB
17. POST /register without credentials → 201 (no validation field)
18. POST /register with unreachable upstream → 201 + warning
19. POST /quick-register with invalid credentials → 400
20. POST /api/import-openapi with invalid credentials → 400

### Credential Injection Tests
21. Bearer token correctly injected in Authorization header
22. API key correctly injected in X-API-Key header
23. Basic auth correctly injected as Base64
24. Query param correctly appended to URL

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/credentialValidator.js` | CREATE | Validation module |
| `tests/credentialValidator.test.js` | CREATE | Unit + integration tests |
| `routes/register.js` | MODIFY | Integrate validation in all registration routes |

## Implementation Order (TDD)

1. Write tests for `credentialValidator` (all red)
2. Implement `credentialValidator.js` (make tests green)
3. Write integration tests for routes (red)
4. Modify `routes/register.js` to call validator (green)
5. Run full test suite (1996 + new tests, 0 fail)
6. Code review + simplify
7. Push
