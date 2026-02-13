// Run migration to add verified_status and verified_at columns
// Usage: node migrations/run-migration.js
// This script uses Supabase's PostgREST to test if columns exist,
// and provides the SQL to run in the Supabase Dashboard if they don't.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkColumns() {
    // Try to select the columns - if they exist, no migration needed
    const { data, error } = await supabase
        .from('services')
        .select('verified_status, verified_at')
        .limit(1);

    if (error && error.code === '42703') {
        console.log('\n⚠️  Columns verified_status and verified_at do NOT exist yet.\n');
        console.log('Please run this SQL in your Supabase Dashboard (SQL Editor):\n');
        console.log(`
ALTER TABLE services
ADD COLUMN IF NOT EXISTS verified_status TEXT DEFAULT NULL;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN services.verified_status IS 'Auto-test result: reachable, unreachable, error, or null';
COMMENT ON COLUMN services.verified_at IS 'Timestamp of the last auto-test';

CREATE INDEX IF NOT EXISTS idx_services_verified_status ON services (verified_status);
        `.trim());
        console.log('\nDashboard URL: https://supabase.com/dashboard/project/kucrowtjsgusdxnjglug/sql/new\n');
        process.exit(1);
    } else if (error) {
        console.error('Unexpected error:', error);
        process.exit(1);
    } else {
        console.log('✅ Columns verified_status and verified_at already exist!');
        console.log('Sample row:', data[0]);
    }
}

checkColumns();
