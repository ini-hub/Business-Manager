-- The stock-transfer workflow columns (accept / deliver / confirm tracking) are in the schema
-- (shared/schema/vendors-purchasing.ts) but no earlier migration adds them, so a database built from
-- the migration files alone lacked them. Idempotent: databases that already have them are unchanged.
--
-- Ends with a check that RAISEs if a column did not land (see 0057).

ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS accepted_at timestamp;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS accepted_by_user_id varchar;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS delivery_method varchar;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS delivery_notes text;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS delivered_at timestamp;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS delivered_by_user_id varchar;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS confirmed_by_user_id varchar;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS confirmed_quantity_json text;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['accepted_at','accepted_by_user_id','rejection_reason','delivery_date','delivery_method',
                    'delivery_notes','delivered_at','delivered_by_user_id','confirmed_at','confirmed_by_user_id',
                    'confirmed_quantity_json']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_transfers' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'stock_transfers columns were not created: %', missing;
  END IF;
END $$;
