-- 0066_hr_job_history.sql
--
-- Job info history tables. Unlike Personal/Job-current (migration 0064),
-- these are insert-only history tables, not a dynamic field bag - "current"
-- is whichever row has the max effective_date for a staff member. No
-- update/delete path is ever exposed; a correction is a new row.

CREATE TABLE IF NOT EXISTS hr_job_info_history (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            VARCHAR NOT NULL REFERENCES staff(id),
  effective_date      DATE NOT NULL,
  location            TEXT,
  division            TEXT,
  department          TEXT,
  job_title           TEXT,
  created_by_user_id  VARCHAR NOT NULL REFERENCES users(id),
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_job_info_history_staff ON hr_job_info_history (staff_id, effective_date);

CREATE TABLE IF NOT EXISTS hr_additional_job_info_history (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             VARCHAR NOT NULL REFERENCES staff(id),
  effective_date       DATE NOT NULL,
  employee_box_id      TEXT,
  legal_entity         TEXT,
  beneficiary_entity   TEXT,
  team                 TEXT,
  subteam              TEXT,
  job_family           TEXT,
  level                TEXT,
  comment              TEXT,
  created_by_user_id   VARCHAR NOT NULL REFERENCES users(id),
  created_at           TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_additional_job_info_history_staff ON hr_additional_job_info_history (staff_id, effective_date);
