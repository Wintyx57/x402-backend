-- Migration 008: Add required_parameters JSONB column to services table
-- Stores inputSchema for external services (internal wrappers use discoveryMap)
ALTER TABLE services ADD COLUMN IF NOT EXISTS required_parameters JSONB DEFAULT NULL;
