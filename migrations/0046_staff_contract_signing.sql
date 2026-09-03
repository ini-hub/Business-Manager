-- 0046_staff_contract_signing.sql
--
-- Staff onboarding e-signature. A manager may attach an employment contract
-- (uploaded file, uploaded image, or typed text) to a staff row at creation
-- time. When one is attached, the invited staff member must review and sign
-- it — after setting their password, as a separate step — before their
-- membership is ever flipped to "active". See StaffContractService for the
-- write path and server/routes.ts (set-activated-password / login) for the
-- enforcement choke point.
--
-- This is deliberately three tables, not one boolean:
--
--   staff_contracts          - one row per staff member: current status +
--                               a pointer at whichever version is "current".
--   staff_contract_versions  - immutable content history. A manager editing
--                               or replacing a not-yet-signed contract INSERTs
--                               a new version and repoints current_version_id
--                               rather than mutating content in place, so the
--                               exact document a staff member was shown is
--                               preserved forever under its own id.
--   staff_contract_signatures - append-only audit record of the actual
--                               signing event (typed name, explicit
--                               affirmation + e-signature consent, IP,
--                               user-agent, timestamp, and a copy of the
--                               version's content hash at signing time).
--
-- current_version_id existing as its own pointer (rather than "the latest
-- version row") is what leaves room for a future contract-amendment feature
-- (a raise, a policy update) without another schema change: that feature
-- just inserts version N+1 and flips status back to pending_signature.
--
-- Rollout is staff-created-after-this-ships only, and enforcement is
-- additionally keyed off organisation_members.activated_at being NULL — see
-- server/routes.ts. No backfill, no cutover column: a staff row created
-- before this migration (or created after it without a contract attached)
-- simply never gets a staff_contracts row, and the gate is a no-op for them.
--
-- staff.signed_contract (a bare, undocumented manager checkbox predating any
-- of this) is left untouched for historical rows and is NOT backfilled —
-- there is no document behind it to backfill against. Application code stops
-- treating it as meaningful once a staff_contracts row exists for that staff
-- member. A follow-up migration can drop it once product confirms no
-- report/export still reads it.

CREATE TABLE IF NOT EXISTS staff_contracts (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id              VARCHAR NOT NULL UNIQUE REFERENCES staff(id),
  current_version_id    VARCHAR,
  status                TEXT NOT NULL DEFAULT 'pending_signature',
    -- 'pending_signature' | 'signed' | 'declined'
  declined_at           TIMESTAMP,
  declined_reason       TEXT,
  declined_ip           TEXT,
  declined_user_agent   TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_contract_versions (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_contract_id     VARCHAR NOT NULL REFERENCES staff_contracts(id),
  version_number        INTEGER NOT NULL,
  contract_type         TEXT NOT NULL, -- 'file' | 'image' | 'text'
  storage_key           TEXT,          -- S3 object key; file/image only
  file_mime_type        TEXT,
  file_size_bytes       INTEGER,
  file_original_name    TEXT,
  content_text          TEXT,          -- plain text only; text contracts only
  alt_text              TEXT,          -- accessibility text; required for image contracts (app-enforced)
  content_hash          TEXT NOT NULL, -- sha256 of the exact bytes/text shown to the staff member
  created_by_user_id    VARCHAR NOT NULL REFERENCES users(id),
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMP,     -- set when a later version replaces this one before it was ever signed
  UNIQUE (staff_contract_id, version_number)
);

ALTER TABLE staff_contracts
  ADD CONSTRAINT staff_contracts_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES staff_contract_versions(id);

CREATE TABLE IF NOT EXISTS staff_contract_signatures (
  id                              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_contract_id               VARCHAR NOT NULL REFERENCES staff_contracts(id),
  staff_contract_version_id       VARCHAR NOT NULL REFERENCES staff_contract_versions(id),
  staff_id                        VARCHAR NOT NULL REFERENCES staff(id), -- denormalized, avoids a join for common queries
  user_id                         VARCHAR NOT NULL REFERENCES users(id), -- who actually signed
  typed_full_name                 TEXT NOT NULL,
  affirmed_read_and_agree         BOOLEAN NOT NULL,
  consented_electronic_signature  BOOLEAN NOT NULL,
  ip_address                      TEXT NOT NULL,
  user_agent                      TEXT NOT NULL,
  content_hash_at_signing         TEXT NOT NULL,
  signed_at                       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_contracts_status ON staff_contracts (status);
CREATE INDEX IF NOT EXISTS idx_staff_contract_versions_contract ON staff_contract_versions (staff_contract_id);
CREATE INDEX IF NOT EXISTS idx_staff_contract_signatures_staff ON staff_contract_signatures (staff_id);

-- ─── organisation_members: new intermediate status ─────────────────────────
-- organisation_members.status has no DB-level check constraint (see
-- shared/schema/auth.ts — it's a free-text column, values enforced only in
-- application code), so no ALTER is needed to introduce a new value. Adding
-- it here in a comment for the same reason 0041/0045 document their
-- rationale inline:
--
--   'contract_pending' — password has been set (the account is otherwise
--   fully activated) but the linked staff member has a staff_contracts row
--   still in 'pending_signature' or 'declined'. Distinct from 'partial'
--   (code verified, password NOT yet set) so the two "not active yet"
--   reasons never get conflated by anything that branches on status. A
--   member only ever passes through 'contract_pending' on its way from
--   'pending'/'partial' to 'active' — see set-activated-password and
--   POST /api/contract/sign in server/routes.ts.
