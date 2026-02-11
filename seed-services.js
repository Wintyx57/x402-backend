require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SERVER_WALLET = process.env.WALLET_ADDRESS;
const BASE_URL = 'https://x402-api.onrender.com';

// Clean up fake/placeholder services that are not real x402 wrappers.
// Only real x402 native wrappers (URLs starting with BASE_URL/api/) are kept.
async function cleanFakeServices() {
    console.log('Cleaning up non-native services seeded by server wallet...\n');

    // Find fake services: owned by server wallet, no tx_hash (not paid registration), and NOT a native wrapper
    const { data: fakeServices, error: countErr } = await supabase
        .from('services')
        .select('id, name, url')
        .eq('owner_address', SERVER_WALLET)
        .is('tx_hash', null)
        .not('url', 'like', `${BASE_URL}/api/%`);

    if (countErr) {
        console.error('Error finding fake services:', countErr.message);
        process.exit(1);
    }

    if (!fakeServices || fakeServices.length === 0) {
        console.log('\u2705 No fake services found. Database is clean.');
        return;
    }

    console.log(`Found ${fakeServices.length} non-native services to remove:\n`);
    fakeServices.forEach((s, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${s.name} — ${s.url}`);
    });

    // Delete them
    const ids = fakeServices.map(s => s.id);
    const { error: delErr } = await supabase
        .from('services')
        .delete()
        .in('id', ids);

    if (delErr) {
        console.error('\nError deleting fake services:', delErr.message);
        process.exit(1);
    }

    console.log(`\n\u2705 Removed ${fakeServices.length} fake services.`);
    console.log('Only real x402 native wrappers and user-registered services remain.');
}

cleanFakeServices();
