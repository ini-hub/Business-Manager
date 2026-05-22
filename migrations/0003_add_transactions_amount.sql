-- Add `amount` column to transactions (idempotent)
ALTER TABLE IF EXISTS transactions
  ADD COLUMN IF NOT EXISTS amount real NOT NULL DEFAULT 0;

-- Backfill existing rows if any (safety): set to total from related checkouts when available
UPDATE transactions t
SET amount = coalesce(c.total_charged, 0)
FROM checkouts c
WHERE t.checkout_id = c.id AND (t.amount IS NULL OR t.amount = 0);
