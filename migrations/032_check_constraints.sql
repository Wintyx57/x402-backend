-- Migration 032 — CHECK constraints on enum-like columns
--
-- Context: `services.status`, `services.verified_status`, `refunds.status`,
-- and `pending_payouts.chain` all store a known set of string values but
-- have no DB-level enforcement. A typo in the code (or a partial deploy of
-- a new status) can silently insert an invalid value that no query filter
-- will match. CHECK constraints make the DB reject the bad value up front.
--
-- All constraints are added IF NOT EXISTS-guarded so the migration is idempotent.
-- Apply via Supabase SQL Editor.

DO $$
BEGIN
  -- services.status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_services_status_enum'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT chk_services_status_enum
      CHECK (
        status IS NULL
        OR status IN (
          'pending_validation','quarantined','unknown',
          'online','offline','degraded','deprecated'
        )
      )
      NOT VALID;  -- don't re-validate existing rows here; backfill separately if needed
  END IF;

  -- services.verified_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_services_verified_status_enum'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT chk_services_verified_status_enum
      CHECK (
        verified_status IS NULL
        OR verified_status IN (
          'reachable','unreachable','error','bare_402',
          'mainnet_verified','testnet','wrong_chain','no_x402',
          'offline','potential_wrapper','manual_quarantine',
          'malicious_content','terms_violation','scam_reported',
          'security_review'
        )
      )
      NOT VALID;
  END IF;

  -- refunds.status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_refunds_status_enum'
  ) THEN
    ALTER TABLE refunds
      ADD CONSTRAINT chk_refunds_status_enum
      CHECK (
        status IS NULL
        OR status IN ('pending','completed','skipped','failed')
      )
      NOT VALID;
  END IF;

  -- pending_payouts.chain
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_pending_payouts_chain_enum'
  ) THEN
    ALTER TABLE pending_payouts
      ADD CONSTRAINT chk_pending_payouts_chain_enum
      CHECK (
        chain IS NULL
        OR chain IN ('base','base-sepolia','skale','polygon')
      )
      NOT VALID;
  END IF;

  -- pending_payouts.status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_pending_payouts_status_enum'
  ) THEN
    ALTER TABLE pending_payouts
      ADD CONSTRAINT chk_pending_payouts_status_enum
      CHECK (
        status IS NULL
        OR status IN ('pending','processing','paid','failed','cancelled')
      )
      NOT VALID;
  END IF;
END $$;

-- Non-negative counters (payment_links.views, payment_links.paid_count).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_links')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_payment_links_views_nonneg'
     )
  THEN
    ALTER TABLE payment_links
      ADD CONSTRAINT chk_payment_links_views_nonneg
      CHECK (views IS NULL OR views >= 0)
      NOT VALID;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_links')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_payment_links_paid_nonneg'
     )
  THEN
    ALTER TABLE payment_links
      ADD CONSTRAINT chk_payment_links_paid_nonneg
      CHECK (paid_count IS NULL OR paid_count >= 0)
      NOT VALID;
  END IF;
END $$;

-- services.price_usdc must not be negative (a zero price is valid = free).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_services_price_nonneg'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT chk_services_price_nonneg
      CHECK (price_usdc IS NULL OR price_usdc >= 0)
      NOT VALID;
  END IF;
END $$;

-- After reviewing existing rows, run:
--   ALTER TABLE services VALIDATE CONSTRAINT chk_services_status_enum;
--   (etc. for each constraint)
-- to enforce them on legacy data. Deferred here to avoid blocking deploy if
-- the DB currently contains one-off values from pre-constraint inserts.
