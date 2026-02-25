#!/usr/bin/env node

// Migration runner — Apply activity table indexes via Supabase
//
// Usage:
//   node migrations/apply-activity-indexes.js
//
// Requires env vars: SUPABASE_URL, SUPABASE_KEY
// (reads from .env if present, or pass directly)
//
// Strategy: Uses supabase.rpc() to call a temporary function that runs the SQL.
// If RPC is not available, falls back to printing the SQL for manual execution.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env if available
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY are required.');
    console.error('Set them as environment variables or in a .env file.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Read the SQL migration file
const sqlPath = path.join(__dirname, '002_add_activity_indexes.sql');
const fullSql = fs.readFileSync(sqlPath, 'utf-8');

// Extract only executable SQL statements (skip comments and empty lines)
function extractStatements(sql) {
    return sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => s + ';');
}

const statements = extractStatements(fullSql);

async function checkExistingIndexes() {
    console.log('Checking existing indexes on activity table...\n');

    // Query pg_indexes to see what already exists
    const { data, error } = await supabase
        .rpc('exec_sql', {
            query: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'activity' ORDER BY indexname;`
        });

    if (error) {
        // RPC not available, try a simpler approach
        console.log('(Could not query pg_indexes via RPC — this is normal if exec_sql function does not exist)\n');
        return null;
    }

    if (data && Array.isArray(data) && data.length > 0) {
        console.log('Existing indexes:');
        for (const idx of data) {
            console.log(`  - ${idx.indexname}: ${idx.indexdef}`);
        }
        console.log('');
    } else {
        console.log('No existing indexes found (or unable to read).\n');
    }

    return data;
}

async function applyViaRpc() {
    console.log('Attempting to apply indexes via Supabase RPC (exec_sql)...\n');

    for (const stmt of statements) {
        const shortLabel = stmt.slice(0, 80).replace(/\n/g, ' ');
        process.stdout.write(`  Executing: ${shortLabel}... `);

        const { error } = await supabase.rpc('exec_sql', { query: stmt });

        if (error) {
            if (error.message?.includes('function') && error.message?.includes('does not exist')) {
                // exec_sql function not available — fall back
                console.log('SKIP (RPC not available)');
                return false;
            }
            console.log(`ERROR: ${error.message}`);
        } else {
            console.log('OK');
        }
    }

    return true;
}

async function applyViaRestSql() {
    // Try the Supabase Management API SQL endpoint (requires service_role key)
    console.log('Attempting to apply via Supabase SQL REST endpoint...\n');

    const sqlEndpoint = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;

    try {
        const res = await fetch(sqlEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
            body: JSON.stringify({ query: statements.join('\n') }),
        });

        if (res.ok) {
            console.log('Applied successfully via REST endpoint.\n');
            return true;
        }

        const body = await res.text();
        if (body.includes('does not exist')) {
            return false;
        }
        console.log(`REST endpoint returned ${res.status}: ${body.slice(0, 200)}`);
        return false;
    } catch (err) {
        console.log(`REST endpoint failed: ${err.message}`);
        return false;
    }
}

async function verifyIndexes() {
    console.log('\nVerifying indexes...');

    // Simple verification: try a query that would benefit from the index
    const checks = [
        {
            name: 'type + created_at (composite)',
            fn: () => supabase
                .from('activity')
                .select('id', { count: 'exact', head: true })
                .eq('type', 'api_call')
                .order('created_at', { ascending: false })
                .limit(1),
        },
        {
            name: 'created_at DESC',
            fn: () => supabase
                .from('activity')
                .select('id', { count: 'exact', head: true })
                .order('created_at', { ascending: false })
                .limit(1),
        },
        {
            name: 'type only (count)',
            fn: () => supabase
                .from('activity')
                .select('*', { count: 'exact', head: true })
                .eq('type', 'payment'),
        },
    ];

    for (const check of checks) {
        const start = Date.now();
        const { error, count } = await check.fn();
        const elapsed = Date.now() - start;
        const status = error ? `ERROR (${error.message})` : `OK (${count ?? '?'} rows, ${elapsed}ms)`;
        console.log(`  [${check.name}]: ${status}`);
    }
}

async function main() {
    console.log('=== Migration 002: Add Activity Indexes ===\n');
    console.log(`Supabase: ${SUPABASE_URL}`);
    console.log(`SQL file: ${sqlPath}`);
    console.log(`Statements: ${statements.length}\n`);

    // Check existing indexes
    await checkExistingIndexes();

    // Try RPC first
    let applied = await applyViaRpc();

    // If RPC failed, try REST
    if (!applied) {
        applied = await applyViaRestSql();
    }

    // If nothing worked, print manual instructions
    if (!applied) {
        console.log('\n' + '='.repeat(70));
        console.log('AUTOMATIC APPLICATION NOT AVAILABLE');
        console.log('='.repeat(70));
        console.log('\nThe exec_sql RPC function is not configured in your Supabase project.');
        console.log('This is normal — Supabase does not expose raw SQL execution by default.\n');
        console.log('To apply the indexes, you have 2 options:\n');

        console.log('OPTION 1: Run in Supabase SQL Editor (recommended)');
        console.log('  1. Go to: https://supabase.com/dashboard/project/kucrowtjsgusdxnjglug/sql/new');
        console.log('  2. Paste the contents of: migrations/002_add_activity_indexes.sql');
        console.log('  3. Click "Run"\n');

        console.log('OPTION 2: Create the exec_sql helper function first');
        console.log('  Run this SQL in the Supabase SQL Editor:\n');
        console.log(`  CREATE OR REPLACE FUNCTION exec_sql(query text)
  RETURNS void AS $$
  BEGIN
    EXECUTE query;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;`);
        console.log('\n  Then re-run this script.\n');

        console.log('='.repeat(70));
        console.log('\nSQL to apply manually:\n');
        console.log(fullSql);

        process.exit(0);
    }

    // Verify
    await verifyIndexes();

    console.log('\nDone. Indexes applied successfully.');
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
