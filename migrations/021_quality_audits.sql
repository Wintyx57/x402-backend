-- Migration 021: AI Quality Audit table
-- Stores results from the AI Quality Agent (Gemini-based semantic evaluation)

CREATE TABLE IF NOT EXISTS quality_audits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id UUID NOT NULL,
    service_id UUID NOT NULL,
    service_name TEXT NOT NULL,
    service_url TEXT,
    chain TEXT DEFAULT 'skale',
    payment_tx_hash TEXT,
    payment_amount_usdc NUMERIC(10,6),
    http_status INTEGER,
    response_latency_ms INTEGER,
    test_params JSONB,
    overall_score INTEGER,
    semantic_correctness INTEGER,
    data_freshness INTEGER,
    locale_accuracy INTEGER,
    content_quality INTEGER,
    schema_compliance INTEGER,
    severity TEXT,
    issues JSONB DEFAULT '[]'::jsonb,
    gemini_summary TEXT,
    gemini_raw JSONB,
    checked_at TIMESTAMPTZ DEFAULT NOW(),
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_audits_run_id ON quality_audits (run_id);
CREATE INDEX IF NOT EXISTS idx_quality_audits_service_id ON quality_audits (service_id);
CREATE INDEX IF NOT EXISTS idx_quality_audits_checked_at ON quality_audits (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_audits_severity ON quality_audits (severity);
