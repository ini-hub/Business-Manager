-- Every feature_catalog row owns exactly one feature_flags row (flag_id).
--
-- Before this, a catalog key and a flag were linked only by string equality
-- (feature_flags.name = feature_catalog.key), flags were free text, and the
-- kill-switch silently did nothing when the names drifted apart. The flag now
-- belongs to the catalog row: the sync (server/lib/featureSync.ts, run via
-- `npm run features:sync`) creates both together and the admin UI no longer
-- creates flags by hand.
--
-- feature_flags was previously only created by scripts/sync-db.ts, never by a
-- migration, so create it here if a deployment lacks it.
--
-- Idempotent, and ends with checks that RAISE if the backfill did not land
-- (see 0057 for why a recorded migration is not proof its statements ran).
--
-- NOTE: with flag_id NOT NULL, catalog rows can no longer be inserted without
-- a flag, so re-running the old seed statements from 0048/0057 by hand fails.
-- Use `npm run features:sync` to repair or seed the catalog instead.

CREATE TABLE IF NOT EXISTS feature_flags (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'off',
  scoped_org_ids jsonb,
  subscription_tier text,
  description text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS flag_id varchar REFERENCES feature_flags(id);

-- A flag that already carries a catalog key's name is adopted as-is, keeping
-- its status (an existing 'off' was a deliberate kill-switch). Every other
-- catalog row gets a new flag, 'on'.
INSERT INTO feature_flags (name, status, description, updated_by)
SELECT c.key, 'on', c.name, 'migration 0086'
FROM feature_catalog c
WHERE c.flag_id IS NULL
ON CONFLICT (name) DO NOTHING;

UPDATE feature_catalog c
SET flag_id = f.id
FROM feature_flags f
WHERE c.flag_id IS NULL AND f.name = c.key;

DO $$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing FROM feature_catalog WHERE flag_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '0086: % feature_catalog rows still have no flag_id after backfill', missing;
  END IF;
END $$;

ALTER TABLE feature_catalog ALTER COLUMN flag_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_catalog_flag_id ON feature_catalog (flag_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'feature_catalog' AND indexname = 'uq_feature_catalog_flag_id'
  ) THEN
    RAISE EXCEPTION '0086: uq_feature_catalog_flag_id was not created';
  END IF;
END $$;
