-- Renames feature key hide_transaction_amount -> staff_sales_visibility. The feature
-- is the paid "Who sees which sales" toggle (organisations.staff_own_transactions_only),
-- which the old key and description never described. Every place the key is stored as
-- text moves with it, so entitlements (which hang off feature_catalog.id) are untouched
-- and the next feature sync updates the row instead of creating a duplicate. Idempotent.

UPDATE feature_catalog SET key = 'staff_sales_visibility' WHERE key = 'hide_transaction_amount'
  AND NOT EXISTS (SELECT 1 FROM feature_catalog WHERE key = 'staff_sales_visibility');

UPDATE feature_flags SET name = 'staff_sales_visibility' WHERE name = 'hide_transaction_amount'
  AND NOT EXISTS (SELECT 1 FROM feature_flags WHERE name = 'staff_sales_visibility');

UPDATE feature_gate_rule_events SET feature_key = 'staff_sales_visibility' WHERE feature_key = 'hide_transaction_amount';

UPDATE pricing_bundles
SET feature_keys = (
  SELECT COALESCE(jsonb_agg(CASE WHEN k = 'hide_transaction_amount' THEN 'staff_sales_visibility' ELSE k END), '[]'::jsonb)
  FROM jsonb_array_elements_text(feature_keys) AS k
)
WHERE feature_keys ? 'hide_transaction_amount';
