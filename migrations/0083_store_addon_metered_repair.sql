-- Re-applies 0050's correction of store_addon from a flat paid add-on to the
-- metered "1st store free, each additional store paid" limit.
--
-- 0050 is recorded as applied everywhere, but on deployments where the catalog
-- was empty at that point (see 0057's header) its UPDATE matched zero rows, and
-- 0057 then re-seeded store_addon in its original paid_flat form. Result:
-- free_limit NULL, so the store cap resolved to 0 and a post-trial org could
-- not create even its first store. Idempotent: a no-op wherever the row is
-- already metered.
UPDATE feature_catalog
SET tier_type = 'paid_metered_limit', free_limit = 1, limit_type = 'store_count', updated_at = now()
WHERE key = 'store_addon' AND tier_type = 'paid_flat';
