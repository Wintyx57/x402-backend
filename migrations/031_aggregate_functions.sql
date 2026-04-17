-- Migration 031 — Server-side aggregates for stats endpoints
--
-- Context: dashboard.js and payouts.js compute sums over thousands of rows
-- client-side by pulling every activity / pending_payout record and reducing
-- in JS. That's O(N) network + O(N) memory on every request. Expose a small
-- set of RPCs so the DB does the work.
--
-- Apply via Supabase SQL Editor.

-- Payments stats for the dashboard: count and sum over a window.
CREATE OR REPLACE FUNCTION public.activity_payment_stats(
    p_since TIMESTAMPTZ
)
RETURNS TABLE(total_count BIGINT, total_amount NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COUNT(*)::BIGINT AS total_count,
        COALESCE(SUM(amount), 0)::NUMERIC AS total_amount
    FROM activity
    WHERE type = 'payment'
      AND created_at >= p_since;
$$;

REVOKE ALL ON FUNCTION public.activity_payment_stats(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activity_payment_stats(TIMESTAMPTZ) TO service_role;

-- Revenue overview: aggregate payouts by wallet/status without pulling rows.
CREATE OR REPLACE FUNCTION public.payouts_revenue_overview()
RETURNS TABLE(total_providers BIGINT, total_pending NUMERIC, total_paid NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COUNT(DISTINCT provider_wallet)::BIGINT AS total_providers,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN provider_amount ELSE 0 END), 0)::NUMERIC AS total_pending,
        COALESCE(SUM(CASE WHEN status = 'paid'    THEN provider_amount ELSE 0 END), 0)::NUMERIC AS total_paid
    FROM pending_payouts;
$$;

REVOKE ALL ON FUNCTION public.payouts_revenue_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payouts_revenue_overview() TO service_role;
