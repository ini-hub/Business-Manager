-- Exchange rates, owner-entered and effective-dated, one row per ordered currency pair.
--
-- NGN->GHS and GHS->NGN are separate rows: nothing is derived, so an owner never has to wonder which
-- way a rate runs. A conversion uses the latest row on or before the date being converted.
--
-- payroll_periods.rates_snapshot freezes the rates that applied when a period was approved, so editing
-- a rate later can never change an approved or paid period.
--
-- Additive and idempotent, with a check that the objects exist (see 0057).

CREATE TABLE IF NOT EXISTS exchange_rates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id varchar NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  from_currency varchar(3) NOT NULL,
  to_currency varchar(3) NOT NULL,
  rate numeric(20, 8) NOT NULL,
  effective_from varchar(10) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  note text,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_distinct_currencies CHECK (from_currency <> to_currency),
  CONSTRAINT exchange_rates_positive CHECK (rate > 0),
  CONSTRAINT exchange_rates_date_format CHECK (effective_from ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT exchange_rates_pair_date_unique UNIQUE (business_id, from_currency, to_currency, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON exchange_rates (business_id, from_currency, to_currency, effective_from DESC);

ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS rates_snapshot jsonb;

DO $$
BEGIN
  IF to_regclass('public.exchange_rates') IS NULL THEN
    RAISE EXCEPTION '0130: exchange_rates was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_periods' AND column_name = 'rates_snapshot'
  ) THEN
    RAISE EXCEPTION '0130: payroll_periods.rates_snapshot was not added';
  END IF;
END $$;
