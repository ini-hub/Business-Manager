-- Roles become one structure: a business's custom roles, platform-wide overrides of the built-in
-- manager/staff permissions (kind 'system', business_id NULL) and super-admin role templates
-- (kind 'template', business_id NULL). permissions[] may now hold page keys as well as module
-- names (see shared/permissions.ts); existing rows keep working because a module name still
-- means "every page in the module".
--
-- Idempotent. Ends with a check that RAISEs if a change did not land (see 0057).

ALTER TABLE custom_roles ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'custom';
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS source_template_id varchar;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_roles_kind_check') THEN
    ALTER TABLE custom_roles ADD CONSTRAINT custom_roles_kind_check
      CHECK (kind IN ('custom', 'system', 'template') AND ((kind = 'custom') = (business_id IS NOT NULL)));
  END IF;
END $$;

-- One platform row per built-in role override / template name.
CREATE UNIQUE INDEX IF NOT EXISTS custom_roles_platform_name_uq
  ON custom_roles (kind, lower(name)) WHERE business_id IS NULL AND is_deleted = false;

-- One live role per name inside a business (names are how staff are linked to a role, so two that
-- differ only by case would be ambiguous). Skipped, with a notice, if existing data already
-- collides; the API enforces the same rule either way.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM custom_roles WHERE business_id IS NOT NULL AND is_deleted = false
    GROUP BY business_id, lower(name) HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'custom_roles has duplicate role names within a business; business name index not created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS custom_roles_business_name_uq
      ON custom_roles (business_id, lower(name)) WHERE business_id IS NOT NULL AND is_deleted = false;
  END IF;
END $$;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['kind', 'source_template_id']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_roles' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'custom_roles columns were not created: %', missing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_roles' AND column_name = 'business_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'custom_roles.business_id is still NOT NULL';
  END IF;
END $$;
