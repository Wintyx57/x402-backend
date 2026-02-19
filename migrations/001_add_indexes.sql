-- Migration 001 — Add missing indexes for performance
-- Run via: node scripts/apply-migrations.js

CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_used_transactions_tx_hash ON used_transactions(tx_hash);
