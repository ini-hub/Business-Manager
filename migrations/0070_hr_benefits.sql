-- 0070_hr_benefits.sql
--
-- hr_dependants is plain multi-row CRUD. hr_estate_beneficiaries carries a
-- "percentages across all rows for a staff member sum to 100" invariant
-- that Postgres cannot express as a cross-row CHECK constraint - it is
-- enforced in EstateBeneficiaryService inside a transaction with row
-- locking instead (see the schema file for the full rationale). No trigger
-- is added here deliberately, to keep the single enforcement point in
-- application code, testable with normal unit tests.

CREATE TABLE IF NOT EXISTS hr_dependants (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      VARCHAR NOT NULL REFERENCES staff(id),
  name          TEXT NOT NULL,
  relationship  TEXT,
  gender        TEXT,
  ssn           TEXT,
  birth_date    DATE,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_dependants_staff ON hr_dependants (staff_id);

CREATE TABLE IF NOT EXISTS hr_estate_beneficiaries (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      VARCHAR NOT NULL REFERENCES staff(id),
  name          TEXT NOT NULL,
  relationship  TEXT,
  address       TEXT,
  phone         TEXT,
  percentage    NUMERIC(5, 2) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_estate_beneficiaries_staff ON hr_estate_beneficiaries (staff_id);
