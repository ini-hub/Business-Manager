ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "carry_forward_amount" NUMERIC(12, 2) NOT NULL DEFAULT 0;
