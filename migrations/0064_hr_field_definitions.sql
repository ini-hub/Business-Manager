-- 0064_hr_field_definitions.sql
--
-- The dynamic field builder behind the HR profile module's "Personal" and
-- "Job (current state)" sections. These are the only two sections backed by
-- a generic field-definition/field-value pair rather than a fixed table:
-- they're flat, single-value-per-staff fields with no relational structure,
-- exactly what a super admin should be able to add/remove/reorder per
-- business. Every other HR section (job history, time off, emergency
-- contacts, documents, benefits, disciplinary, guarantor) has real
-- structure/history/workflow and gets its own fixed table in a later
-- migration instead.
--
-- hr_field_definitions - one row per configurable field, per business, per
-- section. is_system_field rows are seeded below for every field named in
-- the product spec, so a business gets a sane default form immediately; a
-- system field may be relabeled/reordered/disabled but never deleted
-- (enforced in HrFieldDefinitionService, not the DB) since deleting it
-- would orphan any hr_field_values already collected against it.
--
-- hr_field_values - typed value columns (value_text/value_number/
-- value_date/value_boolean/value_json), not a single jsonb blob. The
-- field's field_type deterministically says which column holds the value,
-- so the onboarding gate's required-field check stays a simple NULL check
-- instead of a jsonb ->> cast. value_json is reserved for multiselect only.

CREATE TABLE IF NOT EXISTS hr_field_definitions (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     VARCHAR NOT NULL REFERENCES organisations(id),
  section         TEXT NOT NULL, -- 'personal' | 'job_current'
  field_key       TEXT NOT NULL,
  label           TEXT NOT NULL,
  field_type      TEXT NOT NULL, -- text | textarea | number | date | select | multiselect | boolean | email | phone
  options         JSONB,         -- [{value, label}] - select/multiselect only
  is_required     BOOLEAN NOT NULL DEFAULT false,
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_system_field BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (business_id, section, field_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_field_definitions_business_section
  ON hr_field_definitions (business_id, section, sort_order);

CREATE TABLE IF NOT EXISTS hr_field_values (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             VARCHAR NOT NULL REFERENCES staff(id),
  field_definition_id  VARCHAR NOT NULL REFERENCES hr_field_definitions(id),
  value_text           TEXT,
  value_number         NUMERIC(18, 4),
  value_date           TIMESTAMP,
  value_boolean        BOOLEAN,
  value_json           JSONB,
  updated_by_user_id   VARCHAR REFERENCES users(id),
  updated_at           TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (staff_id, field_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_field_values_staff ON hr_field_values (staff_id);

-- Seed default (is_system_field = true) Personal fields for every existing
-- business, in the order listed in the product spec.
INSERT INTO hr_field_definitions (business_id, section, field_key, label, field_type, is_system_field, sort_order)
SELECT o.id, 'personal', f.field_key, f.label, f.field_type, true, f.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('employee_id', 'Employee ID', 'text', 0),
  ('first_name', 'First Name', 'text', 1),
  ('middle_name', 'Middle Name', 'text', 2),
  ('last_name', 'Last Name', 'text', 3),
  ('date_of_birth', 'Date of Birth', 'date', 4),
  ('nationality', 'Nationality', 'text', 5),
  ('nationality_id', 'Nationality ID', 'text', 6),
  ('gender', 'Gender', 'select', 7),
  ('marital_status', 'Marital Status', 'select', 8),
  ('allergies', 'Allergies', 'textarea', 9),
  ('bvn', 'BVN', 'text', 10),
  ('ssn', 'SSN', 'text', 11),
  ('shirt_size', 'Shirt Size', 'select', 12),
  ('address_street1', 'Street 1', 'text', 13),
  ('address_city', 'City', 'text', 14),
  ('address_state', 'State', 'text', 15),
  ('address_postcode', 'Postcode', 'text', 16),
  ('address_country', 'Country', 'text', 17),
  ('work_phone', 'Work Phone', 'phone', 18),
  ('work_phone_ext', 'Work Phone Ext', 'text', 19),
  ('mobile_number', 'Mobile Number', 'phone', 20),
  ('work_email', 'Work Email', 'email', 21),
  ('home_email', 'Home Email', 'email', 22),
  ('linkedin', 'LinkedIn', 'text', 23),
  ('x_handle', 'X', 'text', 24),
  ('instagram', 'Instagram', 'text', 25),
  ('facebook', 'Facebook', 'text', 26),
  ('tiktok', 'TikTok', 'text', 27)
) AS f(field_key, label, field_type, sort_order)
ON CONFLICT (business_id, section, field_key) DO NOTHING;

-- Seed default Job (current state) fields.
INSERT INTO hr_field_definitions (business_id, section, field_key, label, field_type, is_system_field, sort_order)
SELECT o.id, 'job_current', f.field_key, f.label, f.field_type, true, f.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('hire_date', 'Hire Date', 'date', 0),
  ('team', 'Team', 'text', 1),
  ('people_business_partner', 'People Business Partner / Manager', 'text', 2),
  ('employment_status', 'Employment Status', 'select', 3),
  ('confirmation_date', 'Confirmation Date', 'date', 4),
  ('confirmation_status', 'Confirmation Status', 'select', 5)
) AS f(field_key, label, field_type, sort_order)
ON CONFLICT (business_id, section, field_key) DO NOTHING;

-- select-type system fields need default options so they render usably out
-- of the box; admins can edit these afterwards like any other field.
UPDATE hr_field_definitions SET options = '[{"value":"male","label":"Male"},{"value":"female","label":"Female"},{"value":"other","label":"Other"}]'::jsonb
  WHERE field_key = 'gender' AND section = 'personal' AND options IS NULL;
UPDATE hr_field_definitions SET options = '[{"value":"single","label":"Single"},{"value":"married","label":"Married"},{"value":"divorced","label":"Divorced"},{"value":"widowed","label":"Widowed"}]'::jsonb
  WHERE field_key = 'marital_status' AND section = 'personal' AND options IS NULL;
UPDATE hr_field_definitions SET options = '[{"value":"xs","label":"XS"},{"value":"s","label":"S"},{"value":"m","label":"M"},{"value":"l","label":"L"},{"value":"xl","label":"XL"},{"value":"xxl","label":"XXL"}]'::jsonb
  WHERE field_key = 'shirt_size' AND section = 'personal' AND options IS NULL;
UPDATE hr_field_definitions SET options = '[{"value":"active","label":"Active"},{"value":"on_leave","label":"On Leave"},{"value":"terminated","label":"Terminated"}]'::jsonb
  WHERE field_key = 'employment_status' AND section = 'job_current' AND options IS NULL;
UPDATE hr_field_definitions SET options = '[{"value":"pending","label":"Pending"},{"value":"confirmed","label":"Confirmed"}]'::jsonb
  WHERE field_key = 'confirmation_status' AND section = 'job_current' AND options IS NULL;
