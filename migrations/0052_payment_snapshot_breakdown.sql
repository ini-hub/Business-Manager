-- Snapshot what a subscription payment actually priced in, captured once at
-- creation time. Plans and feature add-ons can reprice later, but a
-- historical payment must keep showing what it charged back then, not
-- today's catalog price - powers the payment history "receipt" view.
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS feature_breakdown jsonb;
