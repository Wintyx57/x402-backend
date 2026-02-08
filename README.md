# x402 Bazaar — Backend

The autonomous marketplace where AI agents discover, pay for, and consume API services using the HTTP 402 protocol on Base.

**Live:** https://x402-api.onrender.com | **Frontend:** https://x402bazaar.org

## What is x402?

x402 implements the HTTP 402 Payment Required standard: when an AI agent calls a paid API endpoint, the server responds `402` with payment details. The agent sends USDC on Base, then retries with the transaction hash — access granted. No API keys, no subscriptions, just on-chain payments.

## Architecture

```
server.js          → Express API (REST, x402 payment verification, Supabase)
mcp-server.mjs     → MCP server (Model Context Protocol for AI IDEs)
demo-agent.js      → Autonomous agent demo (OpenAI + Coinbase SDK)
demo-live.js       → Hackathon live demo with terminal UI
dashboard.html     → Admin dashboard (stats, services, activity)
seed-services.js   → Database seeder (75 real API services)
create-wallet.js   → Wallet creation utility
```

## Quick Start

```bash
git clone https://github.com/Wintyx57/x402-backend.git
cd x402-backend
npm install
cp .env.example .env   # Fill in your keys
node server.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `NETWORK` | `mainnet` or `testnet` (Base / Base Sepolia) |
| `WALLET_ADDRESS` | USDC recipient address (your MetaMask) |
| `WALLET_ID` | Coinbase CDP server wallet ID |
| `COINBASE_API_KEY` | Coinbase Developer Platform API key |
| `COINBASE_API_SECRET` | Coinbase Developer Platform API secret |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon key |
| `OPENAI_API_KEY` | OpenAI key (for demo agent only) |

## API Endpoints

| Route | Method | Cost | Description |
|-------|--------|------|-------------|
| `/` | GET | Free | Marketplace discovery |
| `/services` | GET | 0.05 USDC | List all services |
| `/search?q=` | GET | 0.05 USDC | Search services by keyword |
| `/register` | POST | 1.00 USDC | Register a new service |
| `/health` | GET | Free | Health check |
| `/api/stats` | GET | Free | Dashboard stats |
| `/api/services` | GET | Free | Dashboard service list |
| `/api/activity` | GET | Free | Activity log |

## MCP Server

The MCP server lets any AI IDE (Claude Desktop, Cursor, VS Code, Claude Code) interact with x402 Bazaar as native tools.

```bash
npm run mcp
```

### Tools

| Tool | Cost | Description |
|------|------|-------------|
| `discover_marketplace` | Free | Discover endpoints and services |
| `search_services` | 0.05 USDC | Search APIs by keyword |
| `list_services` | 0.05 USDC | List full catalog |
| `call_api` | Free | Call any external API |
| `get_wallet_balance` | Free | Check wallet USDC balance |
| `get_budget_status` | Free | Check session spending and budget |

### Budget Control

Set `MAX_BUDGET_USDC` to cap spending per session (default: 1.00 USDC). The server tracks all payments and blocks requests when the limit is reached.

```json
{
  "env": {
    "MAX_BUDGET_USDC": "1.00",
    "NETWORK": "mainnet"
  }
}
```

See [claude-desktop-config.example.json](./claude-desktop-config.example.json) for full IDE configuration.

## Security

- Helmet security headers
- CORS whitelist (production origins only in prod)
- Rate limiting: 3 tiers (general, paid endpoints, registration)
- Anti-replay: transaction hashes stored in Supabase
- On-chain payment verification via Base RPC
- Input validation and sanitization
- TX hash normalization (lowercase, trim, length check)

## Scripts

```bash
npm start        # Start the server
npm run seed     # Seed 75 services into Supabase
npm run demo     # Run the autonomous agent demo
npm run demo:live # Hackathon live demo with terminal UI
npm run mcp      # Start the MCP server
```

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Blockchain:** Base (Coinbase SDK, USDC)
- **Database:** Supabase (PostgreSQL)
- **AI:** OpenAI GPT-4o-mini (demo agent)
- **Protocol:** MCP (Model Context Protocol)

## License

ISC
