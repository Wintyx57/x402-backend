# x402 Bazaar - API Wrappers Documentation

## Overview

x402 Bazaar includes **69 native API wrapper endpoints** that proxy external APIs behind x402 micropayments. No API keys needed -- just pay USDC and get data.

---

## Web & Social

### 1. Web Search API

**Endpoint:** `GET /api/search?q={query}&max={count}`
**Price:** 0.005 USDC
**Source:** DuckDuckGo (free, no API key)

Clean web search results optimized for LLMs. No ads, no HTML -- just structured data.

**Parameters:**
- `q` (required): Search query (max 200 chars)
- `max` (optional): Max results (1-20, default 10)

**Response:**
```json
{
  "success": true,
  "query": "bitcoin price today",
  "results_count": 10,
  "results": [
    {
      "title": "Bitcoin Price | BTC Price Index and Live Chart",
      "url": "https://www.coindesk.com/price/bitcoin",
      "snippet": "Get the latest Bitcoin price, BTC market cap, trading pairs..."
    }
  ]
}
```

---

### 2. Universal Scraper

**Endpoint:** `GET /api/scrape?url={target_url}`
**Price:** 0.005 USDC
**Source:** Direct fetch + Cheerio + Turndown

Give any URL, get clean Markdown back. Strips ads, nav, scripts -- returns only main content.

**Parameters:**
- `url` (required): Target URL (HTTP/HTTPS only, no internal IPs)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/article",
  "title": "Article Title",
  "description": "Meta description...",
  "content": "# Article Title\n\nClean markdown content...",
  "content_length": 4521
}
```

**Security:** SSRF protection blocks localhost, private IPs, IPv6 loopback, and cloud metadata (169.254.x.x). DNS rebinding check. 5MB size limit.

---

### 3. Twitter/X Data API

**Endpoint:** `GET /api/twitter?user={username}` or `GET /api/twitter?tweet={tweet_url}` or `GET /api/twitter?search={query}`
**Price:** 0.005 USDC
**Source:** fxtwitter.com + Twitter Syndication API + DuckDuckGo

Read Twitter/X profiles, tweets, and search tweets by keyword -- all without API keys.

**Parameters (one required):**
- `user`: Twitter username (without @, e.g., "elonmusk")
- `tweet`: Full tweet URL (e.g., "https://x.com/user/status/123456789")
- `search`: Search tweets by keyword (max 200 chars, e.g., "bitcoin")
- `max` (optional, search only): Max results (1-20, default 10)

**Profile response:**
```json
{
  "success": true,
  "type": "profile",
  "user": {
    "username": "elonmusk",
    "name": "Elon Musk",
    "description": "...",
    "followers": 200000000,
    "following": 800,
    "tweets_count": 50000,
    "verified": true
  },
  "latest_tweet": {
    "text": "...",
    "likes": 50000,
    "retweets": 10000
  }
}
```

**Tweet response:**
```json
{
  "success": true,
  "type": "tweet",
  "tweet": {
    "id": "123456789",
    "text": "...",
    "likes": 50000,
    "retweets": 10000,
    "replies": 5000,
    "views": 1000000,
    "author": { "name": "...", "username": "...", "followers": 200000000 }
  }
}
```

**Search response:**
```json
{
  "success": true,
  "type": "search",
  "query": "bitcoin",
  "results_count": 10,
  "results": [
    {
      "title": "Bitcoin hits new all-time high...",
      "text": "Snippet from tweet...",
      "url": "https://twitter.com/user/status/123",
      "author": "username"
    }
  ]
}
```

---

### 4. News API

**Endpoint:** `GET /api/news?topic={topic}&lang={lang}`
**Price:** 0.005 USDC
**Source:** Google News RSS (free, no API key)

Get latest news articles for any topic.

**Parameters:**
- `topic` (required): News topic or keyword (max 100 chars, e.g., "artificial intelligence")
- `lang` (optional): Language code (default: "en")

**Response:**
```json
{
  "success": true,
  "topic": "artificial intelligence",
  "language": "en",
  "count": 10,
  "articles": [
    {
      "title": "OpenAI releases new model...",
      "link": "https://...",
      "source": "TechCrunch",
      "published": "Sun, 22 Feb 2026 10:00:00 GMT"
    }
  ]
}
```

---

### 5. Reddit API

**Endpoint:** `GET /api/reddit?subreddit={subreddit}&sort={sort}&limit={limit}`
**Price:** 0.005 USDC
**Source:** Reddit JSON API (public, no API key)

Get posts from any subreddit.

**Parameters:**
- `subreddit` (required): Subreddit name (without r/, e.g., "programming")
- `sort` (optional): `hot` (default), `new`, `top`, `rising`
- `limit` (optional): Number of posts (1-25, default 10)

**Response:**
```json
{
  "success": true,
  "subreddit": "programming",
  "sort": "hot",
  "count": 10,
  "posts": [
    {
      "title": "I built a...",
      "author": "user123",
      "score": 1234,
      "url": "https://...",
      "permalink": "https://reddit.com/r/programming/comments/...",
      "comments": 89,
      "created_utc": 1740230000,
      "selftext": "..."
    }
  ]
}
```

---

### 6. Hacker News API

**Endpoint:** `GET /api/hn?type={type}&limit={limit}`
**Price:** 0.003 USDC
**Source:** Hacker News Firebase API (free, no API key)

Get top, new, or best stories from Hacker News.

**Parameters:**
- `type` (optional): `top` (default), `new`, `best`, `ask`, `show`, `job`
- `limit` (optional): Number of stories (1-30, default 10)

**Response:**
```json
{
  "success": true,
  "type": "top",
  "count": 10,
  "stories": [
    {
      "id": 42356789,
      "title": "Show HN: I built...",
      "url": "https://...",
      "author": "hacker123",
      "score": 432,
      "comments": 87,
      "time": 1740220000,
      "hn_url": "https://news.ycombinator.com/item?id=42356789"
    }
  ]
}
```

---

### 7. YouTube Video Info API

**Endpoint:** `GET /api/youtube?url={youtube_url}` or `GET /api/youtube?id={video_id}`
**Price:** 0.005 USDC
**Source:** YouTube oEmbed API (free, no API key)

Get metadata for any public YouTube video.

**Parameters (one required):**
- `url`: Full YouTube URL (e.g., "https://youtube.com/watch?v=dQw4w9WgXcQ")
- `id`: 11-character video ID (e.g., "dQw4w9WgXcQ")

**Response:**
```json
{
  "success": true,
  "video_id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "author": "Rick Astley",
  "author_url": "https://www.youtube.com/@RickAstleyYT",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "width": 480,
  "height": 270,
  "watch_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "embed_url": "https://www.youtube.com/embed/dQw4w9WgXcQ"
}
```

---

## AI Generation

### 8. AI Image Generation (DALL-E 3)

**Endpoint:** `GET /api/image?prompt={description}`
**Price:** 0.05 USDC
**Source:** OpenAI DALL-E 3

Generate high-quality images from text descriptions using DALL-E 3. Returns a temporary image URL (valid ~1 hour).

**Parameters:**
- `prompt` (required): Image description (max 1000 chars)
- `size` (optional): Image dimensions -- `1024x1024` (default), `1024x1792` (portrait), `1792x1024` (landscape)
- `quality` (optional): `standard` (default) or `hd` (more detail, slower)

**Response:**
```json
{
  "success": true,
  "prompt": "a cat floating in space with stars",
  "revised_prompt": "A whimsical orange tabby cat floating gracefully in outer space...",
  "image_url": "https://oaidalleapiprodscus.blob.core.windows.net/...",
  "size": "1024x1024",
  "quality": "standard"
}
```

**Notes:**
- `revised_prompt` is DALL-E 3's expanded version of your prompt (always returned)
- Image URLs are temporary (~1 hour) -- download promptly
- Content policy: prompts violating OpenAI's content policy will be rejected (400 error)

---

### 9. Math Expression API

**Endpoint:** `GET /api/math?expr={expression}`
**Price:** 0.001 USDC
**Source:** mathjs (safe math evaluator, no eval/new Function)

Evaluate mathematical expressions safely. Supports arithmetic, trigonometry, constants (pi, e), and more.

**Parameters:**
- `expr` (required): Math expression (max 500 chars, e.g., "2*pi*5+sqrt(16)")

**Response:**
```json
{
  "success": true,
  "expression": "2*pi*5+sqrt(16)",
  "result": 35.41592653589793,
  "result_formatted": "35.4159265359"
}
```

---

## Intelligence (AI-Powered)

### 10. Contract Risk Analysis

**Endpoint:** `POST /api/contract-risk`
**Price:** 0.01 USDC
**Source:** OpenAI GPT-4o-mini

AI-powered contract clause analysis. Identifies risky clauses (unlimited liability, automatic renewals, IP transfers, non-compete, etc.) and assigns a risk score.

**Body (JSON):**
```json
{
  "text": "Full contract text here... (max 30000 chars)"
}
```

**Response:**
```json
{
  "success": true,
  "overall_risk": "medium",
  "risk_score": 45,
  "summary": "Standard SaaS contract with some concerning automatic renewal and liability clauses.",
  "clauses": [
    {
      "text": "This agreement auto-renews for successive 1-year terms...",
      "risk_level": "high",
      "category": "termination",
      "explanation": "Automatic renewal with no opt-out notice period specified."
    }
  ]
}
```

---

### 11. Email CRM Parser

**Endpoint:** `POST /api/email-parse`
**Price:** 0.005 USDC
**Source:** OpenAI GPT-4o-mini

Extract structured CRM data from raw email text: sender info, intent, urgency, topics, and suggested follow-up action.

**Body (JSON):**
```json
{
  "email": "Hi, I'm John from Acme Corp. We're interested in a partnership... (max 10000 chars)"
}
```

**Response:**
```json
{
  "success": true,
  "sender_name": "John Smith",
  "sender_email": "john@acme.com",
  "company": "Acme Corp",
  "phone": null,
  "intent": "partnership",
  "sentiment": "positive",
  "urgency": "medium",
  "key_topics": ["integration", "pricing", "timeline"],
  "follow_up_action": "Schedule a discovery call to discuss partnership terms.",
  "summary": "Acme Corp is interested in a technology partnership. They want to discuss pricing and integration options."
}
```

---

### 12. AI Code Review

**Endpoint:** `POST /api/code-review`
**Price:** 0.01 USDC
**Source:** OpenAI GPT-4o-mini

Senior engineer AI code review. Identifies bugs, security issues, performance problems, and maintainability concerns.

**Body (JSON):**
```json
{
  "code": "function login(user, pass) { ... }",
  "language": "javascript"
}
```

**Response:**
```json
{
  "success": true,
  "language": "javascript",
  "quality_score": 62,
  "summary": "Basic login function with critical security vulnerabilities.",
  "issues": [
    {
      "line": 3,
      "severity": "critical",
      "type": "security",
      "message": "SQL injection vulnerability via string concatenation",
      "suggestion": "Use parameterized queries or prepared statements."
    }
  ],
  "strengths": ["Clear function signature", "Handles basic error case"]
}
```

**Issue severity:** `critical`, `major`, `minor`, `info`
**Issue types:** `bug`, `security`, `performance`, `style`, `maintainability`

---

### 13. Table/CSV AI Insights

**Endpoint:** `POST /api/table-insights`
**Price:** 0.01 USDC
**Source:** OpenAI GPT-4o-mini

AI-powered data analysis for CSV/table data. Extracts insights, anomalies, trends, and recommendations.

**Body (JSON):**
```json
{
  "csv": "date,revenue,users\n2026-01,50000,1200\n2026-02,62000,1450\n..."
}
```

**Response:**
```json
{
  "success": true,
  "rows": 12,
  "columns": ["date", "revenue", "users"],
  "insights": ["Revenue grew 24% MoM in February", "User growth correlates strongly with revenue"],
  "anomalies": ["March revenue dipped despite user growth"],
  "trends": ["Steady upward trajectory over 12 months"],
  "recommendations": ["Investigate March revenue dip", "Increase user acquisition spend"],
  "summary": "Dataset shows a healthy growth trend over 12 months. Revenue and user metrics are generally correlated."
}
```

---

### 14. Domain Intelligence Report

**Endpoint:** `GET /api/domain-report?domain={domain}`
**Price:** 0.01 USDC
**Source:** RDAP + DNS + direct fetch + tech detection

Comprehensive domain intelligence: WHOIS/RDAP data, DNS records, SSL status, HTTP status, and tech stack detection.

**Parameters:**
- `domain` (required): Domain name (e.g., "stripe.com")

**Response:**
```json
{
  "success": true,
  "domain": "stripe.com",
  "trust_score": 95,
  "registrar": "MarkMonitor Inc.",
  "created": "2010-03-13T00:00:00Z",
  "expires": "2027-03-13T00:00:00Z",
  "age_days": 5800,
  "dns": {
    "a": ["54.187.216.72"],
    "mx": [{ "priority": 10, "exchange": "aspmx.l.google.com" }],
    "ns": ["ns1.p11.dynect.net"],
    "txt": ["v=spf1 include:_spf.google.com ~all"]
  },
  "ssl": true,
  "http_status": 200,
  "tech": ["Next.js", "React", "Server: cloudflare"]
}
```

**Trust score:** 0-100. Factors: domain age, MX records, SSL, DNS resolution, tech detection.

---

### 15. SEO Audit

**Endpoint:** `GET /api/seo-audit?url={url}`
**Price:** 0.01 USDC
**Source:** Direct fetch + Cheerio

Full on-page SEO audit. Checks title, meta description, headings, canonical, OG tags, images, schema.org, and links.

**Parameters:**
- `url` (required): Page URL to audit (HTTP/HTTPS only)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "score": 75,
  "grade": "B",
  "issues": [
    { "severity": "major", "message": "Meta description too short (45 chars, min 120)" },
    { "severity": "minor", "message": "No canonical tag" }
  ],
  "meta": {
    "title": "Example Domain",
    "description": "This domain is for illustrative examples.",
    "canonical": null
  },
  "headings": {
    "h1": ["Example Domain"],
    "h2_count": 0,
    "h3_count": 0
  },
  "links": { "internal": 1, "external": 1 },
  "schema_org": false,
  "page_size_kb": 12
}
```

**Grades:** A (≥90), B (≥75), C (≥60), D (≥45), F (<45)
**Issue severity:** `critical` (-25), `major` (-10), `minor` (-5), `info` (0)

---

### 16. Lead Scoring

**Endpoint:** `GET /api/lead-score?domain={domain}`
**Price:** 0.01 USDC
**Source:** RDAP + DNS + GitHub + direct fetch

Score a company domain as a B2B lead (0-100). Evaluates domain age, email setup, HTTPS, DNS, GitHub presence, and tech stack.

**Parameters:**
- `domain` (required): Company domain (e.g., "stripe.com")

**Response:**
```json
{
  "success": true,
  "domain": "stripe.com",
  "score": 90,
  "grade": "A",
  "signals": [
    { "name": "Domain age", "value": "15y", "points": 20 },
    { "name": "Email configured", "value": "aspmx.l.google.com", "points": 20 },
    { "name": "HTTPS/SSL", "value": "Valid", "points": 15 },
    { "name": "DNS resolves", "value": "54.187.216.72", "points": 15 },
    { "name": "GitHub org", "value": "32 public repos", "points": 20 }
  ],
  "age_days": 5800,
  "github_org": { "repos": 32, "followers": 12000 }
}
```

**Grades:** A (≥80), B (≥65), C (≥50), D (≥35), F (<35)

---

### 17. Crypto Intelligence

**Endpoint:** `GET /api/crypto-intelligence?symbol={symbol}`
**Price:** 0.005 USDC
**Source:** CoinGecko (free, no API key)

Comprehensive crypto token data: price, market cap, volume, ATH, supply, GitHub activity, and community metrics.

**Parameters:**
- `symbol` (required): Token name or CoinGecko ID (e.g., "bitcoin", "ethereum", "solana")

**Response:**
```json
{
  "success": true,
  "id": "bitcoin",
  "name": "Bitcoin",
  "symbol": "BTC",
  "price_usd": 95000,
  "market_cap_usd": 1880000000000,
  "volume_24h": 42000000000,
  "change_24h": 1.23,
  "change_7d": -2.45,
  "ath_usd": 109000,
  "ath_date": "2025-01-20T00:00:00Z",
  "circulating_supply": 19800000,
  "total_supply": 21000000,
  "github": { "stars": 78000, "forks": 35000, "commits_4w": 45, "contributors": 120 },
  "community": { "twitter_followers": 6800000, "telegram_users": 0, "reddit_subscribers": 5500000 },
  "links": { "homepage": "https://bitcoin.org", "github": "https://github.com/bitcoin/bitcoin" },
  "description": "Bitcoin is a decentralized digital currency..."
}
```

---

## Data & Finance

### 18. Weather API

**Endpoint:** `GET /api/weather?city={city_name}`
**Price:** 0.02 USDC
**Source:** Open-Meteo (free, no API key)

**Response:**
```json
{
  "success": true,
  "city": "Paris",
  "country": "FR",
  "temperature": 15.2,
  "wind_speed": 12.5,
  "weather_code": 3,
  "time": "2026-02-09T21:00"
}
```

---

### 19. Crypto Price API

**Endpoint:** `GET /api/crypto?coin={coin_id}`
**Price:** 0.02 USDC
**Source:** CoinGecko (primary) + CryptoCompare (fallback)

**Response:**
```json
{
  "success": true,
  "coin": "bitcoin",
  "usd": 95000,
  "eur": 88000,
  "usd_24h_change": 1.23,
  "source": "coingecko"
}
```

---

### 20. Stock Price API

**Endpoint:** `GET /api/stocks?symbol={ticker}`
**Price:** 0.005 USDC
**Source:** Yahoo Finance v8 (public endpoint, no API key)

Get real-time stock prices, change, and market state for any ticker.

**Parameters:**
- `symbol` (required): Stock ticker symbol (e.g., "AAPL", "MSFT", "TSLA") — max 10 chars

**Response:**
```json
{
  "success": true,
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "currency": "USD",
  "price": 195.50,
  "previous_close": 193.20,
  "change": 2.30,
  "change_percent": 1.19,
  "market_state": "REGULAR",
  "exchange": "NASDAQ"
}
```

---

### 21. Currency Converter API

**Endpoint:** `GET /api/currency?from={code}&to={code}&amount={amount}`
**Price:** 0.005 USDC
**Source:** Frankfurter API (ECB rates, free, no key)

Convert between 30+ currencies using European Central Bank rates.

**Parameters:**
- `from` (required): Source currency code (ISO 4217, e.g., "USD")
- `to` (required): Target currency code (e.g., "EUR")
- `amount` (optional): Amount to convert (default: 1)

**Response:**
```json
{
  "success": true,
  "from": "USD",
  "to": "EUR",
  "amount": 100,
  "converted": 92.15,
  "rate": 0.9215,
  "date": "2026-02-13"
}
```

---

## Knowledge & Geography

### 22. Wikipedia Summary

**Endpoint:** `GET /api/wikipedia?q={query}`
**Price:** 0.005 USDC
**Source:** Wikipedia REST API

**Response:**
```json
{
  "success": true,
  "title": "Bitcoin",
  "extract": "Bitcoin is a decentralized digital currency...",
  "description": "Decentralized digital currency",
  "thumbnail": "https://upload.wikimedia.org/...",
  "url": "https://en.wikipedia.org/wiki/Bitcoin"
}
```

---

### 23. Dictionary API

**Endpoint:** `GET /api/dictionary?word={word}`
**Price:** 0.005 USDC
**Source:** Free Dictionary API

**Response:**
```json
{
  "success": true,
  "word": "hello",
  "phonetic": "/həˈloʊ/",
  "meanings": [
    {
      "partOfSpeech": "exclamation",
      "definitions": [
        "used as a greeting or to begin a phone conversation"
      ]
    }
  ],
  "sourceUrl": "https://en.wiktionary.org/wiki/hello"
}
```

---

### 24. Countries API

**Endpoint:** `GET /api/countries?name={country_name}`
**Price:** 0.005 USDC
**Source:** REST Countries API

**Response:**
```json
{
  "success": true,
  "name": "France",
  "official": "French Republic",
  "capital": "Paris",
  "population": 67391582,
  "region": "Europe",
  "subregion": "Western Europe",
  "currencies": ["Euro"],
  "languages": ["French"],
  "flag": "https://flagcdn.com/fr.svg",
  "timezones": ["UTC+01:00"]
}
```

---

### 25. IP Geolocation

**Endpoint:** `GET /api/ip?address={ip_address}`
**Price:** 0.005 USDC
**Source:** ip-api.com

**Response:**
```json
{
  "success": true,
  "ip": "8.8.8.8",
  "country": "United States",
  "country_code": "US",
  "region": "California",
  "city": "Mountain View",
  "zip": "94035",
  "latitude": 37.386,
  "longitude": -122.0838,
  "timezone": "America/Los_Angeles",
  "isp": "Google LLC",
  "org": "Google Public DNS"
}
```

---

### 26. Geocoding API

**Endpoint:** `GET /api/geocoding?city={city_name}`
**Price:** 0.005 USDC
**Source:** Open-Meteo Geocoding API

**Response:**
```json
{
  "success": true,
  "query": "Paris",
  "results": [
    {
      "name": "Paris",
      "country": "France",
      "country_code": "FR",
      "latitude": 48.85341,
      "longitude": 2.3488,
      "population": 2138551,
      "timezone": "Europe/Paris"
    }
  ]
}
```

---

### 27. Air Quality API

**Endpoint:** `GET /api/airquality?lat={latitude}&lon={longitude}`
**Price:** 0.005 USDC
**Source:** Open-Meteo Air Quality API

**Parameters:**
- `lat` (required): Latitude (-90 to 90)
- `lon` (required): Longitude (-180 to 180)

**Response:**
```json
{
  "success": true,
  "latitude": 48.85,
  "longitude": 2.35,
  "time": "2026-02-11T10:00",
  "pm2_5": 12.5,
  "pm10": 18.3,
  "ozone": 45.2,
  "nitrogen_dioxide": 22.1,
  "carbon_monoxide": 320,
  "european_aqi": 28,
  "us_aqi": 52
}
```

---

## Developer Tools

### 28. GitHub API

**Endpoint:** `GET /api/github?user={username}` or `GET /api/github?repo={owner/repo}`
**Price:** 0.005 USDC
**Source:** GitHub API (no auth required for public data)

**Parameters (one required):**
- `user`: GitHub username (e.g., "torvalds")
- `repo`: Repository path (e.g., "facebook/react")

**User response:**
```json
{
  "success": true,
  "type": "user",
  "login": "torvalds",
  "name": "Linus Torvalds",
  "bio": "Creator of Linux",
  "public_repos": 8,
  "followers": 180000,
  "following": 0,
  "avatar": "https://avatars.githubusercontent.com/u/1024025",
  "url": "https://github.com/torvalds",
  "created_at": "2011-09-03T15:26:22Z"
}
```

**Repository response:**
```json
{
  "success": true,
  "type": "repo",
  "name": "facebook/react",
  "description": "The library for web and native user interfaces",
  "stars": 230000,
  "forks": 47000,
  "language": "JavaScript",
  "license": "MIT",
  "open_issues": 850,
  "url": "https://github.com/facebook/react",
  "created_at": "2013-05-24T16:15:54Z",
  "updated_at": "2026-02-11T10:30:00Z"
}
```

---

### 29. NPM Registry API

**Endpoint:** `GET /api/npm?package={package_name}`
**Price:** 0.005 USDC
**Source:** NPM Registry (public)

**Response:**
```json
{
  "success": true,
  "name": "react",
  "description": "React is a JavaScript library for building user interfaces.",
  "latest_version": "18.2.0",
  "license": "MIT",
  "homepage": "https://reactjs.org/",
  "repository": "git+https://github.com/facebook/react.git",
  "keywords": ["react", "framework", "ui"],
  "author": "Meta Platforms, Inc.",
  "modified": "2023-06-14T15:27:31.049Z"
}
```

---

### 30. DNS Lookup API

**Endpoint:** `GET /api/dns?domain={domain}&type={type}`
**Price:** 0.003 USDC
**Source:** Node.js built-in DNS module

**Parameters:**
- `domain` (required): Domain name (e.g., "google.com")
- `type` (optional): Record type (A, AAAA, MX, TXT, CNAME, NS, SOA, PTR, SRV, default: "A")

**Response:**
```json
{
  "success": true,
  "domain": "google.com",
  "type": "A",
  "records": ["142.250.185.206"]
}
```

**Security:** Blocks localhost, private IPs, and cloud metadata endpoints.

---

### 31. WHOIS / Domain Lookup API

**Endpoint:** `GET /api/whois?domain={domain}`
**Price:** 0.005 USDC
**Source:** RDAP (successor to WHOIS, free, JSON)

Get domain registration info: registrar, creation date, expiry, nameservers, and status.

**Parameters:**
- `domain` (required): Domain name (e.g., "example.com")

**Response:**
```json
{
  "success": true,
  "domain": "example.com",
  "status": ["active"],
  "registered": "1995-08-13T00:00:00Z",
  "expires": "2026-08-12T00:00:00Z",
  "last_updated": "2024-08-01T00:00:00Z",
  "nameservers": ["a.iana-servers.net", "b.iana-servers.net"],
  "registrar": "ICANN"
}
```

---

### 32. SSL Certificate Check API

**Endpoint:** `GET /api/ssl-check?domain={domain}`
**Price:** 0.003 USDC
**Source:** Node.js built-in TLS module

Check SSL/TLS certificate validity, expiry, and details for any domain.

**Parameters:**
- `domain` (required): Domain name without protocol (e.g., "google.com")

**Response:**
```json
{
  "success": true,
  "domain": "google.com",
  "certificate": {
    "subject": "*.google.com",
    "issuer": "Google Trust Services",
    "valid_from": "2025-12-01T00:00:00.000Z",
    "valid_to": "2026-03-01T00:00:00.000Z",
    "days_remaining": 7,
    "is_valid": true,
    "serial_number": "ABC123...",
    "fingerprint": "SHA256:...",
    "san": ["*.google.com", "google.com"]
  }
}
```

---

### 33. URL Shortener API

**Endpoint:** `GET /api/url-shorten?url={url}`
**Price:** 0.003 USDC
**Source:** is.gd (free, no API key)

Shorten any URL using is.gd.

**Parameters:**
- `url` (required): URL to shorten (max 2000 chars, must be valid HTTP/HTTPS)

**Response:**
```json
{
  "success": true,
  "original_url": "https://example.com/very/long/path?with=many&query=params",
  "short_url": "https://is.gd/AbCdEf"
}
```

---

### 34. Cron Expression Parser API

**Endpoint:** `GET /api/cron-parse?expr={cron_expression}`
**Price:** 0.001 USDC
**Source:** Built-in parser

Parse and explain cron expressions. Supports 5-field (standard) and 6-field (with seconds) formats.

**Parameters:**
- `expr` (required): Cron expression (e.g., "0 9 * * 1-5", "*/15 * * * *")

**Response:**
```json
{
  "success": true,
  "expression": "0 9 * * 1-5",
  "fields": {
    "minute": { "value": "0", "range": "0-59", "special": ", - * /" },
    "hour": { "value": "9", "range": "0-23", "special": ", - * /" },
    "day_of_month": { "value": "*", "range": "1-31", "special": ", - * / ?" },
    "month": { "value": "*", "range": "1-12 or JAN-DEC", "special": ", - * /" },
    "day_of_week": { "value": "1-5", "range": "0-7 or SUN-SAT", "special": ", - * / ?" }
  },
  "description": "At 9:00 (weekdays only)",
  "field_count": 5
}
```

---

### 35. HTTP Status Code API

**Endpoint:** `GET /api/http-status?code={code}`
**Price:** 0.001 USDC
**Source:** Built-in database

Lookup HTTP status code name, description, and category.

**Parameters:**
- `code` (required): HTTP status code (100-599)

**Response:**
```json
{
  "success": true,
  "code": 402,
  "name": "Payment Required",
  "description": "Payment is required to access this resource. Used by x402 protocol for machine-to-machine payments.",
  "category": "Client Error"
}
```

**Categories:** Informational (1xx), Success (2xx), Redirection (3xx), Client Error (4xx), Server Error (5xx)

---

### 36. Unit Converter API

**Endpoint:** `GET /api/unit-convert?value={value}&from={unit}&to={unit}`
**Price:** 0.001 USDC
**Source:** Built-in converter

Convert between units of length, weight, temperature, volume, speed, and data.

**Parameters:**
- `value` (required): Numeric value to convert
- `from` (required): Source unit (e.g., "km", "lbs", "celsius", "gal", "mph", "gb")
- `to` (required): Target unit

**Supported units:**
- **Length:** km, m, cm, mm, miles/mi, yards/yd, feet/ft, inches/in, nm
- **Weight:** kg, g, mg, lb/lbs, oz, ton
- **Temperature:** c/celsius, f/fahrenheit, k/kelvin
- **Volume:** l, ml, gal/gallon, qt, pt, cup, floz
- **Speed:** km/h, mph, m/s, knots
- **Data:** b, kb, mb, gb, tb

**Response:**
```json
{
  "success": true,
  "value": 100,
  "from": "km",
  "to": "miles",
  "result": 62.1371192237,
  "formula": "100 km = 62.1371192237 miles"
}
```

---

## AI Text Processing

### 37. Text Summarization API

**Endpoint:** `GET /api/summarize?text={text}&maxLength={words}`
**Price:** 0.01 USDC
**Source:** OpenAI GPT-4o-mini

**Parameters:**
- `text` (required): Text to summarize (50-50000 chars)
- `maxLength` (optional): Max summary length in words (50-2000, default: 200)

**Response:**
```json
{
  "success": true,
  "summary": "This article discusses the rise of decentralized AI agents...",
  "originalLength": 5432,
  "summaryLength": 156
}
```

---

### 38. Sentiment Analysis API

**Endpoint:** `GET /api/sentiment?text={text}`
**Price:** 0.005 USDC
**Source:** OpenAI GPT-4o-mini

**Parameters:**
- `text` (required): Text to analyze (5-10000 chars)

**Response:**
```json
{
  "success": true,
  "sentiment": "positive",
  "score": 0.92,
  "keywords": ["love", "amazing", "great"],
  "text": "I love this product! It's amazing..."
}
```

**Sentiment values:** `positive`, `negative`, `neutral`
**Score range:** 0.0 (low confidence) to 1.0 (high confidence)

---

### 39. Readability Extractor API

**Endpoint:** `GET /api/readability?url={url}`
**Price:** 0.005 USDC
**Source:** Direct fetch + Cheerio

Extract clean readable text from any web page.

**Parameters:**
- `url` (required): Web page URL (HTTP/HTTPS only)

**Response:**
```json
{
  "success": true,
  "title": "Article Title",
  "text": "This is the main article text without ads or navigation...",
  "wordCount": 1234,
  "url": "https://example.com/article"
}
```

**Security:** SSRF protection + DNS rebinding check. 5MB size limit.

---

## Text Processing

### 40. Translation API

**Endpoint:** `GET /api/translate?text={text}&from={lang}&to={lang}`
**Price:** 0.005 USDC
**Source:** MyMemory Translation API (free, no API key)

**Parameters:**
- `text` (required): Text to translate (max 5000 chars)
- `from` (optional): Source language code (default: "auto", e.g., "en", "fr", "es")
- `to` (required): Target language code (e.g., "fr", "es", "en")

**Response:**
```json
{
  "success": true,
  "translatedText": "Bonjour le monde",
  "from": "en",
  "to": "fr",
  "original": "Hello world"
}
```

---

### 41. Markdown to HTML API

**Endpoint:** `GET /api/markdown?text={markdown}`
**Price:** 0.001 USDC
**Source:** Built-in converter

**Parameters:**
- `text` (required): Markdown text (max 50000 chars)

**Response:**
```json
{
  "success": true,
  "html": "<p><strong>bold</strong> and <em>italic</em></p>",
  "input_length": 22,
  "output_length": 48
}
```

---

### 42. HTML to Text API

**Endpoint:** `GET /api/html-to-text?html={html}`
**Price:** 0.001 USDC
**Source:** Cheerio (built-in)

Strip HTML tags and extract plain text, links, and images from raw HTML.

**Parameters:**
- `html` (required): HTML content to parse (max 100KB)

**Response:**
```json
{
  "success": true,
  "text": "Article Title. This is the main content...",
  "text_length": 1234,
  "html_length": 5678,
  "links_count": 3,
  "links": [
    { "text": "Click here", "href": "https://example.com" }
  ],
  "images_count": 1,
  "images": [
    { "src": "https://example.com/img.jpg", "alt": "Image description" }
  ]
}
```

---

### 43. CSV to JSON API

**Endpoint:** `GET /api/csv-to-json?csv={csv_data}&delimiter={char}&header={true|false}`
**Price:** 0.001 USDC
**Source:** Built-in parser

Convert CSV data to JSON. Supports quoted fields and custom delimiters.

**Parameters:**
- `csv` (required): CSV content (max 50KB)
- `delimiter` (optional): Field separator (default: ",")
- `header` (optional): First row is header (default: true)

**Response:**
```json
{
  "success": true,
  "rows": 3,
  "columns": 3,
  "data": [
    { "name": "Alice", "age": "30", "city": "Paris" },
    { "name": "Bob", "age": "25", "city": "London" }
  ]
}
```

---

### 44. Base64 Encode/Decode API

**Endpoint:** `GET /api/base64?text={text}&mode={encode|decode}`
**Price:** 0.001 USDC
**Source:** Node.js Buffer (built-in)

**Parameters:**
- `text` (required): Text to encode/decode (max 50000 chars)
- `mode` (optional): `encode` (default) or `decode`

**Response:**
```json
{
  "success": true,
  "result": "aGVsbG8=",
  "mode": "encode",
  "input_length": 5,
  "output_length": 8
}
```

---

### 45. Text Diff API

**Endpoint:** `GET /api/diff?text1={text1}&text2={text2}`
**Price:** 0.001 USDC
**Source:** Built-in line-by-line diff

Compare two texts line by line and get a structured diff.

**Parameters:**
- `text1` (required): First text (max 10000 chars)
- `text2` (required): Second text (max 10000 chars)

**Response:**
```json
{
  "success": true,
  "identical": false,
  "lines_text1": 5,
  "lines_text2": 5,
  "changes_count": 1,
  "changes": [
    { "line": 3, "type": "modified", "old": "hello world", "new": "hello earth" }
  ]
}
```

**Change types:** `added`, `removed`, `modified`

---

## Validation & Parsing

### 46. Email Validation API

**Endpoint:** `GET /api/validate-email?email={email}`
**Price:** 0.003 USDC
**Source:** Node.js built-in DNS module

**Parameters:**
- `email` (required): Email address to validate (max 320 chars)

**Response:**
```json
{
  "success": true,
  "email": "test@example.com",
  "valid": true,
  "format": true,
  "mxRecords": true,
  "domain": "example.com"
}
```

**Validation steps:** Format check (RFC 5322) → domain extraction → DNS MX record lookup

---

### 47. Phone Validate API

**Endpoint:** `GET /api/phone-validate?phone={phone}`
**Price:** 0.001 USDC
**Source:** Built-in parser

Validate and parse phone numbers. Detects country code for 12+ countries (US, FR, GB, DE, JP, CN, IN, BR, RU, IT, ES, AU).

**Parameters:**
- `phone` (required): Phone number (e.g., "+33612345678", max 30 chars)

**Response:**
```json
{
  "success": true,
  "input": "+33612345678",
  "cleaned": "+33612345678",
  "digits_only": "33612345678",
  "digit_count": 11,
  "valid": true,
  "has_country_code": true,
  "country": "FR",
  "expected_format": "+33 X XX XX XX XX",
  "type": "mobile"
}
```

---

### 48. URL Parse API

**Endpoint:** `GET /api/url-parse?url={url}`
**Price:** 0.001 USDC
**Source:** Node.js URL (built-in)

Parse a URL into its components (protocol, hostname, port, path, query params, hash).

**Parameters:**
- `url` (required): URL to parse (max 2000 chars)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com:8080/path?q=test#section",
  "protocol": "https",
  "hostname": "example.com",
  "port": "8080",
  "pathname": "/path",
  "search": "?q=test",
  "hash": "#section",
  "origin": "https://example.com:8080",
  "params": { "q": "test" },
  "param_count": 1,
  "is_https": true
}
```

---

### 49. JSON Validator API

**Endpoint:** `GET /api/json-validate?json={json}` or `POST /api/json-validate`
**Price:** 0.001 USDC
**Source:** Built-in JSON parser

Validate and format JSON strings. Reports errors with position.

**GET:** `?json={json_string}`
**POST body:**
```json
{ "json": "{\"key\": \"value\"}" }
```

**Response (valid):**
```json
{
  "success": true,
  "valid": true,
  "input_length": 16,
  "formatted": "{\n  \"key\": \"value\"\n}",
  "type": "object",
  "keys_count": 1
}
```

**Response (invalid):**
```json
{
  "success": true,
  "valid": false,
  "input_length": 10,
  "error_message": "Unexpected token } in JSON at position 8"
}
```

---

### 50. JWT Decode API

**Endpoint:** `GET /api/jwt-decode?token={jwt}`
**Price:** 0.001 USDC
**Source:** Built-in Base64url decoder

Decode JWT tokens without verification. Extracts header, payload, and expiry info.

**Parameters:**
- `token` (required): JWT token string (max 10000 chars)

**Response:**
```json
{
  "success": true,
  "header": { "alg": "HS256", "typ": "JWT" },
  "payload": {
    "sub": "1234567890",
    "name": "John Doe",
    "iat": 1516239022,
    "exp": 1516242622
  },
  "expired": true,
  "expires_in_seconds": -3600,
  "issued_at": "2018-01-18T01:30:22.000Z",
  "expires_at": "2018-01-18T02:30:22.000Z",
  "note": "Signature NOT verified (decode only, no secret key)"
}
```

---

### 51. Password Strength API

**Endpoint:** `GET /api/password-strength?password={password}`
**Price:** 0.001 USDC
**Source:** Built-in analyzer

Analyze password strength with entropy calculation and actionable suggestions.

**Parameters:**
- `password` (required): Password to analyze (max 200 chars)

**Response:**
```json
{
  "success": true,
  "strength": "strong",
  "score": 80,
  "entropy_bits": 87.3,
  "checks": {
    "length": 16,
    "has_lowercase": true,
    "has_uppercase": true,
    "has_digits": true,
    "has_special": true,
    "has_spaces": false,
    "is_common": false
  },
  "suggestions": []
}
```

**Strength levels:** `very_weak`, `weak`, `fair`, `strong`, `very_strong`

---

### 52. Regex Tester API

**Endpoint:** `GET /api/regex?pattern={regex}&text={text}&flags={flags}`
**Price:** 0.001 USDC
**Source:** Node.js built-in RegExp

Test regular expressions against text. Returns all matches with index and capture groups.

**Parameters:**
- `pattern` (required): Regular expression pattern (max 500 chars)
- `text` (required): Text to match against (max 5000 chars)
- `flags` (optional): Regex flags (g, i, m, s, u, y — default: "g")

**Response:**
```json
{
  "success": true,
  "pattern": "\\d+",
  "flags": "g",
  "text_length": 15,
  "match_count": 2,
  "matches": [
    { "match": "123", "index": 3, "groups": [] },
    { "match": "456", "index": 10, "groups": [] }
  ]
}
```

---

## Generation & Utilities

### 53. QR Code Generator (Image)

**Endpoint:** `GET /api/qrcode?text={content}&size={pixels}`
**Price:** 0.005 USDC
**Source:** QR Server API

Generate QR codes from any text. Returns PNG image directly.

**Parameters:**
- `text` (required): Content to encode (max 500 chars)
- `size` (optional): Image size in pixels (50-1000, default 200)

**Response:** PNG image (Content-Type: image/png)

**Note:** This endpoint returns an image directly, not JSON.

---

### 54. QR Code Generator API (JSON)

**Endpoint:** `GET /api/qrcode-gen?data={data}&size={size}`
**Price:** 0.003 USDC
**Source:** QR Server API

Generate QR code images and get back a JSON response with the image URL.

**Parameters:**
- `data` (required): Data to encode (max 2000 chars)
- `size` (optional): Image size in pixels (50-1000, default: 300)

**Response:**
```json
{
  "success": true,
  "imageUrl": "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=...",
  "data": "https://example.com",
  "size": 300
}
```

---

### 55. UUID Generator API

**Endpoint:** `GET /api/uuid?count={count}`
**Price:** 0.001 USDC
**Source:** Node.js crypto (built-in)

**Parameters:**
- `count` (optional): Number of UUIDs (1-100, default: 1)

**Response:**
```json
{
  "success": true,
  "uuids": ["550e8400-e29b-41d4-a716-446655440000"],
  "count": 1
}
```

---

### 56. Password Generator API

**Endpoint:** `GET /api/password?length={length}&symbols={true|false}`
**Price:** 0.001 USDC
**Source:** Node.js crypto (built-in)

**Parameters:**
- `length` (optional): Password length (8-128, default: 16)
- `symbols` (optional): Include symbols (default: true)
- `numbers` (optional): Include numbers (default: true)
- `uppercase` (optional): Include uppercase (default: true)

**Response:**
```json
{
  "success": true,
  "password": "k9#Tm2$xQ7pL!wR4",
  "length": 16,
  "options": { "symbols": true, "numbers": true, "uppercase": true }
}
```

---

### 57. Hash Generator API

**Endpoint:** `GET /api/hash?text={text}&algo={algorithm}`
**Price:** 0.001 USDC
**Source:** Node.js crypto (built-in)

**Parameters:**
- `text` (required): Text to hash (max 10000 chars)
- `algo` (optional): Algorithm — `md5`, `sha1`, `sha256` (default), `sha512`

**Response:**
```json
{
  "success": true,
  "hash": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  "algorithm": "sha256",
  "input_length": 5
}
```

---

### 58. Color Converter API

**Endpoint:** `GET /api/color?hex={hex}` or `GET /api/color?rgb={r,g,b}`
**Price:** 0.001 USDC
**Source:** Built-in converter

**Parameters (one required):**
- `hex`: Hex color without # (e.g., "ff5733")
- `rgb`: RGB values comma-separated (e.g., "255,87,51")

**Response:**
```json
{
  "success": true,
  "hex": "#ff5733",
  "rgb": { "r": 255, "g": 87, "b": 51 },
  "hsl": { "h": 11, "s": 100, "l": 60 },
  "css_rgb": "rgb(255, 87, 51)",
  "css_hsl": "hsl(11, 100%, 60%)"
}
```

---

### 59. Timestamp Converter API

**Endpoint:** `GET /api/timestamp?ts={unix}` or `GET /api/timestamp?date={iso}`
**Price:** 0.001 USDC
**Source:** Node.js Date (built-in)

Convert between Unix timestamps and human-readable dates. Without parameters, returns current time.

**Parameters (all optional):**
- `ts`: Unix timestamp (seconds or milliseconds)
- `date`: ISO 8601 date string (e.g., "2026-01-15T12:00:00Z")

**Response:**
```json
{
  "success": true,
  "timestamp": 1739448000,
  "timestamp_ms": 1739448000000,
  "iso": "2026-02-13T12:00:00.000Z",
  "utc": "Fri, 13 Feb 2026 12:00:00 GMT"
}
```

---

### 60. Lorem Ipsum Generator API

**Endpoint:** `GET /api/lorem?paragraphs={count}`
**Price:** 0.001 USDC
**Source:** Built-in generator

**Parameters:**
- `paragraphs` (optional): Number of paragraphs (1-20, default: 3)

**Response:**
```json
{
  "success": true,
  "paragraphs": ["Lorem ipsum dolor sit amet..."],
  "count": 3,
  "total_words": 150
}
```

---

### 61. World Time API

**Endpoint:** `GET /api/time?timezone={timezone}`
**Price:** 0.005 USDC
**Source:** Node.js Intl (built-in)

**Parameters:**
- `timezone` (required): Timezone (format: Region/City, e.g., "Europe/Paris")

**Response:**
```json
{
  "success": true,
  "timezone": "Europe/Paris",
  "datetime": "2026-02-11T11:30:45+01:00",
  "utc_offset": "+01:00",
  "day_of_week": "Wednesday",
  "abbreviation": "CET",
  "unix_timestamp": 1739273445
}
```

---

### 62. Public Holidays API

**Endpoint:** `GET /api/holidays?country={code}&year={year}`
**Price:** 0.005 USDC
**Source:** Nager.Date API

**Parameters:**
- `country` (required): 2-letter country code (ISO 3166-1 alpha-2, e.g., "FR")
- `year` (optional): Year (2000-2100, default: current year)

**Response:**
```json
{
  "success": true,
  "country": "FR",
  "year": 2026,
  "count": 11,
  "holidays": [
    {
      "date": "2026-01-01",
      "name": "Jour de l'an",
      "name_en": "New Year's Day",
      "fixed": true,
      "types": ["Public"]
    }
  ]
}
```

---

### 63. Random Quote API

**Endpoint:** `GET /api/quote`
**Price:** 0.005 USDC
**Source:** Advice Slip API

**Response:**
```json
{
  "success": true,
  "id": 123,
  "advice": "Never stop learning. Knowledge is infinite."
}
```

---

### 64. Random Facts API

**Endpoint:** `GET /api/facts`
**Price:** 0.005 USDC
**Source:** Cat Facts API

**Response:**
```json
{
  "success": true,
  "fact": "A group of cats is called a clowder.",
  "length": 38
}
```

---

### 65. Random Dog Image API

**Endpoint:** `GET /api/dogs?breed={breed_name}`
**Price:** 0.005 USDC
**Source:** Dog CEO API

**Parameters:**
- `breed` (optional): Dog breed (lowercase, e.g., "labrador", "husky")

**Response:**
```json
{
  "success": true,
  "image_url": "https://images.dog.ceo/breeds/labrador/n02099712_1234.jpg",
  "breed": "labrador"
}
```

---

### 66. Random Joke API

**Endpoint:** `GET /api/joke`
**Price:** 0.01 USDC
**Source:** Official Joke API (free, no API key)

**Response:**
```json
{
  "success": true,
  "setup": "Did you know that protons have mass?",
  "punchline": "I didn't even know they were catholic.",
  "type": "general"
}
```

---

### 67. HTTP Headers Inspector API

**Endpoint:** `GET /api/headers?url={url}`
**Price:** 0.003 USDC
**Source:** Direct fetch (HEAD request, built-in)

**Parameters:**
- `url` (required): Target URL (HTTP/HTTPS only)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "status": 200,
  "headers": {
    "content-type": "text/html; charset=UTF-8",
    "server": "ECAcc",
    "x-cache": "HIT"
  }
}
```

---

### 68. User-Agent Parser API

**Endpoint:** `GET /api/useragent?ua={user_agent_string}`
**Price:** 0.001 USDC
**Source:** Built-in parser

**Parameters:**
- `ua` (optional): User-Agent string to parse. If omitted, uses the request's own User-Agent header.

**Response:**
```json
{
  "success": true,
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  "browser": "Chrome/120.0",
  "os": "Windows NT 10.0",
  "is_mobile": false,
  "is_bot": false,
  "engine": "WebKit"
}
```

---

### 69. Code Execution API

**Endpoint:** `POST /api/code`
**Price:** 0.005 USDC
**Source:** Piston API (free sandbox)

Execute code in 50+ programming languages in a secure sandbox.

**Body (JSON):**
```json
{
  "language": "python",
  "code": "print('Hello from x402!')"
}
```

**Response:**
```json
{
  "success": true,
  "language": "python",
  "version": "3.10.0",
  "output": "Hello from x402!\n",
  "stderr": ""
}
```

**Supported languages:** python, javascript, go, rust, cpp, java, c, ruby, php, swift, kotlin, typescript, bash, perl, lua, r, scala, haskell, and 30+ more.

---

## Payment Flow (all endpoints)

1. **Request without payment** -> `402 Payment Required` with payment details
2. **Send USDC payment** on Base or SKALE Europa (gas-free)
3. **Retry with header** `X-Payment-TxHash: 0x...` (optional: `X-Payment-Chain: base|skale`)
4. **Anti-replay** -- each transaction can only be used once
5. **Success** -- returns API data

### Supported Networks

| Network | Chain ID | Gas | USDC Contract |
|---------|----------|-----|---------------|
| Base | 8453 | ~$0.001 | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| SKALE Europa | 2046399126 | FREE | 0x5F795bb52dAc3085f578f4877D450e2929D2F13d |

---

## Pricing Summary

| Endpoint | Price | External API | Rate Limit |
|----------|-------|--------------|------------|
| `/api/search` | 0.005 USDC | DuckDuckGo | 30/min |
| `/api/scrape` | 0.005 USDC | Direct fetch | 30/min |
| `/api/twitter` | 0.005 USDC | fxtwitter | 30/min |
| `/api/news` | 0.005 USDC | Google News RSS | 30/min |
| `/api/reddit` | 0.005 USDC | Reddit JSON | 30/min |
| `/api/hn` | 0.003 USDC | HN Firebase | 30/min |
| `/api/youtube` | 0.005 USDC | YouTube oEmbed | 30/min |
| `/api/image` | 0.05 USDC | OpenAI DALL-E 3 | 30/min |
| `/api/math` | 0.001 USDC | mathjs (built-in) | 30/min |
| `/api/contract-risk` | 0.01 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/email-parse` | 0.005 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/code-review` | 0.01 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/table-insights` | 0.01 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/domain-report` | 0.01 USDC | RDAP + DNS + fetch | 30/min |
| `/api/seo-audit` | 0.01 USDC | Direct fetch | 30/min |
| `/api/lead-score` | 0.01 USDC | RDAP + GitHub | 30/min |
| `/api/crypto-intelligence` | 0.005 USDC | CoinGecko | 30/min |
| `/api/weather` | 0.02 USDC | Open-Meteo | 30/min |
| `/api/crypto` | 0.02 USDC | CoinGecko | 30/min |
| `/api/stocks` | 0.005 USDC | Yahoo Finance | 30/min |
| `/api/currency` | 0.005 USDC | Frankfurter (ECB) | 30/min |
| `/api/wikipedia` | 0.005 USDC | Wikipedia API | 30/min |
| `/api/dictionary` | 0.005 USDC | Free Dictionary API | 30/min |
| `/api/countries` | 0.005 USDC | REST Countries | 30/min |
| `/api/ip` | 0.005 USDC | ip-api.com | 30/min |
| `/api/geocoding` | 0.005 USDC | Open-Meteo Geocoding | 30/min |
| `/api/airquality` | 0.005 USDC | Open-Meteo Air Quality | 30/min |
| `/api/github` | 0.005 USDC | GitHub API | 30/min |
| `/api/npm` | 0.005 USDC | NPM Registry | 30/min |
| `/api/dns` | 0.003 USDC | Node DNS (built-in) | 30/min |
| `/api/whois` | 0.005 USDC | RDAP | 30/min |
| `/api/ssl-check` | 0.003 USDC | Node TLS (built-in) | 30/min |
| `/api/url-shorten` | 0.003 USDC | is.gd | 30/min |
| `/api/cron-parse` | 0.001 USDC | Built-in parser | 30/min |
| `/api/http-status` | 0.001 USDC | Built-in database | 30/min |
| `/api/unit-convert` | 0.001 USDC | Built-in converter | 30/min |
| `/api/summarize` | 0.01 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/sentiment` | 0.005 USDC | OpenAI GPT-4o-mini | 30/min |
| `/api/readability` | 0.005 USDC | Direct fetch + Cheerio | 30/min |
| `/api/translate` | 0.005 USDC | MyMemory | 30/min |
| `/api/markdown` | 0.001 USDC | Built-in converter | 30/min |
| `/api/html-to-text` | 0.001 USDC | Cheerio (built-in) | 30/min |
| `/api/csv-to-json` | 0.001 USDC | Built-in parser | 30/min |
| `/api/base64` | 0.001 USDC | Node Buffer (built-in) | 30/min |
| `/api/diff` | 0.001 USDC | Built-in diff | 30/min |
| `/api/validate-email` | 0.003 USDC | Node DNS MX (built-in) | 30/min |
| `/api/phone-validate` | 0.001 USDC | Built-in parser | 30/min |
| `/api/url-parse` | 0.001 USDC | Node URL (built-in) | 30/min |
| `/api/json-validate` | 0.001 USDC | Built-in JSON parser | 30/min |
| `/api/jwt-decode` | 0.001 USDC | Built-in decoder | 30/min |
| `/api/password-strength` | 0.001 USDC | Built-in analyzer | 30/min |
| `/api/regex` | 0.001 USDC | Node RegExp (built-in) | 30/min |
| `/api/qrcode` | 0.005 USDC | QR Server API | 30/min |
| `/api/qrcode-gen` | 0.003 USDC | QR Server API | 30/min |
| `/api/uuid` | 0.001 USDC | Node crypto (built-in) | 30/min |
| `/api/password` | 0.001 USDC | Node crypto (built-in) | 30/min |
| `/api/hash` | 0.001 USDC | Node crypto (built-in) | 30/min |
| `/api/color` | 0.001 USDC | Built-in converter | 30/min |
| `/api/timestamp` | 0.001 USDC | Node Date (built-in) | 30/min |
| `/api/lorem` | 0.001 USDC | Built-in generator | 30/min |
| `/api/time` | 0.005 USDC | Node Intl (built-in) | 30/min |
| `/api/holidays` | 0.005 USDC | Nager.Date | 30/min |
| `/api/quote` | 0.005 USDC | Advice Slip | 30/min |
| `/api/facts` | 0.005 USDC | Cat Facts | 30/min |
| `/api/dogs` | 0.005 USDC | Dog CEO | 30/min |
| `/api/joke` | 0.01 USDC | Official Joke API | 30/min |
| `/api/headers` | 0.003 USDC | Direct fetch (built-in) | 30/min |
| `/api/useragent` | 0.001 USDC | Built-in parser | 30/min |
| `/api/code` | 0.005 USDC | Piston API | 30/min |

---

## Security

- Rate limiting: 30 requests/min per IP
- Input sanitization: rejects control characters
- Length limits per parameter
- SSRF protection on all URL-fetching endpoints (private IPs, IPv6, cloud metadata blocked)
- DNS rebinding protection on scraper, readability, domain-report, seo-audit, lead-score
- Timeout: 5-30s on all external calls (30s for code execution)
- Anti-replay: transaction hashes stored in Supabase
- USDC contract validation: only accepts real USDC, not arbitrary tokens
