-- Migration 023: Encrypted credentials for provider API authentication
ALTER TABLE services ADD COLUMN IF NOT EXISTS encrypted_credentials TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS credential_type TEXT;
-- credential_type values: 'none', 'header', 'bearer', 'basic', 'query'
