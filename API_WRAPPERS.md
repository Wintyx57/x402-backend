# x402 Bazaar - API Wrappers Documentation

## Overview

x402 Bazaar includes **6 native API wrapper endpoints** that proxy external APIs behind x402 micropayments. No API keys needed -- just pay USDC and get data.

## High-Value Endpoints

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

**Security:** SSRF protection blocks localhost, private IPs, IPv6 loopback, and cloud metadata (169.254.x.x). 5MB size limit.

---

### 3. Twitter/X Data API

**Endpoint:** `GET /api/twitter?user={username}` or `GET /api/twitter?tweet={tweet_url}`
**Price:** 0.005 USDC
**Source:** fxtwitter.com + Twitter Syndication API

Read Twitter/X profiles and tweets without API keys.

**Parameters (one required):**
- `user`: Twitter username (without @, e.g., "elonmusk")
- `tweet`: Full tweet URL (e.g., "https://x.com/user/status/123456789")

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

---

## Utility Endpoints

### 4. Weather API

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

### 5. Crypto Price API

**Endpoint:** `GET /api/crypto?coin={coin_id}`
**Price:** 0.02 USDC
**Source:** CoinGecko (free, no API key)

**Response:**
```json
{
  "success": true,
  "coin": "bitcoin",
  "usd": 70835,
  "eur": 59434,
  "usd_24h_change": -0.40059
}
```

### 6. Random Joke API

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
| `/api/weather` | 0.02 USDC | Open-Meteo | 30/min |
| `/api/crypto` | 0.02 USDC | CoinGecko | 30/min |
| `/api/joke` | 0.01 USDC | Official Joke API | 30/min |

---

## Security

- Rate limiting: 30 requests/min per IP
- Input sanitization: rejects control characters
- Length limits per parameter
- SSRF protection on scraper (private IPs, IPv6, cloud metadata blocked)
- Timeout: 5-10s on all external calls
- Anti-replay: transaction hashes stored in Supabase
- USDC contract validation: only accepts real USDC, not arbitrary tokens
