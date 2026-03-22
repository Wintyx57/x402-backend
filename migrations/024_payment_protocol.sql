-- Migration 024: Universal 402 Protocol Adapter
-- Adds payment_protocol column to services table
-- Creates discovered_apis table for auto-discovery (Layer 4)

ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_protocol TEXT DEFAULT NULL;

COMMENT ON COLUMN services.payment_protocol IS
  'Detected 402 protocol format: x402-bazaar, x402-v1, x402-v2, mpp, l402, flat, etc. NULL = x402-bazaar default.';

CREATE TABLE IF NOT EXISTS discovered_apis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  format TEXT NOT NULL,
  amount TEXT,
  currency TEXT,
  recipient TEXT,
  chain TEXT,
  discovered_at TIMESTAMPTZ DEFAULT now(),
  agent_address TEXT,
  raw_response JSONB,
  status TEXT DEFAULT 'pending_review'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_apis_url ON discovered_apis(url);
CREATE INDEX IF NOT EXISTS idx_discovered_apis_format ON discovered_apis(format);
