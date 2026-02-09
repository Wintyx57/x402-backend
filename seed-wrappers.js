require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;
const BASE_URL = 'https://x402-api.onrender.com';

// x402 Native wrapper APIs — real endpoints proxied via x402 payments
const WRAPPER_SERVICES = [
    // --- HIGH-VALUE SERVICES ---
    {
        name: "x402 Web Search",
        description: "Clean web search results optimized for LLMs. Returns title, URL, and snippet for each result — no ads, no HTML, just structured data. Powered by DuckDuckGo. Usage: /api/search?q=bitcoin+price&max=10",
        url: `${BASE_URL}/api/search`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "search", "web", "llm", "live"]
    },
    {
        name: "x402 Universal Scraper",
        description: "Give any URL, get clean Markdown back. Strips ads, nav, scripts — returns only the main content. Perfect for AI agents doing research. Usage: /api/scrape?url=https://example.com",
        url: `${BASE_URL}/api/scrape`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "scraper", "markdown", "web", "live"]
    },
    {
        name: "x402 Twitter/X Data",
        description: "Read Twitter/X profiles and tweets without API keys. Get follower counts, recent tweets, engagement metrics. Usage: /api/twitter?user=elonmusk or /api/twitter?tweet=https://x.com/user/status/123",
        url: `${BASE_URL}/api/twitter`,
        price_usdc: 0.005,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "twitter", "social", "data", "live"]
    },
    // --- UTILITY SERVICES ---
    {
        name: "x402 Weather API",
        description: "Real-time weather data for any city. Returns temperature, wind speed, and weather code. Powered by Open-Meteo via x402 payment. Usage: /api/weather?city=Paris",
        url: `${BASE_URL}/api/weather`,
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "weather", "data", "live"]
    },
    {
        name: "x402 Crypto Price API",
        description: "Live cryptocurrency prices in USD and EUR with 24h change. Powered by CoinGecko via x402 payment. Usage: /api/crypto?coin=bitcoin",
        url: `${BASE_URL}/api/crypto`,
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "crypto", "finance", "live"]
    },
    {
        name: "x402 Random Joke API",
        description: "Get a random joke with setup and punchline. Fun endpoint to test x402 payments. Usage: /api/joke",
        url: `${BASE_URL}/api/joke`,
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["x402-native", "fun", "jokes", "live"]
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
        console.log(`  ${i + 1}. ${s.name} (${s.price_usdc} USDC) — ${s.url}`);
    });
    console.log(`\nDone. These will appear with "x402 Native" badge on the marketplace.`);
}

seedWrappers();
