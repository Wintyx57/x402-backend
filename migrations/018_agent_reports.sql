-- Migration 018: Live AI Agent reports table
CREATE TABLE IF NOT EXISTS agent_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'success',  -- success, partial, failed

    -- NASA APOD
    nasa_title TEXT,
    nasa_explanation TEXT,
    nasa_date TEXT,
    nasa_url TEXT,
    nasa_hdurl TEXT,
    nasa_media_type TEXT,
    nasa_tx_hash TEXT,
    nasa_cost NUMERIC(10,6),
    nasa_latency_ms INTEGER,
    nasa_error TEXT,

    -- ISS Tracker
    iss_latitude NUMERIC(10,6),
    iss_longitude NUMERIC(10,6),
    iss_crew_count INTEGER,
    iss_crew_members JSONB,
    iss_tx_hash TEXT,
    iss_cost NUMERIC(10,6),
    iss_latency_ms INTEGER,
    iss_error TEXT,

    -- SpaceX
    spacex_name TEXT,
    spacex_date_utc TIMESTAMPTZ,
    spacex_flight_number INTEGER,
    spacex_details TEXT,
    spacex_rocket TEXT,
    spacex_links JSONB,
    spacex_tx_hash TEXT,
    spacex_cost NUMERIC(10,6),
    spacex_latency_ms INTEGER,
    spacex_error TEXT,

    -- Meta
    total_cost NUMERIC(10,6),
    agent_wallet TEXT,
    chain TEXT DEFAULT 'skale'
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_run_at ON agent_reports (run_at DESC);
