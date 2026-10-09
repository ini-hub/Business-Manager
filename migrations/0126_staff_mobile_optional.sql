-- A staff member's personal mobile number is theirs to provide: the add-staff form now collects
-- only an optional work phone, so staff.mobile_number may be empty until the staff member sets it
-- in their own profile. NULLs don't collide in staff_store_mobile_unique.
--
-- Idempotent. Ends with a check that RAISEs if the change did not land (see 0057).

ALTER TABLE staff ALTER COLUMN mobile_number DROP NOT NULL;
UPDATE staff SET mobile_number = NULL WHERE mobile_number = '';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'staff' AND column_name = 'mobile_number' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'staff.mobile_number is still NOT NULL';
  END IF;
END $$;
