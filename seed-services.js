require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVICES = [
    {
        name: "Weather API Pro",
        description: "Real-time weather data for any city worldwide. Returns temperature, humidity, wind speed, and 5-day forecast.",
        url: "https://api.open-meteo.com/v1/forecast",
        price_usdc: 0.05,
        owner_address: "0x0000000000000000000000000000000000000001",
        tags: ["weather", "forecast", "climate", "api"]
    },
    {
        name: "News Aggregator AI",
        description: "AI-curated news headlines from 80+ sources. Filter by topic, country, or language. Real-time updates.",
        url: "https://newsapi.org/v2/top-headlines",
        price_usdc: 0.10,
        owner_address: "0x0000000000000000000000000000000000000002",
        tags: ["news", "headlines", "media", "ai"]
    },
    {
        name: "PDF Summarizer",
        description: "Upload a PDF URL and receive a structured summary with key points, entities, and action items.",
        url: "https://pdf-summarizer.example.com/v1",
        price_usdc: 0.25,
        owner_address: "0x0000000000000000000000000000000000000003",
        tags: ["pdf", "summarizer", "document", "ai"]
    },
    {
        name: "Currency Converter",
        description: "Real-time forex rates for 170+ currencies. Supports crypto pairs (BTC, ETH, USDC). Historical data available.",
        url: "https://api.exchangerate.host/latest",
        price_usdc: 0.03,
        owner_address: "0x0000000000000000000000000000000000000004",
        tags: ["currency", "forex", "exchange", "finance"]
    },
    {
        name: "Image Generator (SDXL)",
        description: "Generate high-quality images from text prompts using Stable Diffusion XL. 1024x1024, multiple styles.",
        url: "https://image-gen.example.com/v1/generate",
        price_usdc: 0.50,
        owner_address: "0x0000000000000000000000000000000000000005",
        tags: ["image", "generation", "ai", "stable-diffusion"]
    },
    {
        name: "Text-to-Speech Engine",
        description: "Convert text to natural speech in 30+ languages. Multiple voices, adjustable speed and pitch. Returns MP3.",
        url: "https://tts-engine.example.com/v1/speak",
        price_usdc: 0.15,
        owner_address: "0x0000000000000000000000000000000000000006",
        tags: ["tts", "speech", "audio", "voice"]
    },
    {
        name: "Code Review Bot",
        description: "Automated code review powered by LLM. Supports Python, JavaScript, Rust, Go. Returns issues, suggestions, and security alerts.",
        url: "https://code-review.example.com/v1/review",
        price_usdc: 0.30,
        owner_address: "0x0000000000000000000000000000000000000007",
        tags: ["code", "review", "security", "ai"]
    },
    {
        name: "Geocoding Service",
        description: "Convert addresses to coordinates and vice versa. Worldwide coverage. Batch requests supported.",
        url: "https://nominatim.openstreetmap.org/search",
        price_usdc: 0.02,
        owner_address: "0x0000000000000000000000000000000000000008",
        tags: ["geocoding", "maps", "location", "gis"]
    },
    {
        name: "Sentiment Analyzer",
        description: "Analyze sentiment of text, tweets, or reviews. Returns positive/negative/neutral score with confidence level.",
        url: "https://sentiment.example.com/v1/analyze",
        price_usdc: 0.08,
        owner_address: "0x0000000000000000000000000000000000000009",
        tags: ["sentiment", "nlp", "analysis", "ai"]
    },
    {
        name: "Translation API",
        description: "Translate text between 100+ languages. Supports context-aware translation, formality levels, and glossaries.",
        url: "https://translate.example.com/v1/translate",
        price_usdc: 0.10,
        owner_address: "0x000000000000000000000000000000000000000a",
        tags: ["translation", "language", "nlp", "i18n"]
    },
    {
        name: "Stock Market Data",
        description: "Real-time and historical stock prices for NYSE, NASDAQ, and global exchanges. Includes volume, OHLC, and indicators.",
        url: "https://stock-data.example.com/v1/quote",
        price_usdc: 0.20,
        owner_address: "0x000000000000000000000000000000000000000b",
        tags: ["stocks", "finance", "market", "trading"]
    },
    {
        name: "Email Validator",
        description: "Validate email addresses in bulk. Checks syntax, MX records, disposable domains, and deliverability score.",
        url: "https://email-check.example.com/v1/validate",
        price_usdc: 0.01,
        owner_address: "0x000000000000000000000000000000000000000c",
        tags: ["email", "validation", "deliverability", "marketing"]
    },
    {
        name: "Web Scraper Agent",
        description: "Extract structured data from any public webpage. Supports CSS selectors, pagination, and JavaScript-rendered content.",
        url: "https://scraper.example.com/v1/extract",
        price_usdc: 0.15,
        owner_address: "0x000000000000000000000000000000000000000d",
        tags: ["scraping", "extraction", "web", "data"]
    },
    {
        name: "DNS Lookup Service",
        description: "Complete DNS resolution for any domain. Returns A, AAAA, MX, TXT, CNAME, NS records. DNSSEC validation included.",
        url: "https://dns.example.com/v1/lookup",
        price_usdc: 0.02,
        owner_address: "0x000000000000000000000000000000000000000e",
        tags: ["dns", "network", "domain", "infrastructure"]
    },
    {
        name: "Receipt OCR Parser",
        description: "Extract merchant, date, items, totals, and tax from receipt images. Supports 15+ languages and currencies.",
        url: "https://receipt-ocr.example.com/v1/parse",
        price_usdc: 0.20,
        owner_address: "0x000000000000000000000000000000000000000f",
        tags: ["ocr", "receipt", "finance", "ai"]
    }
];

async function seed() {
    console.log(`Seeding ${SERVICES.length} services into Supabase...\n`);

    // Clear existing seed data (placeholder addresses only)
    const { error: delError } = await supabase
        .from('services')
        .delete()
        .like('owner_address', '0x00000000000000000000000000000000000000%');

    if (delError) {
        console.error('Warning: could not clear old seed data:', delError.message);
    }

    const { data, error } = await supabase
        .from('services')
        .insert(SERVICES)
        .select();

    if (error) {
        console.error('Error seeding:', error.message);
        process.exit(1);
    }

    console.log(`✅ ${data.length} services inserted successfully!\n`);
    data.forEach((s, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} (${s.price_usdc} USDC) [${s.id.slice(0, 8)}]`);
    });
    console.log(`\nDone.`);
}

seed();
