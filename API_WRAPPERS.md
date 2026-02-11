# x402 Bazaar - API Wrappers Documentation

## Overview

x402 Bazaar includes **22 native API wrapper endpoints** that proxy external APIs behind x402 micropayments. No API keys needed -- just pay USDC and get data.

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

### 4. AI Image Generation (DALL-E 3)

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

## Utility Endpoints

### 5. Weather API

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

### 6. Crypto Price API

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

### 7. Random Joke API

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

## Knowledge & Data Endpoints

### 8. Wikipedia Summary

**Endpoint:** `GET /api/wikipedia?q={query}`
**Price:** 0.005 USDC
**Source:** Wikipedia REST API

Get clean summaries of Wikipedia articles without the full HTML page.

**Parameters:**
- `q` (required): Search query (max 200 chars)

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

### 9. Dictionary API

**Endpoint:** `GET /api/dictionary?word={word}`
**Price:** 0.005 USDC
**Source:** Free Dictionary API

Get English word definitions, phonetics, and examples.

**Parameters:**
- `word` (required): English word (max 100 chars)

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
        "used as a greeting or to begin a phone conversation",
        "used to attract attention",
        "expressing surprise"
      ]
    }
  ],
  "sourceUrl": "https://en.wiktionary.org/wiki/hello"
}
```

---

### 10. Countries API

**Endpoint:** `GET /api/countries?name={country_name}`
**Price:** 0.005 USDC
**Source:** REST Countries API

Get comprehensive country data (population, capital, languages, etc.).

**Parameters:**
- `name` (required): Country name (max 100 chars)

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

## Developer Tools

### 11. GitHub API

**Endpoint:** `GET /api/github?user={username}` or `GET /api/github?repo={owner/repo}`
**Price:** 0.005 USDC
**Source:** GitHub API (no auth required for public data)

Get GitHub user profiles or repository stats.

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

### 12. NPM Registry API

**Endpoint:** `GET /api/npm?package={package_name}`
**Price:** 0.005 USDC
**Source:** NPM Registry (public)

Get metadata for any npm package.

**Parameters:**
- `package` (required): Package name (supports scoped packages like "@react/core")

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

## Location & Geography

### 13. IP Geolocation

**Endpoint:** `GET /api/ip?address={ip_address}`
**Price:** 0.005 USDC
**Source:** ip-api.com

Get location data from any IP address (IPv4 and IPv6 supported).

**Parameters:**
- `address` (required): IP address (e.g., "8.8.8.8")

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

### 14. Geocoding API

**Endpoint:** `GET /api/geocoding?city={city_name}`
**Price:** 0.005 USDC
**Source:** Open-Meteo Geocoding API

Convert city names to coordinates (lat/lon).

**Parameters:**
- `city` (required): City name (max 100 chars)

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

### 15. Air Quality API

**Endpoint:** `GET /api/airquality?lat={latitude}&lon={longitude}`
**Price:** 0.005 USDC
**Source:** Open-Meteo Air Quality API

Get real-time air quality data and pollutant levels.

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

## Utility & Generation

### 16. QR Code Generator

**Endpoint:** `GET /api/qrcode?text={content}&size={pixels}`
**Price:** 0.005 USDC
**Source:** QR Server API

Generate QR codes from any text (returns PNG image).

**Parameters:**
- `text` (required): Content to encode (max 500 chars)
- `size` (optional): Image size in pixels (50-1000, default 200)

**Response:** PNG image (Content-Type: image/png)

**Note:** This endpoint returns an image directly, not JSON.

---

### 17. World Time API

**Endpoint:** `GET /api/time?timezone={timezone}`
**Price:** 0.005 USDC
**Source:** World Time API

Get current time in any timezone.

**Parameters:**
- `timezone` (required): Timezone (format: Region/City, e.g., "Europe/Paris")

**Response:**
```json
{
  "success": true,
  "timezone": "Europe/Paris",
  "datetime": "2026-02-11T11:30:45.123456+01:00",
  "utc_offset": "+01:00",
  "day_of_week": 2,
  "week_number": 7,
  "abbreviation": "CET",
  "dst": false
}
```

---

### 18. Public Holidays API

**Endpoint:** `GET /api/holidays?country={code}&year={year}`
**Price:** 0.005 USDC
**Source:** Nager.Date API

Get public holidays for any country and year.

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

## Fun & Random Content

### 19. Random Quote API

**Endpoint:** `GET /api/quote`
**Price:** 0.005 USDC
**Source:** Advice Slip API

Get random advice/quotes.

**Response:**
```json
{
  "success": true,
  "id": 123,
  "advice": "Never stop learning. Knowledge is infinite."
}
```

---

### 20. Random Facts API

**Endpoint:** `GET /api/facts`
**Price:** 0.005 USDC
**Source:** Cat Facts API

Get random interesting facts.

**Response:**
```json
{
  "success": true,
  "fact": "A group of cats is called a clowder.",
  "length": 38
}
```

---

### 21. Random Dog Image API

**Endpoint:** `GET /api/dogs?breed={breed_name}`
**Price:** 0.005 USDC
**Source:** Dog CEO API

Get random dog images by breed (or random if no breed specified).

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
| `/api/image` | 0.05 USDC | OpenAI DALL-E 3 | 30/min |
| `/api/weather` | 0.02 USDC | Open-Meteo | 30/min |
| `/api/crypto` | 0.02 USDC | CoinGecko | 30/min |
| `/api/joke` | 0.01 USDC | Official Joke API | 30/min |
| `/api/wikipedia` | 0.005 USDC | Wikipedia API | 30/min |
| `/api/dictionary` | 0.005 USDC | Free Dictionary API | 30/min |
| `/api/countries` | 0.005 USDC | REST Countries | 30/min |
| `/api/github` | 0.005 USDC | GitHub API | 30/min |
| `/api/npm` | 0.005 USDC | NPM Registry | 30/min |
| `/api/ip` | 0.005 USDC | ip-api.com | 30/min |
| `/api/qrcode` | 0.005 USDC | QR Server API | 30/min |
| `/api/time` | 0.005 USDC | World Time API | 30/min |
| `/api/holidays` | 0.005 USDC | Nager.Date | 30/min |
| `/api/geocoding` | 0.005 USDC | Open-Meteo Geocoding | 30/min |
| `/api/airquality` | 0.005 USDC | Open-Meteo Air Quality | 30/min |
| `/api/quote` | 0.005 USDC | Advice Slip | 30/min |
| `/api/facts` | 0.005 USDC | Cat Facts | 30/min |
| `/api/dogs` | 0.005 USDC | Dog CEO | 30/min |

---

## Security

- Rate limiting: 30 requests/min per IP
- Input sanitization: rejects control characters
- Length limits per parameter
- SSRF protection on scraper (private IPs, IPv6, cloud metadata blocked)
- Timeout: 5-10s on all external calls
- Anti-replay: transaction hashes stored in Supabase
- USDC contract validation: only accepts real USDC, not arbitrary tokens
