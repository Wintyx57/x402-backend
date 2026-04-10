-- Migration 026: Webhook URL for service providers
-- Allows providers to receive real-time payment notifications via HTTP POST

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT NULL;

COMMENT ON COLUMN services.webhook_url IS 'HTTPS webhook URL to notify provider on each payment (HMAC-SHA256 signed)';
