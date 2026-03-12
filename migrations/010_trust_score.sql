-- Migration 010: Add Proof of Quality trust score to services table
-- The trust_score is computed asynchronously by the backend and updated periodically.
-- Only the final score (0-100) is public. The algorithm and weights remain private.

ALTER TABLE services
ADD COLUMN IF NOT EXISTS trust_score NUMERIC(5,2) DEFAULT NULL;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS trust_score_updated_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_services_trust_score ON services (trust_score DESC NULLS LAST);
