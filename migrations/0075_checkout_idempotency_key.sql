-- 0075_checkout_idempotency_key.sql
--
-- POST /api/sales/checkout had no replay guard: the offline outbox
-- (client/src/components/offline-sync-manager.tsx) retries a queued sale
-- whenever the request looks like it failed, including "the write actually
-- succeeded but the response was lost." Without a guard that retry creates a
-- second checkout, a second stock decrement and a second revenue entry.
--
-- Mirrors the attendance_punches replay guard from migration 0038
-- (client_punch_id): the client generates one id per sale attempt and resends
-- the same id on every retry of that same sale. All checkout rows for one
-- sale share a receipt (one row per line item), so the guard lives on a
-- separate one-row-per-attempt table rather than on checkouts itself.
CREATE TABLE IF NOT EXISTS "checkout_idempotency_keys" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "client_checkout_id" varchar NOT NULL,
  "checkout_ids" jsonb NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_idempotency_store_client_id_unique"
  ON "checkout_idempotency_keys" ("store_id", "client_checkout_id");
