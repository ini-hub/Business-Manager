-- Optional supplier receipt attached to an individual delivery (a receive
-- action) on a purchase order. The PO-level receipt stays on purchase_orders.
CREATE TABLE IF NOT EXISTS purchase_order_delivery_receipts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id varchar NOT NULL REFERENCES purchase_orders(id),
  restock_event_id varchar REFERENCES inventory_restock_events(id),
  receipt_key text NOT NULL,
  receipt_name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_delivery_receipts_po ON purchase_order_delivery_receipts(po_id);
