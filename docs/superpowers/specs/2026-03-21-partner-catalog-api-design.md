# Partner Catalog API — Design Spec

## Context

XONA/Orbit team wants to pull the x402 Bazaar catalog into their marketplace so their AI agents can discover and call premium API endpoints. Phase 1: read-only catalog endpoint + integration doc.

## Endpoint

`GET /api/catalog`

### Response format

```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": "uuid",
      "name": "Web Search API",
      "description": "Search the web via DuckDuckGo",
      "price_usdc": 0.001,
      "tags": ["search", "web"],
      "status": "online",
      "trust_score": 95,
      "required_parameters": { "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] },
      "has_credentials": false,
      "logo_url": null,
      "call_endpoint": "https://x402-api.onrender.com/api/call/uuid"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 98,
    "pages": 1
  },
  "meta": {
    "marketplace": "x402 Bazaar",
    "website": "https://x402bazaar.org",
    "payment_protocol": "x402 (HTTP 402 + USDC)",
    "supported_chains": ["base", "skale", "polygon"],
    "proxy_base_url": "https://x402-api.onrender.com"
  }
}
```

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | int | 1 | Page number |
| limit | int | 100 | Items per page (max 200) |
| search | string | — | Filter by name/description (ILIKE) |
| tag | string | — | Filter by tag |
| status | string | — | Filter by status (online/offline/degraded) |

### Behavior

- **CORS**: `Access-Control-Allow-Origin: *` (this endpoint only)
- **Cache**: `Cache-Control: public, max-age=300, stale-while-revalidate=600`
- **Rate limit**: dashboard tier (60 req/min)
- **Auth**: none required
- **Filters**: excludes `pending_validation` services (same as /api/services)
- **Fields exposed**: curated subset — no owner_address, no url (upstream), no encrypted_credentials
- **call_endpoint**: pre-built URL for proxy calls

### Fields NOT exposed (security)

- `url` (upstream endpoint — proprietary)
- `owner_address` (provider wallet)
- `encrypted_credentials` (always stripped)
- `credential_type` (internal detail)
- `verified_at`, `created_at` (internal timestamps)
- `erc8004_agent_id`, `erc8004_registered_at` (internal)

## Integration doc (markdown for IBAM)

Contents:
1. Catalog endpoint URL + query params
2. Response format with field descriptions
3. How to call an API via the proxy (x402 payment flow)
4. Code example: fetch catalog + display + call
5. Supported chains + USDC contract addresses
6. Rate limits and caching behavior

## Implementation

### Files to create
- `x402-bazaar/routes/catalog.js` — new route module

### Files to modify
- `x402-bazaar/server.mjs` — mount catalog router

### Files to create (doc)
- `x402-bazaar/docs/INTEGRATION-GUIDE.md` — partner integration guide for IBAM

### Tests
- Add catalog tests to `x402-bazaar/tests/catalog.test.js`
