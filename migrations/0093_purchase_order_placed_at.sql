-- When a purchase order was placed (draft -> ordered). Non-draft rows existing
-- before this column are backfilled with their creation time.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS placed_at timestamp;
UPDATE purchase_orders SET placed_at = created_at WHERE placed_at IS NULL AND status <> 'draft';
