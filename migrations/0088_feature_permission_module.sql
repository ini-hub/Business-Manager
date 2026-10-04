-- Which Settings > Roles module a feature sits under (shared/permissionModules.ts).
-- The role form lists a feature under its module, and a custom role needs the
-- module to use that feature's admin-defined gated routes and screens.
-- Populated for registry features by `npm run features:sync`; null until then.
--
-- Idempotent, with a check that RAISEs if the column did not land.

ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS permission_module text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'feature_catalog' AND column_name = 'permission_module'
  ) THEN
    RAISE EXCEPTION '0088: feature_catalog.permission_module was not added';
  END IF;
END $$;
