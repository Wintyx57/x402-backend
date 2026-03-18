-- 019_refunds_table.sql — Auto-refund tracking table
-- Stores every refund attempt (completed or skipped) for audit and anti-abuse.

CREATE TABLE IF NOT EXISTS refunds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    original_tx_hash TEXT NOT NULL,
    chain TEXT NOT NULL,
    service_id UUID,
    service_name TEXT,
    amount_usdc NUMERIC(10,6) NOT NULL,
    agent_wallet TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    refund_tx_hash TEXT,
    refund_wallet TEXT,
    reason TEXT NOT NULL,
    failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_refunds_agent_wallet ON refunds (agent_wallet);
CREATE INDEX IF NOT EXISTS idx_refunds_service_id ON refunds (service_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_chain_status ON refunds (chain, status);
