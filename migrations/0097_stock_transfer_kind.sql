-- Reverse stock transfers: a branch can REQUEST stock from a neighbouring branch, not only
-- push it. `kind` records who initiated it ('send' = the sending branch, 'request' = the
-- receiving branch) so the approval step goes to the right side. Existing rows are all sends.
--
-- Idempotent, with a check that RAISEs if the column did not land (see 0057).

ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'send';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_transfers' AND column_name = 'kind'
  ) THEN
    RAISE EXCEPTION 'stock_transfers.kind was not created';
  END IF;
END $$;
