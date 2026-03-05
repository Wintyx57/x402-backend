# x402 Bazaar — MCP Server Setup

Connect AI agents (Claude Code, Cursor, Claude Desktop) to the x402 Bazaar API marketplace. Pay-per-call with USDC on Base.

## Quick Start (3 steps)

### 1. Install dependencies

```bash
git clone https://github.com/Wintyx57/x402-backend.git
cd x402-backend
npm install
```

### 2. Add MCP config

Copy `.mcp.json.example` to your project root (or `~/.claude/.mcp.json` for global):

```json
{
  "mcpServers": {
    "x402-bazaar": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server.mjs"],
      "env": {
        "MAX_BUDGET_USDC": "1.00"
      }
    }
  }
}
```

> **Important:** Replace `/absolute/path/to/mcp-server.mjs` with the actual path.
> On Windows: `"C:\\Users\\you\\x402-backend\\mcp-server.mjs"`
> On macOS/Linux: `"/home/you/x402-backend/mcp-server.mjs"`

### 3. Restart your AI client

Restart Claude Code, Cursor, or Claude Desktop. The MCP tools will appear automatically.

## Auto-Wallet (Zero Config)

The MCP server **automatically generates a wallet** on first launch if no key is configured. No manual setup needed.

- Wallet is saved to `~/.x402-bazaar/wallet.json` (permissions: 600)
- Use the `setup_wallet` tool to see your address and funding instructions
- On subsequent launches, the same wallet is reused

### Funding your wallet

To use paid APIs, send USDC to your wallet address on **Base** (chain ID 8453):

1. Run `setup_wallet` to get your address
2. Send USDC from an exchange (Coinbase, Binance) or bridge from another chain
3. Minimum recommended: **1 USDC** (~20 API calls at $0.05 each)

## Configuration

All environment variables are **optional**:

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PRIVATE_KEY` | auto-generated | Hex private key (`0x...`). Overrides auto-wallet. |
| `MAX_BUDGET_USDC` | `1.00` | Maximum USDC spend per session |
| `NETWORK` | `base` | Default chain: `base` or `skale` |
| `X402_SERVER_URL` | `https://x402-api.onrender.com` | Bazaar API server URL |

## Available Tools

### Free tools (no wallet needed)

| Tool | Description |
|------|-------------|
| `discover_marketplace` | Browse the marketplace — endpoints, stats, protocol info |
| `get_budget_status` | Check session spending and remaining budget |
| `setup_wallet` | Initialize wallet, show address, balance, and funding instructions |
| `get_wallet_balance` | Check USDC balance on all supported chains |

### Paid tools (require USDC)

| Tool | Cost | Description |
|------|------|-------------|
| `search_services` | 0.05 USDC | Search APIs by keyword |
| `list_services` | 0.05 USDC | List all available API services |
| `find_tool_for_task` | 0.05 USDC | Describe a task in plain English → get the best API match |
| `call_service` | varies | Call a Bazaar service via proxy (95/5 revenue split) |
| `call_api` | varies | Call any external API URL with auto x402 payment |

## Supported Chains

| Chain | Gas Cost | Best for |
|-------|----------|----------|
| **Base** (default) | ~$0.001 | Most users |
| **SKALE on Base** | ~$0.0007 | High-volume, cost-sensitive |

Switch chains with the `chain` parameter on any paid tool, or set `NETWORK=skale` in config.

## Revenue Split

When using `call_service`, payments split automatically on-chain:
- **95%** goes directly to the API provider
- **5%** platform fee

No smart contract needed — two native USDC transfers per call.

## Troubleshooting

### MCP not connected
- Check that `.mcp.json` is in your project root or `~/.claude/.mcp.json`
- Verify the path to `mcp-server.mjs` is absolute and correct
- Restart your AI client after adding/modifying `.mcp.json`

### "Budget limit reached"
- Increase `MAX_BUDGET_USDC` in your `.mcp.json` env config
- Check current spending with `get_budget_status`

### "Wallet not configured"
- Run `setup_wallet` — it auto-generates a wallet if needed
- Or set `AGENT_PRIVATE_KEY` in your `.mcp.json` env

### Insufficient USDC balance
- Run `get_wallet_balance` to check your balance
- Send USDC on Base to your wallet address
- Minimum 0.05 USDC needed for most API calls

## Links

- **Marketplace**: https://x402bazaar.org
- **API**: https://x402-api.onrender.com
- **GitHub**: https://github.com/Wintyx57/x402-backend
- **npm CLI**: `npx x402-bazaar`
- **n8n node**: `@wintyx/n8n-nodes-x402-bazaar`
