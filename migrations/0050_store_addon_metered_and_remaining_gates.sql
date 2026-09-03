-- store_addon was seeded in 0048 as a flat paid_flat row. The actual rule
-- ("1st store free, each additional store paid") is the same metered-limit
-- shape as staff_seats_addon/customer_capacity_addon, now that
-- server/lib/entitlements.ts's checkCountLimit/getCountLimitStatus support a
-- third 'store_count' limit type - correct it here rather than re-editing
-- the already-applied 0048 seed insert.
UPDATE feature_catalog
SET tier_type = 'paid_metered_limit', free_limit = 1, limit_type = 'store_count', updated_at = now()
WHERE key = 'store_addon' AND tier_type = 'paid_flat';
