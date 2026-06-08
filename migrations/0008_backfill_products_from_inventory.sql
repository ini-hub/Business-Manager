-- Migration: backfill products table from legacy inventory items
-- Every inventory item that has no product_id gets a synthetic product group.
-- Idempotent: safe to run more than once.

-- Step 1: Create a product row for each orphaned inventory item.
-- is_deleted / deleted_at mirror the inventory row so archived items stay archived.
INSERT INTO "products" (
  id, store_id, name, type,
  is_active, is_deleted, deleted_at,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  i.store_id,
  i.name,
  i.type,
  true,
  COALESCE(i.is_deleted, false),
  i.deleted_at,
  now(),
  now()
FROM "inventory" i
WHERE i.product_id IS NULL
ON CONFLICT (store_id, name) DO NOTHING;

-- Step 2: Link each orphaned inventory item to its new product group.
UPDATE "inventory" i
SET product_id = p.id
FROM "products" p
WHERE i.product_id IS NULL
  AND i.store_id    = p.store_id
  AND lower(i.name) = lower(p.name);
