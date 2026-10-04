-- Admin-defined gate rules (see shared/gateRules.ts): a super admin attaches an
-- existing API route or client screen to a paid feature from the UI, saved as a
-- draft and enforced only once enabled. The events table is an append-only
-- history with no FK to the rule, so a deleted or mistaken rule can be reverted.
--
-- Idempotent, and ends with a check that RAISEs if the tables did not land (see
-- 0057 for why a recorded migration is not proof its statements ran).

CREATE TABLE IF NOT EXISTS feature_gate_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id varchar NOT NULL REFERENCES feature_catalog(id),
  kind text NOT NULL CHECK (kind IN ('route', 'screen')),
  methods text NOT NULL DEFAULT '*',
  pattern text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  note text,
  created_by text,
  updated_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_feature_gate_rules UNIQUE (feature_id, kind, methods, pattern)
);

CREATE INDEX IF NOT EXISTS idx_feature_gate_rules_status ON feature_gate_rules (status);

CREATE TABLE IF NOT EXISTS feature_gate_rule_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id varchar NOT NULL,
  feature_key text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  admin_email text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_gate_rule_events_rule ON feature_gate_rule_events (rule_id);

DO $$
BEGIN
  IF to_regclass('public.feature_gate_rules') IS NULL OR to_regclass('public.feature_gate_rule_events') IS NULL THEN
    RAISE EXCEPTION '0087: feature gate rule tables were not created';
  END IF;
END $$;
