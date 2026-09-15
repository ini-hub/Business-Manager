-- Legal document consent (Terms and Conditions, Privacy Policy, Data Usage
-- Policy) + a one-time 14-day-trial welcome notice. Neither existed anywhere
-- in the app before this - confirmed by a full-repo search turning up zero
-- hits for any of "terms and conditions" / "privacy policy" / consent
-- capture on signup.
--
-- Schema is modeled directly on migrations/0046_staff_contract_signing.sql:
-- one row per document type (legal_documents), an immutable versioned
-- content history with a sha256 content_hash integrity anchor
-- (legal_document_versions), and an append-only acceptance ledger
-- (legal_document_acceptances) hash-pinned to the exact version a user
-- agreed to. The difference from staff contracts is that these three
-- documents are global rather than per-staff-member, and a single consent
-- action writes one acceptance row per document type.
--
-- See shared/schema/legal-documents.ts for the Drizzle mirror.

CREATE TABLE IF NOT EXISTS legal_documents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL UNIQUE, -- terms_and_conditions | privacy_policy | data_usage_policy
  title text NOT NULL,
  current_version_id varchar, -- FK added below, once legal_document_versions exists
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_document_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id varchar NOT NULL REFERENCES legal_documents(id),
  version_number integer NOT NULL,
  content_markdown text NOT NULL,
  content_hash text NOT NULL, -- sha256 of the exact markdown shown - the immutability anchor
  created_by_admin_id varchar REFERENCES super_admins(id), -- nullable: the seeded v1 row below has no real admin author
  created_at timestamp NOT NULL DEFAULT now(),
  superseded_at timestamp,
  CONSTRAINT legal_document_versions_document_version_unique UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_legal_document_versions_document ON legal_document_versions (document_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'legal_documents_current_version_fkey'
  ) THEN
    ALTER TABLE legal_documents
      ADD CONSTRAINT legal_documents_current_version_fkey
      FOREIGN KEY (current_version_id) REFERENCES legal_document_versions(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS legal_document_acceptances (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id varchar NOT NULL REFERENCES legal_documents(id),
  document_version_id varchar NOT NULL REFERENCES legal_document_versions(id),
  user_id varchar NOT NULL REFERENCES users(id),
  organisation_id varchar REFERENCES organisations(id),
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  content_hash_at_acceptance text NOT NULL,
  accepted_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_document_acceptances_user ON legal_document_acceptances (user_id);
CREATE INDEX IF NOT EXISTS idx_legal_document_acceptances_document ON legal_document_acceptances (document_id);

-- One-time blocking "your 14-day free trial starts now" notice shown to a
-- new owner right after signup (client/src/components/trial-welcome-notice.tsx).
-- This is a single timestamp, not versioned legal-document content, so it
-- lives directly on organisations next to trial_ends_at. Never backfilled
-- for pre-existing orgs - unlike legal-document consent, this is an
-- informational notice, not a legal acceptance record.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS trial_consent_accepted_at timestamp;

-- Seed the three document rows + a placeholder version 1 each, so the app
-- never has a document type with no current version. Only runs for a
-- document_type that doesn't already exist, so this never overwrites real
-- content on a deployment where a super admin has already published.
DO $$
DECLARE
  rec RECORD;
  new_doc_id varchar;
  new_version_id varchar;
  seed_content text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
      ('terms_and_conditions', 'Terms and Conditions'),
      ('privacy_policy', 'Privacy Policy'),
      ('data_usage_policy', 'Data Usage Policy')
    ) AS t(document_type, title)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM legal_documents WHERE document_type = rec.document_type) THEN
      seed_content := '# ' || rec.title || E'\n\nThis document has not been finalized yet. Check back soon, or contact support with any questions.';

      INSERT INTO legal_documents (document_type, title)
      VALUES (rec.document_type, rec.title)
      RETURNING id INTO new_doc_id;

      INSERT INTO legal_document_versions (document_id, version_number, content_markdown, content_hash, created_by_admin_id)
      VALUES (new_doc_id, 1, seed_content, encode(sha256(convert_to(seed_content, 'UTF8')), 'hex'), NULL)
      RETURNING id INTO new_version_id;

      UPDATE legal_documents SET current_version_id = new_version_id WHERE id = new_doc_id;
    END IF;
  END LOOP;
END $$;
