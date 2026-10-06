-- Removes the unbuilt placeholder features from the catalog (nothing is built behind
-- them: each is either superseded by a real feature or has no code at all). They were
-- inactive, so nothing depended on them. The registry no
-- longer lists them; the feature sync never deletes rows, so this does.
--
-- Conservative: a placeholder is only deleted when nothing outside the catalog
-- still points at it (entitlements, purchases, gate rules, ...). One that does is
-- kept and reported, so no billing history is ever lost. Idempotent.

DO $$
DECLARE
  slug text;
  fid varchar;
  fk record;
  referenced boolean;
BEGIN
  FOREACH slug IN ARRAY ARRAY[
    'quote_booking_management', 'customer_analytics_retention', 'vat_tracking',
    'plugins_integrations', 'consignment_management'
  ] LOOP
    SELECT id INTO fid FROM feature_catalog WHERE key = slug;
    CONTINUE WHEN fid IS NULL;

    referenced := false;
    FOR fk IN
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'feature_catalog'::regclass
        AND c.conrelid <> 'feature_dependencies'::regclass
    LOOP
      -- A catalog row pointing at itself (parent / group parent) is not a reference.
      IF fk.tbl = 'feature_catalog' THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM feature_catalog WHERE %I = $1 AND id <> $1)', fk.col)
          INTO referenced USING fid;
      ELSE
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', fk.tbl, fk.col)
          INTO referenced USING fid;
      END IF;
      EXIT WHEN referenced;
    END LOOP;

    IF referenced THEN
      RAISE NOTICE '0103: kept % - still referenced', slug;
      CONTINUE;
    END IF;

    DELETE FROM feature_dependencies WHERE feature_id = fid OR depends_on_feature_id = fid;
    WITH gone AS (DELETE FROM feature_catalog WHERE id = fid RETURNING flag_id)
    DELETE FROM feature_flags WHERE id IN (SELECT flag_id FROM gone);
    -- A flag left over from before 0086 may carry the key without being linked.
    DELETE FROM feature_flags WHERE name = slug AND id NOT IN (SELECT flag_id FROM feature_catalog WHERE flag_id IS NOT NULL);
  END LOOP;
END $$;
