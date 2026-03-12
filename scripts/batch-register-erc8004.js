#!/usr/bin/env node
// scripts/batch-register-erc8004.js
// One-time batch registration of all existing services on ERC-8004 Identity Registry.
// Usage: node scripts/batch-register-erc8004.js [--dry-run]
// Requires: AGENT_PRIVATE_KEY (or ERC8004_REGISTRY_KEY) + SUPABASE_URL + SUPABASE_KEY

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { initClients, registerAgent } = require('../lib/erc8004-registry');

const PROGRESS_FILE = path.join(__dirname, '_batch-register-progress.json');
const BATCH_SIZE = 5;
const BATCH_DELAY = 3000;

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
        process.exit(1);
    }
    if (!process.env.AGENT_PRIVATE_KEY && !process.env.ERC8004_REGISTRY_KEY) {
        console.error('Missing AGENT_PRIVATE_KEY or ERC8004_REGISTRY_KEY in .env');
        process.exit(1);
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // Initialize viem clients
    initClients();

    // Load progress (resume from where we left off)
    let progress = {};
    if (fs.existsSync(PROGRESS_FILE)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        console.log(`Resuming: ${Object.keys(progress).length} already processed`);
    }

    // Fetch all services without erc8004_agent_id
    const { data: services, error } = await supabase
        .from('services')
        .select('id, name, url, description')
        .is('erc8004_agent_id', null)
        .order('created_at', { ascending: true })
        .limit(500);

    if (error) {
        console.error('Supabase error:', error.message);
        process.exit(1);
    }

    // Filter out already-progressed
    const todo = services.filter(s => !progress[s.id]);
    console.log(`${todo.length} services to register (${services.length} total without agent_id)\n`);

    if (dryRun) {
        console.log('DRY RUN — would register:');
        todo.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.id.slice(0, 8)})`));
        return;
    }

    if (todo.length === 0) {
        console.log('Nothing to do — all services registered!');
        return;
    }

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const batch = todo.slice(i, i + BATCH_SIZE);

        for (let j = 0; j < batch.length; j++) {
            const svc = batch[j];
            const idx = i + j + 1;

            const result = await registerAgent(svc.id, svc.name, svc.url, svc.description || '');

            if (result && result.agentId != null) {
                await supabase.from('services').update({
                    erc8004_agent_id: result.agentId,
                    erc8004_registered_at: new Date().toISOString(),
                }).eq('id', svc.id);

                progress[svc.id] = { agentId: result.agentId, txHash: result.txHash };
                console.log(`[${idx}/${todo.length}] ✅ ${svc.name} → agentId=${result.agentId}`);
                succeeded++;
            } else {
                progress[svc.id] = { error: 'registration failed' };
                console.error(`[${idx}/${todo.length}] ❌ ${svc.name} → FAILED`);
                failed++;
            }

            // Save progress after each service
            fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        }

        if (i + BATCH_SIZE < todo.length) {
            console.log(`  Batch done, waiting ${BATCH_DELAY}ms...`);
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    console.log(`\nDone! ${succeeded} registered, ${failed} failed out of ${todo.length}.`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
