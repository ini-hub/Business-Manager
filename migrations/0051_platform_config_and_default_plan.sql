-- Platform-operator config (trial length) and platform payment gateway
-- credentials (encrypted at rest), plus the one implicit ₦0 default plan
-- every pay-per-feature checkout now resolves to when the client omits
-- planId - the app no longer asks anyone to choose a plan tier. See
-- shared/schema/platform.ts and the requirements plan this shipped from.

CREATE TABLE IF NOT EXISTS platform_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE IF NOT EXISTS platform_payment_credentials (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  public_key text,
  secret_key_encrypted text,
  webhook_secret_encrypted text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- At most one plan can be the implicit default - guards against two rows
-- both claiming it (which would make /api/billing/subscribe's planId-less
-- lookup ambiguous).
CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_single_default ON plans (is_default) WHERE is_default = true;

-- Seed the trial-days config row only if unset, so this migration never
-- silently changes trial length for a deployment that already has a value.
INSERT INTO platform_config (key, value)
SELECT 'trial_days', '14'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM platform_config WHERE key = 'trial_days');

-- Seed the implicit default plan only if none exists yet.
INSERT INTO plans (name, price_monthly, price_annual, currency, features, is_active, is_default)
SELECT 'Pay Per Feature', 0, 0, 'NGN', '[]'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE is_default = true);
