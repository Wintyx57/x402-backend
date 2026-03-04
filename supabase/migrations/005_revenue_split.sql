-- Migration 005: Revenue split infrastructure (95/5)
-- Date: 2026-03-04
-- Table pour tracker les paiements dus aux providers

CREATE TABLE IF NOT EXISTS pending_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service_name TEXT NOT NULL,
    provider_wallet TEXT NOT NULL,
    gross_amount NUMERIC(20, 6) NOT NULL,
    provider_amount NUMERIC(20, 6) NOT NULL,
    platform_fee NUMERIC(20, 6) NOT NULL,
    tx_hash_in TEXT NOT NULL,
    tx_hash_out TEXT,
    chain TEXT DEFAULT 'base',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
    created_at TIMESTAMPTZ DEFAULT now(),
    paid_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pending_payouts_status ON pending_payouts(status);
CREATE INDEX IF NOT EXISTS idx_pending_payouts_provider ON pending_payouts(provider_wallet);
CREATE INDEX IF NOT EXISTS idx_pending_payouts_created ON pending_payouts(created_at DESC);

-- RLS (admin only via service_role key)
-- No policy defined: RLS enabled + no policy = deny all anon, allow all service_role
ALTER TABLE pending_payouts ENABLE ROW LEVEL SECURITY;
