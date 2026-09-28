-- 0067_hr_time_off.sql
--
-- Time off is a ledger, not a field bag: hr_time_off_balances holds the
-- current available/used/earned per staff+leave_type, and every change to
-- it is written in the same transaction as a row in hr_time_off_history
-- (see HrTimeOffService), so the balance is always re-derivable from
-- history. hr_time_off_requests is the approval workflow; approving or
-- rejecting a request is what produces the matching history + balance
-- update.

CREATE TABLE IF NOT EXISTS hr_time_off_balances (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     VARCHAR NOT NULL REFERENCES staff(id),
  leave_type   TEXT NOT NULL, -- annual | sick | bereavement | maternity
  available    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  used         NUMERIC(8, 2) NOT NULL DEFAULT 0,
  earned       NUMERIC(8, 2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (staff_id, leave_type)
);

CREATE TABLE IF NOT EXISTS hr_time_off_requests (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            VARCHAR NOT NULL REFERENCES staff(id),
  leave_type          TEXT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  days_requested      NUMERIC(8, 2) NOT NULL,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  reviewed_by_user_id VARCHAR REFERENCES users(id),
  reviewed_at         TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_time_off_requests_staff ON hr_time_off_requests (staff_id, status);

CREATE TABLE IF NOT EXISTS hr_time_off_history (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       VARCHAR NOT NULL REFERENCES staff(id),
  request_id     VARCHAR REFERENCES hr_time_off_requests(id), -- nullable: manual adjustments have no request
  leave_type     TEXT NOT NULL,
  date           DATE NOT NULL,
  description    TEXT NOT NULL,
  used_days      NUMERIC(8, 2) NOT NULL DEFAULT 0,
  earned_days    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  balance_after  NUMERIC(8, 2) NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_time_off_history_staff_type ON hr_time_off_history (staff_id, leave_type, date);

-- Zero-balance seed rows for every currently active staff member, for each
-- leave type, so the UI never has to special-case "no row yet".
INSERT INTO hr_time_off_balances (staff_id, leave_type)
SELECT s.id, lt.leave_type
FROM staff s
CROSS JOIN (VALUES ('annual'), ('sick'), ('bereavement'), ('maternity')) AS lt(leave_type)
WHERE s.is_archived = false
ON CONFLICT (staff_id, leave_type) DO NOTHING;
