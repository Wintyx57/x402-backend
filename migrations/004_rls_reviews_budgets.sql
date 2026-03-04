-- Migration 004 — RLS on reviews + budgets + drop exec_sql
-- Applied: 2026-03-04 via Supabase SQL Editor
--
-- Context: Supabase Security Advisor flagged "1 error" — reviews table without RLS.
-- Also secured budgets table and dropped dangerous exec_sql function.

-- ============================================================
-- 1. REVIEWS TABLE
-- ============================================================

DROP POLICY IF EXISTS "public_select_reviews" ON reviews;
DROP POLICY IF EXISTS "service_role_write_reviews" ON reviews;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select_reviews"
  ON reviews FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "service_role_write_reviews"
  ON reviews FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. BUDGETS TABLE (if exists)
-- ============================================================

DO $$ BEGIN
  ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_budgets" ON budgets;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_budgets"
    ON budgets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================
-- 3. DROP DANGEROUS FUNCTION
-- ============================================================

DROP FUNCTION IF EXISTS exec_sql(text);
