-- Migration 033 — Quarantine all services that failed the x402 sniffer (verified_status='no_x402')
-- and never went online. These pollute the catalog and break agent demos when listed.
--
-- Idempotent: only updates services that aren't already quarantined.
-- Apply via Supabase SQL Editor.
--
-- Rollback: see migration 028 + admin endpoint POST /api/admin/unquarantine/:id

UPDATE services
SET status = 'quarantined'
WHERE verified_status = 'no_x402'
  AND (status IS NULL OR status NOT IN ('quarantined', 'online'));

-- Report on what was changed (read-only verification — no rows affected by this).
SELECT
  COUNT(*) FILTER (WHERE status = 'quarantined' AND verified_status = 'no_x402') AS quarantined_no_x402,
  COUNT(*) FILTER (WHERE status = 'online') AS online,
  COUNT(*) FILTER (WHERE verified_status IS NULL) AS never_verified
FROM services;
