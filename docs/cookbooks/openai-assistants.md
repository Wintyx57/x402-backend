# Cookbook: OpenAI Assistants API with x402 Bazaar

**Time**: 10 minutes
**Cost**: < $0.05 USDC + OpenAI API cost
**Prerequisites**: OpenAI API key, a wallet with USDC on SKALE / Base

The Assistants API is OpenAI's managed agent runtime. This cookbook wires x402 Bazaar paid APIs as Assistants tools, so the assistant can call any x402 service via function calling.

---

## 1. Install

```bash
pip install openai x402-bazaar
```

---

## 2. Create the client + fund a wallet

```python
from x402_bazaar import X402Client

x402 = X402Client(network="skale")
print("Fund this address with USDC on SKALE:", x402.wallet_address)
```

Fund via https://x402bazaar.org/fund, then:

```python
print("Balance:", x402.get_balance(), "USDC")
```

---

## 3. Describe the x402 tools to OpenAI

OpenAI expects a tool spec in JSON Schema format. The SDK exposes a helper:

```python
from x402_bazaar.openai import to_openai_tool_specs

tool_specs = to_openai_tool_specs(
    x402,
    services=["news", "translate", "sentiment"],
)
# Each entry looks like:
# {
#   "type": "function",
#   "function": {
#     "name": "x402_news",
#     "description": "...",
#     "parameters": { ...JSON Schema for query params... }
#   }
# }
```

---

## 4. Create an Assistant with those tools

```python
from openai import OpenAI
client = OpenAI()

assistant = client.beta.assistants.create(
    name="x402-demo-agent",
    instructions=(
        "You are an agent that answers questions using paid APIs from x402 Bazaar. "
        "Use the tools efficiently — each call costs a small amount of USDC. "
        "Prefer calling the minimum set of tools needed to answer."
    ),
    model="gpt-4o-mini",
    tools=tool_specs,
)
```

---

## 5. Run a thread and handle tool calls

The Assistants API uses the "tool outputs" pattern — when the model asks to call a tool, you execute it and submit the result.

```python
thread = client.beta.threads.create()

client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="What are recent headlines about Paris in Spanish, and is the sentiment positive?"
)

run = client.beta.threads.runs.create(
    thread_id=thread.id,
    assistant_id=assistant.id,
)

# Poll until done or tools are requested
import time
while True:
    run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)
    if run.status == "completed":
        break
    if run.status == "requires_action":
        tool_outputs = []
        for tool_call in run.required_action.submit_tool_outputs.tool_calls:
            name = tool_call.function.name  # e.g. "x402_news"
            args = json.loads(tool_call.function.arguments)
            # The SDK knows how to execute any x402_* tool name
            result = x402.call_tool(name, args)
            tool_outputs.append({
                "tool_call_id": tool_call.id,
                "output": json.dumps(result.data),
            })
        client.beta.threads.runs.submit_tool_outputs(
            thread_id=thread.id,
            run_id=run.id,
            tool_outputs=tool_outputs,
        )
    elif run.status in ("failed", "cancelled", "expired"):
        raise RuntimeError(f"Run ended: {run.status}")
    else:
        time.sleep(1)

# Read the final answer
msgs = client.beta.threads.messages.list(thread_id=thread.id, order="desc", limit=1)
print(msgs.data[0].content[0].text.value)
```

---

## 6. What just happened

1. You described 3 x402 services as OpenAI tools
2. The Assistant decided it needed `news` + `translate` + `sentiment` to answer
3. Each tool call triggered a real on-chain USDC payment through the SDK
4. Results streamed back, the Assistant synthesized the final answer
5. You paid ~$0.015 USDC total + OpenAI input/output tokens

---

## 7. Pitfalls

- **The Assistants API is polling-based.** Production systems should use the streaming equivalents (Chat Completions with `stream=True`) and function calling, which is more responsive. Assistants API is great for quick prototypes and thread-based conversations.
- **Rate limits on OpenAI**: each `runs.retrieve` call counts. Sleep 1s minimum between polls.
- **x402 wallet funding**: keep the balance at 10x the per-run cost — if a run is interrupted mid-call, you might have an authorized but unrealized debit.
- **Tool naming**: OpenAI tool names must match `^[a-zA-Z0-9_-]{1,64}$`. The SDK prefixes `x402_` automatically.

---

## 8. Compared to: plain Chat Completions + streaming

If you don't need thread persistence, this is shorter and cheaper:

```python
messages = [{"role": "user", "content": "..."}]
while True:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=tool_specs,
    )
    msg = resp.choices[0].message
    if not msg.tool_calls:
        print(msg.content); break
    messages.append(msg)
    for tc in msg.tool_calls:
        args = json.loads(tc.function.arguments)
        result = x402.call_tool(tc.function.name, args)
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": json.dumps(result.data),
        })
```

Use the Assistants version if you need: threads, file search, code interpreter, persistent memory between calls. Use Chat Completions otherwise.

---

## 9. What's next

- The [`langgraph-agent.md`](./langgraph-agent.md) cookbook shows the same idea with LangGraph orchestration (better for complex graphs)
- The [`mcp-workflow-claude.md`](./mcp-workflow-claude.md) cookbook shows how to do this with Claude via MCP (zero code: `npx x402-bazaar init`)
- Full marketplace: https://x402bazaar.org/services
