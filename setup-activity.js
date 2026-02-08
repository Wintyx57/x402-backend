require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function setup() {
    console.log('Creating activity table in Supabase...\n');

    // Try to insert a test row — if table exists, it works
    const { error: testError } = await supabase
        .from('activity')
        .select('id')
        .limit(1);

    if (!testError) {
        console.log('Table "activity" already exists. Done.');
        return;
    }

    console.log('Table does not exist yet. Please create it manually in Supabase SQL Editor:');
    console.log('Go to: https://supabase.com/dashboard → your project → SQL Editor\n');
    console.log('Run this SQL:\n');
    console.log(`
CREATE TABLE activity (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL,
    detail TEXT NOT NULL,
    amount NUMERIC DEFAULT 0,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast dashboard queries
CREATE INDEX idx_activity_created_at ON activity (created_at DESC);

-- Enable RLS
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Allow public read (for dashboard)
CREATE POLICY "Allow public read" ON activity FOR SELECT USING (true);

-- Allow service role insert
CREATE POLICY "Allow service insert" ON activity FOR INSERT WITH CHECK (true);
    `);
}

setup().catch(console.error);
