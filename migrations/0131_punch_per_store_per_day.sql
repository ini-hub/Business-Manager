-- One clock-in and one clock-out per person per STORE per day (was: per person per day).
--
-- A person assigned to several stores (staff_store_assignments, 0129) can really work two of them in
-- one day. The old key (staff_id, local_date, kind) refused their second clock-in with "already clocked
-- in today". The new key adds store_id, so each store keeps its own punch and day record. Lateness for the
-- day is still judged once, on the first clock-in (AttendanceService), not by this index.
--
-- The new keys are supersets of the old ones, so existing data cannot violate them. New names, so the
-- statement is idempotent, and the old indexes are dropped last. The predicates match 0038 (voided punches
-- and decided requests do not count) — a database built from the Drizzle schema alone had them without
-- predicates, which is stricter, so it also satisfies these.

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_store_day_kind_unique"
  ON "attendance_punches" ("staff_id", "store_id", "local_date", "kind")
  WHERE "voided_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_retro_request_store_pending_unique"
  ON "attendance_retro_requests" ("staff_id", "store_id", "date")
  WHERE "status" = 'pending';

DROP INDEX IF EXISTS "attendance_punch_day_kind_unique";
DROP INDEX IF EXISTS "attendance_retro_request_pending_unique";

DO $$
BEGIN
  IF to_regclass('public.attendance_punch_store_day_kind_unique') IS NULL
     OR to_regclass('public.attendance_retro_request_store_pending_unique') IS NULL THEN
    RAISE EXCEPTION '0131: the per-store punch indexes were not created';
  END IF;
  IF to_regclass('public.attendance_punch_day_kind_unique') IS NOT NULL
     OR to_regclass('public.attendance_retro_request_pending_unique') IS NOT NULL THEN
    RAISE EXCEPTION '0131: an old per-person punch index is still present';
  END IF;
END $$;
