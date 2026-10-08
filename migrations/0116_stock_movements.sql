-- stock_movements: append-only ledger of every change to inventory.quantity.
-- Invariant: inventory.quantity = SUM(stock_movements.delta) per inventory row.
-- Each existing item gets one synthetic 'opening_balance' row for its current quantity so the
-- invariant holds from the moment this runs. Idempotent: re-running adds no second opening row.

CREATE TABLE IF NOT EXISTS stock_movements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  inventory_id varchar NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  reason text NOT NULL,
  quantity_before numeric(14,4) NOT NULL,
  quantity_after numeric(14,4) NOT NULL,
  delta numeric(14,4) NOT NULL,
  ref_type text,
  ref_id varchar,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  actor_staff_id varchar REFERENCES staff(id) ON DELETE SET NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item_time ON stock_movements (inventory_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_time ON stock_movements (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements (ref_type, ref_id);

INSERT INTO stock_movements (store_id, inventory_id, reason, quantity_before, quantity_after, delta, note, created_at)
SELECT i.store_id, i.id, 'opening_balance', 0, i.quantity, i.quantity, 'Balance when the stock ledger started', now()
FROM inventory i
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements m WHERE m.inventory_id = i.id AND m.reason = 'opening_balance'
);
