# Build Autonomous API Workflows with Claude + x402 MCP

> **Quick Start**
> ```bash
> npx x402-bazaar init
> # Add the generated config to Claude Desktop or Cursor
> # Ask Claude: "Research the latest AI news and summarize the top 3 articles"
> ```

---

## Introduction

**Model Context Protocol (MCP)** is a standard that lets AI assistants like Claude call external tools during a conversation. Instead of generating text responses only, Claude can call APIs, read files, query databases, and — with x402 Bazaar — pay for services autonomously.

**x402 Bazaar's MCP server** gives Claude access to 112+ paid APIs through a single integration. Claude can:
- Discover APIs by capability ("find me a weather API")
- Check prices before paying
- Call any API and receive structured results
- Manage a budget to avoid overspending

This cookbook shows you how to configure the x402 MCP server and use it to build multi-step autonomous workflows directly in Claude Desktop or Cursor — no Python or JavaScript required.

---

## Prerequisites

- [Claude Desktop](https://claude.ai/download) or [Cursor](https://cursor.sh) (MCP-enabled)
- Node.js 18+ (for the MCP server runtime)
- ~$0.10 USDC in an x402 wallet (auto-created on first run)

### Install the MCP server

```bash
npx x402-bazaar init
```

This command:
1. Downloads the x402 MCP server (`x402-bazaar` npm package)
2. Auto-generates an encrypted wallet in `~/.x402/wallet.enc`
3. Prints a JSON configuration snippet to add to your MCP client

You will see output like:

```
x402 Bazaar MCP Server initialized
Wallet address: 0x7aB3...f902
Config snippet saved to: ~/.x402/claude-desktop-config.json

Next: add the x402-bazaar server to your MCP client config (see Step 1 below).
```

---

## Step 1: Configure Your MCP Client

### Claude Desktop

Open your Claude Desktop configuration file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the x402 server to the `mcpServers` section:

```json
{
  "mcpServers": {
    "x402-bazaar": {
      "command": "node",
      "args": ["/path/to/your/x402-bazaar/mcp-server.mjs"],
      "env": {
        "WALLET_PRIVATE_KEY": "your-encrypted-wallet-key",
        "X402_CHAIN": "skale"
      }
    }
  }
}
```

Or use the auto-generated snippet from `~/.x402/claude-desktop-config.json`.

### Cursor

In Cursor, go to **Settings > MCP Servers** and add:

```json
{
  "x402-bazaar": {
    "command": "node",
    "args": ["/path/to/mcp-server.mjs"]
  }
}
```

### Verify the connection

Restart Claude Desktop or Cursor. You should see x402 tools available when you hover over the tools icon. Ask Claude:

```
What x402 tools do you have available?
```

Claude will list the available tools, confirming the connection works.

---

## Step 2: Set Up Your Wallet

Before making any paid API calls, set up your wallet. The MCP server provides a `setup_wallet` tool that handles this automatically.

### In Claude Desktop, type:

```
Set up my x402 wallet and show me my balance.
```

Claude will call the `setup_wallet` tool and respond with:

```
I've initialized your x402 wallet.

Wallet address: 0x7aB3...f902
Chain: SKALE (near-zero gas fees)
USDC Balance: 0.00

To fund your wallet, send USDC to 0x7aB3...f902 on SKALE network,
or visit https://x402bazaar.org/faucet for a free test allocation.
```

To check your balance at any time:

```
Check my x402 wallet balance and budget status.
```

---

## Step 3: Discover Available APIs

The x402 MCP server provides free discovery tools — `discover_marketplace`, `search_services`, and `find_tool_for_task` — that do not charge USDC.

### Explore the marketplace

```
Show me what APIs are available in the x402 marketplace.
```

Claude calls `discover_marketplace` and returns a categorized overview:

```
Here's what's available in the x402 Bazaar marketplace:

**Search & Web (5 APIs)**
- Web Search Pro — $0.005/call — full-text search with 10 results
- Web Scraper — $0.005/call — extract content from any URL
- Site Indexer — $0.008/call — crawl and index an entire domain

**AI & Language (8 APIs)**
- Summarization — $0.005/call — compress text to key points
- Sentiment Analysis — $0.005/call — tone scoring + signal extraction
- Translation — $0.003/call — 95 languages

**Financial Data (6 APIs)**
- Stock Market Data — $0.010/call — real-time price, volume, fundamentals
- News Feed — $0.010/call — 15,000+ financial sources
- Crypto Prices — $0.005/call — spot + historical

**Weather & Geo (3 APIs)**
- Weather API — $0.005/call — current + 7-day forecast
- Geocoding — $0.003/call — address to coordinates

[...and 90+ more categories]
```

### Find the right tool for a task

```
I need to analyze the sentiment of customer reviews. What's the best API for that?
```

Claude calls `find_tool_for_task` with task description and returns:

```
Best match: Sentiment Analysis API
- ID: a7b8c9d0-e1f2-3456-789a-bcde0123f456
- Price: $0.005 per call
- Input: text (string, max 10,000 characters)
- Output: score (0-100), tone (positive/negative/neutral), key phrases

This API is rated 4.8/5 by 234 users and has 99.2% uptime.
Shall I call it with your review text?
```

---

## Step 4: Build a Multi-Step Workflow

Now for the powerful part. Claude can chain multiple API calls in a single conversation turn, reasoning about what to call next based on previous results.

### Example workflow: AI news research

Type this prompt in Claude Desktop:

```
Research the latest AI news. Find 3 recent articles, scrape their full content,
and write a concise summary of the most important developments.
My budget is $0.10.
```

Claude reasons through the steps and calls tools autonomously:

---

**Claude's internal reasoning and tool calls:**

```
Step 1: I need to search for news. Let me find a news API first.
```

```json
// Tool call: find_tool_for_task
{
  "task": "search for recent AI news articles"
}
// Result: News Feed API (id: "d3e4f5a6-...", $0.010/call)
```

```
Step 2: Now I'll fetch the latest AI headlines.
```

```json
// Tool call: call_service
{
  "id": "d3e4f5a6-7890-abcd-ef12-345678901234",
  "params": { "query": "artificial intelligence 2025", "limit": 5 }
}
// Result: [
//   { "title": "OpenAI releases GPT-5 with 1M token context", "url": "https://...", ... },
//   { "title": "Google DeepMind announces Gemini 2.0 Ultra", "url": "https://...", ... },
//   { "title": "Anthropic Claude 4 beats human experts on MMLU", "url": "https://...", ... }
// ]
```

```
Step 3: I have 3 articles. Now I need to scrape them. Let me find the scraper API.
```

```json
// Tool call: find_tool_for_task
{
  "task": "scrape full article content from a URL"
}
// Result: Web Scraper (id: "e5f6a7b8-...", $0.005/call)
```

```json
// Tool call: call_service (article 1)
{ "id": "e5f6a7b8-...", "params": { "url": "https://openai.com/blog/gpt-5-..." } }
// Result: { "content": "OpenAI today announced GPT-5, featuring a 1 million token..." }

// Tool call: call_service (article 2)
{ "id": "e5f6a7b8-...", "params": { "url": "https://deepmind.google/blog/..." } }
// Result: { "content": "Google DeepMind's Gemini 2.0 Ultra achieves new SOTA..." }

// Tool call: call_service (article 3)
{ "id": "e5f6a7b8-...", "params": { "url": "https://anthropic.com/news/..." } }
// Result: { "content": "Claude 4's performance on MMLU represents..." }
```

```
Step 4: I have full content from all 3 articles. Now summarize.
```

```json
// Tool call: find_tool_for_task
{ "task": "summarize multiple text documents into key points" }
// Result: Summarization API (id: "c9d0e1f2-...", $0.005/call)

// Tool call: call_service
{
  "id": "c9d0e1f2-...",
  "params": {
    "text": "[combined content of all 3 articles]",
    "max_length": 400
  }
}
// Result: { "summary": "Three major AI labs released flagship models this week..." }
```

---

**Claude's final response to you:**

```
Here's a summary of the latest AI developments:

## Major AI Model Releases — April 2025

**1. GPT-5 from OpenAI** (1M token context)
OpenAI released GPT-5 with a 1 million token context window, enabling entire
codebases and books to be processed in a single prompt. Early benchmarks show
40% improvement over GPT-4o on complex reasoning tasks.

**2. Gemini 2.0 Ultra from Google DeepMind**
Gemini 2.0 Ultra sets new state-of-the-art on 12 of 15 leading benchmarks,
with particular strength in multimodal tasks (video understanding + code).
Notably optimized for Google's TPU v5 infrastructure.

**3. Claude 4 from Anthropic**
Claude 4 achieves 89.7% on MMLU-Pro, surpassing human expert performance
for the first time on this benchmark. Focus areas: extended reasoning, reduced
hallucination, and agentic reliability.

**Key trend:** All three models emphasize long-context reasoning and autonomous
agent capabilities — a clear industry shift toward AI systems that operate
independently over extended tasks.

---
Workflow cost breakdown:
- News search: $0.010
- Web scraping × 3: $0.015
- Summarization: $0.005
- Total: $0.030 (well within your $0.10 budget)
```

---

## Step 5: Budget Management

Protect yourself from unexpected spending with budget controls.

### Check your budget status

```
What's my current x402 budget status?
```

Claude calls `get_budget_status`:

```
Your x402 Bazaar budget status:

Daily budget: $1.00
Spent today: $0.125 (12.5%)
Remaining: $0.875

Most expensive calls today:
- Stock Market Data × 3 = $0.030
- News Feed × 2 = $0.020
- Web Scraper × 7 = $0.035

At current pace, your daily budget will last approximately 7 more days.
```

### Set a per-session budget

You can instruct Claude to enforce spending limits:

```
For this session, don't spend more than $0.05 total. Check prices before calling
any paid API and ask for confirmation if a single call costs more than $0.01.
```

Claude will call `get_budget_status` before each expensive operation and alert you if the limit is approaching.

---

## Advanced Workflow Examples

### Example 1: Weather-aware travel planner

```
I'm planning a trip to Tokyo next week. Check the weather forecast,
find the top 5 tourist attractions, and suggest the best days and
activities based on the weather.
```

Claude will call: Weather API ($0.005) + Web Search ($0.005) = **$0.010**

---

### Example 2: Competitive intelligence report

```
I'm launching a new product in the electric vehicle charging market.
Research the latest news, sentiment around major players (Tesla, ChargePoint, EVgo),
and get their current stock performance. Give me a 1-page competitive brief.
```

Claude will call: News ($0.010) + Sentiment × 3 ($0.015) + Stocks × 3 ($0.030) = **$0.055**

---

### Example 3: Code research assistant

```
I'm debugging a memory leak in a Node.js application. Search for the most
common causes in 2025, scrape the top 3 Stack Overflow threads, and
summarize the actionable solutions.
```

Claude will call: Web Search ($0.005) + Scraper × 3 ($0.015) + Summarization ($0.005) = **$0.025**

---

## MCP Tool Reference

| Tool | Cost | Description |
|------|------|-------------|
| `discover_marketplace` | Free | Browse all available APIs by category |
| `search_services` | Free | Search APIs by keyword |
| `list_services` | Free | List all services with filters |
| `find_tool_for_task` | Free | Natural language → best matching API |
| `get_service_schema` | Free | Get detailed input/output schema for an API |
| `call_service` | Paid (per API) | Call any API by UUID + params |
| `call_api` | Paid (per API) | Alternative call method with URL-based routing |
| `get_wallet_balance` | Free | Check USDC balance on connected chain |
| `setup_wallet` | Free | Initialize or recover wallet |
| `get_budget_status` | Free | View spending limits and daily usage |

---

## Cost Breakdown (typical workflows)

| Workflow | API Calls | Total Cost |
|----------|-----------|-----------|
| Single web search | 1 × Search | $0.005 |
| Research pipeline (Search + Scrape + Summarize) | 3 calls | $0.015 |
| Market analysis (News + Sentiment + Stocks) | 4 calls | $0.030 |
| Full competitive brief (multi-source) | 10+ calls | $0.060 |
| Daily news briefing (5 topics) | 15 calls | $0.075 |

All payments settle on SKALE network — near-zero gas fees, instant finality.

---

## Next Steps

**Use automated workflows (no human in the loop):**

You can call the MCP server programmatically from scripts using the `x402-bazaar` CLI:

```bash
# Trigger a research run from the command line
npx x402-bazaar call --task "summarize AI news today" --budget 0.05
```

**Build custom Claude prompts for recurring tasks:**

Save prompts as files and pipe them in for scheduled runs:

```bash
# research_prompt.txt
Research the latest developments in [TOPIC].
Find 3 articles, scrape full content, summarize key insights.
Budget: $0.05

# Run it
cat research_prompt.txt | sed "s/\[TOPIC\]/quantum computing/g" | \
  npx x402-bazaar claude-run
```

**Integrate MCP into your own application:**

The MCP server is a Node.js process you can embed in any app using the MCP SDK:

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["./node_modules/x402-bazaar/mcp-server.mjs"],
});

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

// Call any x402 tool
const result = await client.callTool("call_service", {
  id: "service-uuid-here",
  params: { query: "LLM news 2025" },
});
```

**Use Cursor for code-aware research:**

In Cursor, you can combine x402 APIs with codebase context:

```
Look at my src/payment.js file. Research the latest best practices for
EIP-3009 off-chain signing, scrape the EIP specification page, and
suggest specific improvements to my implementation.
```

Cursor will read your file AND call x402 APIs in the same workflow.

---

## Troubleshooting

**"Tools not appearing in Claude Desktop"**
- Confirm the config path is correct for your OS
- Check Node.js version: `node --version` (must be 18+)
- Restart Claude Desktop fully (not just reload)
- Check the MCP server log: `~/.x402/mcp-server.log`

**"Insufficient funds" error**
- Check balance: ask Claude "What's my x402 wallet balance?"
- Top up at [x402bazaar.org](https://x402bazaar.org) by sending USDC to your wallet address on SKALE

**"Service unavailable" error**
- The target API may be temporarily down (x402 monitors all services)
- Ask Claude: "Find an alternative API for [task]" — it will discover a replacement

**"Transaction failed" error**
- SKALE requires a small amount of sFUEL (free gas token) for transactions
- Claim free sFUEL at: `https://sfuel.skale.network/`

---

## x402 Bazaar Ecosystem

| Resource | Link |
|----------|------|
| Platform & API catalog | [x402bazaar.org](https://x402bazaar.org) |
| MCP full setup guide | [MCP_SETUP.md](../MCP_SETUP.md) |
| Python SDK (`pip install x402-bazaar`) | [GitHub](https://github.com/Wintyx57/x402-sdk-python) |
| JavaScript SDK (`npm install @wintyx/x402-sdk`) | [npm](https://www.npmjs.com/package/@wintyx/x402-sdk) |
| CLI (`npx x402-bazaar`) | [npm](https://www.npmjs.com/package/x402-bazaar) |
| Full integration guide | [Integration Guide](../INTEGRATION-GUIDE.md) |
| LangChain cookbook | [research-agent-langchain.md](./research-agent-langchain.md) |
| CrewAI cookbook | [data-analyst-crewai.md](./data-analyst-crewai.md) |

Questions or issues? Open an issue on GitHub or reach out via the platform.
