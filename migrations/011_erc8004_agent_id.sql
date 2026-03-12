-- Migration 011: Add ERC-8004 agent identity to services table
-- Each service can optionally be registered as an on-chain agent (NFT) on SKALE on Base

ALTER TABLE services ADD COLUMN IF NOT EXISTS erc8004_agent_id BIGINT DEFAULT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS erc8004_registered_at TIMESTAMPTZ DEFAULT NULL;

-- Unique index: one service = one agent ID (prevents duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_erc8004_agent_id
  ON services (erc8004_agent_id) WHERE erc8004_agent_id IS NOT NULL;
