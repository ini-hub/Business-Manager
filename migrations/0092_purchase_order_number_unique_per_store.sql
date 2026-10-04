-- po_number only needs to be unique within a store, not across every business
-- (store codes are only unique per business, so PO-<CODE>-<n> can repeat across
-- businesses). Drops the global unique constraint/index on po_number alone, then
-- adds uniqueness per store. Idempotent.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'purchase_orders' AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text) FROM unnest(con.conkey) k
           JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k) = ARRAY['po_number']
  LOOP
    EXECUTE format('ALTER TABLE purchase_orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_store_po_number_unique ON purchase_orders (store_id, po_number);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'purchase_orders' AND indexname = 'purchase_orders_store_po_number_unique') THEN
    RAISE EXCEPTION 'purchase_orders per-store unique index did not land';
  END IF;
END $$;
