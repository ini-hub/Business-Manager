-- 0072_hr_guarantor_signing.sql
--
-- Guarantor form: the 3-party (employee / next-of-kin / guarantor) form
-- attached to this migration's plan, with ID/photo uploads and a signed
-- declaration. This mirrors staff_contracts / staff_contract_versions /
-- staff_contract_signatures (migration 0046) exactly in shape - one row per
-- staff, immutable versioned content, append-only signatures - with one
-- deliberate deviation:
--
--   The guarantor is not a users row (they have no login account), so
--   their signature is NOT captured through an authenticated POST like
--   staff-contract signing is. Instead the employee submits the form
--   (POST /api/hr/staff/:staffId/guarantor/submit, status flips to
--   pending_signature), and the guarantor signs through an
--   unauthenticated, short-lived signed-token link
--   (GET/POST /api/guarantor/... gated by a new guarantor token family in
--   server/auth.ts, the same family as contract_pending_token). This is the
--   one place in the HR module where a non-user party interacts with the
--   app directly.
--
-- hr_guarantor_form_versions stores a full immutable snapshot of all 3
-- parties' data plus the eligibility checklist (hard-coded, not
-- admin-configurable - it's a compliance checklist, not a display field)
-- and a sha256 content_hash as the immutability anchor, exactly like
-- staff_contract_versions.content_hash.
--
-- hr_guarantor_form_documents holds the per-party ID document + photo
-- uploads (up to 6 rows per version: 3 parties x 2 doc types), using the
-- same presigned-S3-URL pattern as staff contracts
-- (server/lib/objectStorage.ts).
--
-- hr_guarantor_form_signatures is append-only, capturing the declaration
-- fields from the attached form template (years known, relationship,
-- affirmation, liability acceptance) alongside the usual e-signature audit
-- trail (ip, user-agent, content hash at signing).
--
-- organisation_members.status gains a documented-only value
-- 'guarantor_pending' (free-text column, no ALTER needed - same convention
-- as 'contract_pending' from migration 0046): set when the guarantor
-- section is required-for-onboarding for the business and the linked
-- hr_guarantor_forms row is not yet 'signed'. See server/lib/authFlow.ts
-- and server/lib/hrProfileGate.ts.

CREATE TABLE IF NOT EXISTS hr_guarantor_forms (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             VARCHAR NOT NULL UNIQUE REFERENCES staff(id),
  current_version_id   VARCHAR,
  status               TEXT NOT NULL DEFAULT 'pending_submission',
    -- 'pending_submission' | 'pending_signature' | 'signed' | 'declined'
  declined_at          TIMESTAMP,
  declined_reason      TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_guarantor_form_versions (
  id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantor_form_id           VARCHAR NOT NULL REFERENCES hr_guarantor_forms(id),
  version_number               INTEGER NOT NULL,

  employee_title               TEXT,
  employee_surname             TEXT,
  employee_other_names         TEXT,
  employee_dob                 TEXT,
  employee_nin                 TEXT,
  employee_address             TEXT,
  employee_nearest_bus_stop    TEXT,
  employee_landmark            TEXT,
  employee_mobile              TEXT,
  employee_email               TEXT,

  nok_title                    TEXT,
  nok_surname                  TEXT,
  nok_other_names              TEXT,
  nok_dob                      TEXT,
  nok_nin                      TEXT,
  nok_address                  TEXT,
  nok_nearest_bus_stop         TEXT,
  nok_landmark                 TEXT,
  nok_mobile                   TEXT,
  nok_email                    TEXT,

  guarantor_title               TEXT,
  guarantor_surname             TEXT,
  guarantor_other_names         TEXT,
  guarantor_dob                 TEXT,
  guarantor_nin                 TEXT,
  guarantor_address             TEXT,
  guarantor_nearest_bus_stop    TEXT,
  guarantor_landmark            TEXT,
  guarantor_mobile              TEXT,
  guarantor_email               TEXT,
  guarantor_business_name       TEXT,
  guarantor_business_address    TEXT,
  guarantor_occupation          TEXT,
  guarantor_job_grade           TEXT,
  guarantor_official_email      TEXT,

  eligibility_checklist        JSONB NOT NULL,
  content_hash                 TEXT NOT NULL,
  created_by_user_id           VARCHAR NOT NULL REFERENCES users(id),
  created_at                   TIMESTAMP NOT NULL DEFAULT now(),
  superseded_at                TIMESTAMP,
  UNIQUE (guarantor_form_id, version_number)
);

ALTER TABLE hr_guarantor_forms
  ADD CONSTRAINT hr_guarantor_forms_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES hr_guarantor_form_versions(id);

CREATE TABLE IF NOT EXISTS hr_guarantor_form_documents (
  id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantor_form_version_id   VARCHAR NOT NULL REFERENCES hr_guarantor_form_versions(id),
  party                       TEXT NOT NULL, -- 'employee' | 'next_of_kin' | 'guarantor'
  doc_type                    TEXT NOT NULL, -- 'id_document' | 'photo'
  storage_key                 TEXT NOT NULL,
  file_mime_type              TEXT NOT NULL,
  file_size_bytes             INTEGER NOT NULL,
  file_original_name          TEXT NOT NULL,
  uploaded_at                 TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_guarantor_form_documents_version ON hr_guarantor_form_documents (guarantor_form_version_id);

CREATE TABLE IF NOT EXISTS hr_guarantor_form_signatures (
  id                              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantor_form_id               VARCHAR NOT NULL REFERENCES hr_guarantor_forms(id),
  guarantor_form_version_id       VARCHAR NOT NULL REFERENCES hr_guarantor_form_versions(id),
  staff_id                        VARCHAR NOT NULL REFERENCES staff(id),
  typed_full_name                 TEXT NOT NULL,
  years_known_employee            INTEGER NOT NULL,
  relationship_to_employee        TEXT NOT NULL,
  affirmed_read_and_agree         BOOLEAN NOT NULL,
  accepts_liability               BOOLEAN NOT NULL,
  consented_electronic_signature  BOOLEAN NOT NULL,
  ip_address                      TEXT NOT NULL,
  user_agent                      TEXT NOT NULL,
  content_hash_at_signing         TEXT NOT NULL,
  signed_at                       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_guarantor_form_signatures_staff ON hr_guarantor_form_signatures (staff_id);
CREATE INDEX IF NOT EXISTS idx_hr_guarantor_forms_status ON hr_guarantor_forms (status);
