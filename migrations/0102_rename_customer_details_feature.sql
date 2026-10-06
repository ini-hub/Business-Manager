-- Renames feature key customer_details -> customer_management (display name is
-- already "Customer Management"). Every place the key is stored as text moves
-- with it, so entitlements (which hang off feature_catalog.id) are untouched and
-- the next feature sync updates the row instead of creating a duplicate.
-- Idempotent.

UPDATE feature_catalog SET key = 'customer_management' WHERE key = 'customer_details'
  AND NOT EXISTS (SELECT 1 FROM feature_catalog WHERE key = 'customer_management');

UPDATE feature_flags SET name = 'customer_management' WHERE name = 'customer_details'
  AND NOT EXISTS (SELECT 1 FROM feature_flags WHERE name = 'customer_management');

UPDATE feature_gate_rule_events SET feature_key = 'customer_management' WHERE feature_key = 'customer_details';

UPDATE pricing_bundles
SET feature_keys = (
  SELECT COALESCE(jsonb_agg(CASE WHEN k = 'customer_details' THEN 'customer_management' ELSE k END), '[]'::jsonb)
  FROM jsonb_array_elements_text(feature_keys) AS k
)
WHERE feature_keys ? 'customer_details';
