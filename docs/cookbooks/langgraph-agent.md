# Cookbook: Build a LangGraph agent that pays APIs with x402 Bazaar

**Time**: 10 minutes
**Cost to run**: < $0.05 USDC
**Prerequisites**: Python 3.10+, an OpenAI or Anthropic API key, a wallet with a bit of USDC on SKALE (cheapest gas)

LangGraph is LangChain's graph-based orchestration library for multi-step agents. This cookbook shows how to plug x402 Bazaar as a payment-enabled tool layer inside a LangGraph agent.

By the end you'll have an agent that:

1. Decides which APIs it needs
2. Pays each one on-chain (95% to provider, 5% platform fee)
3. Synthesizes a final answer

---

## 1. Install

```bash
pip install x402-bazaar langgraph langchain-openai
```

The `x402-bazaar` Python SDK (v1.3.0) ships a LangChain-compatible `X402BazaarTool` — LangGraph can consume it natively.

---

## 2. Set up the wallet

The first run creates an encrypted wallet at `~/.x402-bazaar/wallet.json` and gives you the address. You fund it with a tiny amount of USDC (SKALE recommended, ~$0.10 is enough for hundreds of calls at $0.001 each).

```python
from x402_bazaar import X402Client

client = X402Client(network="skale")
print("Fund this address:", client.wallet_address)
# Output: Fund this address: 0xABCD...1234
```

Bridge USDC to SKALE via https://x402bazaar.org/fund (1-click from Base/Polygon/Ethereum).

Once funded:

```python
print("Balance:", client.get_balance(), "USDC")
```

---

## 3. Discover available tools

x402 Bazaar exposes ~112 services. You don't need to hardcode them — `find_tool_for_task` uses semantic search to pick the best one for a natural-language task.

```python
tools = client.find_tool_for_task("translate a piece of text to Spanish")
# Returns: [{id: "translate", price_usdc: 0.005, description: "..."}, ...]
```

`find_tool_for_task` is **free** (no USDC spent). Use it liberally.

---

## 4. Wire the tools into LangGraph

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from x402_bazaar.langchain import create_x402_tools

# One LangChain Tool per x402 service we want to give the agent
tools = create_x402_tools(
    client,
    services=["news", "translate", "sentiment"],
)

llm = ChatOpenAI(model="gpt-4o-mini")

agent = create_react_agent(llm, tools)
```

`create_x402_tools` returns plain `langchain_core.tools.Tool` objects — LangGraph treats them like any other tool. Every tool invocation triggers a real on-chain payment through the SDK.

---

## 5. Run the agent

```python
result = agent.invoke({
    "messages": [
        ("user", "Find the latest headlines about Paris, translate them to Spanish, and tell me the overall sentiment.")
    ]
})

print(result["messages"][-1].content)
```

Behind the scenes:

1. The LLM picks `news` first, LangGraph calls it, the SDK pays ~$0.005 USDC on SKALE
2. LLM picks `translate` next, pays again
3. LLM picks `sentiment`, pays again
4. LLM writes a final synthesized answer

Total cost per run: **~$0.015 USDC** (3 calls at the average wrapper price).

---

## 6. Budget safety

By default the SDK enforces a **$1 USDC per-session budget**. If the agent tries to spend more, calls are rejected with `BudgetExceededError`. Change it:

```python
client = X402Client(network="skale", max_budget_usdc=10.0)
```

Recommended: set a budget matching the expected cost of a single query. If the agent hallucinates a 100-tool call loop, the budget stops the bleed.

---

## 7. Streaming events

LangGraph streams token-by-token by default. You can intercept tool calls to log payments:

```python
for chunk in agent.stream({"messages": [("user", "...")]}):
    for msg in chunk.get("messages", []):
        if hasattr(msg, "tool_call_id"):
            # Fired on every tool result — the preceding tool call already cost USDC
            print(f"-> tool {msg.name}: cost paid, result received")
```

---

## 8. Production hardening

A few things to add once you're shipping this to users, not just prototyping:

- **Use a dedicated wallet per agent session** — don't pool funds across tenants
- **Set `max_budget_usdc` per user** — not global
- **Wrap `agent.invoke` in a try/except** for `NetworkError` (SKALE RPC flakes happen)
- **Log the `tx_hash` of every call** — you'll want it for debugging and for user-facing receipts
- **Pin the SDK version** in `requirements.txt` — the API evolves

---

## 9. What you built

- A LangGraph agent that pays APIs with USDC, per call, no subscription
- Providers receive 95% of each payment within 6 hours
- You pay only for what the agent actually uses
- Free tool discovery, zero-cost exploration
- ~$0.015 per complete multi-step task

Compare to the status quo:
- **RapidAPI**: you'd pay a monthly subscription for each of the 3 APIs, even if you call each once, AND providers take 25% haircut
- **Direct integration**: sign up to 3 different companies, manage 3 API keys, handle 3 rate limits, get 3 bills

---

## 10. Next steps

- Try `create_x402_tools` with `services=None` to let the agent browse the whole catalog
- Integrate the `web-search` and `scrape` wrappers for web-aware agents
- Explore the marketplace: https://x402bazaar.org/services
- For production deployments, read https://x402bazaar.org/docs/security

Questions? https://github.com/Wintyx57/x402-backend/issues
