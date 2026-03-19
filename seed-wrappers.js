require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;
const BASE_URL = 'https://x402-api.onrender.com';

// All 95 x402 Native wrapper APIs — real endpoints proxied via x402 payments
const WRAPPER_SERVICES = [
    // --- HIGH-VALUE SERVICES (0.005 USDC) ---
    {
        name: "x402 Web Search",
        description: "Clean web search results optimized for LLMs. Returns title, URL, and snippet for each result — no ads, no HTML, just structured data. Powered by DuckDuckGo. Usage: /api/search?q=bitcoin+price&max=10",
        url: `${BASE_URL}/api/search`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "search", "web", "llm", "live"]
    },
    {
        name: "x402 Universal Scraper",
        description: "Give any URL, get clean Markdown back. Strips ads, nav, scripts — returns only the main content. Perfect for AI agents doing research. Usage: /api/scrape?url=https://example.com",
        url: `${BASE_URL}/api/scrape`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "scraping", "scraper", "markdown", "web", "live"]
    },
    {
        name: "x402 Twitter/X Data",
        description: "Read Twitter/X profiles and tweets without API keys. Get follower counts, recent tweets, engagement metrics. Usage: /api/twitter?user=elonmusk or /api/twitter?tweet=https://x.com/user/status/123",
        url: `${BASE_URL}/api/twitter`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "communication", "twitter", "social", "live"]
    },

    // --- KNOWLEDGE & DATA (0.005 USDC) ---
    {
        name: "x402 Wikipedia Summary",
        description: "Get any Wikipedia article summary with title, description, thumbnail and full URL. Usage: /api/wikipedia?q=Bitcoin",
        url: `${BASE_URL}/api/wikipedia`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "wikipedia", "knowledge", "live"]
    },
    {
        name: "x402 Dictionary API",
        description: "English dictionary with definitions, phonetics and meanings. Up to 3 definitions per part of speech. Usage: /api/dictionary?word=hello",
        url: `${BASE_URL}/api/dictionary`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "dictionary", "language", "live"]
    },
    {
        name: "x402 Countries API",
        description: "Detailed country data: population, capital, currencies, languages, flag, timezones. Usage: /api/countries?name=France",
        url: `${BASE_URL}/api/countries`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "countries", "geography", "live"]
    },

    // --- DEVELOPER TOOLS (0.005 USDC) ---
    {
        name: "x402 GitHub API",
        description: "Public GitHub data for users and repositories. Stars, forks, language, bio, followers. Usage: /api/github?user=torvalds or /api/github?repo=facebook/react",
        url: `${BASE_URL}/api/github`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "github", "developer", "code", "live"]
    },
    {
        name: "x402 NPM Registry API",
        description: "NPM package metadata: latest version, description, license, keywords, author. Usage: /api/npm?package=react",
        url: `${BASE_URL}/api/npm`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "npm", "developer", "packages", "live"]
    },

    // --- LOCATION & GEOGRAPHY (0.005 USDC) ---
    {
        name: "x402 IP Geolocation API",
        description: "IP address geolocation: country, city, timezone, ISP, coordinates. Usage: /api/ip?address=8.8.8.8",
        url: `${BASE_URL}/api/ip`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "ip", "geolocation", "network", "live"]
    },
    {
        name: "x402 Geocoding API",
        description: "Convert city names to GPS coordinates. Returns up to 5 matches with country and population. Usage: /api/geocoding?city=Paris",
        url: `${BASE_URL}/api/geocoding`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "location", "geocoding", "coordinates", "live"]
    },
    {
        name: "x402 Air Quality API",
        description: "Real-time air quality: PM2.5, PM10, ozone, NO2, CO. European and US AQI indexes. Usage: /api/airquality?lat=48.85&lon=2.35",
        url: `${BASE_URL}/api/airquality`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "airquality", "environment", "live"]
    },

    // --- UTILITY (0.005 USDC) ---
    {
        name: "x402 QR Code Generator",
        description: "Generate QR code images from any text or URL. Custom size 50-1000px. Returns PNG image. Usage: /api/qrcode?text=hello&size=200",
        url: `${BASE_URL}/api/qrcode`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "media", "qrcode", "generator", "live"]
    },
    {
        name: "x402 World Time API",
        description: "Current time in any timezone with UTC offset, DST status, and week number. Usage: /api/time?timezone=Europe/Paris",
        url: `${BASE_URL}/api/time`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "time", "timezone", "live"]
    },
    {
        name: "x402 Public Holidays API",
        description: "Public holidays for 100+ countries by year. Local and English names. Usage: /api/holidays?country=FR&year=2026",
        url: `${BASE_URL}/api/holidays`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "holidays", "calendar", "live"]
    },

    // --- FUN & RANDOM (0.005 USDC) ---
    {
        name: "x402 Random Quote API",
        description: "Random life advice and wisdom. A new quote every time. Usage: /api/quote",
        url: `${BASE_URL}/api/quote`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "quotes", "advice", "live"]
    },
    {
        name: "x402 Random Facts API",
        description: "Random fun facts. A new fact every time. Usage: /api/facts",
        url: `${BASE_URL}/api/facts`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "facts", "trivia", "live"]
    },
    {
        name: "x402 Random Dog Image API",
        description: "Random dog images. Optional breed filter from 120+ breeds. Usage: /api/dogs or /api/dogs?breed=labrador",
        url: `${BASE_URL}/api/dogs`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "dogs", "images", "live"]
    },

    // --- PREMIUM SERVICES ---
    {
        name: "x402 Weather API",
        description: "Real-time weather data for any city. Returns temperature, wind speed, and weather code. Powered by Open-Meteo via x402 payment. Usage: /api/weather?city=Paris",
        url: `${BASE_URL}/api/weather`,
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "weather", "live"]
    },
    {
        name: "x402 Crypto Price API",
        description: "Live cryptocurrency prices in USD and EUR with 24h change. Powered by CoinGecko via x402 payment. Usage: /api/crypto?coin=bitcoin",
        url: `${BASE_URL}/api/crypto`,
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "finance", "crypto", "live"]
    },
    {
        name: "x402 Random Joke API",
        description: "Get a random joke with setup and punchline. Fun endpoint to test x402 payments. Usage: /api/joke",
        url: `${BASE_URL}/api/joke`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "jokes", "humor", "live"]
    },
    {
        name: "x402 AI Image Generation",
        description: "Generate images with Google Gemini AI. Provide a text prompt, get a high-quality AI-generated image (base64 PNG). Supports 256, 512, 1024px sizes. Returns JSON with data_uri for easy embedding. Usage: /api/image?prompt=a+cat+in+space&size=512",
        url: `${BASE_URL}/api/image`,
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "image", "gemini", "generation", "live"]
    },

    // --- NEW WRAPPERS (2026-02-12) ---
    {
        name: "x402 Translation API",
        description: "Translate text between 90+ languages using MyMemory API. Auto-detect source language or specify explicitly. Returns translated text with source and target language codes. Usage: /api/translate?text=hello&from=auto&to=fr",
        url: `${BASE_URL}/api/translate`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "translation", "language", "live"]
    },
    {
        name: "x402 Text Summarization",
        description: "AI-powered text summarization using GPT-4o-mini. Condense long articles, documents or text into concise summaries. Configurable max length (50-2000 words). Perfect for research and content analysis. Usage: /api/summarize?text=long+article&maxLength=200",
        url: `${BASE_URL}/api/summarize`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "summarization", "nlp", "live"]
    },
    {
        name: "x402 Code Execution",
        description: "Execute code in 50+ programming languages via sandboxed Piston API. Supports Python, JavaScript, Go, Rust, C++, Java and more. Returns stdout and stderr. Usage: POST /api/code {language: 'python', code: 'print(42)'}",
        url: `${BASE_URL}/api/code`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "code", "execution", "sandbox", "live"]
    },
    {
        name: "x402 DNS Lookup",
        description: "DNS record lookup for any domain. Supports A, AAAA, MX, TXT, CNAME, NS, SOA, PTR, SRV records. Built-in SSRF protection. Usage: /api/dns?domain=google.com&type=A",
        url: `${BASE_URL}/api/dns`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "dns", "network", "security", "live"]
    },
    {
        name: "x402 QR Code Generator",
        description: "Generate QR code images from any text or URL. Returns image URL (PNG format). Customizable size 50-1000px. Usage: /api/qrcode-gen?data=https://example.com&size=300",
        url: `${BASE_URL}/api/qrcode-gen`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "qrcode", "generator", "media", "live"]
    },
    {
        name: "x402 Readability Extractor",
        description: "Extract clean readable text from any web page. Strips ads, navigation, scripts and returns title + main content. Built-in SSRF protection. Perfect for content analysis and AI training data. Usage: /api/readability?url=https://example.com/article",
        url: `${BASE_URL}/api/readability`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "scraping", "readability", "text", "live"]
    },
    {
        name: "x402 Sentiment Analysis",
        description: "AI-powered sentiment analysis using GPT-4o-mini. Classifies text as positive/negative/neutral with confidence score and keyword extraction. Usage: /api/sentiment?text=I+love+this+product",
        url: `${BASE_URL}/api/sentiment`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "sentiment", "nlp", "analysis", "live"]
    },
    {
        name: "x402 Email Validation",
        description: "Validate email addresses with format check and DNS MX record verification. Returns detailed validation results including domain info. Usage: /api/validate-email?email=test@example.com",
        url: `${BASE_URL}/api/validate-email`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "email", "validation", "verification", "live"]
    },

    // --- BATCH 2: 12 NEW WRAPPERS (2026-02-12) ---
    {
        name: "x402 Hash Generator",
        description: "Generate cryptographic hashes (MD5, SHA1, SHA256, SHA512) from any text. Useful for checksums, data integrity, and security. Usage: /api/hash?text=hello&algo=sha256",
        url: `${BASE_URL}/api/hash`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "hash", "crypto", "security", "live"]
    },
    {
        name: "x402 UUID Generator",
        description: "Generate cryptographically secure UUID v4 identifiers. Supports batch generation up to 100 UUIDs at once. Usage: /api/uuid?count=5",
        url: `${BASE_URL}/api/uuid`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "uuid", "identifier", "live"]
    },
    {
        name: "x402 Base64 Encoder/Decoder",
        description: "Encode or decode Base64 strings. Supports UTF-8 text up to 50KB. Usage: /api/base64?text=hello&mode=encode or /api/base64?text=aGVsbG8=&mode=decode",
        url: `${BASE_URL}/api/base64`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "base64", "encoding", "utility", "live"]
    },
    {
        name: "x402 Password Generator",
        description: "Generate cryptographically secure passwords. Configurable length (8-128), symbols, numbers, uppercase. Usage: /api/password?length=24&symbols=true",
        url: `${BASE_URL}/api/password`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "password", "generator", "live"]
    },
    {
        name: "x402 Currency Converter",
        description: "Real-time currency conversion with 30+ currencies. Powered by European Central Bank rates via Frankfurter API. Usage: /api/currency?from=USD&to=EUR&amount=100",
        url: `${BASE_URL}/api/currency`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "finance", "currency", "exchange", "conversion", "live"]
    },
    {
        name: "x402 Timestamp Converter",
        description: "Convert between Unix timestamps and human-readable dates. Supports seconds and milliseconds. Returns ISO 8601, UTC, and Unix formats. Usage: /api/timestamp?ts=1700000000 or /api/timestamp?date=2026-01-15",
        url: `${BASE_URL}/api/timestamp`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "timestamp", "date", "time", "live"]
    },
    {
        name: "x402 Lorem Ipsum Generator",
        description: "Generate lorem ipsum placeholder text. 1-20 paragraphs with random sentence structure. Usage: /api/lorem?paragraphs=5",
        url: `${BASE_URL}/api/lorem`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "lorem", "text", "placeholder", "live"]
    },
    {
        name: "x402 HTTP Headers Inspector",
        description: "Inspect HTTP response headers of any URL. Returns status code and all headers. Built-in SSRF protection. Usage: /api/headers?url=https://example.com",
        url: `${BASE_URL}/api/headers`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "http", "headers", "security", "live"]
    },
    {
        name: "x402 Markdown to HTML",
        description: "Convert Markdown text to clean HTML. Supports headings, bold, italic, code, links, and lists. Usage: /api/markdown?text=**bold**+_italic_",
        url: `${BASE_URL}/api/markdown`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "markdown", "html", "converter", "live"]
    },
    {
        name: "x402 Color Converter",
        description: "Convert colors between HEX, RGB, and HSL formats. Returns all formats plus CSS-ready strings. Usage: /api/color?hex=ff5733 or /api/color?rgb=255,87,51",
        url: `${BASE_URL}/api/color`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "color", "design", "converter", "live"]
    },
    {
        name: "x402 JSON Validator",
        description: "Validate and format JSON strings. Returns validity status, formatted output, type, and key count. Usage: POST /api/json-validate with {\"json\": \"your string\"}",
        url: `${BASE_URL}/api/json-validate`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "json", "validator", "formatter", "live"]
    },
    {
        name: "x402 User Agent Parser",
        description: "Parse User-Agent strings into browser, OS, engine, and device type. Detects bots and mobile devices. Usage: /api/useragent?ua=Mozilla/5.0...",
        url: `${BASE_URL}/api/useragent`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "useragent", "browser", "parser", "live"]
    },

    // --- BATCH 3: DATA & SOCIAL (session 21) ---
    {
        name: "x402 News Feed",
        description: "Search real-time news from Google News RSS. Returns top 10 articles with title, source, link and publication date. Usage: /api/news?topic=artificial+intelligence&lang=en",
        url: `${BASE_URL}/api/news`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "news", "rss", "search", "live"]
    },
    {
        name: "x402 Stock Price",
        description: "Real-time stock prices from Yahoo Finance. Returns price, change, market state, exchange. Usage: /api/stocks?symbol=AAPL",
        url: `${BASE_URL}/api/stocks`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "finance", "stocks", "market", "trading", "live"]
    },
    {
        name: "x402 Reddit Data",
        description: "Fetch Reddit posts from any subreddit. Supports hot, new, top, rising sort. Returns title, score, author, comments. Usage: /api/reddit?subreddit=programming&sort=hot&limit=10",
        url: `${BASE_URL}/api/reddit`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "social", "reddit", "community", "data", "live"]
    },
    {
        name: "x402 Hacker News",
        description: "Access Hacker News stories (top, new, best, ask, show, job). Returns title, URL, score, comments, author. Usage: /api/hn?type=top&limit=10",
        url: `${BASE_URL}/api/hn`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "social", "hackernews", "tech", "news", "live"]
    },
    {
        name: "x402 YouTube Info",
        description: "Get YouTube video metadata from URL or video ID. Returns title, author, thumbnail, embed URL. Usage: /api/youtube?url=https://youtube.com/watch?v=dQw4w9WgXcQ",
        url: `${BASE_URL}/api/youtube`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "social", "youtube", "video", "media", "live"]
    },
    {
        name: "x402 WHOIS Lookup",
        description: "Domain WHOIS via RDAP. Returns registration/expiration dates, nameservers, registrar, status. Usage: /api/whois?domain=example.com",
        url: `${BASE_URL}/api/whois`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "whois", "domain", "dns", "live"]
    },
    {
        name: "x402 SSL Certificate Check",
        description: "Check SSL certificate details for any domain. Returns issuer, validity dates, days remaining, fingerprint, SAN. Usage: /api/ssl-check?domain=google.com",
        url: `${BASE_URL}/api/ssl-check`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "ssl", "tls", "certificate", "live"]
    },
    {
        name: "x402 Regex Tester",
        description: "Test regex patterns against text. Returns all matches with index and captured groups. Supports flags (g,i,m,s). Usage: /api/regex?pattern=\\d+&text=abc123def456&flags=g",
        url: `${BASE_URL}/api/regex`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "regex", "pattern", "testing", "live"]
    },
    {
        name: "x402 Text Diff",
        description: "Compare two texts line by line. Shows added, removed, and modified lines. Usage: /api/diff?text1=hello+world&text2=hello+earth",
        url: `${BASE_URL}/api/diff`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "diff", "compare", "text", "live"]
    },
    {
        name: "x402 Math Expression",
        description: "Evaluate math expressions safely. Supports +,-,*,/,^,pi,e,sqrt,sin,cos,tan,log,abs,ceil,floor,round. Usage: /api/math?expr=2*pi*5+sqrt(16)",
        url: `${BASE_URL}/api/math`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "math", "calculator", "science", "live"]
    },

    // --- BATCH 4: UTILITY APIs (session 21) ---
    {
        name: "x402 Unit Converter",
        description: "Convert between units: length (km, miles, ft), weight (kg, lb), temperature (C, F, K), volume, speed, data. Usage: /api/unit-convert?value=100&from=km&to=miles",
        url: `${BASE_URL}/api/unit-convert`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "converter", "units", "math", "live"]
    },
    {
        name: "x402 CSV to JSON",
        description: "Convert CSV data to JSON. Supports custom delimiters and header row detection. Usage: /api/csv-to-json?csv=name,age\\nAlice,30\\nBob,25",
        url: `${BASE_URL}/api/csv-to-json`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "csv", "json", "converter", "data", "live"]
    },
    {
        name: "x402 JWT Decoder",
        description: "Decode JWT tokens without verification. Returns header, payload, expiration status. Usage: /api/jwt-decode?token=eyJhbGciOiJIUzI1NiIs...",
        url: `${BASE_URL}/api/jwt-decode`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "jwt", "token", "auth", "live"]
    },
    {
        name: "x402 Cron Parser",
        description: "Parse cron expressions into human-readable descriptions. Shows field breakdown and schedule. Usage: /api/cron-parse?expr=0 9 * * 1-5",
        url: `${BASE_URL}/api/cron-parse`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "cron", "scheduler", "parser", "live"]
    },
    {
        name: "x402 Password Strength",
        description: "Analyze password strength with score (0-100), entropy, checks and suggestions. Usage: /api/password-strength?password=MyP@ssw0rd!",
        url: `${BASE_URL}/api/password-strength`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "password", "strength", "analysis", "live"]
    },
    {
        name: "x402 Phone Validator",
        description: "Validate and analyze phone numbers. Detects country code, formats number, identifies mobile vs landline. Usage: /api/phone-validate?phone=+33612345678",
        url: `${BASE_URL}/api/phone-validate`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "phone", "validator", "format", "live"]
    },
    {
        name: "x402 URL Parser",
        description: "Parse and analyze URLs. Returns protocol, hostname, port, path, query params, hash. Usage: /api/url-parse?url=https://example.com:8080/path?q=test",
        url: `${BASE_URL}/api/url-parse`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "url", "parser", "web", "live"]
    },
    {
        name: "x402 URL Shortener",
        description: "Shorten any URL using is.gd service. Returns permanent short URL. Usage: /api/url-shorten?url=https://example.com/very-long-path",
        url: `${BASE_URL}/api/url-shorten`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "url", "shortener", "link", "live"]
    },
    {
        name: "x402 HTML to Text",
        description: "Extract clean text from HTML. Removes scripts, styles. Also extracts links and images. Uses Cheerio. Usage: /api/html-to-text?html=<h1>Title</h1><p>Content</p>",
        url: `${BASE_URL}/api/html-to-text`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "utility", "html", "text", "parser", "live"]
    },
    {
        name: "x402 HTTP Status Codes",
        description: "Look up HTTP status codes. Returns name, description, and category for any code 100-599. Usage: /api/http-status?code=404",
        url: `${BASE_URL}/api/http-status`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "development", "http", "status", "reference", "live"]
    },

    // --- INTELLIGENCE APIs (high-value, GPT-4o-mini + multi-source aggregation) ---
    {
        name: "x402 Contract Risk Analyzer",
        description: "Send any contract or Terms of Service text, get back risky clauses flagged with severity (high/medium/low), category, and explanation. Detects unlimited liability, IP transfers, non-compete, forced arbitration and more. Usage: POST /api/contract-risk {text: '...'}",
        url: `${BASE_URL}/api/contract-risk`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "legal", "contract", "risk", "gpt4o", "live"]
    },
    {
        name: "x402 Email CRM Parser",
        description: "Send a raw email, get structured CRM data back: sender name, company, phone, intent, sentiment, urgency, key topics and suggested follow-up action. Ready to insert into your CRM. Usage: POST /api/email-parse {email: '...'}",
        url: `${BASE_URL}/api/email-parse`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "email", "crm", "parse", "gpt4o", "live"]
    },
    {
        name: "x402 AI Code Review",
        description: "Submit any code snippet and get a structured review: bugs, security issues, performance problems and style issues — each with line number, severity, and fix suggestion. Plus an overall quality score. Usage: POST /api/code-review {code: '...', language: 'python'}",
        url: `${BASE_URL}/api/code-review`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "code", "review", "security", "gpt4o", "development", "live"]
    },
    {
        name: "x402 Table & CSV Insights",
        description: "Upload CSV or table data and get AI-generated insights, anomaly detection, trends and actionable recommendations — no data science setup required. Usage: POST /api/table-insights {csv: 'col1,col2\\nval1,val2'}",
        url: `${BASE_URL}/api/table-insights`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "data", "csv", "analytics", "insights", "gpt4o", "live"]
    },
    {
        name: "x402 Domain Intelligence Report",
        description: "One domain → full intelligence report: WHOIS/RDAP registration data, DNS records (A, MX, NS, TXT), SSL status, tech stack detection and trust score. Saves 5+ separate API calls. Usage: /api/domain-report?domain=stripe.com",
        url: `${BASE_URL}/api/domain-report`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "intelligence", "domain", "whois", "dns", "ssl", "tech", "live"]
    },
    {
        name: "x402 SEO Audit",
        description: "Full SEO audit of any URL: title/description length, H1 tags, canonical, OG tags, missing alt attributes, schema.org, internal/external links. Returns score /100 with grade A-F and prioritized issues. Usage: /api/seo-audit?url=https://example.com",
        url: `${BASE_URL}/api/seo-audit`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "seo", "audit", "marketing", "web", "live"]
    },
    {
        name: "x402 Lead Scoring",
        description: "Give a company domain, get a sales lead score (0-100, grade A-F) based on 7 signals: domain age, email setup (MX records), SSL, DNS health, GitHub presence, tech stack. Usage: /api/lead-score?domain=stripe.com",
        url: `${BASE_URL}/api/lead-score`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "sales", "lead", "scoring", "crm", "intelligence", "live"]
    },
    {
        name: "x402 Crypto Intelligence",
        description: "Full intelligence report for any cryptocurrency: price, market cap, 24h/7d change, volume, ATH, GitHub developer activity (stars, forks, commits), community size (Twitter, Telegram, Reddit). Powered by CoinGecko. Usage: /api/crypto-intelligence?symbol=bitcoin",
        url: `${BASE_URL}/api/crypto-intelligence`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "crypto", "intelligence", "defi", "finance", "coingecko", "live"]
    },
    {
        name: "x402 Article to Markdown",
        description: "Convert any article/blog URL to clean Markdown. Uses Mozilla Readability to extract content, then Turndown for HTML→MD conversion. Returns title, byline, excerpt, word count, and full Markdown content. Usage: /api/article-to-md?url=https://blog.example.com/post",
        url: `${BASE_URL}/api/article-to-md`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "web", "content", "markdown", "conversion", "readability", "live"]
    },
    {
        name: "x402 OpenGraph Extractor",
        description: "Extract OpenGraph and Twitter Card metadata from any URL for rich link previews. Returns title, description, image, site_name, type, locale, favicon, and twitter_card info. Usage: /api/opengraph?url=https://example.com",
        url: `${BASE_URL}/api/opengraph`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "web", "metadata", "opengraph", "seo", "preview", "live"]
    },
    {
        name: "x402 SVG Avatar Generator",
        description: "Generate unique, deterministic SVG avatars from any name or seed string. 3 styles: geometric (circles/triangles/rects), pixel (5x5 mirrored grid), initials (gradient + text). Size 32-512px. Returns SVG image or JSON with data_uri. Usage: /api/avatar?name=Alice&style=geometric&size=128",
        url: `${BASE_URL}/api/avatar`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "image", "avatar", "svg", "generator", "identity", "live"]
    },
    // --- SCIENCE & SPACE (session 80) ---
    {
        name: "x402 ArXiv Search",
        description: "Search academic papers on ArXiv. Returns titles, authors, summaries, publication dates and categories. Usage: /api/arxiv?query=transformer+attention&max=5",
        url: `${BASE_URL}/api/arxiv`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "science", "academic", "papers", "arxiv", "research", "live"]
    },
    {
        name: "x402 NASA APOD",
        description: "NASA Astronomy Picture of the Day. Get the current featured image with title, explanation, and HD URL. Usage: /api/nasa",
        url: `${BASE_URL}/api/nasa`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "science", "space", "nasa", "astronomy", "live"]
    },
    {
        name: "x402 ISS Tracker",
        description: "Real-time International Space Station position (lat/lon) and current crew members. Usage: /api/iss",
        url: `${BASE_URL}/api/iss`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "science", "space", "iss", "tracking", "live"]
    },
    {
        name: "x402 SpaceX Launches",
        description: "Latest or upcoming SpaceX launches with details, links, and patch images. Usage: /api/spacex or /api/spacex?type=upcoming",
        url: `${BASE_URL}/api/spacex`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "science", "space", "spacex", "rockets", "live"]
    },
    {
        name: "x402 Crossref Academic Search",
        description: "Search academic publications via Crossref. Returns DOI, authors, journal, citation count. Usage: /api/crossref?query=machine+learning&max=5",
        url: `${BASE_URL}/api/crossref`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "science", "academic", "doi", "citations", "research", "live"]
    },

    // --- MEDIA & ENTERTAINMENT (session 80) ---
    {
        name: "x402 TV Show Search",
        description: "Search TV shows by name. Returns ratings, genres, status, premiere date and summary. Powered by TVmaze. Usage: /api/tvshow?q=breaking+bad",
        url: `${BASE_URL}/api/tvshow`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "media", "tv", "shows", "entertainment", "live"]
    },
    {
        name: "x402 Books Search",
        description: "Search books via Open Library. Returns author, year, ISBN, subjects and cover image. Usage: /api/books?q=dune+frank+herbert",
        url: `${BASE_URL}/api/books`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "media", "books", "library", "literature", "live"]
    },
    {
        name: "x402 iTunes Search",
        description: "Search iTunes for music, movies, podcasts, audiobooks. Returns artist, price, artwork, preview URL. Usage: /api/itunes?q=radiohead&media=music",
        url: `${BASE_URL}/api/itunes`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "media", "music", "itunes", "entertainment", "live"]
    },
    {
        name: "x402 Anime Search",
        description: "Search anime by name via Jikan (MyAnimeList). Returns score, episodes, synopsis, genres. Usage: /api/anime?q=naruto",
        url: `${BASE_URL}/api/anime`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "media", "anime", "manga", "entertainment", "live"]
    },

    // --- BLOCKCHAIN (session 80) ---
    {
        name: "x402 BTC Address Info",
        description: "Get Bitcoin address balance and transaction count from blockchain.com. Usage: /api/btc-address?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        url: `${BASE_URL}/api/btc-address`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "blockchain", "bitcoin", "address", "balance", "live"]
    },
    {
        name: "x402 ETH Gas Prices",
        description: "Current gas prices in Gwei for Ethereum, Base and Polygon. Zero external APIs — reads directly from RPC nodes. Usage: /api/eth-gas",
        url: `${BASE_URL}/api/eth-gas`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "blockchain", "ethereum", "gas", "defi", "live"]
    },

    // --- IMAGES & CREATIVE (session 80) ---
    {
        name: "x402 Random Cat",
        description: "Random cat image from cataas.com. Returns image URL and tags. Usage: /api/cat",
        url: `${BASE_URL}/api/cat`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "cat", "image", "random", "live"]
    },
    {
        name: "x402 Color Palette Generator",
        description: "Generate a harmonious 5-color palette. Optionally seed with a hex color. Powered by Colormind AI. Usage: /api/color-palette or /api/color-palette?seed=ff5733",
        url: `${BASE_URL}/api/color-palette`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "design", "color", "palette", "creative", "live"]
    },
    {
        name: "x402 Openverse Image Search",
        description: "Search CC-licensed images via Openverse. Returns URLs, creator, license info. Usage: /api/openverse?q=sunset+mountain",
        url: `${BASE_URL}/api/openverse`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "image", "search", "creative-commons", "openverse", "live"]
    },

    // --- DEV TOOLS (session 80) ---
    {
        name: "x402 Public IP",
        description: "Get the caller's public IP address. Zero external calls — reads from request headers. Usage: /api/public-ip",
        url: `${BASE_URL}/api/public-ip`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "network", "ip", "utility", "live"]
    },
    {
        name: "x402 Uptime Check",
        description: "Check if a website is up with response time in milliseconds. Usage: /api/uptime?url=https://example.com",
        url: `${BASE_URL}/api/uptime`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "monitoring", "uptime", "website", "health", "live"]
    },
    {
        name: "x402 Robots.txt Parser",
        description: "Fetch and parse a website's robots.txt. Returns rules, sitemaps, and crawling directives. Usage: /api/robots?url=https://example.com",
        url: `${BASE_URL}/api/robots`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "seo", "robots", "crawler", "web", "live"]
    },

    // --- LOCATION (session 80) ---
    {
        name: "x402 Elevation API",
        description: "Get elevation in meters/feet for any GPS coordinates. Usage: /api/elevation?lat=48.85&lon=2.35",
        url: `${BASE_URL}/api/elevation`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "location", "elevation", "geography", "coordinates", "live"]
    },
    {
        name: "x402 Timezone API",
        description: "Get timezone and current time for any GPS coordinates. Usage: /api/timezone?lat=48.85&lon=2.35",
        url: `${BASE_URL}/api/timezone`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "location", "timezone", "time", "coordinates", "live"]
    },

    // --- FUN & MOCK DATA (session 80) ---
    {
        name: "x402 Random User",
        description: "Generate a random fake user with name, email, phone, location, avatar. Perfect for testing. Usage: /api/random-user",
        url: `${BASE_URL}/api/random-user`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "data", "mock", "random", "testing", "live"]
    },
    {
        name: "x402 Emoji Search",
        description: "Search emojis by name, category or group. Returns emoji character, name, category and unicode. Usage: /api/emoji?q=smile",
        url: `${BASE_URL}/api/emoji`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "emoji", "search", "unicode", "live"]
    },
    {
        name: "x402 Pokemon API",
        description: "Get Pokemon data by name: types, abilities, stats, sprites. Usage: /api/pokemon?name=pikachu",
        url: `${BASE_URL}/api/pokemon`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "pokemon", "game", "data", "live"]
    },

    // --- TEXT & NLP (session 80) ---
    {
        name: "x402 Language Detection",
        description: "Detect the language of any text using franc-min (local, no external API). Returns ISO 639-3 code with confidence and alternatives. Usage: POST /api/detect-lang {\"text\": \"Bonjour le monde\"}",
        url: `${BASE_URL}/api/detect-lang`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "text", "nlp", "language", "detection", "live"]
    },
    {
        name: "x402 Text Statistics",
        description: "Analyze text: word count, sentence count, reading time, Flesch readability score, syllable count. Usage: POST /api/text-stats {\"text\": \"Your text here.\"}",
        url: `${BASE_URL}/api/text-stats`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "text", "nlp", "statistics", "readability", "live"]
    },
    {
        name: "x402 METAR Aviation Weather",
        description: "Get current aviation weather (METAR) for any airport by ICAO code. Temperature, wind, visibility, flight category. Usage: /api/metar?icao=KJFK",
        url: `${BASE_URL}/api/metar`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "aviation", "weather", "metar", "airport", "live"]
    },

    // --- SECURITY (session 80) ---
    {
        name: "x402 Malware URL Check",
        description: "Check if a URL is known malware/phishing via URLhaus (abuse.ch). Returns threat type, tags and status. Usage: /api/malware-check?url=https://example.com",
        url: `${BASE_URL}/api/malware-check`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "security", "malware", "phishing", "url", "threat", "live"]
    },

    // --- TEXT & NLP (session 80, missing from seed until session 85) ---
    {
        name: "x402 Language Detection",
        description: "Detect the language of a text. POST with JSON body { text: '...' }. Returns detected language, confidence score and alternatives.",
        url: `${BASE_URL}/api/detect-lang`,
        price_usdc: 0.003,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "text", "nlp", "language", "detection", "live"]
    },
    {
        name: "x402 Text Statistics",
        description: "Analyze text and return statistics: word count, sentence count, reading time, readability score, character frequency. POST with JSON body { text: '...' }.",
        url: `${BASE_URL}/api/text-stats`,
        price_usdc: 0.001,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "text", "statistics", "analysis", "readability", "live"]
    },
    {
        name: "x402 METAR Aviation Weather",
        description: "Get real-time aviation weather (METAR) data for any airport by ICAO code. Returns raw METAR string and decoded fields. Usage: /api/metar?icao=LFPG",
        url: `${BASE_URL}/api/metar`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "aviation", "weather", "metar", "airport", "live"]
    },
];

async function seedWrappers() {
    console.log(`Seeding ${WRAPPER_SERVICES.length} x402 native wrapper services...\n`);

    // Upsert on URL — preserves existing id, trust_score, erc8004_agent_id, monitoring data
    // Only updates name, description, price, owner_address, tags for existing entries
    const { data, error } = await supabase
        .from('services')
        .upsert(WRAPPER_SERVICES, { onConflict: 'url', ignoreDuplicates: false })
        .select();

    if (error) {
        console.error('Error seeding wrappers:', error.message);
        process.exit(1);
    }

    console.log(`\u2705 ${data.length} x402 native services upserted:\n`);
    data.forEach((s, i) => {
        const hasAgent = s.erc8004_agent_id ? ` [ERC-8004 #${s.erc8004_agent_id}]` : '';
        const hasTrust = s.trust_score != null ? ` (trust: ${s.trust_score})` : '';
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} (${s.price_usdc} USDC)${hasAgent}${hasTrust}`);
    });
    console.log(`\nDone. These will appear with "x402 Native" badge on the marketplace.`);
}

seedWrappers();
