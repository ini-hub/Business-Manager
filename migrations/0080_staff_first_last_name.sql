-- 0080_staff_first_last_name.sql
--
-- Splits staff.name into first_name/last_name at the source, so it can be
-- collected as two fields at staff creation and mirrored losslessly onto the
-- HR "complete profile" first_name/last_name fields (server/lib/hrDefaults.ts)
-- via server/services/IdentitySync.ts, with no guessing at word boundaries.
--
-- staff.name itself is kept (every existing read site - contracts
-- e-signature matching, invite emails, staff list, reports - still reads it
-- unchanged) but becomes a DERIVED column from here on: StaffRepository
-- recomputes it as `${firstName} ${lastName}` on every create/update rather
-- than accepting it as independently-typed input. This one-time backfill
-- uses the same first-word/rest heuristic that was already the accepted
-- approximation for existing rows - going forward there is no more guessing
-- because first_name/last_name are the real source of truth.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "first_name" text;
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "last_name" text;

UPDATE "staff"
SET
  "first_name" = split_part(trim("name"), ' ', 1),
  "last_name" = NULLIF(trim(substring(trim("name") from length(split_part(trim("name"), ' ', 1)) + 1)), '')
WHERE "first_name" IS NULL;
