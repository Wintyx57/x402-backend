-- Migration 006: Support for native on-chain split payment (95/5)
-- Adds tx_hash_platform and split_mode columns to pending_payouts

ALTER TABLE pending_payouts
    ADD COLUMN IF NOT EXISTS tx_hash_platform TEXT,
    ADD COLUMN IF NOT EXISTS split_mode TEXT DEFAULT 'legacy'
        CHECK (split_mode IN ('legacy', 'split_complete', 'provider_only'));

-- Indexes for lookups by split mode and platform tx hash
CREATE INDEX IF NOT EXISTS idx_pending_payouts_split_mode
    ON pending_payouts (split_mode);

CREATE INDEX IF NOT EXISTS idx_pending_payouts_tx_platform
    ON pending_payouts (tx_hash_platform)
    WHERE tx_hash_platform IS NOT NULL;

-- Backfill existing rows as legacy
UPDATE pending_payouts
    SET split_mode = 'legacy'
    WHERE split_mode IS NULL;

-- Register migration
INSERT INTO migrations_applied (name, applied_at)
    VALUES ('006_split_payments', NOW())
    ON CONFLICT (name) DO NOTHING;
