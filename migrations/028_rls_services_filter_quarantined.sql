-- Migration 028 — Tighten public_select_services RLS to exclude quarantined and pending_validation
--
-- Context: Migration 003 created the policy `public_select_services` with
-- USING (true), so any request with the anon key (available in the frontend
-- source) could list services in state `quarantined` or `pending_validation`
-- by bypassing the backend filter. We filter at the policy level so the DB
-- itself enforces it, even if a future caller forgets the .neq() in the
-- Node.js query.
--
-- Apply via Supabase SQL Editor.

DROP POLICY IF EXISTS "public_select_services" ON services;

CREATE POLICY "public_select_services"
  ON services FOR SELECT
  TO anon
  USING (
    status IS DISTINCT FROM 'quarantined'
    AND status IS DISTINCT FROM 'pending_validation'
  );

-- Keep service_role full access (unchanged from migration 003).
