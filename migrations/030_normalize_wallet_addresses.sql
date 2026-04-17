-- Migration 030 — Normalize wallet addresses to lowercase + indexes
--
-- Context: `owner_address` (services) and `provider_wallet` (pending_payouts)
-- are stored in mixed case. All lookups use `.ilike()` which forces a sequential
-- scan on every call — 5 hot paths affected (`routes/provider.js`, `lib/payouts.js`,
-- `routes/register.js`). Normalizing to lowercase lets us switch to `.eq()` with
-- a plain B-tree index.
--
-- This migration is idempotent. Apply via Supabase SQL Editor.

-- 1. Backfill existing rows to lowercase.
UPDATE services
   SET owner_address = LOWER(owner_address)
 WHERE owner_address IS NOT NULL
   AND owner_address <> LOWER(owner_address);

UPDATE pending_payouts
   SET provider_wallet = LOWER(provider_wallet)
 WHERE provider_wallet IS NOT NULL
   AND provider_wallet <> LOWER(provider_wallet);

-- 2. Enforce lowercase going forward via CHECK constraints.
--    Guard against duplicate-constraint errors if re-applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_services_owner_lowercase'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT chk_services_owner_lowercase
      CHECK (owner_address IS NULL OR owner_address = LOWER(owner_address));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'chk_payouts_wallet_lowercase'
  ) THEN
    ALTER TABLE pending_payouts
      ADD CONSTRAINT chk_payouts_wallet_lowercase
      CHECK (provider_wallet IS NULL OR provider_wallet = LOWER(provider_wallet));
  END IF;
END $$;

-- 3. B-tree indexes for plain equality lookups.
CREATE INDEX IF NOT EXISTS idx_services_owner_address
  ON services (owner_address);

CREATE INDEX IF NOT EXISTS idx_pending_payouts_provider_wallet
  ON pending_payouts (provider_wallet);

-- 4. Composite index for the common pattern "pending payouts of wallet X in state Y".
CREATE INDEX IF NOT EXISTS idx_pending_payouts_wallet_status
  ON pending_payouts (provider_wallet, status);
