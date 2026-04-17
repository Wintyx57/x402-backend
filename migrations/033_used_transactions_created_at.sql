-- Migration 033 — Add created_at + retention index on used_transactions
--
-- Context: lib/retention.js now purges used_transactions older than
-- USED_TRANSACTIONS_RETENTION_DAYS (180). It needs a created_at column to
-- do so, plus an index that makes the DELETE fast.
--
-- Apply via Supabase SQL Editor.

ALTER TABLE used_transactions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_used_transactions_created_at
    ON used_transactions (created_at DESC);
