-- 0076_gamification_points_badges_streaks.sql
--
-- Adds the gamification feature: points, badges and streaks for customers,
-- staff and business owners. See shared/schema/gamification.ts and
-- shared/gamification/badges.ts.
--
-- Points are append-only (gamification_points_ledger) rather than a mutable
-- running total, matching the auditability reasoning behind
-- checkout_idempotency_keys/transactions elsewhere in this schema: a point
-- balance an owner disputes needs a trail, not just a number. Badge
-- definitions themselves are NOT a table - they are product copy + rules
-- that live in code (shared/gamification/badges.ts); this migration only
-- creates the join table recording that a subject earned one.
CREATE TABLE IF NOT EXISTS "gamification_points_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "subject_type" text NOT NULL,
  "subject_id" varchar NOT NULL,
  "points" integer NOT NULL,
  "reason" text NOT NULL,
  "source_type" text,
  "source_id" varchar,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_gamification_points_subject"
  ON "gamification_points_ledger" ("store_id", "subject_type", "subject_id");

CREATE TABLE IF NOT EXISTS "gamification_badge_awards" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "subject_type" text NOT NULL,
  "subject_id" varchar NOT NULL,
  "badge_key" text NOT NULL,
  "awarded_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "gamification_badge_award_unique"
  ON "gamification_badge_awards" ("store_id", "subject_type", "subject_id", "badge_key");

CREATE INDEX IF NOT EXISTS "idx_gamification_badges_subject"
  ON "gamification_badge_awards" ("store_id", "subject_type", "subject_id");

CREATE TABLE IF NOT EXISTS "gamification_streaks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "subject_type" text NOT NULL,
  "subject_id" varchar NOT NULL,
  "streak_type" text NOT NULL,
  "current_count" integer NOT NULL DEFAULT 0,
  "longest_count" integer NOT NULL DEFAULT 0,
  "last_qualifying_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "gamification_streak_unique"
  ON "gamification_streaks" ("store_id", "subject_type", "subject_id", "streak_type");
