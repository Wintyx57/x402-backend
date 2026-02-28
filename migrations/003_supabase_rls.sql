-- Migration 003 — Supabase Row Level Security (RLS)
--
-- Context: activity, budgets, monitoring_checks tables are exposed via
-- Supabase's auto-generated REST API. Without RLS, any request with the
-- anon key can read/write all rows. This migration locks down access so
-- only the service role (backend) can write, and public reads are blocked.
--
-- Apply manually via Supabase SQL Editor:
-- https://supabase.com/dashboard/project/kucrowtjsgusdxnjglug/sql

-- ============================================================
-- 1. ACTIVITY TABLE
-- ============================================================

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Only service role can insert activity
CREATE POLICY "service_role_insert_activity"
  ON activity FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only service role can select activity
CREATE POLICY "service_role_select_activity"
  ON activity FOR SELECT
  TO service_role
  USING (true);

-- Only service role can delete activity (retention cleanup)
CREATE POLICY "service_role_delete_activity"
  ON activity FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- 2. BUDGETS TABLE
-- ============================================================

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

-- Only service role can manage budgets
CREATE POLICY "service_role_all_budgets"
  ON budgets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. MONITORING_CHECKS TABLE
-- ============================================================

ALTER TABLE monitoring_checks ENABLE ROW LEVEL SECURITY;

-- Only service role can insert monitoring checks
CREATE POLICY "service_role_insert_monitoring"
  ON monitoring_checks FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Public can read monitoring status (used by /api/status endpoints)
CREATE POLICY "public_select_monitoring"
  ON monitoring_checks FOR SELECT
  TO anon
  USING (true);

-- Service role can also read
CREATE POLICY "service_role_select_monitoring"
  ON monitoring_checks FOR SELECT
  TO service_role
  USING (true);

-- ============================================================
-- 4. SERVICES TABLE (already public read, lock writes)
-- ============================================================

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Public can read services (marketplace listing)
CREATE POLICY "public_select_services"
  ON services FOR SELECT
  TO anon
  USING (true);

-- Only service role can insert/update/delete services
CREATE POLICY "service_role_write_services"
  ON services FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. USED_TRANSACTIONS TABLE (anti-replay)
-- ============================================================

ALTER TABLE used_transactions ENABLE ROW LEVEL SECURITY;

-- Only service role can manage anti-replay cache
CREATE POLICY "service_role_all_used_transactions"
  ON used_transactions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
