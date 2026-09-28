-- 0071_hr_disciplinary.sql
--
-- Append-style incident log. incident_date/closed_date/complaint_issued_by/
-- description/action per the product spec; manager-only write access is
-- enforced in server/routes/hr.routes.ts, not the schema.

CREATE TABLE IF NOT EXISTS hr_disciplinary_records (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             VARCHAR NOT NULL REFERENCES staff(id),
  incident_date        DATE NOT NULL,
  closed_date          DATE,
  complaint_issued_by  TEXT,
  description          TEXT NOT NULL,
  action               TEXT,
  created_by_user_id   VARCHAR NOT NULL REFERENCES users(id),
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_disciplinary_records_staff ON hr_disciplinary_records (staff_id, incident_date);
