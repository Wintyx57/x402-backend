-- Migration 014: API Keys (no-wallet payment flow)
-- Allows developers to use x402 Bazaar services without a crypto wallet.
-- They prepay USDC, get an API key, and use X-API-Key header for calls.

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,               -- SHA-256 hash of the raw key (never store plain)
  key_prefix TEXT NOT NULL,                    -- First 12 chars for display: 'sk_live_xxxx'
  owner_email TEXT NOT NULL,                   -- Owner's email (for multi-key listing)
  label TEXT DEFAULT '',                       -- Human-readable label (e.g. "Production")
  balance_usdc NUMERIC(20, 6) DEFAULT 0,       -- Remaining prepaid balance
  total_spent NUMERIC(20, 6) DEFAULT 0,        -- Cumulative amount spent
  call_count INTEGER DEFAULT 0,               -- Total number of API calls made
  active BOOLEAN DEFAULT true,                 -- Soft-delete flag
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE        -- NULL if never used
);

-- Fast lookups by hash (used on every API call)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Fast listing by email (used on GET /api/keys)
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(owner_email);

-- Partial index: only active keys (most queries filter by active=true)
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(key_hash) WHERE active = true;

-- Track this migration
INSERT INTO migrations_applied (migration_name, applied_at)
VALUES ('014_api_keys', NOW())
ON CONFLICT (migration_name) DO NOTHING;
