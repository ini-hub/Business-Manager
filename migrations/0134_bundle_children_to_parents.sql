-- Bundles must list only features sold on their own. The 0101 seed put "stock_transfer" in Growth
-- and Business, but stock_transfer is a bundle_child of store_addon: it is never held directly, so
-- those bundles could never be "held in full" (no discount at checkout or renewal), were left out of
-- the public pricing, and could not be saved from Super Admin (the editor cannot show the child).
--
-- Replace every bundle_child member with its parent (de-duplicated, order kept). Buying the parent is
-- what carries the child, so this keeps the bundle's meaning. A bundle with no child is untouched, and
-- a database whose catalog is not synced yet is a no-op (0101 no longer seeds the child either).
-- Idempotent.

UPDATE pricing_bundles b
SET feature_keys = (
      SELECT COALESCE(jsonb_agg(k ORDER BY first_ord), '[]'::jsonb)
      FROM (
        SELECT k, MIN(ord) AS first_ord
        FROM (
          SELECT COALESCE(p.key, e.k) AS k, e.ord
          FROM jsonb_array_elements_text(b.feature_keys) WITH ORDINALITY AS e(k, ord)
          LEFT JOIN feature_catalog c ON c.key = e.k AND c.tier_type = 'bundle_child'
          LEFT JOIN feature_catalog p ON p.id = c.parent_feature_id
        ) m
        GROUP BY k
      ) d
    ),
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(b.feature_keys) AS e(k)
  JOIN feature_catalog c ON c.key = e.k AND c.tier_type = 'bundle_child' AND c.parent_feature_id IS NOT NULL
);
