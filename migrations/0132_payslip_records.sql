-- payslip_records was defined in the Drizzle schema (shared/schema/payroll.ts) but no migration ever
-- created it, so databases built from migrations had no such table. Every payslip registration and
-- every payroll-period delete (which clears payslips first) failed with "Failed query".
-- Idempotent: databases built with drizzle-kit push already have it.

CREATE TABLE IF NOT EXISTS "payslip_records" (
  "id"                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"              varchar NOT NULL REFERENCES "stores"("id"),
  "period_id"             varchar NOT NULL REFERENCES "payroll_periods"("id"),
  "staff_id"              varchar NOT NULL REFERENCES "staff"("id"),
  "generated_by_user_id"  varchar REFERENCES "users"("id"),
  "gross_pay"             numeric(12,2),
  "net_pay"               numeric(12,2),
  "generated_at"          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payslip_records_period_idx" ON "payslip_records" ("period_id");
CREATE INDEX IF NOT EXISTS "payslip_records_staff_idx" ON "payslip_records" ("staff_id");
