-- Migration 013 — Free Tiers per API
-- Adds free_calls_per_month to services and creates the free_usage counter table.

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS free_calls_per_month INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS free_usage (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    calls_used   INTEGER NOT NULL DEFAULT 0,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('month', NOW()),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (service_id, user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_free_usage_lookup
    ON free_usage (service_id, user_id, period_start);
