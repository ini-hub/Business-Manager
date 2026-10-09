-- Drafts keep the per-leg payment detail (account, reference, sender, confirmed, cash tendered, change owed).
-- payment_detail holds the single-method detail; split legs carry theirs inside split_payments. Idempotent.
ALTER TABLE sale_drafts ADD COLUMN IF NOT EXISTS payment_detail jsonb;
