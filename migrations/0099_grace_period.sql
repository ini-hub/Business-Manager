-- 7-day grace after a failed renewal (a trial's grace is derived from trial_ends_at, so it
-- needs no column). Set when a renewal charge fails, cleared by the next successful payment.
-- While now() < grace_ends_at the org keeps full access; afterwards it is "soft locked":
-- it falls back to the free tier (nothing is deleted, checkout and exports stay open).
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS grace_ends_at timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organisations' AND column_name = 'grace_ends_at'
  ) THEN
    RAISE EXCEPTION 'migration 0099: organisations.grace_ends_at was not created';
  END IF;
END $$;
