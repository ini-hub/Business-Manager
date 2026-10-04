-- The supplier's own order / invoice number, which differs from our internal po_number.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_ref text;
