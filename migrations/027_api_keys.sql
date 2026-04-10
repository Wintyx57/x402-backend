-- Migration 027: API Keys + Prepaid Credits
-- Enables providers and consumers to authenticate without on-chain payments
-- by pre-funding a credit balance using USDC.

CREATE TABLE IF NOT EXISTS api_keys (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash          TEXT NOT NULL UNIQUE,          -- SHA-256 hex of plaintext key (never stored)
    key_prefix        TEXT NOT NULL,                 -- First 12 chars for user display
    name              TEXT NOT NULL,                 -- Human-readable label (e.g. "my-agent")
    owner_wallet      TEXT NOT NULL,                 -- EVM address of owner (lowercase)
    credits_usdc      NUMERIC(18, 6) NOT NULL DEFAULT 0,   -- Prepaid USDC balance
    daily_limit_usdc  NUMERIC(18, 6) DEFAULT NULL,   -- Optional per-day spending cap
    daily_spent_usdc  NUMERIC(18, 6) NOT NULL DEFAULT 0,   -- Spent today
    daily_reset_at    TIMESTAMPTZ DEFAULT NOW(),     -- When daily_spent was last reset
    last_used_at      TIMESTAMPTZ DEFAULT NULL,      -- Last successful API call
    is_active         BOOLEAN NOT NULL DEFAULT TRUE, -- Soft-delete flag
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by hash (primary validation path)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE is_active = TRUE;

-- List keys by owner wallet
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_wallet, is_active);

COMMENT ON TABLE api_keys IS 'API keys with prepaid USDC credit balances for agent access without per-call payments';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 of plaintext key — never store the plaintext key itself';
COMMENT ON COLUMN api_keys.credits_usdc IS 'Current prepaid credit balance in USDC (6 decimal precision)';
COMMENT ON COLUMN api_keys.daily_limit_usdc IS 'Optional daily spending cap; NULL = unlimited';
COMMENT ON COLUMN api_keys.daily_reset_at IS 'Timestamp when daily_spent_usdc was last zeroed';
