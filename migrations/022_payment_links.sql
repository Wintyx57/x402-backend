-- Migration 022: Payment Links (shareable paywalls for any content/URL)
CREATE TABLE IF NOT EXISTS payment_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  target_url TEXT NOT NULL,
  price_usdc NUMERIC(10,4) NOT NULL,
  owner_address TEXT NOT NULL,
  redirect_after_payment BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  views INTEGER DEFAULT 0,
  paid_count INTEGER DEFAULT 0,
  total_earned_usdc NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_owner ON payment_links(owner_address);
CREATE INDEX IF NOT EXISTS idx_payment_links_active ON payment_links(is_active);
