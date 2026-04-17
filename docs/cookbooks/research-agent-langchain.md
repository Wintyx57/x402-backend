# Build a Research Agent with LangChain + x402 Bazaar

> **Quick Start**
> ```bash
> pip install x402-bazaar[langchain] langchain langchain-openai openai
> export OPENAI_API_KEY="sk-..."
> python research_agent.py
> ```

---

## Introduction

AI agents are only as powerful as the data they can access. Most research pipelines today are either hard-coded (brittle, no flexibility) or rely on expensive proprietary APIs locked behind dashboards and billing forms.

**x402 Bazaar** takes a different approach: a decentralized marketplace of APIs that agents pay for autonomously, per call, with crypto (USDC on SKALE — near-zero gas). No signup, no billing portal, no monthly commitment. Your agent discovers what it needs and pays exactly for what it uses.

In this tutorial, you will build a **3-step research agent** using LangChain:

1. **Search** — find relevant URLs for a topic ($0.005)
2. **Scrape** — extract full article content from the top result ($0.005)
3. **Summarize** — generate a concise AI summary ($0.005)

**Total cost: ~$0.015 per research run.** The agent is fully autonomous: it discovers the right API, pays for it, and returns structured results — without any human intervention.

---

## Prerequisites

- Python 3.10 or higher
- An OpenAI API key (`OPENAI_API_KEY`)
- Internet connection (the x402 client auto-generates and funds a wallet on first run)

### Install dependencies

```bash
pip install x402-bazaar[langchain] langchain langchain-openai openai
```

This installs:
- `x402-bazaar` — the x402 Bazaar Python SDK
- `langchain` — the LangChain orchestration framework
- `langchain-openai` — OpenAI LLM integration for LangChain
- `openai` — OpenAI Python client

---

## Step 1: Set Up the x402 Client and LangChain Tools

The `X402Client` is the entry point for all interactions with x402 Bazaar. On first run, it automatically:
- Generates an encrypted wallet (AES-256-GCM, stored locally)
- Connects to the SKALE chain (near-zero gas fees)
- Fetches your wallet address and balance

```python
# research_agent.py

import os
import logging
from x402_bazaar import X402Client
from x402_bazaar.integrations.langchain import X402SearchTool, X402CallTool

# Configure logging to see what the agent is doing
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def build_x402_tools() -> list:
    """Initialize x402 client and return LangChain-compatible tools."""
    client = X402Client()
    logger.info("x402 wallet address: %s", client.wallet_address)

    return [
        X402SearchTool(client=client),
        X402CallTool(client=client),
    ]
```

The `X402SearchTool` lets the agent search the marketplace by keyword (free). The `X402CallTool` lets the agent call any discovered service by its UUID (costs USDC per call).

---

## Step 2: Create a LangChain Research Agent

We use LangChain's `create_react_agent` to build a ReAct-style agent that reasons before acting. The agent will decide which tools to use based on the task description.

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain.prompts import PromptTemplate


RESEARCH_PROMPT = PromptTemplate.from_template("""You are a research assistant with access to a marketplace of paid APIs.

Your workflow for any research topic:
1. Use search_services to find the "web search" API — search for "web search"
2. Call the web search API with the research topic to get URLs
3. Use search_services to find the "scraping" API — search for "scraping"
4. Call the scraping API on the top URL to get full article content
5. Use search_services to find the "summarization" API — search for "summarization"
6. Call the summarization API on the scraped content to produce a summary
7. Return a structured research report

Always search for an API before calling it — never hardcode UUIDs.

You have access to the following tools:
{tools}

Tool names: {tool_names}

Use this format:
Question: the research topic
Thought: your reasoning
Action: tool name
Action Input: tool input
Observation: tool result
... (repeat Thought/Action/Observation as needed)
Thought: I now have enough information
Final Answer: the complete research report

Question: {input}
Thought: {agent_scratchpad}
""")


def create_research_agent(tools: list):
    """Build a ReAct research agent with OpenAI GPT-4."""
    llm = ChatOpenAI(
        model="gpt-4o-mini",  # cost-effective, capable enough for this task
        temperature=0,
        api_key=os.environ["OPENAI_API_KEY"],
    )

    agent = create_react_agent(llm=llm, tools=tools, prompt=RESEARCH_PROMPT)
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        max_iterations=12,
        handle_parsing_errors=True,
    )
    return executor
```

---

## Step 3: Run the Full Research Pipeline

Now we wire everything together. The agent receives a topic, runs the Search → Scrape → Summarize pipeline, and returns a report.

```python
import json

def research(topic: str) -> dict:
    """
    Run a full research pipeline for the given topic.

    Args:
        topic: The subject to research (e.g., "quantum computing breakthroughs 2025")

    Returns:
        dict with keys: topic, summary, cost_usd, steps_completed

    Note: cost_usd assumes exactly 3 API calls (search + scrape + summarize).
          Actual cost may vary if the agent discovers or retries additional calls.
    """
    logger.info("Starting research pipeline for: %s", topic)

    tools = build_x402_tools()
    agent = create_research_agent(tools)

    try:
        result = agent.invoke({
            "input": f"Research this topic thoroughly: {topic}"
        })

        return {
            "topic": topic,
            "summary": result["output"],
            "cost_usd": 0.015,  # search $0.005 + scrape $0.005 + summarize $0.005
            "steps_completed": 3,
        }

    except Exception as e:
        logger.error("Research pipeline failed: %s", str(e))
        raise


if __name__ == "__main__":
    topic = "latest developments in open-source LLMs 2025"
    print(f"\nResearching: {topic}\n{'='*60}")

    report = research(topic)

    print("\n" + "="*60)
    print("RESEARCH REPORT")
    print("="*60)
    print(json.dumps(report, indent=2))
```

---

## Step 4: Complete Runnable File

Here is the complete `research_agent.py` ready to run:

```python
# research_agent.py — Complete Research Agent
# Usage: python research_agent.py

import os
import json
import logging

from x402_bazaar import X402Client
from x402_bazaar.integrations.langchain import X402SearchTool, X402CallTool
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain.prompts import PromptTemplate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RESEARCH_PROMPT = PromptTemplate.from_template("""You are a research assistant using a paid API marketplace.

Workflow for any research topic:
1. search_services("web search") — find the web search API UUID
2. call_service(uuid, {{"query": topic}}) — get top URLs
3. search_services("scraping") — find the scraping API UUID
4. call_service(uuid, {{"url": top_url}}) — get full article content
5. search_services("summarization") — find the summarization API UUID
6. call_service(uuid, {{"text": content}}) — generate summary

Always search before calling. Never hardcode UUIDs.

Tools available:
{tools}

Tool names: {tool_names}

Format:
Question: {input}
Thought: {agent_scratchpad}
Action: <tool>
Action Input: <input>
Observation: <result>
Final Answer: <report>
""")


def run_research_agent(topic: str) -> str:
    client = X402Client()
    logger.info("Wallet: %s | Balance: checking...", client.wallet_address)

    tools = [
        X402SearchTool(client=client),
        X402CallTool(client=client),
    ]

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = create_react_agent(llm=llm, tools=tools, prompt=RESEARCH_PROMPT)
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        max_iterations=12,
        handle_parsing_errors=True,
    )

    result = executor.invoke({"input": f"Research this topic: {topic}"})
    return result["output"]


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        raise EnvironmentError("Set OPENAI_API_KEY environment variable")

    topic = "open-source LLM breakthroughs in early 2025"
    print(f"\nResearching: '{topic}'\n")

    try:
        summary = run_research_agent(topic)
        print("\n" + "="*60)
        print("FINAL RESEARCH SUMMARY")
        print("="*60)
        print(summary)
        print("\nEstimated cost: ~$0.015 (3 API calls)")

    except Exception as e:
        logger.error("Agent failed: %s", e)
        raise
```

---

## Expected Output

Running the script produces verbose LangChain trace output, then a final structured summary:

```
2025-04-10 14:32:01 INFO Wallet: 0x7aB3...f902 | Balance: checking...

> Entering new AgentExecutor chain...
Thought: I need to find a web search API first.
Action: search_services
Action Input: web search
Observation: [{"id": "a1b2c3d4-...", "name": "Web Search Pro", "price_usdc": 0.005, ...}]

Thought: Found the web search API. Now I'll search for the topic.
Action: call_service
Action Input: {"id": "a1b2c3d4-...", "params": {"query": "open-source LLM breakthroughs 2025"}}
Observation: {"results": [{"url": "https://techcrunch.com/2025/03/llama-4-...", "title": "Meta releases Llama 4..."}, ...]}

Thought: Got URLs. Now I'll find the scraping API.
Action: search_services
Action Input: scraping
Observation: [{"id": "e5f6a7b8-...", "name": "Web Scraper", "price_usdc": 0.005, ...}]

Action: call_service
Action Input: {"id": "e5f6a7b8-...", "params": {"url": "https://techcrunch.com/2025/03/llama-4-..."}}
Observation: {"content": "Meta today released Llama 4, a family of models including Scout (17B)..."}

Action: search_services
Action Input: summarization
Action: call_service
Action Input: {"id": "c9d0e1f2-...", "params": {"text": "Meta today released Llama 4..."}}
Observation: {"summary": "Meta's Llama 4 release marks a significant milestone..."}

> Finished chain.

============================================================
FINAL RESEARCH SUMMARY
============================================================
## Open-Source LLM Breakthroughs in Early 2025

**Key Development:** Meta released Llama 4, featuring the Scout (17B) and Maverick
(400B MoE) architectures. Scout achieves performance comparable to GPT-4o on most
benchmarks at a fraction of the inference cost.

**Other Notable Releases:**
- Mistral released Mistral-3 with 128k context and native function calling
- DeepSeek V3 reached state-of-the-art on coding benchmarks (HumanEval 92.3%)
- Qwen2.5-72B surpassed Llama 3.1 70B across 14/18 evaluation tasks

**Trend:** The open-source/closed-source performance gap closed dramatically in Q1 2025.

Estimated cost: ~$0.015 (3 API calls)
```

---

## Cost Breakdown

| Step | API | Price per Call | Purpose |
|------|-----|---------------|---------|
| 1 | Web Search | $0.005 | Find relevant URLs for the research topic |
| 2 | Web Scraper | $0.005 | Extract full article content from the top URL |
| 3 | Summarization | $0.005 | Compress article into a structured summary |
| **Total** | — | **$0.015** | **One complete research run** |

All payments are settled on SKALE (near-zero gas), in USDC. The SDK handles wallet management, transaction signing, and on-chain verification automatically.

---

## Error Handling

The SDK raises clear exceptions you can catch:

```python
from x402_bazaar.exceptions import InsufficientFundsError, ServiceUnavailableError

try:
    result = client.call(service_id, params={"query": topic})
except InsufficientFundsError:
    print("Wallet balance too low. Top up at https://x402bazaar.org")
except ServiceUnavailableError as e:
    print(f"Service temporarily down: {e}. Try a different one.")
```

---

## Next Steps

**Add more tools to the pipeline:**
```python
from x402_bazaar.integrations.langchain import X402SearchTool, X402CallTool

# The agent can discover and use ANY service in the marketplace
tools = [X402SearchTool(client=client), X402CallTool(client=client)]
# Add sentiment analysis, news APIs, stock data — all auto-discovered
```

**Change the research topic at runtime:**
```python
topics = [
    "advances in protein folding AI",
    "carbon capture technology 2025",
    "quantum error correction breakthroughs",
]
for t in topics:
    report = run_research_agent(t)
    print(report)
```

**Deploy as an API endpoint:**
```python
from flask import Flask, request, jsonify
app = Flask(__name__)

@app.route("/research", methods=["POST"])
def research_endpoint():
    topic = request.json["topic"]
    summary = run_research_agent(topic)
    return jsonify({"summary": summary, "cost_usd": 0.015})
```

**Schedule recurring research:**
```python
import schedule, time

def daily_research():
    report = run_research_agent("AI news today")
    # save to database, send email, post to Slack, etc.

schedule.every().day.at("08:00").do(daily_research)
while True:
    schedule.run_pending()
    time.sleep(60)
```

---

## x402 Bazaar Ecosystem

| Resource | Link |
|----------|------|
| Platform & API catalog | [x402bazaar.org](https://x402bazaar.org) |
| Python SDK (`pip install x402-bazaar`) | [GitHub](https://github.com/Wintyx57/x402-sdk-python) |
| JavaScript SDK (`npm install @wintyx/x402-sdk`) | [npm](https://www.npmjs.com/package/@wintyx/x402-sdk) |
| MCP Server for Claude/Cursor | [MCP Setup Guide](../MCP_SETUP.md) |
| Full integration guide | [Integration Guide](../INTEGRATION-GUIDE.md) |
| CrewAI cookbook | [data-analyst-crewai.md](./data-analyst-crewai.md) |
| Claude MCP cookbook | [mcp-workflow-claude.md](./mcp-workflow-claude.md) |

Questions or issues? Open an issue on GitHub or reach out via the platform.
