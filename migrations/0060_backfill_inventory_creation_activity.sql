-- Backfills a "CREATE" audit_logs entry for every existing inventory row that
-- doesn't have one, so the Activity tab (server/repositories/InventoryRepository.ts
-- #getActivityTimeline) shows where an item's lifecycle began instead of appearing
-- to start mid-story. This covers every variant, not just single-variant products —
-- each variant is its own row in `inventory`, and activity is keyed to that row's
-- id, not the parent product's.
--
-- Two things this deliberately does NOT do:
-- 1. Guess a creation quantity. `inventory` carries no history of its own starting
--    stock, and reconstructing one from current quantity minus every restock/sale/
--    return since would be a guess dressed up as a fact. The entry has no quantity;
--    everything from here forward is logged accurately at the time it happens.
-- 2. Use an exact creation timestamp. `inventory` has no created_at column of its
--    own — only its parent `products` row does. The backfilled entry uses that as
--    an approximation and says so in `details`, rather than implying precision
--    that doesn't exist.
--
-- Idempotent: only inserts where no CREATE/inventory audit_logs row already
-- exists for that inventory id, so re-running this is a no-op the second time.
INSERT INTO audit_logs (id, timestamp, action, resource, resource_id, status, store_id, details, channel)
SELECT
  gen_random_uuid(),
  p.created_at,
  'CREATE',
  'inventory',
  i.id,
  'success',
  i.store_id,
  jsonb_build_object(
    'backfilled', true,
    'approximateTimestamp', true,
    'note', 'Backfilled from parent product''s created_at; inventory has no created_at of its own. Quantity intentionally omitted — not reconstructed from later activity.'
  ),
  'system'
FROM inventory i
JOIN products p ON p.id = i.product_id
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs al
  WHERE al.resource = 'inventory' AND al.resource_id = i.id AND al.action = 'CREATE'
);
