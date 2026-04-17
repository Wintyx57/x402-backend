# Build a Multi-Agent Data Analyst with CrewAI + x402 Bazaar

> **Quick Start**
> ```bash
> pip install x402-bazaar[crewai] crewai openai
> export OPENAI_API_KEY="sk-..."
> python market_analyst_crew.py
> ```

---

## Introduction

Modern financial and market intelligence requires pulling data from multiple sources simultaneously, cross-referencing signals, and synthesizing insights — the kind of work that benefits enormously from a multi-agent architecture.

**CrewAI** lets you define specialized agents with distinct roles and have them collaborate on a shared goal. Combined with **x402 Bazaar**, each agent can independently call paid APIs — news feeds, sentiment analyzers, stock data providers — paying per call in USDC with no upfront setup.

In this tutorial, you will build a **2-agent market intelligence crew**:

- **News Researcher** — fetches the latest headlines for a given company or sector ($0.01)
- **Market Analyst** — scores article sentiment, pulls live stock data, and writes the report ($0.02)

**Total cost: ~$0.030 per analysis run.** No API keys, no subscriptions, no rate-limit emails. Each agent pays exactly for what it consumes.

---

## Prerequisites

- Python 3.10 or higher
- OpenAI API key (`OPENAI_API_KEY`)
- ~$0.05 USDC in your x402 wallet (auto-created on first run; top up at [x402bazaar.org](https://x402bazaar.org))

### Install dependencies

```bash
pip install x402-bazaar[crewai] crewai openai
```

This installs:
- `x402-bazaar[crewai]` — SDK with CrewAI integration layer
- `crewai` — multi-agent orchestration framework
- `openai` — LLM backend for the agents

---

## Step 1: Set Up x402 Client with CrewAI Tools

The `X402Client` manages your wallet and signs transactions. The CrewAI integration wraps the client into `Tool` objects that CrewAI agents can call natively.

```python
# market_analyst_crew.py

import os
import logging
from x402_bazaar import X402Client
from x402_bazaar.integrations.crewai import X402SearchTool, X402CallTool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def build_x402_tools():
    """Initialize the x402 client and return CrewAI-compatible tool instances."""
    client = X402Client()
    logger.info("x402 wallet initialized: %s", client.wallet_address)

    search_tool = X402SearchTool(client=client)
    call_tool = X402CallTool(client=client)

    return client, search_tool, call_tool
```

`X402SearchTool` enables an agent to search the marketplace for the right API (free).
`X402CallTool` enables an agent to call a discovered API by UUID and parameters (paid).

---

## Step 2: Define the Two Specialized Agents

Each CrewAI `Agent` has a role, a goal, and a backstory. These guide the LLM's behavior. We give each agent the full set of x402 tools so they can discover and call any API they need.

```python
from crewai import Agent


def build_agents(search_tool, call_tool) -> tuple:
    """Create and return the News Researcher and Market Analyst agents."""

    news_researcher = Agent(
        role="News Researcher",
        goal=(
            "Gather the latest financial news and headlines about the target company or sector. "
            "Use the x402 marketplace to find a news API, then fetch current headlines."
        ),
        backstory=(
            "You are a seasoned financial journalist with 10 years of experience tracking "
            "market-moving news. You know how to find credible sources quickly and extract "
            "the key facts. You always verify what API to call before calling it."
        ),
        tools=[search_tool, call_tool],
        verbose=True,
        allow_delegation=False,
        max_iter=8,
    )

    market_analyst = Agent(
        role="Market Analyst",
        goal=(
            "Analyze the sentiment of provided news articles, retrieve current stock data "
            "for the company, and produce a structured investment intelligence report."
        ),
        backstory=(
            "You are a quantitative analyst at a top hedge fund. You specialize in NLP-driven "
            "sentiment scoring and correlating news signals with price action. "
            "You always search for the right API before calling it."
        ),
        tools=[search_tool, call_tool],
        verbose=True,
        allow_delegation=False,
        max_iter=10,
    )

    return news_researcher, market_analyst
```

---

## Step 3: Define the Tasks

Each CrewAI `Task` specifies what an agent must accomplish, with a clear expected output format. Tasks can reference each other's outputs via `context`.

```python
from crewai import Task


def build_tasks(news_researcher: Agent, market_analyst: Agent, target: str) -> list:
    """
    Build the task pipeline for a given research target.

    Args:
        news_researcher: The news gathering agent
        market_analyst: The analysis agent
        target: Company name, ticker, or sector (e.g. "NVIDIA", "AI semiconductors")

    Returns:
        List of Task objects in execution order
    """

    gather_news = Task(
        description=(
            f"Find and retrieve the 5 most recent and significant news articles about '{target}'. "
            "Step 1: Use search_services to find a 'news' API. "
            "Step 2: Call the news API with the target as query parameter. "
            "Step 3: Return a structured list of headlines, sources, publication dates, and URLs."
        ),
        expected_output=(
            "A JSON-formatted list of 5 news articles, each with: "
            "title, source, date, url, and a 2-sentence summary of the article content."
        ),
        agent=news_researcher,
    )

    analyze_sentiment = Task(
        description=(
            "For each article provided by the News Researcher, perform sentiment analysis. "
            "Step 1: Use search_services to find a 'sentiment' API. "
            "Step 2: Call the sentiment API for each article's summary text. "
            "Step 3: Aggregate the scores into an overall market sentiment score (0-100). "
            "Step 4: Identify the top 3 bullish signals and top 3 bearish signals."
        ),
        expected_output=(
            "A sentiment report with: overall_score (0-100, where 50=neutral), "
            "per_article_scores list, top_bullish_signals list, top_bearish_signals list."
        ),
        agent=market_analyst,
        context=[gather_news],  # receives the output of gather_news
    )

    get_stock_data_and_report = Task(
        description=(
            f"Retrieve current stock market data for '{target}', then produce the final report. "
            "Step 1: Use search_services to find a 'stocks' or 'financial data' API. "
            "Step 2: Call the stocks API with the ticker or company name. "
            "Step 3: Combine stock data + sentiment analysis into a final investment intelligence report."
        ),
        expected_output=(
            "A complete market intelligence report in markdown format with sections: "
            "Executive Summary, Latest News Summary, Sentiment Analysis (score + signals), "
            "Stock Data (price, change, volume), and Investment Outlook (bullish/neutral/bearish + rationale)."
        ),
        agent=market_analyst,
        context=[gather_news, analyze_sentiment],  # receives both previous outputs
    )

    return [gather_news, analyze_sentiment, get_stock_data_and_report]
```

---

## Step 4: Create the Crew and Run

```python
from crewai import Crew, Process


def run_market_analysis(target: str) -> str:
    """
    Run the full market intelligence analysis for the given target.

    Args:
        target: Company ticker, name, or sector to analyze

    Returns:
        Final market intelligence report as a string
    """
    client, search_tool, call_tool = build_x402_tools()

    news_researcher, market_analyst = build_agents(search_tool, call_tool)
    tasks = build_tasks(news_researcher, market_analyst, target)

    crew = Crew(
        agents=[news_researcher, market_analyst],
        tasks=tasks,
        process=Process.sequential,  # tasks run in order, each passing context to the next
        verbose=True,
    )

    logger.info("Launching crew for target: %s", target)
    result = crew.kickoff()
    logger.info("Analysis complete. Estimated cost: ~$0.030")

    return str(result)


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        raise EnvironmentError("OPENAI_API_KEY is not set")

    target = "NVIDIA"
    print(f"\nRunning market intelligence analysis for: {target}")
    print("=" * 60)

    try:
        report = run_market_analysis(target)
        print("\n" + "=" * 60)
        print("FINAL MARKET INTELLIGENCE REPORT")
        print("=" * 60)
        print(report)
        print("\nEstimated cost: ~$0.030 (4 API calls)")

    except Exception as e:
        logger.error("Crew failed: %s", e)
        raise
```

---

## Complete Runnable File

```python
# market_analyst_crew.py — Complete Multi-Agent Market Analyst
# Usage: python market_analyst_crew.py

import os
import logging
from x402_bazaar import X402Client
from x402_bazaar.integrations.crewai import X402SearchTool, X402CallTool
from crewai import Agent, Task, Crew, Process

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run_market_analysis(target: str) -> str:
    client = X402Client()
    logger.info("Wallet: %s", client.wallet_address)
    search_tool = X402SearchTool(client=client)
    call_tool = X402CallTool(client=client)

    news_researcher = Agent(
        role="News Researcher",
        goal=f"Gather the 5 most recent significant news articles about {target} using paid news APIs.",
        backstory="Experienced financial journalist. Always searches for the right API before calling it.",
        tools=[search_tool, call_tool],
        verbose=True,
        allow_delegation=False,
        max_iter=8,
    )
    market_analyst = Agent(
        role="Market Analyst",
        goal=f"Score news sentiment and correlate with live stock data for {target} to produce a report.",
        backstory="Quantitative analyst specializing in news-driven alpha signals.",
        tools=[search_tool, call_tool],
        verbose=True,
        allow_delegation=False,
        max_iter=10,
    )

    gather_news = Task(
        description=(
            f"Get 5 recent news articles about '{target}'. "
            "1. search_services('news') to find the news API. "
            "2. call_service(uuid, {{'query': target}}) to fetch headlines."
        ),
        expected_output="JSON list of 5 articles: title, source, date, url, 2-sentence summary.",
        agent=news_researcher,
    )
    analyze_sentiment = Task(
        description=(
            "Sentiment-score each article from the News Researcher. "
            "1. search_services('sentiment analysis') for the API. "
            "2. call_service for each article. "
            "3. Aggregate into overall score 0-100 + top 3 bullish/bearish signals."
        ),
        expected_output="Sentiment report: overall_score, per_article_scores, top_bullish, top_bearish.",
        agent=market_analyst,
        context=[gather_news],
    )
    final_report = Task(
        description=(
            f"Get live stock data for '{target}' and write the final report. "
            "1. search_services('stocks') for the stock data API. "
            "2. call_service(uuid, {{'symbol': target}}). "
            "3. Combine news + sentiment + stocks into a markdown report."
        ),
        expected_output=(
            "Markdown report: Executive Summary, News Summary, Sentiment (score + signals), "
            "Stock Data (price, change, volume), Investment Outlook."
        ),
        agent=market_analyst,
        context=[gather_news, analyze_sentiment],
    )

    crew = Crew(
        agents=[news_researcher, market_analyst],
        tasks=[gather_news, analyze_sentiment, final_report],
        process=Process.sequential,
        verbose=True,
    )

    return str(crew.kickoff())


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        raise EnvironmentError("Set OPENAI_API_KEY")

    target = input("Enter company name or ticker [NVIDIA]: ").strip() or "NVIDIA"

    try:
        report = run_market_analysis(target)
        print("\n" + "=" * 60)
        print(report)
        print("\nTotal estimated cost: ~$0.030")
    except Exception as e:
        logger.error("Analysis failed: %s", e)
        raise
```

---

## Expected Output

The crew runs sequentially, with verbose logging for each agent action:

```
INFO Wallet: 0x7aB3...f902

 [News Researcher] Starting task: Get 5 recent news articles about NVIDIA
 > Searching: search_services("news")
 > Found: Reuters Financial News API (id: d3e4f5a6-..., $0.01/call)
 > Calling: call_service("d3e4f5a6-...", {"query": "NVIDIA"})
 > Result: [
     {"title": "NVIDIA Blackwell B200 demand exceeds supply...", "source": "Reuters", ...},
     {"title": "NVIDIA Q1 2025 earnings beat estimates by 18%...", ...},
     ...
   ]
 [News Researcher] Task complete.

 [Market Analyst] Starting task: Sentiment analysis
 > Searching: search_services("sentiment analysis")
 > Found: Financial Sentiment API (id: a7b8c9d0-..., $0.005/call)
 > Calling sentiment API for article 1... score: 82 (bullish)
 > Calling sentiment API for article 2... score: 79 (bullish)
 > Aggregate sentiment score: 77/100
 [Market Analyst] Task complete.

 [Market Analyst] Starting task: Stock data + final report
 > Searching: search_services("stocks")
 > Found: Stock Market API (id: f1e2d3c4-..., $0.01/call)
 > Calling: call_service("f1e2d3c4-...", {"symbol": "NVDA"})
 > Result: {"price": 924.50, "change_pct": +2.3, "volume": 38420000, ...}

============================================================
FINAL MARKET INTELLIGENCE REPORT
============================================================

## NVIDIA (NVDA) — Market Intelligence Report
**Date:** April 10, 2025

### Executive Summary
NVIDIA continues to dominate the AI accelerator market. News sentiment is
strongly bullish (77/100), driven by supply-constrained Blackwell demand
and Q1 2025 earnings outperformance.

### Latest News Summary
1. **Blackwell B200 demand exceeds supply** (Reuters, Apr 9) — GPU orders
   backlogged into Q3 2025; margin expansion expected.
2. **Q1 2025 earnings beat by 18%** (Bloomberg, Apr 8) — Data center
   revenue $22.6B vs $19.1B consensus.
[...3 more articles...]

### Sentiment Analysis
- **Overall score:** 77/100 (Bullish)
- **Top bullish signals:** AI infrastructure spend, export license clarity,
  software moat (CUDA ecosystem)
- **Top bearish signals:** Valuation stretch (P/E 38x), China export risk,
  AMD MI300X competition

### Stock Data
| Metric | Value |
|--------|-------|
| Price | $924.50 |
| Change | +2.3% |
| Volume | 38,420,000 |
| 52w High | $974.00 |

### Investment Outlook
**BULLISH** — Short-term catalysts intact. Recommend monitoring Blackwell
shipment cadence and Q2 data center guidance as key inflection points.

Total estimated cost: ~$0.030
```

---

## Cost Breakdown

| Step | Agent | API | Price | Purpose |
|------|-------|-----|-------|---------|
| 1 | News Researcher | News Feed | $0.010 | Fetch 5 recent headlines for target |
| 2 | Market Analyst | Sentiment Analysis | $0.005 | Score article 1 sentiment |
| 3 | Market Analyst | Sentiment Analysis | $0.005 | Score article 2 sentiment |
| 4 | Market Analyst | Stock Data | $0.010 | Retrieve live price and volume |
| **Total** | — | — | **$0.030** | **Full analysis run** |

Note: sentiment calls can be batched — some APIs accept arrays, reducing cost to $0.005 for all articles.

---

## Error Handling

```python
from x402_bazaar.exceptions import InsufficientFundsError, ServiceUnavailableError

try:
    report = run_market_analysis("TSLA")
except InsufficientFundsError:
    print("Low balance. Top up at https://x402bazaar.org/wallet")
except ServiceUnavailableError as e:
    print(f"API unavailable: {e}. The crew will retry automatically on next run.")
except Exception as e:
    logger.error("Unexpected error: %s", e)
    raise
```

---

## Next Steps

**Run analysis on multiple tickers in parallel:**
```python
import asyncio

async def analyze_all(tickers: list[str]):
    tasks = [asyncio.to_thread(run_market_analysis, t) for t in tickers]
    reports = await asyncio.gather(*tasks)
    return dict(zip(tickers, reports))

reports = asyncio.run(analyze_all(["NVDA", "AMD", "INTC"]))
```

**Schedule a daily briefing:**
```python
import schedule, time

def daily_briefing():
    for ticker in ["NVDA", "MSFT", "GOOGL"]:
        report = run_market_analysis(ticker)
        # send_email(report) or post_to_slack(report)

schedule.every().weekday.at("07:30").do(daily_briefing)
while True:
    schedule.run_pending()
    time.sleep(60)
```

**Add a third "Risk Monitor" agent:**
```python
risk_monitor = Agent(
    role="Risk Monitor",
    goal="Flag regulatory and macro risks based on the news and sentiment data.",
    backstory="Former compliance officer with expertise in geopolitical risk.",
    tools=[search_tool, call_tool],
    max_iter=6,
)
```

**Export to PDF or Slack:**
```python
# After getting the report string
import json, requests

# Post to Slack
requests.post(os.environ["SLACK_WEBHOOK"], json={"text": report})
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
| LangChain cookbook | [research-agent-langchain.md](./research-agent-langchain.md) |
| Claude MCP cookbook | [mcp-workflow-claude.md](./mcp-workflow-claude.md) |

Questions or issues? Open an issue on GitHub or reach out via the platform.
