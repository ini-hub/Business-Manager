-- Owner-initiated business deletion. The organisation row is soft-deleted
-- (deleted_at, already present) and kept until a super admin purges it.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS deleted_by_user_id varchar;
CREATE INDEX IF NOT EXISTS idx_organisations_deleted_at ON organisations (deleted_at) WHERE deleted_at IS NOT NULL;

-- Exit-survey answers. Deliberately no FK to organisations: the feedback must
-- outlive a permanent purge of the business it came from.
CREATE TABLE IF NOT EXISTS business_deletion_feedback (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id varchar NOT NULL,
  organisation_name text NOT NULL,
  user_id varchar,
  user_email text,
  reasons text[] NOT NULL DEFAULT '{}',
  details text,
  would_return text,
  contact_ok boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bdf_org ON business_deletion_feedback (organisation_id);
CREATE INDEX IF NOT EXISTS idx_bdf_created ON business_deletion_feedback (created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organisations' AND column_name = 'deleted_by_user_id')
     OR to_regclass('business_deletion_feedback') IS NULL THEN
    RAISE EXCEPTION '0127 did not apply';
  END IF;
END $$;
