-- Repairs the owner's auto-created staff record (server/routes/business.routes.ts,
-- POST /api/stores) for every organisation created before this shipped. That
-- code read name/phone off the JWT session payload, which carries neither
-- field, so every owner's own staff row silently got a "<Business> Owner"
-- placeholder name, "0000000000" for a mobile number, and role='manager'
-- (the comment there literally said "until an explicit 'owner' role is
-- needed"). Fixed going forward in that same file; this backfills every
-- existing occurrence by re-deriving the correct values from the owner's
-- real users row - the same source IdentitySync now keeps in step whenever
-- they edit their profile or verify a phone change.
--
-- Identifies "the owner's own staff row" as: staff.user_id is the same
-- account as an active 'owner' organisation_members row for the
-- organisation that owns staff.store_id. A person can only be an
-- organisation's owner by having signed up as one (server/routes.ts), so
-- this can't misidentify a regular staff member who happens to share a name.
--
-- Idempotent: re-running this only re-applies the same derived values.

DO $$
DECLARE
  rec RECORD;
  dial_code text;
  matched_code text;
  matched_local text;
  -- Every dial code shared/phone-utils.ts's countryCodes list knows about,
  -- longest first so a prefix match can never pick a shorter code that's
  -- itself a prefix of the real one (none currently overlap, but this stays
  -- correct if a code is ever added that does).
  dial_codes text[] := ARRAY[
    '+880', '+233', '+254', '+351', '+966', '+971',
    '+420', '+358', '+353',
    '+61', '+43', '+32', '+55', '+86', '+45', '+20', '+33', '+49', '+30',
    '+36', '+91', '+62', '+39', '+81', '+60', '+52', '+31', '+64', '+234',
    '+47', '+92', '+63', '+48', '+40', '+65', '+27', '+34', '+46', '+41',
    '+66', '+90', '+380', '+44',
    '+7', '+1'
  ];
BEGIN
  FOR rec IN
    SELECT s.id AS staff_id, u.name AS user_name, u.phone AS user_phone
    FROM staff s
    JOIN users u ON u.id = s.user_id
    JOIN stores st ON st.id = s.store_id
    JOIN organisation_members om
      ON om.user_id = s.user_id
     AND om.organisation_id = st.business_id
     AND om.role = 'owner'
     AND om.status = 'active'
  LOOP
    matched_code := NULL;
    matched_local := NULL;

    IF rec.user_phone IS NOT NULL THEN
      FOREACH dial_code IN ARRAY dial_codes LOOP
        IF rec.user_phone LIKE dial_code || '%' THEN
          matched_code := dial_code;
          matched_local := substring(rec.user_phone FROM length(dial_code) + 1);
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- Isolated per row: staff_store_mobile_unique (storeId, mobileNumber)
    -- could theoretically collide with another staff row at the same store
    -- already using that number - a real, if rare, edge case, same as
    -- IdentitySync's own best-effort handling. One collision must not abort
    -- the fix for every other organisation's owner.
    BEGIN
      UPDATE staff
      SET
        name = COALESCE(rec.user_name, name),
        mobile_number = COALESCE(matched_local, mobile_number),
        country_code = COALESCE(matched_code, country_code),
        role = 'owner'
      WHERE id = rec.staff_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Skipped staff row % - mobile number collision at its store', rec.staff_id;
    END;
  END LOOP;
END $$;
