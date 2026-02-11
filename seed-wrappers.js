require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;
const BASE_URL = 'https://x402-api.onrender.com';

// All 21 x402 Native wrapper APIs — real endpoints proxied via x402 payments
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
        description: "Generate images with DALL-E 3. Provide a text prompt, get a high-quality AI-generated image URL back. Supports 1024x1024, 1024x1792, 1792x1024 sizes and standard/hd quality. Usage: /api/image?prompt=a+cat+in+space&size=1024x1024&quality=standard",
        url: `${BASE_URL}/api/image`,
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "ai", "image", "dall-e", "generation", "live"]
    },
];

async function seedWrappers() {
    console.log(`Seeding ${WRAPPER_SERVICES.length} x402 native wrapper services...\n`);

    // Remove previous wrapper seeds (same owner, no tx_hash, url starts with BASE_URL)
    const { error: delErr } = await supabase
        .from('services')
        .delete()
        .eq('owner_address', SERVER_WALLET)
        .is('tx_hash', null)
        .like('url', `${BASE_URL}/api/%`);

    if (delErr) {
        console.error('Warning: could not clear previous wrapper seeds:', delErr.message);
    }

    const { data, error } = await supabase
        .from('services')
        .insert(WRAPPER_SERVICES)
        .select();

    if (error) {
        console.error('Error seeding wrappers:', error.message);
        process.exit(1);
    }

    console.log(`\u2705 ${data.length} x402 native services inserted:\n`);
    data.forEach((s, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} (${s.price_usdc} USDC) — ${s.url}`);
    });
    console.log(`\nDone. These will appear with "x402 Native" badge on the marketplace.`);
}

seedWrappers();
