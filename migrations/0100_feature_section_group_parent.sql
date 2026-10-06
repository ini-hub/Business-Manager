-- Product tree for the feature catalog: which top-level section a feature is listed
-- under (management / sales / settings_business / settings_store) and which feature it
-- nests beneath (e.g. Customer > Archive). Display and grouping only: unlike
-- parent_feature_id (bundle grants) it never grants anything.
-- Populated for registry features by `npm run features:sync`; null until then.
--
-- Idempotent, with a check that RAISEs if the columns did not land.

ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS group_parent_feature_id varchar REFERENCES feature_catalog(id);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'feature_catalog' AND column_name IN ('section', 'group_parent_feature_id')
  ) <> 2 THEN
    RAISE EXCEPTION '0100: feature_catalog.section / group_parent_feature_id were not added';
  END IF;
END $$;
