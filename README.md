<p align="center">
  <h1 align="center">x402 Bazaar</h1>
  <p align="center">
    <strong>The decentralized API marketplace where AI agents pay with USDC, not API keys.</strong>
  </p>
  <p align="center">
    <a href="https://x402bazaar.org"><img src="https://img.shields.io/badge/website-x402bazaar.org-blue?style=flat-square" alt="Website"></a>
    <a href="https://www.npmjs.com/package/x402-bazaar"><img src="https://img.shields.io/npm/v/x402-bazaar?style=flat-square&color=green" alt="npm"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License"></a>
    <a href="https://github.com/Wintyx57/x402-backend"><img src="https://img.shields.io/github/stars/Wintyx57/x402-backend?style=flat-square" alt="Stars"></a>
    <a href="https://basescan.org"><img src="https://img.shields.io/badge/chain-Base%20%2B%20SKALE-8b5cf6?style=flat-square" alt="Chain"></a>
  </p>
</p>

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![Tests](https://img.shields.io/badge/tests-478%20passing-brightgreen) ![Render](https://img.shields.io/badge/deploy-Render-46E3B7) ![APIs](https://img.shields.io/badge/APIs-69%20native-blue)

---

## Ecosystem

| Repository | Description |
|------------|-------------|
| **[x402-backend](https://github.com/Wintyx57/x402-backend)** (this repo) | Backend API — Express server, payment middleware, 69 native wrappers, MCP server |
| **[x402-frontend](https://github.com/Wintyx57/x402-frontend)** | React frontend — 15 pages, glassmorphism UI, wallet connect, i18n FR/EN |
| **[x402-langchain](https://github.com/Wintyx57/x402-langchain)** | Python package — LangChain tools for x402 Bazaar (pip install) |
| **[x402-fast-monetization-template](https://github.com/Wintyx57/x402-fast-monetization-template)** | FastAPI template — Monetize any Python function with x402 in 5 minutes |
| **[CLI: npx x402-bazaar](https://www.npmjs.com/package/x402-bazaar)** | One-line setup for Claude Desktop, Cursor, VS Code |
| **[@x402/sdk](https://www.npmjs.com/package/@x402/sdk)** | TypeScript SDK — typed client for x402 Bazaar APIs |
| **[Reviews API](https://x402-api.onrender.com/api/reviews)** | Ratings & reviews system for marketplace services |
| **[Bazaar Discovery](https://x402-api.onrender.com/api/discovery)** | Agent discovery via @x402/extensions v2.5.0 (official Coinbase SDK) |

**Live:** [x402bazaar.org](https://x402bazaar.org) | **API:** [x402-api.onrender.com](https://x402-api.onrender.com) | **Dashboard:** [x402-api.onrender.com/dashboard](https://x402-api.onrender.com/dashboard)

---

## What is x402 Bazaar?

x402 Bazaar is an autonomous API marketplace built on the [HTTP 402 Payment Required](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/402) standard. AI agents discover services, pay in USDC on Base or SKALE Europa (zero gas), and get instant access -- no API keys, no subscriptions, no accounts. The server verifies payments on-chain and enforces anti-replay protection, making every transaction trustless and permissionless.

## Key Features

- **HTTP 402 Protocol** -- Standard-compliant payment flow. Call an endpoint, get a `402` with payment details, pay USDC, retry with tx hash, done.
- **69 Native API Wrappers** -- Web search, URL scraper, Twitter/X, weather, crypto, jokes, DALL-E 3, translation, code execution, sentiment analysis, and 59+ more -- all behind micropayments.
- **70+ Registered Services** -- Growing marketplace of third-party APIs monetized through x402.
- **LangChain Integration** -- Python package `x402-langchain` for agents built with LangChain/LangGraph.
- **Multi-Chain** -- Base (mainnet) + SKALE Europa (zero gas fees via sFUEL).
- **MCP Server** -- Plug into Claude Desktop, Cursor, VS Code, or Claude Code as native AI tools.
- **One-Line Setup** -- `npx x402-bazaar init` detects your IDE and configures everything.
- **Anti-Replay Protection** -- Every transaction hash is stored in Supabase and can only be used once.
- **Budget Control** -- Per-session spending caps for AI agents (configurable `MAX_BUDGET_USDC`).
- **Security Hardened** -- Helmet headers, CORS whitelist, rate limiting (3 tiers), input sanitization, SSRF protection.
- **478 Tests** -- 14 test suites, all passing (node:test, zero deps).
- **Real-Time Monitoring** -- 69 endpoints checked every 5min, Telegram alerts on transitions, public `/api/status` page.
- **Telegram Bot** -- Interactive admin bot with 6 commands (/balance, /stats, /status, /recent, /services, /help).
- **Auto-Test on Registration** -- New services are pinged automatically, with Telegram notification on result.
- **Public Stats** -- `GET /api/public-stats` (no auth) for frontend homepage counters.

## Quick Start

```bash
# One-line setup for AI IDEs (Claude Desktop, Cursor, VS Code)
npx x402-bazaar init
```

Or run the server locally:

```bash
git clone https://github.com/Wintyx57/x402-backend.git
cd x402-backend
npm install
cp .env.example .env   # Fill in your keys
node server.js
```

## How the x402 Payment Flow Works

```
Agent                          x402 Bazaar                     Base / SKALE
  |                                |                                |
  |  GET /api/weather?city=Paris   |                                |
  |------------------------------->|                                |
  |  402 Payment Required          |                                |
  |  { amount: 0.02, recipient }   |                                |
  |<-------------------------------|                                |
  |                                |                                |
  |  Transfer 0.02 USDC ------------------------------------------>|
  |  tx: 0xabc123...              |                                |
  |                                |                                |
  |  GET /api/weather?city=Paris   |                                |
  |  X-Payment-TxHash: 0xabc123   |                                |
  |------------------------------->|                                |
  |                                |  verify tx on-chain ---------->|
  |                                |  mark tx used (anti-replay)    |
  |  200 OK { temperature: 15.2 } |                                |
  |<-------------------------------|                                |
```

## API Reference

### Marketplace Endpoints

| Route | Method | Cost | Description |
|-------|--------|------|-------------|
| `/` | GET | Free | Marketplace info + endpoint catalog |
| `/health` | GET | Free | Health check + supported networks |
| `/services` | GET | 0.05 USDC | List all registered services |
| `/search?q=` | GET | 0.05 USDC | Search services by keyword |
| `/register` | POST | 1.00 USDC | Register a new service |

### Native API Wrappers (69 endpoints, x402-powered)

| Route | Cost | Source | Description |
|-------|------|--------|-------------|
| `/api/search?q=` | 0.005 USDC | DuckDuckGo | Clean web search results for LLMs |
| `/api/scrape?url=` | 0.005 USDC | Cheerio + Turndown | Any URL to clean Markdown |
| `/api/twitter?user=\|tweet=\|search=` | 0.005 USDC | fxtwitter | Twitter/X profiles, tweets, search |
| `/api/weather?city=` | 0.02 USDC | Open-Meteo | Weather data for any city |
| `/api/crypto?coin=` | 0.02 USDC | CoinGecko | Cryptocurrency prices (USD/EUR) |
| `/api/joke` | 0.01 USDC | Official Joke API | Random joke |
| `/api/image?prompt=` | 0.05 USDC | DALL-E 3 | AI image generation (1024x1024) |
| `/api/wikipedia?q=` | 0.005 USDC | Wikipedia API | Article summaries |
| `/api/dictionary?word=` | 0.005 USDC | Free Dictionary | English definitions |
| `/api/countries?name=` | 0.005 USDC | REST Countries | Country data |
| `/api/github?user=\|repo=` | 0.005 USDC | GitHub API | Profiles and repo stats |
| `/api/npm?package=` | 0.005 USDC | NPM Registry | Package metadata |
| `/api/ip?address=` | 0.005 USDC | ip-api.com | IP geolocation |
| `/api/translate?text=&to=` | 0.005 USDC | MyMemory | Translate 90+ languages |
| `/api/summarize?text=` | 0.01 USDC | GPT-4o-mini | AI text summarization |
| `/api/code` | 0.005 USDC | Piston API | Execute code in 50+ languages |
| `/api/sentiment?text=` | 0.005 USDC | GPT-4o-mini | Sentiment analysis |
| `/api/dns?domain=` | 0.003 USDC | Node DNS | DNS record lookup |
| `/api/currency?from=&to=` | 0.005 USDC | Frankfurter | Currency conversion (ECB) |
| ...and 22 more | 0.003-0.005 | Various | See [API_WRAPPERS.md](API_WRAPPERS.md) |

### Monitoring & Status (Free)

| Route | Description |
|-------|-------------|
| `/api/status` | Live monitoring status for all 69 endpoints |
| `/api/status/uptime` | Uptime percentages by endpoint |
| `/api/status/history` | Check history (last 24h) |
| `/api/public-stats` | Public stats (services, API calls, monitoring, integrations) |

### Dashboard (Admin, requires `X-Admin-Token`)

| Route | Description |
|-------|-------------|
| `/dashboard` | Admin UI -- stats, services, activity log, System Info |
| `/api/stats` | JSON stats (services, payments, revenue, wallet balance) |
| `/api/analytics` | Enriched analytics (balance, recent activity, avg price) |

### Payment Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Payment-TxHash` | Yes (for paid endpoints) | USDC transfer transaction hash |
| `X-Payment-Chain` | No (default: `base`) | Chain used: `base`, `base-sepolia`, or `skale` |

## MCP Server

The MCP server exposes x402 Bazaar as native tools for AI IDEs. Agents can discover, search, and pay for APIs directly from their conversation.

```bash
npx x402-bazaar init   # Auto-detects your IDE and installs
```

### MCP Tools

| Tool | Cost | Description |
|------|------|-------------|
| `discover_marketplace` | Free | Browse available endpoints and service count |
| `search_services` | 0.05 USDC | Search APIs by keyword |
| `list_services` | 0.05 USDC | Full service catalog |
| `find_tool_for_task` | 0.05 USDC | Describe what you need in plain English, get the best match |
| `call_api` | Free | Call any external API URL |
| `get_wallet_balance` | Free | Check agent wallet USDC balance on-chain |
| `get_budget_status` | Free | Session spending tracker |

## Supported Networks

| Network | Chain ID | Gas | USDC Contract |
|---------|----------|-----|---------------|
| Base | 8453 | ~$0.001 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | Free (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| SKALE Europa | 2046399126 | Free (sFUEL) | `0x5F795bb52dAc3085f578f4877D450e2929D2F13d` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express 5 |
| Blockchain | Base + SKALE Europa (USDC) |
| Wallet SDK | Coinbase Developer Platform (CDP) |
| Database | Supabase (PostgreSQL) |
| MCP | Model Context Protocol SDK |
| AI (demo) | OpenAI GPT-4o-mini |
| Scraping | Cheerio + Turndown |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `NETWORK` | `mainnet` or `testnet` |
| `WALLET_ADDRESS` | USDC recipient address |
| `WALLET_ID` | Coinbase CDP wallet ID |
| `COINBASE_API_KEY` | Coinbase Developer Platform API key |
| `COINBASE_API_SECRET` | CDP API secret |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon key |
| `OPENAI_API_KEY` | OpenAI key (for /api/image, /api/summarize, /api/sentiment) |
| `ADMIN_TOKEN` | Secret token for dashboard access |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for monitoring alerts + interactive commands |
| `TELEGRAM_CHAT_ID` | Telegram chat ID to receive notifications |

## Scripts

```bash
npm start            # Start the server
npm run mcp          # Start the MCP server
npm run seed         # Seed 75+ services into Supabase
npm run seed:wrappers # Register the 69 native wrappers
npm run demo         # Run the autonomous agent demo
npm run demo:live    # Hackathon live demo with terminal UI
```

## Security

- **Helmet** -- Security headers (HSTS, X-Content-Type, X-Frame-Options)
- **CORS** -- Strict origin whitelist (no wildcards in production)
- **Rate Limiting** -- 3 tiers: general (500/15min), paid endpoints (30/min), registration (10/hr)
- **Anti-Replay** -- Transaction hashes persisted in Supabase `used_transactions` table
- **On-Chain Verification** -- Validates USDC transfer logs directly via RPC
- **USDC-Only** -- Rejects non-USDC token transfers
- **Input Sanitization** -- Control character rejection, Postgres LIKE escaping, length limits
- **SSRF Protection** -- Blocks localhost, private IPs, IPv6 loopback, cloud metadata
- **Body Limit** -- 10KB max request body
- **RPC Timeout** -- 10s timeout on all blockchain calls

## Create Your Own x402 API

Monetize any Python function in 5 minutes with the FastAPI template:

```bash
git clone https://github.com/Wintyx57/x402-fast-monetization-template
cd x402-fast-monetization-template
pip install -r requirements.txt
cp .env.example .env  # Set your WALLET_ADDRESS
python main.py
```

```python
@x402_paywall(price=0.05, description="My API", tags=["cool"])
def my_function(text: str) -> dict:
    return {"result": "something"}
```

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Links

- **Website:** [x402bazaar.org](https://x402bazaar.org)
- **Frontend:** [github.com/Wintyx57/x402-frontend](https://github.com/Wintyx57/x402-frontend)
- **LangChain:** [github.com/Wintyx57/x402-langchain](https://github.com/Wintyx57/x402-langchain)
- **CLI:** `npx x402-bazaar init` | [npm](https://www.npmjs.com/package/x402-bazaar)
- **API Template:** [x402-fast-monetization-template](https://github.com/Wintyx57/x402-fast-monetization-template)
- **Live API:** [x402-api.onrender.com](https://x402-api.onrender.com)
- **Dashboard:** [x402-api.onrender.com/dashboard](https://x402-api.onrender.com/dashboard)

## License

MIT
