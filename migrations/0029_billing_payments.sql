-- 0029_billing_payments.sql
--
-- Wires a real payment provider (Paystack first) into the billing scaffold
-- from 0024_trial_billing.sql. Adds the reusable-card column subscriptions
-- needs for automatic renewal charging, and a subscription_payments ledger
-- so super admins can review individual payment attempts, not just current
-- subscription state.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_authorization_code TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_attempted_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL REFERENCES organisations(id),
  plan_id VARCHAR NOT NULL REFERENCES plans(id),
  subscription_id VARCHAR REFERENCES subscriptions(id),
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'initial',
  reference TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_response JSONB,
  initiated_by_user_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_org ON subscription_payments (organisation_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON subscription_payments (status);
