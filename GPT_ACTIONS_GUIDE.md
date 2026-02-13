# Custom GPT Actions — x402 Bazaar

Guide to create a Custom GPT that uses x402 Bazaar as an API backend.

## Prerequisites

- ChatGPT Plus or Enterprise account (GPT Actions require paid plan)
- The OpenAPI spec is served at: `https://x402-api.onrender.com/.well-known/openapi.json`

## Step-by-step Setup

### 1. Go to the GPT Editor

Navigate to [chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)

### 2. Configure the GPT

**Name:** x402 Bazaar

**Description:** Access 41+ real-time API services via the x402 payment protocol. Weather, crypto prices, web search, AI image generation, code execution, and more.

**Instructions (System Prompt):**

```
You are x402 Bazaar Assistant, an AI agent connected to the x402 Bazaar API marketplace.

You have access to 41+ real-time API endpoints. Free endpoints (marketplace info, health check, monitoring status) return data directly. Paid endpoints return HTTP 402 with payment details.

BEHAVIOR:
- When a user asks for information available via an API (weather, crypto prices, Wikipedia, etc.), call the appropriate endpoint.
- Free endpoints: call them directly and return the data.
- Paid endpoints (HTTP 402): explain to the user that this API costs X USDC on Base blockchain. Show them the payment details from the 402 response:
  - Amount in USDC
  - Recipient wallet address
  - Chain: Base (chainId 8453)
  - Token: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- Suggest they use the x402 CLI (`npx x402-bazaar call <endpoint>`) or MCP integration for automatic payments.
- Always be helpful and suggest the right endpoint for the user's needs.

PRICING TIERS:
- Micro (0.001 USDC): hash, uuid, base64, password, timestamp, lorem, markdown, color, json-validate, useragent
- Nano (0.003 USDC): dns, qrcode-gen, validate-email, headers
- Standard (0.005 USDC): search, scrape, twitter, wikipedia, dictionary, countries, github, npm, ip, qrcode, time, holidays, geocoding, airquality, quote, facts, dogs, translate, currency, readability, sentiment
- Enhanced (0.01 USDC): joke, summarize
- Premium (0.02 USDC): weather, crypto
- Pro (0.05 USDC): image (DALL-E 3), services list

AVAILABLE FREE ENDPOINTS:
- GET / — Marketplace info
- GET /health — Health check
- GET /api/status — Real-time monitoring of all 41 endpoints
- GET /api/status/uptime — Uptime percentages (24h/7d/30d)
- GET /api/agent/{agentId} — ERC-8004 agent identity lookup
```

### 3. Import the OpenAPI Schema

1. Scroll down to **Actions**
2. Click **Create new action**
3. Click **Import from URL**
4. Enter: `https://x402-api.onrender.com/.well-known/openapi.json`
5. The schema will be imported with all 47 endpoints (6 free + 41 paid)

### 4. Set the Privacy Policy

In the Actions configuration:
- **Privacy policy URL:** `https://x402bazaar.org/privacy`

### 5. Authentication

- **Authentication type:** None
- x402 uses HTTP 402 payment protocol, not API keys

### 6. Save and Test

1. Save the GPT
2. Test with free endpoints:
   - "What's the health status of x402 Bazaar?"
   - "Show me the marketplace info"
   - "What's the uptime of the weather API?"
3. Test with paid endpoints:
   - "What's the weather in Paris?" (will show 402 payment details)
   - "Get the Bitcoin price" (will show 402 payment details)

## How Payment Works

When the GPT calls a paid endpoint, it receives a 402 response like:

```json
{
  "error": "Payment Required",
  "x402": {
    "version": "1",
    "payload": {
      "amount": "5000",
      "amountHuman": "0.005 USDC",
      "recipient": "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430",
      "chain": "base",
      "chainId": 8453,
      "token": "USDC",
      "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    }
  },
  "instructions": "Send USDC to the recipient address on Base, then retry with X-Payment-TxHash header"
}
```

The GPT displays this information to the user and explains how to pay. For automatic payments, users should use:
- **CLI:** `npx x402-bazaar call /api/weather?city=Paris --key wallet.json`
- **MCP:** Configure in Claude Desktop or Cursor for seamless payments
- **LangChain:** Use the `x402-langchain` Python package

## Updating the Schema

The OpenAPI spec is served dynamically from the backend. To add new endpoints:

1. Add the wrapper in `routes/wrappers.js`
2. Add the path in `openapi.json`
3. Push to GitHub (auto-deploys to Render)
4. The GPT will automatically use the updated schema on next conversation

## Links

- **API:** https://x402-api.onrender.com
- **Website:** https://x402bazaar.org
- **OpenAPI Spec:** https://x402-api.onrender.com/.well-known/openapi.json
- **GitHub:** https://github.com/Wintyx57/x402-backend
- **npm CLI:** https://www.npmjs.com/package/x402-bazaar
- **Privacy Policy:** https://x402bazaar.org/privacy
