# x402 Bazaar — Partner Integration Guide

> For XONA/Orbit and other marketplace partners looking to embed the x402 Bazaar API catalog.

## 1. Catalog Endpoint

```
GET https://x402-api.onrender.com/api/catalog
```

**No authentication required.** CORS is open (`*`) — you can call this from any frontend.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 100 | Items per page (max 200) |
| `search` | string | — | Filter by name or description |
| `tag` | string | — | Filter by tag (e.g. `search`, `ai`, `weather`) |
| `status` | string | — | Filter by status: `online`, `offline`, `degraded` |

### Response

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "name": "Web Search API",
      "description": "Search the web via DuckDuckGo. Returns titles, URLs, and snippets.",
      "price_usdc": 0.001,
      "tags": ["search", "web"],
      "status": "online",
      "trust_score": 95,
      "required_parameters": {
        "type": "object",
        "properties": { "q": { "type": "string", "description": "Search query" } },
        "required": ["q"]
      },
      "has_credentials": false,
      "logo_url": null,
      "call_endpoint": "https://x402-api.onrender.com/api/call/a1b2c3d4-..."
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
    "proxy_base_url": "https://x402-api.onrender.com",
    "docs": "https://x402bazaar.org/docs"
  }
}
```

### Field Reference

| Field | Description |
|-------|-------------|
| `id` | Unique service UUID |
| `name` | Human-readable API name |
| `description` | What the API does |
| `price_usdc` | Cost per call in USDC (6 decimals) |
| `tags` | Array of category tags |
| `status` | `online` / `offline` / `degraded` / `unknown` |
| `trust_score` | 0-100 quality score (null if not yet scored) |
| `required_parameters` | JSON Schema describing required input params |
| `has_credentials` | Whether the API requires provider credentials |
| `logo_url` | Logo URL (nullable) |
| `call_endpoint` | **Ready-to-use URL** for calling via our proxy |

### Caching

Responses are cached for 5 minutes (`Cache-Control: public, max-age=300`). You can cache on your side too — the catalog doesn't change every second.

### Rate Limits

60 requests per minute. More than enough for periodic catalog sync.

---

## 2. How to Call an API (x402 Payment Flow)

When an Orbit agent selects an API from the catalog, here's the payment flow:

### Step 1: First call returns HTTP 402

```bash
curl -X POST https://x402-api.onrender.com/api/call/SERVICE_ID \
  -H "Content-Type: application/json" \
  -d '{"q": "latest AI news"}'
```

Response (402):
```json
{
  "error": "Payment Required",
  "price": "0.001 USDC",
  "amount_usdc": 0.001,
  "payment_address": "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430",
  "supported_chains": [
    { "chain": "base", "chainId": 8453 },
    { "chain": "skale", "chainId": 1187947933 },
    { "chain": "polygon", "chainId": 137 }
  ],
  "usdc_contracts": {
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "skale": "0xCC205196288B7A26f6D43bBD68AaA98dde97b75F",
    "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  }
}
```

### Step 2: Send USDC on-chain

Transfer the exact USDC amount to `payment_address` on any supported chain.

**All chains use 6 decimals for USDC.**

### Step 3: Retry with payment proof

```bash
curl -X POST https://x402-api.onrender.com/api/call/SERVICE_ID \
  -H "Content-Type: application/json" \
  -H "X-Payment-TxHash: 0xabc123..." \
  -H "X-Payment-Chain: base" \
  -d '{"q": "latest AI news"}'
```

Response (200):
```json
{
  "success": true,
  "data": {
    "results": [...]
  }
}
```

### Chain Recommendations

| Chain | Gas Cost | Speed | Best For |
|-------|----------|-------|----------|
| **SKALE** | ~$0.0007 | Instant | High-volume agent calls |
| **Base** | ~$0.01 | 2-3 sec | Standard usage |
| **Polygon** | ~$0.001 | 2-3 sec | Polygon-native agents |

SKALE is recommended for AI agents due to ultra-low gas costs.

---

## 3. Quick Integration Example

### Fetch and display the catalog (JavaScript)

```javascript
async function fetchCatalog({ search, tag, status } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (tag) params.set('tag', tag);
  if (status) params.set('status', status);

  const url = `https://x402-api.onrender.com/api/catalog?${params}`;
  const res = await fetch(url);
  const { data, pagination, meta } = await res.json();

  return { apis: data, pagination, meta };
}

// Example: get all online AI-related APIs
const { apis } = await fetchCatalog({ search: 'ai', status: 'online' });

for (const api of apis) {
  console.log(`${api.name} — $${api.price_usdc} USDC`);
  console.log(`  Status: ${api.status} | Trust: ${api.trust_score}`);
  console.log(`  Call: ${api.call_endpoint}`);
}
```

### Call an API via the proxy (after payment)

```javascript
async function callApi(callEndpoint, params, txHash, chain = 'base') {
  const res = await fetch(callEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-TxHash': txHash,
      'X-Payment-Chain': chain,
    },
    body: JSON.stringify(params),
  });

  if (res.status === 402) {
    // Payment required — extract payment details from response
    return { needsPayment: true, details: await res.json() };
  }

  return { needsPayment: false, data: await res.json() };
}
```

### Full agent flow

```javascript
// 1. Browse catalog
const { apis } = await fetchCatalog({ tag: 'search' });
const searchApi = apis[0];

// 2. First call — get payment requirements
const firstTry = await callApi(searchApi.call_endpoint, { q: 'web3 news' });

if (firstTry.needsPayment) {
  // 3. Send USDC on-chain (using your wallet/SDK)
  const txHash = await sendUSDC(
    firstTry.details.payment_address,
    firstTry.details.amount_usdc,
    'base' // or 'skale' for lower gas
  );

  // 4. Retry with payment proof
  const result = await callApi(searchApi.call_endpoint, { q: 'web3 news' }, txHash, 'base');
  console.log(result.data);
}
```

---

## 4. Tips for Agent Integration

- **Cache the catalog** on your side (refresh every 5-10 minutes)
- **Use `required_parameters`** to validate agent inputs before calling
- **Check `status`** — only show `online` APIs to users, warn on `degraded`
- **Use `trust_score`** to sort/rank APIs in your marketplace
- **SKALE chain** is best for agent automation (ultra-low gas)
- **Batch calls** are not supported yet — each call is one payment

---

## 5. Support

- Website: https://x402bazaar.org
- Docs: https://x402bazaar.org/docs
- GitHub: https://github.com/Wintyx57/x402-backend

Questions? Reach out to Robin directly.
