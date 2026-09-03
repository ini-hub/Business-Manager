-- Every organisation that existed before this migration runs gets a
-- grandfathered active entitlement for every currently-launched paid feature
-- (isActive=true, standalone or bundle-parent - bundle children are never
-- entitled directly, they ride on their parent). None of them "purchased"
-- anything under the old flat-plan model, and none should suddenly lose
-- access to functionality they already had (FAC-10). Any organisation
-- created after this migration runs starts on the free tier only, with the
-- 1-staff/50-customer caps live from day one.
--
-- This does NOT grandfather the three not-yet-paywalled-but-already-free
-- Business Settings features (receipt_customization, loyalty_program,
-- custom_roles_permissions) any differently from every other feature here -
-- they are simply included, like everything else, because they are
-- is_active=true paid_flat rows. The staged sunset-notice transition
-- (server/lib/entitlements.ts scheduleFeatureRemoval, source
-- 'grandfathered_sunset') is a separate, later, admin-initiated action for
-- when the super admin actually decides to start charging for them - this
-- migration only guarantees nobody loses anything on day one.

INSERT INTO org_feature_entitlements (organisation_id, feature_id, status, source, effective_from)
SELECT o.id, f.id, 'active', 'grandfathered', now()
FROM organisations o
CROSS JOIN feature_catalog f
WHERE f.is_active = true
  AND f.tier_type IN ('paid_flat', 'bundle_parent', 'paid_metered_limit')
ON CONFLICT (organisation_id, feature_id) WHERE status = 'active' DO NOTHING;
