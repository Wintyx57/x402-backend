-- Migration 009: Add live status columns to services table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- These columns store the live health status from daily-tester + monitor

ALTER TABLE services
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'unknown';

ALTER TABLE services
ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN services.status IS 'Live status from daily-tester/monitor: online, offline, degraded, unknown';
COMMENT ON COLUMN services.last_checked_at IS 'Timestamp of the last health check (monitor every 5min, daily-tester every 24h)';

-- Index for filtering by status (e.g. show only online services)
CREATE INDEX IF NOT EXISTS idx_services_status ON services (status);
