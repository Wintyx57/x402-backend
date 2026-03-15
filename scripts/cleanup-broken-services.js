#!/usr/bin/env node
// scripts/cleanup-broken-services.js — One-shot script to clean up broken external services
// Run: node scripts/cleanup-broken-services.js
// Actions:
//   1. DELETE services matching "X402search" (broken external URLs)
//   2. Mark "Company Name Matching" as offline (double x402 payment issue)
//   3. Mark "Fia Signals" as offline (returns 404)

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
    console.log('🧹 Cleaning up broken external services...\n');

    // 1. Find and DELETE X402search services
    const { data: x402search, error: e1 } = await supabase
        .from('services')
        .select('id, name, url')
        .ilike('name', '%x402%search%');

    if (e1) { console.error('Error finding X402search:', e1.message); }
    else if (x402search && x402search.length > 0) {
        for (const svc of x402search) {
            console.log(`  ❌ Deleting: "${svc.name}" (${svc.id}) — ${svc.url}`);
            const { error } = await supabase.from('services').delete().eq('id', svc.id);
            if (error) console.error(`    Failed: ${error.message}`);
            else console.log(`    ✅ Deleted`);
        }
    } else {
        console.log('  No X402search services found (already cleaned).');
    }

    // 2. Mark "Company Name Matching" as offline
    const { data: interzoid, error: e2 } = await supabase
        .from('services')
        .select('id, name, status')
        .ilike('name', '%company name matching%');

    if (e2) { console.error('Error finding Interzoid:', e2.message); }
    else if (interzoid && interzoid.length > 0) {
        for (const svc of interzoid) {
            if (svc.status === 'offline') {
                console.log(`  ⏭️ "${svc.name}" already offline`);
                continue;
            }
            console.log(`  🔴 Marking offline: "${svc.name}" (${svc.id})`);
            const { error } = await supabase
                .from('services')
                .update({ status: 'offline', last_checked_at: new Date().toISOString() })
                .eq('id', svc.id);
            if (error) console.error(`    Failed: ${error.message}`);
            else console.log(`    ✅ Marked offline`);
        }
    } else {
        console.log('  No Company Name Matching services found.');
    }

    // 3. Mark "Fia Signals" as offline
    const { data: fia, error: e3 } = await supabase
        .from('services')
        .select('id, name, status')
        .ilike('name', '%fia%signal%');

    if (e3) { console.error('Error finding Fia Signals:', e3.message); }
    else if (fia && fia.length > 0) {
        for (const svc of fia) {
            if (svc.status === 'offline') {
                console.log(`  ⏭️ "${svc.name}" already offline`);
                continue;
            }
            console.log(`  🔴 Marking offline: "${svc.name}" (${svc.id})`);
            const { error } = await supabase
                .from('services')
                .update({ status: 'offline', last_checked_at: new Date().toISOString() })
                .eq('id', svc.id);
            if (error) console.error(`    Failed: ${error.message}`);
            else console.log(`    ✅ Marked offline`);
        }
    } else {
        console.log('  No Fia Signals services found.');
    }

    console.log('\n✅ Cleanup complete.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
