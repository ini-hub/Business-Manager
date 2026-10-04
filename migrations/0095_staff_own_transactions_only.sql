-- Per-business switch: when true (the default), anyone who is not an owner or
-- manager sees only the transactions they took part in (checkout processor, lead
-- or assisting staff). The owner can turn it off in Settings > Business Profile.
--
-- Idempotent, with a check that RAISEs if the column did not land (see 0057 for
-- why a recorded migration is not proof its statements ran).

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS staff_own_transactions_only boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organisations' AND column_name = 'staff_own_transactions_only'
  ) THEN
    RAISE EXCEPTION '0095: organisations.staff_own_transactions_only was not added';
  END IF;
END $$;
