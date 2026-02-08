require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;

const SERVICES = [
    // ============================================================
    //  AI & MACHINE LEARNING
    // ============================================================
    {
        name: "GPT-4o Text Generation",
        description: "State-of-the-art text generation powered by OpenAI GPT-4o. Supports chat, completion, summarization, and code generation.",
        url: "https://api.openai.com/v1/chat/completions",
        price_usdc: 0.30,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "text-generation", "openai"]
    },
    {
        name: "Claude AI Assistant",
        description: "Anthropic Claude API for safe, helpful AI conversations. Supports analysis, writing, coding, and reasoning tasks.",
        url: "https://api.anthropic.com/v1/messages",
        price_usdc: 0.25,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "assistant", "anthropic"]
    },
    {
        name: "Image Recognition API",
        description: "Identify objects, scenes, faces, and text in images using deep learning. Returns labels with confidence scores.",
        url: "https://vision-ai.example.com/v1/analyze",
        price_usdc: 0.15,
        owner_address: SERVER_WALLET,
        tags: ["ai", "vision", "image-recognition"]
    },
    {
        name: "Sentiment Analysis API",
        description: "Analyze the emotional tone of any text. Returns positive, negative, neutral scores and detected emotions.",
        url: "https://nlp-api.example.com/v1/sentiment",
        price_usdc: 0.08,
        owner_address: SERVER_WALLET,
        tags: ["ai", "nlp", "sentiment"]
    },
    {
        name: "Language Translation API",
        description: "Neural machine translation supporting 100+ languages. Auto-detect source language. High-quality output.",
        url: "https://translate-api.example.com/v2/translate",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["ai", "translation", "language"]
    },
    {
        name: "Text-to-Speech API",
        description: "Convert text to natural-sounding speech in 30+ languages. Multiple voices, adjustable speed and pitch.",
        url: "https://tts-api.example.com/v1/synthesize",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["ai", "tts", "audio", "speech"]
    },
    {
        name: "Speech-to-Text API",
        description: "Transcribe audio files to text with high accuracy. Supports 50+ languages, punctuation, and speaker diarization.",
        url: "https://stt-api.example.com/v1/transcribe",
        price_usdc: 0.12,
        owner_address: SERVER_WALLET,
        tags: ["ai", "stt", "audio", "transcription"]
    },
    {
        name: "AI Image Generation (DALL-E)",
        description: "Generate images from text descriptions using DALL-E. Supports various styles, sizes, and quality levels.",
        url: "https://api.openai.com/v1/images/generations",
        price_usdc: 0.50,
        owner_address: SERVER_WALLET,
        tags: ["ai", "image-generation", "dall-e"]
    },
    {
        name: "Code Review AI",
        description: "Automated code review powered by AI. Detects bugs, security issues, and suggests improvements for 20+ languages.",
        url: "https://code-review-ai.example.com/v1/review",
        price_usdc: 0.20,
        owner_address: SERVER_WALLET,
        tags: ["ai", "code-review", "developer"]
    },
    {
        name: "Named Entity Recognition",
        description: "Extract names, places, organizations, dates, and amounts from unstructured text. Supports EN, FR, ES, DE.",
        url: "https://nlp-api.example.com/v1/ner",
        price_usdc: 0.07,
        owner_address: SERVER_WALLET,
        tags: ["ai", "nlp", "ner"]
    },
    {
        name: "AI Text Summarizer",
        description: "Summarize long articles, documents, or web pages into concise bullet points or paragraphs. Adjustable length.",
        url: "https://summarize-api.example.com/v1/summarize",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["ai", "summarizer", "text"]
    },
    {
        name: "AI Embeddings API",
        description: "Generate vector embeddings for text. Perfect for semantic search, clustering, and RAG applications. 1536 dimensions.",
        url: "https://api.openai.com/v1/embeddings",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["ai", "embeddings", "vector", "search"]
    },

    // ============================================================
    //  FINANCE & CRYPTO
    // ============================================================
    {
        name: "Crypto Price Tracker",
        description: "Real-time cryptocurrency prices from CoinGecko. Supports BTC, ETH, SOL, and thousands of tokens.",
        url: "https://api.coingecko.com/api/v3/simple/price",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["finance", "crypto", "bitcoin"]
    },
    {
        name: "Currency Exchange Rates",
        description: "Live exchange rates for 150+ currencies. Base currency configurable. Updated every hour.",
        url: "https://open.er-api.com/v6/latest/USD",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["finance", "currency", "forex"]
    },
    {
        name: "Stock Market Data API",
        description: "Real-time and historical stock prices, volume, market cap. Covers NYSE, NASDAQ, and global exchanges.",
        url: "https://stock-api.example.com/v1/quote",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["finance", "stocks", "market"]
    },
    {
        name: "NFT Metadata API",
        description: "Fetch metadata, images, traits, and floor prices for any NFT collection on Ethereum, Base, and Solana.",
        url: "https://nft-api.example.com/v1/metadata",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["finance", "nft", "crypto"]
    },
    {
        name: "DeFi Yield Tracker",
        description: "Track APY/APR across DeFi protocols: Aave, Compound, Uniswap, Curve. Real-time yield comparison.",
        url: "https://defi-api.example.com/v1/yields",
        price_usdc: 0.08,
        owner_address: SERVER_WALLET,
        tags: ["finance", "defi", "yield"]
    },
    {
        name: "Gas Price Oracle",
        description: "Real-time gas prices for Ethereum, Base, Polygon, and Arbitrum. Returns slow, standard, and fast estimates.",
        url: "https://gas-api.example.com/v1/prices",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "gas", "crypto", "free"]
    },
    {
        name: "Wallet Balance Checker",
        description: "Check ETH, USDC, and ERC-20 token balances for any wallet address across multiple chains.",
        url: "https://balance-api.example.com/v1/balance",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "wallet", "crypto", "free"]
    },
    {
        name: "Token Price Feed",
        description: "Aggregated token prices from multiple DEXs and CEXs. Supports 10,000+ tokens with OHLCV data.",
        url: "https://price-feed.example.com/v1/token",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["finance", "token", "price"]
    },
    {
        name: "Invoice Generator API",
        description: "Generate professional PDF invoices from JSON data. Supports multi-currency, tax calculations, and custom branding.",
        url: "https://invoice-api.example.com/v1/generate",
        price_usdc: 0.08,
        owner_address: SERVER_WALLET,
        tags: ["finance", "invoice", "pdf"]
    },

    // ============================================================
    //  DATA & KNOWLEDGE
    // ============================================================
    {
        name: "Weather Forecast API",
        description: "Global weather forecast with temperature, humidity, wind speed, and precipitation. Supports hourly and 7-day forecasts.",
        url: "https://api.open-meteo.com/v1/forecast",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["data", "weather", "forecast"]
    },
    {
        name: "Wikipedia Summary API",
        description: "Get a concise summary of any Wikipedia article. Returns title, extract, thumbnail, and links.",
        url: "https://en.wikipedia.org/api/rest_v1/page/summary/",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["data", "wikipedia", "knowledge"]
    },
    {
        name: "Country Information API",
        description: "Detailed information about any country: population, capital, currencies, languages, borders, and flag.",
        url: "https://restcountries.com/v3.1/name/",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["data", "countries", "geography"]
    },
    {
        name: "News Headlines API",
        description: "Latest news headlines from 80+ sources worldwide. Filter by category, country, and keyword. Updated every 15 minutes.",
        url: "https://news-api.example.com/v2/top-headlines",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["data", "news", "headlines"]
    },
    {
        name: "Open Library Book Search",
        description: "Search millions of books by title, author, or ISBN. Returns cover art, publishers, and editions.",
        url: "https://openlibrary.org/search.json",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["data", "books", "library"]
    },
    {
        name: "Dictionary & Definitions",
        description: "English dictionary with definitions, phonetics, synonyms, antonyms, and usage examples.",
        url: "https://api.dictionaryapi.dev/api/v2/entries/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "dictionary", "language", "free"]
    },
    {
        name: "Public Holidays API",
        description: "Public and bank holidays for 100+ countries. Filter by year. Includes local and global holidays.",
        url: "https://date.nager.at/api/v3/PublicHolidays/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "holidays", "calendar", "free"]
    },
    {
        name: "University Search API",
        description: "Search universities worldwide by name or country. Returns name, country, domains, and web pages.",
        url: "https://universities.hipolabs.com/search",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "education", "academic", "free"]
    },
    {
        name: "Recipe Search API",
        description: "Search 2M+ recipes by ingredient, cuisine, or dietary restriction. Returns ingredients, steps, and nutrition info.",
        url: "https://recipe-api.example.com/v1/search",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["data", "food", "recipes"]
    },
    {
        name: "Movie & TV Database",
        description: "Search movies, TV shows, actors, and ratings. Returns posters, trailers, cast, and reviews from TMDB.",
        url: "https://api.themoviedb.org/3/search/movie",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["data", "movies", "entertainment"]
    },
    {
        name: "Sports Scores API",
        description: "Live scores, standings, and schedules for football, basketball, tennis, and 20+ sports worldwide.",
        url: "https://sports-api.example.com/v1/scores",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["data", "sports", "scores"]
    },
    {
        name: "Air Quality Index API",
        description: "Real-time air quality data (PM2.5, PM10, O3, NO2) for any location. Includes health recommendations.",
        url: "https://air-quality.example.com/v1/current",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["data", "air-quality", "environment"]
    },

    // ============================================================
    //  DEVELOPER TOOLS
    // ============================================================
    {
        name: "GitHub User Profile API",
        description: "Fetch public GitHub user profiles. Returns repos count, followers, bio, company, and avatar.",
        url: "https://api.github.com/users/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "github", "free"]
    },
    {
        name: "JSON Validator API",
        description: "Validate JSON against any JSON Schema (draft-07, 2019-09, 2020-12). Returns detailed error messages and paths.",
        url: "https://json-validator.example.com/v1/validate",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "json", "validator", "free"]
    },
    {
        name: "Code Formatter API",
        description: "Auto-format code in 15+ languages (JS, Python, Go, Rust, SQL...). Uses Prettier and Black under the hood.",
        url: "https://formatter-api.example.com/v1/format",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "formatter", "code", "free"]
    },
    {
        name: "Regex Tester API",
        description: "Test regex patterns against input strings. Returns matches, groups, and named captures. Supports JS, Python, and Go flavors.",
        url: "https://regex-api.example.com/v1/test",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "regex", "utility", "free"]
    },
    {
        name: "UUID Generator API",
        description: "Generate UUID v4, v5, v7, and ULID identifiers. Batch generation supported (up to 1000 per request).",
        url: "https://uuid-api.example.com/v1/generate",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "uuid", "utility", "free"]
    },
    {
        name: "Hash Generator API",
        description: "Generate MD5, SHA-1, SHA-256, SHA-512, and bcrypt hashes from any input. Supports file hashing via upload.",
        url: "https://hash-api.example.com/v1/hash",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "hash", "crypto", "free"]
    },
    {
        name: "Lorem Ipsum Generator",
        description: "Generate placeholder text in paragraphs, sentences, or words. Supports classic Latin and modern alternatives.",
        url: "https://lorem-api.example.com/v1/generate",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "lorem-ipsum", "utility", "free"]
    },
    {
        name: "Webhook Relay",
        description: "Create temporary webhook URLs to inspect, debug, and forward HTTP requests. 24h retention. Real-time streaming.",
        url: "https://webhook-relay.example.com/v1/create",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "webhook", "debug", "free"]
    },
    {
        name: "API Status Checker",
        description: "Check if any URL or API endpoint is up or down. Returns response time, status code, SSL info, and headers.",
        url: "https://status-checker.example.com/v1/check",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "monitoring", "uptime", "free"]
    },
    {
        name: "Cron Expression Parser",
        description: "Parse and validate cron expressions. Returns next 10 execution times and human-readable description.",
        url: "https://cron-api.example.com/v1/parse",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "cron", "scheduler", "free"]
    },

    // ============================================================
    //  MEDIA & CONTENT
    // ============================================================
    {
        name: "Image Compression API",
        description: "Compress PNG, JPEG, and WebP images by up to 80% without visible quality loss. Batch processing supported.",
        url: "https://compress-api.example.com/v1/compress",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["media", "image", "compression"]
    },
    {
        name: "Video Thumbnail Generator",
        description: "Extract thumbnails from video URLs at any timestamp. Supports YouTube, Vimeo, and direct video links.",
        url: "https://thumb-api.example.com/v1/extract",
        price_usdc: 0.08,
        owner_address: SERVER_WALLET,
        tags: ["media", "video", "thumbnail"]
    },
    {
        name: "Placeholder Image API",
        description: "Generate placeholder images of any size and color. Supports text overlay, gradients, and custom formats.",
        url: "https://placeholder-api.example.com/v1/image",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["media", "placeholder", "image", "free"]
    },
    {
        name: "QR Code Generator",
        description: "Generate QR codes from any text or URL. Configurable size, color, error correction, and format (PNG/SVG).",
        url: "https://api.qrserver.com/v1/create-qr-code/",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["media", "qr-code", "utility"]
    },
    {
        name: "Color Palette Generator",
        description: "Extract dominant colors from an image or generate harmonious palettes. Returns HEX, RGB, and HSL values.",
        url: "https://color-api.example.com/v1/palette",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["media", "color", "design", "free"]
    },
    {
        name: "PDF Generator API",
        description: "Generate PDF documents from HTML/CSS or Markdown. Supports headers, footers, page numbers, and custom fonts.",
        url: "https://pdf-gen.example.com/v1/generate",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["media", "pdf", "document"]
    },
    {
        name: "Screenshot Capture API",
        description: "Capture full-page or viewport screenshots of any website. Returns PNG/JPEG with custom resolution and device emulation.",
        url: "https://screenshot-api.example.com/v1/capture",
        price_usdc: 0.08,
        owner_address: SERVER_WALLET,
        tags: ["media", "screenshot", "web"]
    },
    {
        name: "OCR Document Scanner",
        description: "Extract text from images and scanned documents using optical character recognition. Supports 60+ languages.",
        url: "https://ocr-api.example.com/v1/scan",
        price_usdc: 0.12,
        owner_address: SERVER_WALLET,
        tags: ["media", "ocr", "document"]
    },
    {
        name: "Meme Generator API",
        description: "Generate memes from popular templates with custom top/bottom text. 500+ templates available. Returns PNG.",
        url: "https://meme-api.example.com/v1/generate",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["media", "meme", "fun"]
    },

    // ============================================================
    //  SECURITY
    // ============================================================
    {
        name: "Malware URL Scanner",
        description: "Scan URLs against malware, phishing, and scam databases. Returns threat level, blacklist status, and risk score.",
        url: "https://malware-scan.example.com/v1/check",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["security", "malware", "scanner"]
    },
    {
        name: "Password Strength Checker",
        description: "Analyze password strength with entropy calculation, common patterns detection, and breach database check (k-anonymity).",
        url: "https://password-api.example.com/v1/check",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["security", "password", "free"]
    },
    {
        name: "SSL Certificate Checker",
        description: "Check SSL/TLS certificate validity, expiration date, issuer, and chain for any domain. Detects misconfigurations.",
        url: "https://ssl-check.example.com/v1/check",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["security", "ssl", "certificate"]
    },
    {
        name: "Domain WHOIS Lookup",
        description: "Retrieve WHOIS registration data for any domain. Returns registrar, creation date, expiry, nameservers, and contacts.",
        url: "https://whois-api.example.com/v1/lookup",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["security", "whois", "domain"]
    },
    {
        name: "Email Breach Checker",
        description: "Check if an email has been compromised in known data breaches. Returns breach names, dates, and exposed data types.",
        url: "https://breach-api.example.com/v1/check",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["security", "breach", "email"]
    },

    // ============================================================
    //  LOCATION & MAPS
    // ============================================================
    {
        name: "Geocoding Service",
        description: "Convert city names to GPS coordinates and vice versa. Worldwide coverage with multilingual support.",
        url: "https://geocoding-api.open-meteo.com/v1/search",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["location", "geocoding"]
    },
    {
        name: "IP Geolocation API",
        description: "Geolocate any IP address. Returns country, city, timezone, ISP, and coordinates.",
        url: "https://ip-api.com/json/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "ip", "geolocation", "free"]
    },
    {
        name: "Distance Calculator API",
        description: "Calculate distance and travel time between two points. Supports driving, walking, cycling, and straight line.",
        url: "https://distance-api.example.com/v1/calculate",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["location", "distance", "maps"]
    },
    {
        name: "Address Validation API",
        description: "Validate and standardize postal addresses worldwide. Returns corrected address, ZIP code, and deliverability status.",
        url: "https://address-api.example.com/v1/validate",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["location", "address", "validation"]
    },
    {
        name: "World Time API",
        description: "Current time in any timezone. Returns UTC offset, DST status, and formatted datetime.",
        url: "https://worldtimeapi.org/api/timezone/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "time", "timezone", "free"]
    },
    {
        name: "Reverse Geocoding API",
        description: "Convert GPS coordinates to human-readable addresses. Returns street, city, region, country, and postal code.",
        url: "https://reverse-geo.example.com/v1/reverse",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["location", "geocoding", "address"]
    },

    // ============================================================
    //  COMMUNICATION
    // ============================================================
    {
        name: "Email Sending API",
        description: "Send transactional and marketing emails via API. Supports HTML templates, attachments, and tracking (open/click).",
        url: "https://email-api.example.com/v1/send",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["communication", "email", "messaging"]
    },
    {
        name: "SMS Gateway API",
        description: "Send SMS to 200+ countries. Supports Unicode, delivery reports, and scheduled sending. Competitive per-message pricing.",
        url: "https://sms-api.example.com/v1/send",
        price_usdc: 0.15,
        owner_address: SERVER_WALLET,
        tags: ["communication", "sms", "messaging"]
    },
    {
        name: "Push Notification API",
        description: "Send push notifications to iOS, Android, and Web browsers. Supports rich media, deep links, and segmentation.",
        url: "https://push-api.example.com/v1/send",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["communication", "push", "notification"]
    },
    {
        name: "Email Validation API",
        description: "Verify if an email address is valid, deliverable, and not disposable. Checks MX records, syntax, and known providers.",
        url: "https://email-verify.example.com/v1/validate",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["communication", "email", "validation"]
    },

    // ============================================================
    //  SEO & WEB ANALYTICS
    // ============================================================
    {
        name: "SEO Analysis API",
        description: "Analyze any URL for SEO performance. Returns meta tags, heading structure, page speed, mobile score, and issues.",
        url: "https://seo-api.example.com/v1/analyze",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["seo", "analytics", "web"]
    },
    {
        name: "Backlink Checker API",
        description: "Find all backlinks pointing to any domain or URL. Returns anchor text, domain authority, and follow/nofollow status.",
        url: "https://backlink-api.example.com/v1/check",
        price_usdc: 0.15,
        owner_address: SERVER_WALLET,
        tags: ["seo", "backlinks", "domain"]
    },
    {
        name: "RSS Feed Parser",
        description: "Parse any RSS or Atom feed URL into structured JSON. Extracts titles, links, dates, images, and content.",
        url: "https://rss-parser.example.com/v1/parse",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["seo", "rss", "feed", "free"]
    },
    {
        name: "Readability Scorer",
        description: "Score text readability using Flesch-Kincaid, Gunning Fog, and SMOG indexes. Returns grade level and improvement tips.",
        url: "https://readability-api.example.com/v1/score",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["seo", "readability", "text"]
    },
    {
        name: "URL Shortener API",
        description: "Shorten any URL with custom slugs and click tracking. Returns short URL, QR code, and analytics dashboard link.",
        url: "https://short-url.example.com/v1/shorten",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["seo", "url", "shortener", "free"]
    },

    // ============================================================
    //  DATA ENRICHMENT & SCRAPING
    // ============================================================
    {
        name: "Web Scraping API",
        description: "Extract structured data from any website. Handles JavaScript rendering, pagination, and anti-bot protection.",
        url: "https://scrape-api.example.com/v1/extract",
        price_usdc: 0.15,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "web", "data"]
    },
    {
        name: "Company Data Enrichment",
        description: "Enrich company names with domain, logo, industry, size, location, social profiles, and tech stack.",
        url: "https://enrichment-api.example.com/v1/company",
        price_usdc: 0.20,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "enrichment", "company"]
    },
    {
        name: "LinkedIn Profile API",
        description: "Fetch public LinkedIn profile data: headline, experience, education, skills, and certifications.",
        url: "https://linkedin-api.example.com/v1/profile",
        price_usdc: 0.25,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "linkedin", "profile"]
    },
    {
        name: "Product Price Tracker",
        description: "Track product prices across Amazon, eBay, and major retailers. Returns price history, alerts, and best deals.",
        url: "https://price-tracker.example.com/v1/track",
        price_usdc: 0.10,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "ecommerce", "price"]
    },

    // ============================================================
    //  FUN & MISCELLANEOUS
    // ============================================================
    {
        name: "Random User Generator",
        description: "Generate realistic fake user profiles with name, email, photo, address, and phone. Great for testing.",
        url: "https://randomuser.me/api/",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "mock-data", "users", "free"]
    },
    {
        name: "Cat Facts API",
        description: "Random fun facts about cats. Perfect for testing or entertainment. Returns one fact per request.",
        url: "https://catfact.ninja/fact",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "facts", "cats", "free"]
    },
    {
        name: "Number Trivia API",
        description: "Interesting mathematical and historical trivia about any number. Supports math, date, and year types.",
        url: "https://numbersapi.com/42/trivia",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "trivia", "numbers", "free"]
    },
    {
        name: "Joke Generator API",
        description: "Random programming jokes, dad jokes, and dark humor. Filter by category. Safe-mode available.",
        url: "https://joke-api.example.com/v1/random",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "jokes", "humor", "free"]
    },
    {
        name: "Inspirational Quotes API",
        description: "Random quotes from famous authors, entrepreneurs, and philosophers. Filter by category or author.",
        url: "https://quotes-api.example.com/v1/random",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "quotes", "inspiration", "free"]
    }
];

async function seed() {
    console.log(`Seeding ${SERVICES.length} services into Supabase...\n`);

    // Delete old placeholder-address seeds (from previous version)
    const { error: delOld } = await supabase
        .from('services')
        .delete()
        .like('owner_address', '0x00000000000000000000000000000000000000%');

    if (delOld) {
        console.error('Warning: could not clear old placeholder seeds:', delOld.message);
    }

    // Delete previous server-wallet seeds (no tx_hash = not registered by a real user)
    const { error: delSeeds } = await supabase
        .from('services')
        .delete()
        .eq('owner_address', SERVER_WALLET)
        .is('tx_hash', null);

    if (delSeeds) {
        console.error('Warning: could not clear previous seeds:', delSeeds.message);
    }

    const { data, error } = await supabase
        .from('services')
        .insert(SERVICES)
        .select();

    if (error) {
        console.error('Error seeding:', error.message);
        process.exit(1);
    }

    console.log(`\u2705 ${data.length} services inserted successfully!\n`);
    data.forEach((s, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} (${s.price_usdc} USDC) [${s.id.slice(0, 8)}]`);
    });
    console.log(`\nDone.`);
}

seed();
