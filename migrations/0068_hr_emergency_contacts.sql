-- 0068_hr_emergency_contacts.sql
--
-- Fixed field set per the product spec, multiple rows per staff member.
-- No dynamic field builder needed here - unlike Personal/Job-current, the
-- field set is small, fixed, and not something a business would want to
-- extend.

CREATE TABLE IF NOT EXISTS hr_emergency_contacts (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id           VARCHAR NOT NULL REFERENCES staff(id),
  name               TEXT NOT NULL,
  relationship       TEXT,
  work_phone         TEXT,
  work_phone_ext     TEXT,
  home_phone         TEXT,
  mobile             TEXT,
  email              TEXT,
  address_street1    TEXT,
  address_street2    TEXT,
  address_city       TEXT,
  address_state      TEXT,
  address_postcode   TEXT,
  address_country    TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_emergency_contacts_staff ON hr_emergency_contacts (staff_id);
