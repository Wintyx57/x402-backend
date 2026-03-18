-- 020_refund_retry_count.sql — Add retry_count column to refunds table
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
