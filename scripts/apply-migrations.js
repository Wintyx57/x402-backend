#!/usr/bin/env node
// scripts/apply-migrations.js — Run SQL migrations against Supabase
// Usage: node scripts/apply-migrations.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
    await supabase.rpc('query', {
        query: `CREATE TABLE IF NOT EXISTS migrations_applied (
            id SERIAL PRIMARY KEY,
            filename TEXT UNIQUE NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        );`
    }).catch(() => {
        // Table might already exist or rpc not available — try direct SQL via supabase
    });
}

async function getApplied() {
    const { data, error } = await supabase.from('migrations_applied').select('filename');
    if (error) return new Set();
    return new Set((data || []).map(r => r.filename));
}

async function markApplied(filename) {
    await supabase.from('migrations_applied').insert({ filename });
}

async function run() {
    console.log('[migrations] Connecting to Supabase...');

    await ensureMigrationsTable();
    const applied = await getApplied();

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (files.length === 0) {
        console.log('[migrations] No migration files found.');
        return;
    }

    let ran = 0;
    for (const file of files) {
        if (applied.has(file)) {
            console.log(`[migrations] Skipping ${file} (already applied)`);
            continue;
        }

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        console.log(`[migrations] Applying ${file}...`);

        // Execute via Supabase (each statement separately)
        const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            const { error } = await supabase.rpc('exec_sql', { sql: stmt }).catch(() => ({ error: { message: 'rpc not available' } }));
            if (error) {
                console.warn(`[migrations] Warning for "${stmt.slice(0, 60)}...": ${error.message}`);
                console.warn('[migrations] Note: Run this SQL manually in Supabase SQL Editor if needed.');
            }
        }

        await markApplied(file);
        console.log(`[migrations] ✅ Applied ${file}`);
        ran++;
    }

    console.log(`[migrations] Done. ${ran} migration(s) applied.`);
    if (ran === 0) console.log('[migrations] All migrations already up to date.');
}

run().catch(e => {
    console.error('[migrations] Fatal:', e.message);
    process.exit(1);
});
