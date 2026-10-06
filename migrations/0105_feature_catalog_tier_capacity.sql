-- feature_catalog.tier_capacity: the most a paid_metered_limit tier allows in total (not on top of
-- free_limit); NULL is unlimited. It used to exist only in the code registry (shared/features.ts), so a
-- capped add-on created in the admin catalog could be bought but never raised anyone's limit. The limit
-- logic now reads it from here. Idempotent.

ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS tier_capacity integer;

-- The built-in stepped tiers, so the limit logic is right before the next registry sync runs.
UPDATE feature_catalog SET tier_capacity = 5  WHERE key = 'staff_seats_5'  AND tier_capacity IS NULL;
UPDATE feature_catalog SET tier_capacity = 15 WHERE key = 'staff_seats_15' AND tier_capacity IS NULL;
