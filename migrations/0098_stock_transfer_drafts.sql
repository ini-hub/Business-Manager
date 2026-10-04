-- Saved-but-unsent stock transfers / requests. Deliberately a separate table: a draft
-- never touches stock_transfers or inventory, so it cannot reserve stock, show up in
-- shipment counts or approvals, or be seen by the other branch.
--
-- Idempotent, with a check that RAISEs if the table did not land (see 0057).

CREATE TABLE IF NOT EXISTS stock_transfer_drafts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  created_by_user_id varchar REFERENCES users(id),
  kind text NOT NULL DEFAULT 'send',
  other_store_id varchar,
  form_data jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_drafts_store ON stock_transfer_drafts (store_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_transfer_drafts') THEN
    RAISE EXCEPTION '0098: stock_transfer_drafts was not created';
  END IF;
END $$;
