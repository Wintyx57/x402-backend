# RapidAPI One-Click Import — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Goal:** Allow users to import any RapidAPI API into x402 Bazaar by uploading its OpenAPI spec and providing their RapidAPI key. Auto-configures credentials and host.

---

## Problem

Users who want to monetize RapidAPI APIs through x402 Bazaar must manually configure the base URL, credential type, and headers (`X-RapidAPI-Key`, `X-RapidAPI-Host`). This is error-prone and slow. We want a dedicated flow that auto-detects RapidAPI specs and pre-configures everything.

## Design: "Upload Spec + Key → Auto-Configure → Import"

### 1. RapidAPI Detection — `detectRapidAPI(spec)`

New function in `lib/openapi-parser.js`:

```javascript
function detectRapidAPI(spec) {
    // RapidAPI auto-adds x-rapidapi-info to downloaded specs
    const info = spec['x-rapidapi-info'];

    // Also detect by server URL pattern
    const serverUrl = spec.servers?.[0]?.url || '';
    const isRapidAPIHost = serverUrl.includes('.p.rapidapi.com');

    if (!info && !isRapidAPIHost) return null;

    // Extract host: OpenAPI 3.x (servers[]) or Swagger 2.0 (host + basePath)
    const serverUrl = spec.servers?.[0]?.url ||
        (spec.host ? `${(spec.schemes?.[0] || 'https')}://${spec.host}${spec.basePath || ''}` : '');

    let host = null;
    try {
        host = new URL(serverUrl).hostname;
    } catch {}

    // If host could not be extracted, return null — cannot auto-configure without it
    if (!host) return null;

    return {
        isRapidAPI: true,
        host,                           // e.g. "weather.p.rapidapi.com"
        apiId: info?.apiId || null,
        apiVersionId: info?.apiVersionId || null,
        serverUrl,
    };
}
```

**Detection criteria** (any of):
- `spec['x-rapidapi-info']` exists (official RapidAPI marker)
- `spec.servers[0].url` OR `spec.host` contains `.p.rapidapi.com`

**Host extraction**: From `spec.servers[0].url` (OpenAPI 3.x) or `spec.host` (Swagger 2.0). Returns `null` if host cannot be extracted (prevents broken credentials).

**Swagger 2.0 support**: Required because RapidAPI distributes Swagger 2.0 specs for older APIs. The function handles both spec versions.

### 2. Backend Changes

#### `POST /api/import-openapi/preview` — Enriched response

After parsing the spec, call `detectRapidAPI(spec)`. If detected, add to response:

```json
{
    "spec_title": "Weather API",
    "base_url": "https://weather.p.rapidapi.com",
    "endpoints": [...],
    "rapidapi": {
        "detected": true,
        "host": "weather.p.rapidapi.com",
        "apiId": "abc123",
        "hint": "This is a RapidAPI API. Your X-RapidAPI-Key will be auto-configured as credential."
    }
}
```

If not detected, `rapidapi` is `null`. No behavior change for non-RapidAPI specs.

#### `POST /api/import-openapi` — No changes needed

The existing endpoint already accepts `credentials` + `credential_type`. The frontend/MCP formats the RapidAPI credentials as:
```json
{
    "credential_type": "header",
    "credentials": [
        { "key": "X-RapidAPI-Key", "value": "<user_key>" },
        { "key": "X-RapidAPI-Host", "value": "<auto_from_spec>" }
    ]
}
```

This uses the existing `ServiceCredentialsSchema` array format. The backend encrypts with AES-256-GCM via `attachCredentials()`, the proxy injects at request time via `injectCredentials()`. Zero changes needed.

### 3. Frontend — `/import/rapidapi` Page

New page `ImportRapidAPI.tsx` — simplified 3-step wizard:

**Step 1: Upload & Key**
- Drag-drop or file picker for OpenAPI spec (JSON/YAML)
- Link: "Download your spec from RapidAPI → [API Dashboard > Definitions > Download]"
- On upload: parse spec client-side, call preview endpoint
- If `rapidapi.detected`: show green badge "RapidAPI Detected — Host: weather.p.rapidapi.com"
- If NOT detected: show warning "This spec doesn't appear to be from RapidAPI. Use the standard import instead."
- Input: X-RapidAPI-Key (password field, required)
- No client-side "Test Connection" — the server-side credential validation during import handles this (via `credentialValidator.js`). A browser-side test would use a different network path than the server proxy and could give misleading results.

**Step 2: Preview & Price**
- Reuse `ImportOpenAPI.tsx` preview UI (endpoint list with checkboxes)
- Slider for default price (0.001 - 1 USDC)
- Tags input (optional)
- Show: "X endpoints will be imported. Credentials auto-configured."

**Step 3: Sign & Import**
- Sign with wallet (EIP-191, same as existing import)
- Credentials auto-formatted (array format matching `ServiceCredentialsSchema`):
  ```json
  {
      "type": "header",
      "credentials": [
          { "key": "X-RapidAPI-Key",  "value": "abc123" },
          { "key": "X-RapidAPI-Host", "value": "weather.p.rapidapi.com" }
      ]
  }
  ```
- Call `POST /api/import-openapi` (existing endpoint)
- Success: show imported services count + links

**Navigation**: Add "Import from RapidAPI" button on:
- `/import` page (existing, add a RapidAPI tab/section)
- `/register` page (add link)
- Navbar Providers dropdown

### 4. MCP Tool — `import_rapidapi`

New tool in `mcp-server.mjs`:

```javascript
server.tool(
    'import_rapidapi',
    'Import a RapidAPI API into x402 Bazaar. Upload the OpenAPI spec (downloaded from RapidAPI) and provide your X-RapidAPI-Key. Credentials are auto-configured. Free.',
    {
        spec_url: z.string().url().describe('URL to the OpenAPI spec file (JSON/YAML)'),
        rapidapi_key: z.string().min(10).describe('Your X-RapidAPI-Key from rapidapi.com'),
        default_price: z.number().min(0.001).max(1000).describe('Default price per call in USDC'),
        exclude_paths: z.array(z.string()).optional(),
    },
    async ({ spec_url, rapidapi_key, default_price, exclude_paths }) => {
        // 1. Fetch and parse spec
        // 2. detectRapidAPI() → extract host
        // 3. Format credentials as header type
        // 4. Sign EIP-191
        // 5. Call POST /api/import-openapi with credentials
        // 6. Return results
    }
);
```

**Total MCP tools after this**: 14 (was 13).

### 5. Credential Format

RapidAPI requires two headers on every request:
- `X-RapidAPI-Key: <user_key>` (authentication)
- `X-RapidAPI-Host: <api_host>` (routing)

These are stored using the existing `ServiceCredentialsSchema` format (array of key-value pairs):
```json
{
    "type": "header",
    "credentials": [
        { "key": "X-RapidAPI-Key",  "value": "abc123" },
        { "key": "X-RapidAPI-Host", "value": "weather.p.rapidapi.com" }
    ]
}
```

This matches the `CredentialItemSchema` in `schemas/index.js`. The backend encrypts with AES-256-GCM via `attachCredentials()`, and `injectCredentials()` in `lib/credentials.js` iterates the array to inject each header at proxy time. Zero changes needed to the credential pipeline.

### 6. Files Modified

| File | Changes |
|------|---------|
| `lib/openapi-parser.js` | Add `detectRapidAPI(spec)`, export it |
| `routes/register.js` | Enrich preview response with `rapidapi` field |
| `mcp-server.mjs` | Add `import_rapidapi` tool |
| `tests/openapi-import.test.js` | Tests for `detectRapidAPI()` (5-8 tests) |
| `x402-frontend/src/pages/ImportRapidAPI.tsx` | New page — 3-step wizard |
| `x402-frontend/src/App.tsx` | Add route `/import/rapidapi` |
| `x402-frontend/src/i18n/translations.js` | Add `importRapidapi.*` keys EN/FR |

### 7. What Does NOT Change

- `POST /api/import-openapi` endpoint — untouched
- `POST /api/import-openapi/preview` — only enriched response (backward compatible)
- Credential encryption (AES-256-GCM) — untouched
- Proxy credential injection — untouched
- Existing `import_openapi` MCP tool — untouched
- All existing tests — must still pass

### 8. Testing Strategy

**Unit tests (~8 new):**
- `detectRapidAPI()` with real RapidAPI spec (x-rapidapi-info present)
- `detectRapidAPI()` with .p.rapidapi.com server URL (no x-rapidapi-info)
- `detectRapidAPI()` with non-RapidAPI spec → null
- `detectRapidAPI()` with missing servers → null, host null
- Preview endpoint returns `rapidapi` field when detected
- Preview endpoint returns `rapidapi: null` when not detected
- Credential format: multi-header with `\n` separator
- MCP tool formats credentials correctly

**Live test (manual):**
- Download a real RapidAPI spec (e.g., Weather API)
- Import via frontend wizard
- Verify proxy calls work with auto-injected credentials
