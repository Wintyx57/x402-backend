-- Migration 025: Free tier usage tracking
-- Tracks daily API call count per hashed IP for free tier (5 calls/day)

CREATE TABLE IF NOT EXISTS free_usage (
    ip_hash TEXT NOT NULL,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ip_hash, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_free_usage_date ON free_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_free_usage_ip_date ON free_usage(ip_hash, usage_date);

COMMENT ON TABLE free_usage IS 'Daily free tier API call tracking per hashed IP';
COMMENT ON COLUMN free_usage.ip_hash IS 'SHA-256 hash of IP address (GDPR compliant)';
COMMENT ON COLUMN free_usage.count IS 'Number of free tier calls today';
