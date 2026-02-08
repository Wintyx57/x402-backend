require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SERVER_WALLET = process.env.WALLET_ADDRESS;

const SERVICES = [
    {
        name: "Weather Forecast API",
        description: "Global weather forecast with temperature, humidity, wind speed, and precipitation. Supports hourly and 7-day forecasts for any coordinates.",
        url: "https://api.open-meteo.com/v1/forecast",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["weather", "forecast"]
    },
    {
        name: "Geocoding Service",
        description: "Convert city names to GPS coordinates and vice versa. Worldwide coverage with multilingual support.",
        url: "https://geocoding-api.open-meteo.com/v1/search",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["geocoding", "location"]
    },
    {
        name: "Country Information API",
        description: "Detailed information about any country: population, capital, currencies, languages, borders, and flag.",
        url: "https://restcountries.com/v3.1/name/",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["countries", "geography"]
    },
    {
        name: "Wikipedia Summary API",
        description: "Get a concise summary of any Wikipedia article. Returns title, extract, thumbnail, and links.",
        url: "https://en.wikipedia.org/api/rest_v1/page/summary/",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["wikipedia", "knowledge"]
    },
    {
        name: "Currency Exchange Rates",
        description: "Live exchange rates for 150+ currencies. Base currency configurable. Updated every hour.",
        url: "https://open.er-api.com/v6/latest/USD",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["currency", "forex"]
    },
    {
        name: "Crypto Price Tracker",
        description: "Real-time cryptocurrency prices from CoinGecko. Supports BTC, ETH, SOL, and thousands of tokens.",
        url: "https://api.coingecko.com/api/v3/simple/price",
        price_usdc: 0.05,
        owner_address: SERVER_WALLET,
        tags: ["crypto", "bitcoin"]
    },
    {
        name: "IP Geolocation API",
        description: "Geolocate any IP address. Returns country, city, timezone, ISP, and coordinates.",
        url: "https://ip-api.com/json/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["ip", "geolocation"]
    },
    {
        name: "World Time API",
        description: "Current time in any timezone. Returns UTC offset, DST status, and formatted datetime.",
        url: "https://worldtimeapi.org/api/timezone/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["time", "timezone"]
    },
    {
        name: "Public Holidays API",
        description: "Public and bank holidays for 100+ countries. Filter by year. Includes local and global holidays.",
        url: "https://date.nager.at/api/v3/PublicHolidays/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["holidays", "calendar"]
    },
    {
        name: "Dictionary & Definitions",
        description: "English dictionary with definitions, phonetics, synonyms, antonyms, and usage examples.",
        url: "https://api.dictionaryapi.dev/api/v2/entries/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["dictionary", "language"]
    },
    {
        name: "QR Code Generator",
        description: "Generate QR codes from any text or URL. Configurable size, color, and format (PNG/SVG).",
        url: "https://api.qrserver.com/v1/create-qr-code/",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["qr-code", "utility"]
    },
    {
        name: "Random User Generator",
        description: "Generate realistic fake user profiles with name, email, photo, address, and phone. Great for testing.",
        url: "https://randomuser.me/api/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["users", "mock-data"]
    },
    {
        name: "University Search API",
        description: "Search universities worldwide by name or country. Returns name, country, domains, and web pages.",
        url: "https://universities.hipolabs.com/search",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["education", "academic"]
    },
    {
        name: "Open Library Book Search",
        description: "Search millions of books by title, author, or ISBN. Returns cover art, publishers, and editions.",
        url: "https://openlibrary.org/search.json",
        price_usdc: 0.03,
        owner_address: SERVER_WALLET,
        tags: ["books", "library"]
    },
    {
        name: "GitHub User Profile API",
        description: "Fetch public GitHub user profiles. Returns repos count, followers, bio, company, and avatar.",
        url: "https://api.github.com/users/",
        price_usdc: 0.02,
        owner_address: SERVER_WALLET,
        tags: ["github", "developer"]
    },
    {
        name: "Cat Facts API",
        description: "Random fun facts about cats. Perfect for testing or entertainment. Returns one fact per request.",
        url: "https://catfact.ninja/fact",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["fun", "facts"]
    },
    {
        name: "Number Trivia API",
        description: "Interesting mathematical and historical trivia about any number. Supports math, date, and year types.",
        url: "https://numbersapi.com/42/trivia",
        price_usdc: 0.01,
        owner_address: SERVER_WALLET,
        tags: ["trivia", "numbers"]
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
