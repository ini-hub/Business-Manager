-- 0038_geofenced_clock_in.sql
--
-- Staff self-service clock-in, and a deduction for arriving late.
--
-- Attendance was previously a manager typing a status against a name once a
-- day: no time of arrival, no proof anyone was at the salon, and a daily chore
-- for whoever ran the branch. Two consequences followed. A staff member who
-- turned up at 11:30 was recorded exactly like one who opened at 09:00 and was
-- paid the same transport allowance. And the record was written by a third
-- party who was not necessarily watching the door.
--
-- This migration adds the pieces for staff to clock themselves in from their
-- own phone, inside a geofence around the branch, with lateness measured
-- against a configured opening time and charged as a separate, visible payroll
-- deduction. Transport computation itself is deliberately untouched.
--
-- Everything ships OFF: settings.clock_in_enabled defaults false and
-- default_weekly_off_days defaults to '[0]', which reproduces the hardcoded
-- "Sundays are off-days" rule the payroll engine used to carry inline. An
-- existing store sees no behaviour change until someone opts in.

-- ── Punches ─────────────────────────────────────────────────────────────────
-- Append-only event log, and the source of truth for arrival times.
--
-- Kept separate from attendance_records because that table is keyed
-- UNIQUE (store_id, staff_id, date) and is what the payroll engine reads. A day
-- needs many punches (in, out, a manager proxy, an offline replay arriving
-- late) and needs to keep both the time the device claimed and the time the
-- server actually received it. Neither fits under a one-row-per-day key.
CREATE TABLE IF NOT EXISTS "attendance_punches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "staff_id" varchar NOT NULL REFERENCES "staff"("id"),

  -- Store-local calendar date (YYYY-MM-DD), resolved server-side from the
  -- store's timezone. Never taken from the client.
  "local_date" text NOT NULL,
  "kind" text NOT NULL,           -- 'clock_in' | 'clock_out'
  "source" text NOT NULL,         -- 'self' | 'manager_proxy' | 'retro_approved' | 'offline_replay'

  -- The instant all lateness maths uses. For an online punch this is always the
  -- server clock; only a queued offline punch may supply its own, and only
  -- within settings.max_offline_punch_age_minutes.
  "effective_at" timestamp NOT NULL,
  "server_received_at" timestamp NOT NULL DEFAULT now(),
  "client_captured_at" timestamp,
  "clock_skew_seconds" integer,
  -- Set when the device clock disagreed with the server beyond tolerance, or
  -- claimed a time outside the acceptable queue window. A flagged punch may
  -- never clear a late flag on its own -- only a manager can.
  "time_divergence_flagged" boolean NOT NULL DEFAULT false,

  "latitude" numeric(9, 6),
  "longitude" numeric(9, 6),
  "accuracy_meters" numeric(8, 2),
  "distance_meters" numeric(10, 2),
  "within_geofence" boolean,

  -- Anti-collusion. The geofence cannot see the difference between five staff
  -- arriving and one staff member holding five sets of credentials at the
  -- salon, because both are inside the fence. The device identity can.
  "device_id" varchar,
  "user_agent" text,
  "ip_address" text,
  "device_trusted" boolean NOT NULL DEFAULT false,
  "shared_device_flagged" boolean NOT NULL DEFAULT false,

  -- Client-generated idempotency key, so a service worker replaying a queued
  -- punch after a flaky sync does not create a second one.
  "client_punch_id" varchar,

  "reason" text,                  -- mandatory for source = 'manager_proxy'
  "recorded_by_user_id" varchar REFERENCES "users"("id"),
  "voided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_attendance_punches_store_date"
  ON "attendance_punches" ("store_id", "local_date");

CREATE INDEX IF NOT EXISTS "idx_attendance_punches_staff_date"
  ON "attendance_punches" ("staff_id", "local_date");

-- Powers the "one device punched several people today" sweep.
CREATE INDEX IF NOT EXISTS "idx_attendance_punches_device_day"
  ON "attendance_punches" ("store_id", "local_date", "device_id")
  WHERE "device_id" IS NOT NULL;

-- Replay guard: the same queued punch arriving twice is a no-op, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_client_id_unique"
  ON "attendance_punches" ("staff_id", "client_punch_id")
  WHERE "client_punch_id" IS NOT NULL;

-- One clock-in and one clock-out per staff member per local day. Voided rows are
-- excluded so a manager can correct a mistaken punch without dropping the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_day_kind_unique"
  ON "attendance_punches" ("staff_id", "local_date", "kind")
  WHERE "voided_at" IS NULL;

-- ── Known devices ───────────────────────────────────────────────────────────
-- First punch from a device binds it to the staff member. An unrecognised device
-- is allowed but flagged for review rather than blocked: localStorage is cleared
-- by private browsing and evicted by iOS after a week of not using the site, so
-- hard-blocking would manufacture a support call every time someone's phone
-- forgot its id.
CREATE TABLE IF NOT EXISTS "staff_devices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "staff_id" varchar NOT NULL REFERENCES "staff"("id"),
  "device_id" varchar NOT NULL,
  "label" text,
  "user_agent" text,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "punch_count" integer NOT NULL DEFAULT 0,
  "approved_by_user_id" varchar REFERENCES "users"("id"),
  "approved_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_device_unique"
  ON "staff_devices" ("staff_id", "device_id");

CREATE INDEX IF NOT EXISTS "idx_staff_devices_store"
  ON "staff_devices" ("store_id");

-- ── Retro-requests ──────────────────────────────────────────────────────────
-- The escape hatch. The geofence is a hard block with no override, so a staff
-- member whose phone died, or whose GPS put them across the street, needs a way
-- to ask for the day back. clears_late_flag lets the manager restore attendance
-- and separately decide whether the arrival still counts as late -- without it,
-- approving a dead battery would either punish it or forgive every genuine
-- lateness alongside it.
CREATE TABLE IF NOT EXISTS "attendance_retro_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "staff_id" varchar NOT NULL REFERENCES "staff"("id"),
  "date" text NOT NULL,
  "requested_kind" text NOT NULL DEFAULT 'clock_in',
  "requested_at" timestamp NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  "clears_late_flag" boolean NOT NULL DEFAULT false,
  "decided_by_user_id" varchar REFERENCES "users"("id"),
  "decided_at" timestamp,
  "decision_note" text,
  "created_punch_id" varchar REFERENCES "attendance_punches"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- One open request per staff member per date.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_retro_request_pending_unique"
  ON "attendance_retro_requests" ("staff_id", "date")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "idx_attendance_retro_requests_store_status"
  ON "attendance_retro_requests" ("store_id", "status");

-- ── Rosters ─────────────────────────────────────────────────────────────────
-- weekly_off_days is a JSON array of day numbers, 0 = Sunday, matching
-- Date#getUTCDay so the roster reads the same way the payroll engine does.
CREATE TABLE IF NOT EXISTS "staff_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "staff_id" varchar NOT NULL REFERENCES "staff"("id"),
  "weekly_off_days" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_by_user_id" varchar REFERENCES "users"("id"),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_schedule_staff_unique"
  ON "staff_schedules" ("staff_id");

-- A specific date overriding the weekly pattern, in either direction: 'off' for
-- a day taken, 'working' for a day covered. Salons swap days constantly, and a
-- pure weekly pattern cannot express a swap.
CREATE TABLE IF NOT EXISTS "staff_schedule_exceptions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "staff_id" varchar NOT NULL REFERENCES "staff"("id"),
  "date" text NOT NULL,
  "kind" text NOT NULL,           -- 'off' | 'working'
  "reason" text,
  "created_by_user_id" varchar REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_schedule_exception_unique"
  ON "staff_schedule_exceptions" ("staff_id", "date");

CREATE INDEX IF NOT EXISTS "idx_staff_schedule_exceptions_store_date"
  ON "staff_schedule_exceptions" ("store_id", "date");

-- ── Attendance records: derived projection of the punch log ─────────────────
-- Written in the same request that records a punch, so PayrollService keeps
-- reading one table with one query and gains arrival times for free.
ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "first_clock_in_at" timestamp;

ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "last_clock_out_at" timestamp;

ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "is_late" boolean NOT NULL DEFAULT false;

ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "late_minutes" integer;

-- The opening time in force when the punch landed, snapshotted so that changing
-- the branch's hours next month does not silently rewrite last month's history.
ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "expected_start_time" text;

-- Clock-out is optional, so an unclosed shift is normal rather than an error.
-- The nightly sweep marks it and moves on; nothing punitive follows.
ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "shift_auto_closed" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_attendance_records_store_late"
  ON "attendance_records" ("store_id", "date")
  WHERE "is_late" = true;

-- ── Settings ────────────────────────────────────────────────────────────────
-- NOTE: every column here must also be added to the sanitizeSettings allowlist
-- in server/routes/settings.routes.ts. It is an explicit allowlist, so anything
-- missing from it is dropped silently on PUT /api/settings with a 200 OK.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "clock_in_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "geofence_latitude" numeric(9, 6);

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "geofence_longitude" numeric(9, 6);

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "geofence_place_label" text;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "geofence_radius_meters" integer NOT NULL DEFAULT 50;

-- A GPS fix reporting 80 m of error cannot prove a 50 m fence either way.
-- Readings worse than this are rejected as unusable rather than treated as
-- "outside" -- conflating the two is what turns the fallback into the daily path.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "geofence_max_accuracy_meters" integer NOT NULL DEFAULT 100;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "opening_time" text NOT NULL DEFAULT '09:00';

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "late_grace_minutes" integer NOT NULL DEFAULT 0;

-- Flat amount per late day. Deliberately uncapped: the business owner chose for
-- it to be able to exceed a day's transport. Where it exceeds the whole period's
-- pay, the existing mark-paid clamp writes the excess to
-- payroll_entries.carry_forward_amount and it is recovered next period.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "late_deduction_amount" numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "late_deduction_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "require_punch_pin" boolean NOT NULL DEFAULT false;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "max_offline_punch_age_minutes" integer NOT NULL DEFAULT 720;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "retro_request_max_age_days" integer NOT NULL DEFAULT 7;

-- '[0]' = Sunday, reproducing the rule that was hardcoded in PayrollService.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "default_weekly_off_days" jsonb NOT NULL DEFAULT '[0]'::jsonb;

-- ── Punch PIN ───────────────────────────────────────────────────────────────
-- Optional per-store second factor, distinct from the login password. Staff
-- share app passwords casually; a separate PIN means a shared password does not
-- by itself grant the ability to punch someone else in.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "punch_pin_hash" text;

-- ── Late-arrival deductions ─────────────────────────────────────────────────
-- One row per late DATE rather than one aggregate per staff member, for two
-- reasons. A manager needs to forgive a single day, and an aggregate row can
-- only be waived wholesale. And a per-date natural key is what lets the
-- re-sync be an idempotent ON CONFLICT DO NOTHING -- without it, the
-- recalculation that fires on every single sale would insert a duplicate
-- deduction each time.
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "late_date" text;

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_deduction_period_late_date_unique"
  ON "payroll_deductions" ("period_id", "staff_id", "late_date")
  WHERE "late_date" IS NOT NULL;
