-- Saved-but-uncommitted "New item" wizard sessions. Deliberately a separate table:
-- drafts never touch products/inventory, so they cannot leak into the POS, stock
-- totals, reports or free-plan item caps.
--
-- Idempotent, with a check that RAISEs if the table did not land (see 0057).

CREATE TABLE IF NOT EXISTS inventory_drafts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  created_by_user_id varchar REFERENCES users(id),
  name text,
  type text,
  form_data jsonb NOT NULL,
  step text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_drafts_store ON inventory_drafts (store_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_drafts') THEN
    RAISE EXCEPTION '0096: inventory_drafts was not created';
  END IF;
END $$;
