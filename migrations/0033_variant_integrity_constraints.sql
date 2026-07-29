-- 0033_variant_integrity_constraints.sql
--
-- Fixes the "endless variant loop" bug: productId + variantDimensions is the
-- real, live grouping key for a product's variants (see products.variants
-- relation and ProductRepository) — parentInventoryId was a vestigial,
-- never-constrained self-reference (no FK, no depth guard) only written by
-- the now-removed /api/inventory/:id/variants endpoint, which let a variant
-- become the "parent" of another variant with nothing to stop it chaining
-- indefinitely. Run 0032_variant_diagnostics.sql first and review query (b)
-- before applying this file.
--
-- This migration:
--   1. Remediates duplicate (product_id, variant_dimensions) combos found
--      by 0032's diagnostic (b), so the new unique index below can be created.
--   2. Drops parent_inventory_id — productId + variantDimensions is now the
--      sole variant-grouping mechanism.
--   3. Adds a partial unique index so the DB itself rejects duplicate
--      variant combos within a product, closing the race the client-side
--      "existingComboKeys" check alone could not close.

-- --- 1. Remediation ---
-- Keep, per duplicate (product_id, variant_dimensions) group, the row with
-- the most sales history (so no order/receipt history is orphaned), falling
-- back to the lowest id when neither has any sales. Soft-delete the rest.
UPDATE inventory
SET is_deleted = true, deleted_at = now()
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY product_id, variant_dimensions
             ORDER BY (SELECT count(*) FROM transactions t WHERE t.inventory_id = inventory.id) DESC, id
           ) AS rn
    FROM inventory
    WHERE variant_dimensions IS NOT NULL AND variant_dimensions != '{}'::jsonb
      AND is_deleted = false
  ) ranked
  WHERE rn > 1
);

-- --- 2. Schema change ---
ALTER TABLE inventory DROP COLUMN IF EXISTS parent_inventory_id;

-- --- 3. Integrity constraint ---
-- Partial: only rows WITH dimensions are constrained — a product's base item
-- has variant_dimensions NULL/{} and must keep sharing product_id with its
-- variants unconstrained. jsonb equality compares parsed structure, not raw
-- text, so key-order differences don't evade this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_product_variant_dims_unique
  ON inventory (product_id, variant_dimensions)
  WHERE variant_dimensions IS NOT NULL AND variant_dimensions != '{}'::jsonb
    AND is_deleted = false;
