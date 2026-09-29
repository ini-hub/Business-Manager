CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "organisation_id" varchar,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "revoked_reason" text
);
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_active" ON "auth_sessions" ("user_id") WHERE "revoked_at" IS NULL;
