-- Migration: Add verified_status and verified_at columns to services table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- These columns support the auto-test on registration feature

ALTER TABLE services
ADD COLUMN IF NOT EXISTS verified_status TEXT DEFAULT NULL;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL;

-- Add a comment for documentation
COMMENT ON COLUMN services.verified_status IS 'Auto-test result: reachable, unreachable, error, or null (not tested)';
COMMENT ON COLUMN services.verified_at IS 'Timestamp of the last auto-test';

-- Optional: Create an index for filtering verified services
CREATE INDEX IF NOT EXISTS idx_services_verified_status ON services (verified_status);
