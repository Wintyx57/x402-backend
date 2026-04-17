-- Migration 029 — Atomic increment for free_usage
--
-- Context: the Node.js code did a SELECT then an UPDATE/UPSERT, which left a
-- TOCTOU window. Concurrent requests with the same IP could all pass the
-- limit check with count=4 and each increment locally → the user effectively
-- gets 2×, 3×, 10× the daily free quota.
--
-- Fix: expose an atomic INSERT ... ON CONFLICT DO UPDATE via an RPC so the DB
-- is the only source of truth. The function returns the NEW count after the
-- increment; the caller decides whether to deny based on the limit.
--
-- Apply via Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.increment_free_usage(
    p_ip_hash TEXT,
    p_usage_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO free_usage (ip_hash, usage_date, count)
    VALUES (p_ip_hash, p_usage_date, 1)
    ON CONFLICT (ip_hash, usage_date)
    DO UPDATE SET count = free_usage.count + 1
    RETURNING count INTO v_count;

    RETURN v_count;
END;
$$;

-- Allow only service_role (backend) to call this. The anon key must not be
-- able to inflate counts.
REVOKE ALL ON FUNCTION public.increment_free_usage(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_free_usage(TEXT, DATE) TO service_role;
