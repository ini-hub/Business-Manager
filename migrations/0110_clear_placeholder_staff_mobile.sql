-- Clears the fake "0000000000" mobile number stamped on owner/trial staff rows
-- when the account had no phone. Rows whose linked user has a phone get the real
-- local number (users.phone is dial code + local digits); the rest are blanked
-- and are filled by IdentitySync when the owner verifies a phone. Idempotent.

-- 1. Backfill from the linked login phone where it starts with the row's dial code.
UPDATE staff s
SET mobile_number = substr(u.phone, length(s.country_code) + 1)
FROM users u
WHERE s.user_id = u.id
  AND s.mobile_number = '0000000000'
  AND u.phone LIKE s.country_code || '%'
  AND length(u.phone) > length(s.country_code)
  AND NOT EXISTS (
    SELECT 1 FROM staff o
    WHERE o.store_id = s.store_id AND o.id <> s.id
      AND o.mobile_number = substr(u.phone, length(s.country_code) + 1)
  );

-- 2. Blank whatever placeholder remains.
UPDATE staff s
SET mobile_number = ''
WHERE s.mobile_number = '0000000000'
  AND NOT EXISTS (
    SELECT 1 FROM staff o WHERE o.store_id = s.store_id AND o.id <> s.id AND o.mobile_number = ''
  );
