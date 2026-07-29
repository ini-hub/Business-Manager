-- 0032_variant_diagnostics.sql
--
-- Read-only diagnostics for the variant-loop bug fix (see 0033). Run
-- manually and review the output BEFORE applying 0033_variant_integrity_constraints.sql.
-- Not part of the enforced migration chain — no DDL, nothing here mutates data.

-- (a) parent_inventory_id chains deeper than 1: a variant whose own
-- parent_inventory_id points at ANOTHER row that also has a non-null
-- parent_inventory_id. Proof of the unbounded variant-of-variant chaining
-- bug in the (now-removed) POST /api/inventory/:id/variants endpoint.
SELECT child.id AS child_id, child.name AS child_name,
       parent.id AS parent_id, parent.name AS parent_name,
       parent.parent_inventory_id AS grandparent_id
FROM inventory child
JOIN inventory parent ON parent.id = child.parent_inventory_id
WHERE child.parent_inventory_id IS NOT NULL
  AND parent.parent_inventory_id IS NOT NULL;

-- (b) Duplicate (product_id, variant_dimensions) combos within the same
-- product, non-deleted. This MUST come back empty (or be remediated) before
-- 0033 runs, since 0033 adds a unique index on exactly this pair and will
-- fail atomically if duplicates remain.
SELECT product_id, variant_dimensions, array_agg(id) AS duplicate_ids, count(*)
FROM inventory
WHERE variant_dimensions IS NOT NULL AND variant_dimensions != '{}'::jsonb
  AND is_deleted = false
GROUP BY product_id, variant_dimensions
HAVING count(*) > 1;

-- (c) parent_inventory_id values pointing at rows that no longer exist
-- (deleted or hard-deleted) — orphaned references. Informational only;
-- moot once 0033 drops the column.
SELECT child.id, child.name, child.parent_inventory_id
FROM inventory child
LEFT JOIN inventory parent ON parent.id = child.parent_inventory_id
WHERE child.parent_inventory_id IS NOT NULL AND parent.id IS NULL;
