-- Migration 017: Add unique index on services.url to prevent duplicate registrations
-- This enforces uniqueness at the DB level and prevents race conditions

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_url_unique ON services(url);
