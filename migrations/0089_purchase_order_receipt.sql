-- Supplier receipt / invoice attached to a purchase order (object-storage key,
-- never a public URL). Optional; attachable at any status.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS receipt_key text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS receipt_name text;
