-- 0065_hr_section_config.sql
--
-- Per-business enable/require toggles for the 8 HR profile sections
-- (personal, job, time_off, emergency, documents, benefits, disciplinary,
-- guarantor). Field-level required/enabled/order for the two dynamic
-- sections lives on hr_field_definitions (migration 0064) - this table only
-- covers whole-section on/off and whether a section blocks onboarding.
--
-- Seeded per existing business with the product's stated defaults:
-- personal/emergency/guarantor required before a new staff member gets full
-- access, everything else enabled but not required. hrProfileGate.ts
-- (server/lib) reads this table directly and never hard-codes a fallback -
-- a missing row for a section would be a data bug, not "use the default".

CREATE TABLE IF NOT EXISTS hr_section_config (
  id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                 VARCHAR NOT NULL REFERENCES organisations(id),
  section                     TEXT NOT NULL,
  is_enabled                  BOOLEAN NOT NULL DEFAULT true,
  is_required_for_onboarding  BOOLEAN NOT NULL DEFAULT false,
  updated_at                  TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (business_id, section)
);

INSERT INTO hr_section_config (business_id, section, is_enabled, is_required_for_onboarding)
SELECT o.id, s.section, true, s.required
FROM organisations o
CROSS JOIN (VALUES
  ('personal', true),
  ('job', false),
  ('time_off', false),
  ('emergency', true),
  ('documents', false),
  ('benefits', false),
  ('disciplinary', false),
  ('guarantor', true)
) AS s(section, required)
ON CONFLICT (business_id, section) DO NOTHING;
