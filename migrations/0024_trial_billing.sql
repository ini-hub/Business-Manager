-- 0024_trial_billing.sql
--
-- Adds free-trial and subscription-billing state. Every new column on
-- organisations is nullable and every existing row keeps status = 'active'
-- with trial_ends_at = null - this migration does not change behavior for
-- any organisation that exists today. Only the signup path (application
-- code, not this migration) starts setting status = 'trialing' going
-- forward for brand-new organisations.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS default_walk_in_customer_id VARCHAR;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS default_trial_staff_id VARCHAR;

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price_monthly NUMERIC(12, 2) NOT NULL,
  price_annual NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL UNIQUE REFERENCES organisations(id),
  plan_id VARCHAR NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'trialing',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  current_period_start TIMESTAMP NOT NULL DEFAULT now(),
  current_period_end TIMESTAMP NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

CREATE TABLE IF NOT EXISTS funnel_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL REFERENCES organisations(id),
  event_name TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_org_event ON funnel_events (organisation_id, event_name);

-- Placeholder starter plans so the plan picker has something to show.
-- Prices are illustrative only - replace via the plans table before going live with real billing.
INSERT INTO plans (name, price_monthly, price_annual, currency, features, is_active)
SELECT 'Starter', 15000, 150000, 'NGN', '["1 store", "Up to 3 staff", "Core sales & inventory"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Starter');

INSERT INTO plans (name, price_monthly, price_annual, currency, features, is_active)
SELECT 'Growth', 35000, 350000, 'NGN', '["Multiple stores", "Unlimited staff", "Advanced reports & analytics"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Growth');
