# x402 Bazaar - API Wrappers Documentation

## Overview

The x402 Bazaar now includes 3 real working API wrapper endpoints that proxy free external APIs behind x402 payments. These endpoints demonstrate the core x402 value proposition: **pay USDC, get data, no API keys needed**.

## Endpoints

### 1. Weather API Wrapper

**Endpoint:** `GET /api/weather?city={city_name}`
**Price:** 0.02 USDC
**External API:** Open-Meteo (free, no API key required)

Returns current weather data for any city in the world.

**Parameters:**
- `city` (required): City name (e.g., "Paris", "New York", "Tokyo")

**Response (after payment):**
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

**Weather Codes:**
- 0: Clear sky
- 1-3: Mainly clear, partly cloudy, overcast
- 45-48: Fog
- 51-67: Rain (various intensities)
- 71-77: Snow
- 80-82: Rain showers
- 95-99: Thunderstorm

**Example usage:**
```bash
# 1. Get payment details (402 response)
curl http://localhost:3000/api/weather?city=Paris

# 2. Send USDC payment (0.02 USDC = 20000 in wei) to the recipient address

# 3. Call API with transaction hash
curl -H "X-Payment-TxHash: 0x..." http://localhost:3000/api/weather?city=Paris
```

---

### 2. Crypto Price API Wrapper

**Endpoint:** `GET /api/crypto?coin={coin_id}`
**Price:** 0.02 USDC
**External API:** CoinGecko (free, no API key required)

Returns current cryptocurrency prices in USD and EUR with 24h change.

**Parameters:**
- `coin` (required): Cryptocurrency ID (e.g., "bitcoin", "ethereum", "cardano")

**Response (after payment):**
```json
{
  "success": true,
  "coin": "bitcoin",
  "usd": 70835,
  "eur": 59434,
  "usd_24h_change": -0.40059
}
```

**Popular coin IDs:**
- bitcoin
- ethereum
- cardano
- solana
- polkadot
- dogecoin
- binancecoin

**Example usage:**
```bash
# 1. Get payment details (402 response)
curl http://localhost:3000/api/crypto?coin=bitcoin

# 2. Send USDC payment (0.02 USDC = 20000 in wei) to the recipient address

# 3. Call API with transaction hash
curl -H "X-Payment-TxHash: 0x..." http://localhost:3000/api/crypto?coin=bitcoin
```

---

### 3. Random Joke API Wrapper

**Endpoint:** `GET /api/joke`
**Price:** 0.01 USDC
**External API:** Official Joke API (free, no API key required)

Returns a random joke (setup + punchline).

**Parameters:** None

**Response (after payment):**
```json
{
  "success": true,
  "setup": "Did you know that protons have mass?",
  "punchline": "I didn't even know they were catholic.",
  "type": "general"
}
```

**Joke types:**
- general
- programming
- knock-knock

**Example usage:**
```bash
# 1. Get payment details (402 response)
curl http://localhost:3000/api/joke

# 2. Send USDC payment (0.01 USDC = 10000 in wei) to the recipient address

# 3. Call API with transaction hash
curl -H "X-Payment-TxHash: 0x..." http://localhost:3000/api/joke
```

---

## Payment Flow

All API wrapper endpoints follow the x402 payment protocol:

1. **Request without payment** → Returns `402 Payment Required` with payment details
2. **User sends USDC payment** on Base or Base Sepolia
3. **Request with tx hash header** → Server verifies payment on-chain
4. **Anti-replay protection** → Each transaction can only be used once
5. **Success** → Returns API data

### Headers

- `X-Payment-TxHash`: Transaction hash of the USDC payment (required after payment)
- `X-Payment-Chain`: Chain identifier (optional, defaults to "base-sepolia" in testnet)

### Supported Networks

- **Base Sepolia** (testnet): chainId 84532
- **Base** (mainnet): chainId 8453
- **SKALE Europa** (mainnet): chainId 2046399126 (gas-free)

---

## Security Features

All endpoints include:

- **Rate limiting**: 30 requests per minute per IP
- **Input sanitization**: Rejects control characters and null bytes
- **Length limits**: City names (100 chars), coin IDs (50 chars)
- **Timeout protection**: 5s timeout on external API calls
- **Error handling**: Graceful fallbacks with error messages
- **Activity logging**: All API calls logged to Supabase

---

## Error Responses

### 402 Payment Required
```json
{
  "error": "Payment Required",
  "message": "Cette action coûte 0.02 USDC. Envoyez le paiement puis fournissez le hash dans le header X-Payment-TxHash.",
  "payment_details": {
    "amount": 0.02,
    "currency": "USDC",
    "network": "base-sepolia",
    "chainId": 84532,
    "recipient": "0x...",
    "accepted": ["USDC", "ETH"],
    "action": "Weather API"
  }
}
```

### 400 Bad Request
```json
{
  "error": "Parameter 'city' required. Ex: /api/weather?city=Paris"
}
```

### 404 Not Found
```json
{
  "error": "City not found",
  "city": "InvalidCity"
}
```

### 429 Too Many Requests
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Try again in 1 minute."
}
```

### 500 Internal Server Error
```json
{
  "error": "Weather API request failed",
  "message": "RPC timeout"
}
```

---

## Testing

Run the test suite:
```bash
cd x402-bazaar
node test-api-wrappers.js
```

Test external APIs directly:
```bash
# Open-Meteo Geocoding
curl "https://geocoding-api.open-meteo.com/v1/search?name=Paris&count=1"

# Open-Meteo Weather
curl "https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current_weather=true"

# CoinGecko Prices
curl "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur&include_24hr_change=true"

# Official Joke API
curl "https://official-joke-api.appspot.com/random_joke"
```

---

## Value Proposition

These API wrappers showcase the x402 protocol's killer feature:

- **No API keys**: Users don't need to sign up for CoinGecko, Open-Meteo, etc.
- **Pay per use**: Only pay for what you consume (0.01-0.02 USDC per call)
- **Instant access**: Send USDC, get data immediately
- **No subscriptions**: No monthly fees, no commitments
- **Agent-friendly**: AI agents can use these APIs autonomously without human API key management

---

## Use Cases

### For AI Agents
- Autonomous weather lookups for travel planning
- Real-time crypto price checks for trading bots
- Entertainment (joke generation) for chatbots

### For Developers
- Prototyping without API key setup
- Micropayment monetization model
- Building on top of free APIs with monetization layer

### For End Users
- One-click access to premium data
- No signup friction
- Transparent pricing

---

## Implementation Details

### Code Location
`C:\Users\robin\OneDrive\Bureau\HACKATHON\x402-bazaar\server.js` lines 506-628

### Middleware Stack
1. `paidEndpointLimiter` - Rate limiting (30/min)
2. `paymentMiddleware(amount, display, label)` - x402 payment verification
3. Route handler - API logic

### External API Calls
- Uses existing `fetchWithTimeout(url, options, timeout)` utility
- 5s timeout on all external API calls
- Proper error handling with try/catch

### Activity Logging
- All successful API calls logged to Supabase `activity` table
- Format: `api_call`, `Weather API: Paris -> Paris, FR`

---

## Pricing

| Endpoint | Price | External API | Rate Limit |
|----------|-------|--------------|------------|
| `/api/weather` | 0.02 USDC | Open-Meteo | 30/min |
| `/api/crypto` | 0.02 USDC | CoinGecko | 30/min |
| `/api/joke` | 0.01 USDC | Official Joke API | 30/min |

**Total cost for all 3 APIs**: 0.05 USDC (~$0.05)

---

## Future Enhancements

Potential additions:
- Twitter/X API wrapper (search, post)
- Brave Search wrapper (web search)
- News API wrapper (headlines)
- Image generation wrapper (Stability AI)
- Translation API wrapper (DeepL)

See `ROADMAP.md` Milestone 3 for planned wrappers.
