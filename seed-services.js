require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;

// ============================================================================
//  REAL APIs ONLY — prices calculated per request based on official pricing
//  Paid APIs: actual cost + ~30% margin (min 0.005 USDC)
//  Free APIs: genuinely free public APIs, no API key required
// ============================================================================

const SERVICES = [
    // ========================================================================
    //  AI & MACHINE LEARNING (paid — token/usage based)
    // ========================================================================
    {
        name: "OpenAI GPT-4o",
        description: "Flagship multimodal model by OpenAI. Text, vision, reasoning, and code generation. Pricing: $2.50/1M input + $10/1M output tokens.",
        url: "https://api.openai.com/v1/chat/completions",
        price_usdc: 0.012,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "text-generation"]
    },
    {
        name: "OpenAI GPT-4o-mini",
        description: "Fast, affordable small model by OpenAI. Ideal for classification, extraction, and quick tasks. $0.15/1M input + $0.60/1M output tokens.",
        url: "https://api.openai.com/v1/chat/completions",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "fast"]
    },
    {
        name: "Anthropic Claude Sonnet 4.5",
        description: "Advanced reasoning and coding model by Anthropic. Extended thinking, analysis, and generation. $3/1M input + $15/1M output tokens.",
        url: "https://api.anthropic.com/v1/messages",
        price_usdc: 0.012,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "reasoning"]
    },
    {
        name: "Anthropic Claude Haiku 4.5",
        description: "Fast, compact model by Anthropic. Optimized for high-throughput tasks: classification, routing, extraction. $1/1M input + $5/1M output tokens.",
        url: "https://api.anthropic.com/v1/messages",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["ai", "llm", "fast"]
    },
    {
        name: "OpenAI DALL-E 3",
        description: "AI image generation from text prompts. Supports multiple sizes and quality levels. Standard 1024x1024: $0.04/image.",
        url: "https://api.openai.com/v1/images/generations",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["ai", "image-generation", "creative"]
    },
    {
        name: "OpenAI Whisper (Speech-to-Text)",
        description: "Automatic speech recognition supporting 50+ languages. Punctuation and timestamps included. $0.006/minute of audio.",
        url: "https://api.openai.com/v1/audio/transcriptions",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["ai", "stt", "audio"]
    },
    {
        name: "OpenAI TTS (Text-to-Speech)",
        description: "Convert text to natural-sounding speech. 6 voices, adjustable speed. Standard: $15/1M characters, HD: $30/1M characters.",
        url: "https://api.openai.com/v1/audio/speech",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["ai", "tts", "audio"]
    },
    {
        name: "OpenAI Embeddings",
        description: "Generate vector embeddings for semantic search, clustering, and RAG. text-embedding-3-small: $0.02/1M tokens. 1536 dimensions.",
        url: "https://api.openai.com/v1/embeddings",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["ai", "embeddings", "search"]
    },
    {
        name: "DeepL Translation",
        description: "Neural machine translation in 30+ languages. Superior quality for European languages. Free: 500K chars/month, Pro: $25/1M characters.",
        url: "https://api-free.deepl.com/v2/translate",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["ai", "translation", "language"]
    },
    {
        name: "Google Cloud Vision",
        description: "Image analysis: label detection, OCR, face detection, object localization. $1.50/1000 images (first 1000/month free).",
        url: "https://vision.googleapis.com/v1/images:annotate",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["ai", "vision", "image-recognition"]
    },
    {
        name: "Hugging Face Inference",
        description: "Run 200,000+ open-source models (Llama, Mistral, Stable Diffusion). Free tier available. Pricing varies by model and hardware.",
        url: "https://api-inference.huggingface.co/models",
        price_usdc: 0.008,
        owner_address: SERVER_WALLET,
        tags: ["ai", "open-source", "inference"]
    },
    {
        name: "Remove.bg Background Removal",
        description: "AI-powered image background removal. Returns transparent PNG. 50 free API calls/month, then ~$0.20/image on subscription.",
        url: "https://api.remove.bg/v1.0/removebg",
        price_usdc: 0.25,
        owner_address: SERVER_WALLET,
        tags: ["ai", "image", "background-removal"]
    },

    // ========================================================================
    //  FINANCE & CRYPTO (mixed free/paid)
    // ========================================================================
    {
        name: "CoinGecko Crypto Prices",
        description: "Real-time prices for 15,000+ cryptocurrencies. Market cap, volume, 24h change. Free: 10-30 calls/min.",
        url: "https://api.coingecko.com/api/v3/simple/price",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "crypto", "prices", "free"]
    },
    {
        name: "ExchangeRate API",
        description: "Live exchange rates for 161 currencies. Updated every 24h on free tier. No API key required.",
        url: "https://open.er-api.com/v6/latest/USD",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "currency", "forex", "free"]
    },
    {
        name: "CoinGecko Market Data",
        description: "Detailed market data: OHLCV, historical prices, trending coins, exchange volumes. Free: 10-30 calls/min.",
        url: "https://api.coingecko.com/api/v3/coins/markets",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "crypto", "market-data", "free"]
    },
    {
        name: "Alpha Vantage Stock Data",
        description: "Real-time and historical stock prices, forex, and crypto. Free: 25 requests/day. Premium from $49.99/month.",
        url: "https://www.alphavantage.co/query",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["finance", "stocks", "market"]
    },
    {
        name: "Etherscan API",
        description: "Ethereum blockchain explorer API. Balances, transactions, token transfers, contract ABIs. Free: 5 calls/sec.",
        url: "https://api.etherscan.io/api",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "ethereum", "blockchain", "free"]
    },
    {
        name: "BaseScan API",
        description: "Base L2 blockchain explorer API. Same interface as Etherscan. Balances, transactions, contract verification. Free tier available.",
        url: "https://api.basescan.org/api",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "base", "blockchain", "free"]
    },
    {
        name: "CoinMarketCap",
        description: "Crypto market data from the #1 tracker. 10,000+ coins. Quotes, listings, global metrics. Free: 10K credits/month.",
        url: "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["finance", "crypto", "market-data"]
    },
    {
        name: "Blockchain.com Exchange Rates",
        description: "Bitcoin exchange rates in 22 currencies. Real-time ticker data. No API key required.",
        url: "https://blockchain.info/ticker",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["finance", "bitcoin", "rates", "free"]
    },

    // ========================================================================
    //  DATA & KNOWLEDGE (mostly free)
    // ========================================================================
    {
        name: "Open-Meteo Weather Forecast",
        description: "Global weather: temperature, humidity, wind, precipitation. Hourly and 7-day forecasts. Completely free, no API key.",
        url: "https://api.open-meteo.com/v1/forecast",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "weather", "forecast", "free"]
    },
    {
        name: "OpenWeatherMap",
        description: "Current weather, 5-day forecast, air pollution, and geocoding. Free: 1000 calls/day. Paid from $0.0012/call.",
        url: "https://api.openweathermap.org/data/2.5/weather",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["data", "weather", "forecast"]
    },
    {
        name: "Wikipedia Summary",
        description: "Get any Wikipedia article summary with title, extract, thumbnail, and links. Free, no API key, all languages.",
        url: "https://en.wikipedia.org/api/rest_v1/page/summary",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "wikipedia", "knowledge", "free"]
    },
    {
        name: "REST Countries",
        description: "Detailed info for all 250 countries: population, capital, currencies, languages, borders, flags. Free, no API key.",
        url: "https://restcountries.com/v3.1/all",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "countries", "geography", "free"]
    },
    {
        name: "Open Library Book Search",
        description: "Search millions of books by title, author, or ISBN. Returns covers, publishers, and editions. Free, no API key.",
        url: "https://openlibrary.org/search.json",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "books", "library", "free"]
    },
    {
        name: "TMDB Movies & TV",
        description: "The Movie Database: search movies, TV shows, actors. Posters, ratings, trailers. Free API key required.",
        url: "https://api.themoviedb.org/3/search/movie",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "movies", "entertainment", "free"]
    },
    {
        name: "NewsAPI Headlines",
        description: "Top headlines from 80+ sources in 54 countries. Filter by category, source, keyword. Free: 100 requests/day.",
        url: "https://newsapi.org/v2/top-headlines",
        price_usdc: 0.008,
        owner_address: SERVER_WALLET,
        tags: ["data", "news", "headlines"]
    },
    {
        name: "Open-Meteo Air Quality",
        description: "Real-time air quality data: PM2.5, PM10, O3, NO2, CO. European and US AQI indexes. Free, no API key.",
        url: "https://air-quality-api.open-meteo.com/v1/air-quality",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "air-quality", "environment", "free"]
    },
    {
        name: "Open Food Facts",
        description: "Collaborative database of food products worldwide. Nutrition facts, ingredients, Nutri-Score. Free, open data.",
        url: "https://world.openfoodfacts.org/api/v2/search",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "food", "nutrition", "free"]
    },
    {
        name: "NASA Astronomy Picture of the Day",
        description: "Daily astronomy image or video with expert explanation. Decades of archive. Free with NASA API key.",
        url: "https://api.nasa.gov/planetary/apod",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "space", "nasa", "free"]
    },
    {
        name: "PokéAPI",
        description: "Complete Pokémon database: 1,300+ Pokémon, moves, abilities, types, evolutions. Free, no API key. RESTful.",
        url: "https://pokeapi.co/api/v2/pokemon",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["data", "pokemon", "gaming", "free"]
    },

    // ========================================================================
    //  DEVELOPER TOOLS (mostly free)
    // ========================================================================
    {
        name: "GitHub REST API",
        description: "Access GitHub data: users, repos, issues, PRs, commits. Free: 60 req/hr unauthenticated, 5000 with token.",
        url: "https://api.github.com",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "github", "code", "free"]
    },
    {
        name: "NPM Registry",
        description: "Search and fetch metadata for 2M+ npm packages. Versions, dependencies, downloads stats. Free, no API key.",
        url: "https://registry.npmjs.org",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "npm", "packages", "free"]
    },
    {
        name: "JSONPlaceholder",
        description: "Fake REST API for testing and prototyping. Posts, comments, users, todos, photos. Free, no API key.",
        url: "https://jsonplaceholder.typicode.com",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "testing", "mock-data", "free"]
    },
    {
        name: "HTTPBin",
        description: "HTTP request/response testing service. Test headers, auth, redirects, cookies, status codes. Free, no API key.",
        url: "https://httpbin.org",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "testing", "debug", "free"]
    },
    {
        name: "ipinfo.io",
        description: "IP geolocation and ASN data. Country, city, timezone, ISP, company. Free: 50K lookups/month.",
        url: "https://ipinfo.io",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "ip", "geolocation", "free"]
    },
    {
        name: "Google PageSpeed Insights",
        description: "Analyze page performance and Core Web Vitals. Lighthouse scores for mobile and desktop. Free with Google API key.",
        url: "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "performance", "seo", "free"]
    },
    {
        name: "Abstract Email Validation",
        description: "Verify email deliverability: syntax, MX records, SMTP check, disposable detection. Free: 100/month. Paid: $0.004/email.",
        url: "https://emailvalidation.abstractapi.com/v1",
        price_usdc: 0.006,
        owner_address: SERVER_WALLET,
        tags: ["developer", "email", "validation"]
    },
    {
        name: "Abstract IP Geolocation",
        description: "IP geolocation with country, city, timezone, currency, connection type, and security flags. Free: 20K/month.",
        url: "https://ipgeolocation.abstractapi.com/v1",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["developer", "ip", "geolocation", "free"]
    },

    // ========================================================================
    //  MEDIA & IMAGE (mixed)
    // ========================================================================
    {
        name: "QR Code Generator",
        description: "Generate QR codes from any text or URL. Custom size, color, error correction. PNG and SVG formats. Free, no API key.",
        url: "https://api.qrserver.com/v1/create-qr-code",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["media", "qr-code", "generator", "free"]
    },
    {
        name: "TinyPNG Image Compression",
        description: "Smart PNG/JPEG/WebP compression. Reduces file size up to 80% without visible quality loss. Free: 500 images/month.",
        url: "https://api.tinify.com/shrink",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["media", "image", "compression"]
    },
    {
        name: "Placeholder.com Images",
        description: "Generate placeholder images of any size. Custom colors and text. Direct URL-based, no API key needed.",
        url: "https://via.placeholder.com",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["media", "placeholder", "image", "free"]
    },
    {
        name: "Unsplash Photos",
        description: "Access 3M+ high-resolution photos. Search, random, collections. Free: 50 requests/hour. Commercial use allowed.",
        url: "https://api.unsplash.com/photos",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["media", "photos", "images", "free"]
    },
    {
        name: "Cloudinary Image Transform",
        description: "On-the-fly image transformation: resize, crop, filters, format conversion. Free: 25K transformations/month.",
        url: "https://api.cloudinary.com/v1_1",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["media", "image", "transform"]
    },

    // ========================================================================
    //  SECURITY (mixed)
    // ========================================================================
    {
        name: "Shodan Internet Scanner",
        description: "Search engine for internet-connected devices. IP lookup, open ports, vulnerabilities, SSL info. Free: limited queries.",
        url: "https://api.shodan.io",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["security", "scanner", "network"]
    },
    {
        name: "Have I Been Pwned (Passwords)",
        description: "Check if a password has been exposed in data breaches using k-anonymity. Returns breach count. Free, open API.",
        url: "https://api.pwnedpasswords.com/range",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["security", "password", "breach", "free"]
    },
    {
        name: "URLhaus Malware Check",
        description: "Check URLs against the URLhaus malware database by abuse.ch. Returns threat status and tags. Free, open data.",
        url: "https://urlhaus-api.abuse.ch/v1",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["security", "malware", "url-check", "free"]
    },
    {
        name: "AbuseIPDB",
        description: "Check and report abusive IP addresses. Returns confidence score, ISP, and report history. Free: 1000 checks/day.",
        url: "https://api.abuseipdb.com/api/v2/check",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["security", "ip", "abuse", "free"]
    },
    {
        name: "SSL Labs Server Test",
        description: "Deep analysis of SSL/TLS configuration for any domain. Grades A+ to F. Certificate chain, protocols, vulnerabilities.",
        url: "https://api.ssllabs.com/api/v3/analyze",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["security", "ssl", "certificate", "free"]
    },

    // ========================================================================
    //  LOCATION & TIME (mostly free)
    // ========================================================================
    {
        name: "Open-Meteo Geocoding",
        description: "Convert city names to GPS coordinates and vice versa. Worldwide coverage, multilingual. Free, no API key.",
        url: "https://geocoding-api.open-meteo.com/v1/search",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "geocoding", "coordinates", "free"]
    },
    {
        name: "ip-api.com Geolocation",
        description: "IP geolocation: country, region, city, ZIP, lat/lon, timezone, ISP. Free for non-commercial use, 45 req/min.",
        url: "https://ip-api.com/json",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "ip", "geolocation", "free"]
    },
    {
        name: "WorldTimeAPI",
        description: "Current time in any timezone. UTC offset, DST status, abbreviation, and Unix timestamp. Free, no API key.",
        url: "https://worldtimeapi.org/api/timezone",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "time", "timezone", "free"]
    },
    {
        name: "Nager.at Public Holidays",
        description: "Public and bank holidays for 100+ countries. Filter by year. Free, open source, no API key.",
        url: "https://date.nager.at/api/v3/PublicHolidays",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["location", "holidays", "calendar", "free"]
    },
    {
        name: "OpenCage Geocoding",
        description: "Forward and reverse geocoding worldwide. 2,500+ free requests/day. Premium from $50/month for 10K/day.",
        url: "https://api.opencagedata.com/geocode/v1/json",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["location", "geocoding", "address"]
    },
    {
        name: "Mapbox Geocoding",
        description: "Forward and reverse geocoding with address autocomplete. Free: 100K requests/month. Then $0.75/1000 requests.",
        url: "https://api.mapbox.com/geocoding/v5/mapbox.places",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["location", "geocoding", "maps"]
    },

    // ========================================================================
    //  COMMUNICATION (paid — per-message based)
    // ========================================================================
    {
        name: "Twilio SMS",
        description: "Send SMS to 200+ countries. Delivery reports, Unicode support. US: $0.0079/SMS + carrier fees.",
        url: "https://api.twilio.com/2010-04-01/Accounts",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["communication", "sms", "messaging"]
    },
    {
        name: "Twilio WhatsApp",
        description: "Send WhatsApp messages via API. Templates, media, and interactive messages. $0.005/message + Meta fees.",
        url: "https://api.twilio.com/2010-04-01/Accounts",
        price_usdc: 0.008,
        owner_address: SERVER_WALLET,
        tags: ["communication", "whatsapp", "messaging"]
    },
    {
        name: "SendGrid Email",
        description: "Transactional and marketing email API. HTML templates, tracking, analytics. Free: 100 emails/day. Essentials: $19.95/month.",
        url: "https://api.sendgrid.com/v3/mail/send",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["communication", "email", "transactional"]
    },
    {
        name: "Mailgun Email",
        description: "Email sending, validation, and routing API. Optimized deliverability. Free: 100 emails/day. Flex: $0.80/1000 emails.",
        url: "https://api.mailgun.net/v3",
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["communication", "email", "delivery"]
    },

    // ========================================================================
    //  SEO & WEB ANALYTICS (mixed)
    // ========================================================================
    {
        name: "Google PageSpeed Insights",
        description: "Page performance analysis powered by Lighthouse. Core Web Vitals, performance score, accessibility audit. Free.",
        url: "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["seo", "performance", "lighthouse", "free"]
    },
    {
        name: "ScrapingBee Web Scraper",
        description: "Web scraping API with JS rendering and proxy rotation. Handles anti-bot. Free: 1000 credits. From $49/month.",
        url: "https://app.scrapingbee.com/api/v1",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["seo", "scraping", "web"]
    },
    {
        name: "Hunter.io Email Finder",
        description: "Find professional email addresses by domain or name. Verification included. Free: 25 searches/month. From $49/month.",
        url: "https://api.hunter.io/v2/domain-search",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["seo", "email", "lead-generation"]
    },
    {
        name: "Microlink Web Previews",
        description: "Generate link previews, screenshots, and PDF from any URL. Metadata extraction. Free: 50 req/day. Pro: $15.99/month.",
        url: "https://api.microlink.io",
        price_usdc: 0.008,
        owner_address: SERVER_WALLET,
        tags: ["seo", "preview", "screenshot"]
    },

    // ========================================================================
    //  SCRAPING & DATA ENRICHMENT (paid)
    // ========================================================================
    {
        name: "ScraperAPI",
        description: "Web scraping with automatic proxy rotation, CAPTCHA handling, and JS rendering. Free: 5000 credits. From $49/month.",
        url: "https://api.scraperapi.com",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "web", "proxy"]
    },
    {
        name: "Clearbit Company Enrichment",
        description: "Enrich company data: domain, logo, industry, size, tech stack, social profiles. Now part of HubSpot. From $99/month.",
        url: "https://company.clearbit.com/v2/companies/find",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "enrichment", "company"]
    },
    {
        name: "ZeroBounce Email Validation",
        description: "Email validation: deliverability, disposable detection, catch-all, abuse check. Free: 100/month. Then $0.008/email.",
        url: "https://api.zerobounce.net/v2/validate",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "email", "validation"]
    },
    {
        name: "FullContact Person Enrichment",
        description: "Enrich person data from email: name, photo, social profiles, job title, company. From $99/month.",
        url: "https://api.fullcontact.com/v3/person.enrich",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["scraping", "enrichment", "person"]
    },

    // ========================================================================
    //  FUN & MISC (all free)
    // ========================================================================
    {
        name: "Dictionary API",
        description: "English dictionary with definitions, phonetics, synonyms, antonyms, and usage examples. Free, no API key.",
        url: "https://api.dictionaryapi.dev/api/v2/entries/en",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "dictionary", "language", "free"]
    },
    {
        name: "RandomUser.me",
        description: "Generate realistic fake user profiles: name, email, photo, address, phone. Great for testing. Free, no API key.",
        url: "https://randomuser.me/api",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "mock-data", "users", "free"]
    },
    {
        name: "Cat Facts",
        description: "Random fun facts about cats. One fact per request. Perfect for testing or entertainment. Free, no API key.",
        url: "https://catfact.ninja/fact",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "facts", "cats", "free"]
    },
    {
        name: "Dog CEO Random Images",
        description: "Random dog images by breed. 20,000+ images across 120 breeds. Free, no API key.",
        url: "https://dog.ceo/api/breeds/image/random",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "dogs", "images", "free"]
    },
    {
        name: "JokeAPI",
        description: "Random jokes: programming, puns, dark humor, misc. Filter by category and language. Safe-mode available. Free.",
        url: "https://v2.jokeapi.dev/joke/Any",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "jokes", "humor", "free"]
    },
    {
        name: "Advice Slip",
        description: "Random life advice and wisdom. One slip per request. Search by keyword. Free, no API key.",
        url: "https://api.adviceslip.com/advice",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "advice", "quotes", "free"]
    },
    {
        name: "Numbers API",
        description: "Interesting mathematical and historical trivia about any number, date, or year. Free, no API key.",
        url: "https://numbersapi.com",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "trivia", "numbers", "free"]
    },
    {
        name: "Bored API",
        description: "Random activity suggestions when you're bored. Filter by type, participants, and price. Free, no API key.",
        url: "https://bored-api.appbrewery.com/random",
        price_usdc: 0,
        owner_address: SERVER_WALLET,
        tags: ["fun", "activities", "random", "free"]
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

    const freeCount = data.filter(s => Number(s.price_usdc) === 0).length;
    const paidCount = data.filter(s => Number(s.price_usdc) > 0).length;

    console.log(`\u2705 ${data.length} services inserted (${freeCount} free, ${paidCount} paid)\n`);
    data.forEach((s, i) => {
        const price = Number(s.price_usdc) === 0 ? 'FREE' : `${s.price_usdc} USDC`;
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} (${price}) [${s.id.slice(0, 8)}]`);
    });
    console.log(`\nDone.`);
}

seed();
