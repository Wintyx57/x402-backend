-- Migration 007: Daily E2E API Testing Agent — results table
-- Auto-tested via daily-tester.js: real USDC payments on SKALE, full response validation

CREATE TABLE IF NOT EXISTS daily_checks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id UUID NOT NULL,
    endpoint TEXT NOT NULL,
    label TEXT NOT NULL,
    api_type TEXT NOT NULL DEFAULT 'internal',
    chain TEXT NOT NULL DEFAULT 'skale',

    -- Payment phase
    payment_status TEXT NOT NULL,
    payment_tx_hash TEXT,
    payment_amount_usdc NUMERIC(10,6),
    payment_latency_ms INTEGER,
    payment_error TEXT,

    -- API call phase
    call_status TEXT NOT NULL,
    http_status INTEGER,
    call_latency_ms INTEGER,
    call_error TEXT,

    -- Validation phase
    response_valid BOOLEAN,
    response_has_json BOOLEAN,
    response_fields_present TEXT[],
    response_fields_missing TEXT[],
    validation_notes TEXT,

    -- Overall
    overall_status TEXT NOT NULL,
    checked_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_daily_run_endpoint UNIQUE (run_id, endpoint)
);

CREATE INDEX idx_daily_checks_run ON daily_checks(run_id);
CREATE INDEX idx_daily_checks_checked ON daily_checks(checked_at);
CREATE INDEX idx_daily_checks_status ON daily_checks(overall_status);

-- RLS
ALTER TABLE daily_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on daily_checks"
    ON daily_checks FOR ALL
    USING (true)
    WITH CHECK (true);
