-- One staff person, many store assignments.
--
-- staff.id stays the person and staff.store_id stays their HOME store (pay,
-- payroll, seat and contract all remain keyed to it). staff_store_assignments
-- is the authority for "which stores may this person work in". Every existing
-- staff row gets one home assignment, so access is unchanged until the access
-- layer starts reading this table.
--
-- Additive and idempotent. Ends with a check that every staff row has a home
-- assignment, so a partial backfill fails the migration instead of shipping.

CREATE TABLE IF NOT EXISTS staff_store_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id varchar NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  store_id varchar NOT NULL REFERENCES stores(id),
  staff_number text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  punch_pin_hash text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT staff_assignment_person_store_unique UNIQUE (staff_id, store_id),
  CONSTRAINT staff_assignment_store_number_unique UNIQUE (store_id, staff_number)
);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_store ON staff_store_assignments (store_id);

INSERT INTO staff_store_assignments (staff_id, store_id, staff_number, role, punch_pin_hash, is_archived, created_at)
SELECT s.id, s.store_id, s.staff_number, s.role, s.punch_pin_hash, s.is_archived, s.created_at
FROM staff s
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM staff s
    WHERE NOT EXISTS (
      SELECT 1 FROM staff_store_assignments a
      WHERE a.staff_id = s.id AND a.store_id = s.store_id
    )
  ) THEN
    RAISE EXCEPTION '0129: some staff rows have no home assignment after backfill';
  END IF;
END $$;
