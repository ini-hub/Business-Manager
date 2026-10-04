-- Free-text note to the vendor (delivery instructions, brand/size preferences).
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes text;
