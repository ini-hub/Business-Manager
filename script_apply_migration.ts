import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("🚀 Starting database schema migration for Payroll V2...");

  const queries = [
    // Alter settings table
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "default_payment_method" text NOT null DEFAULT 'hybrid';`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "commission_type" text NOT null DEFAULT 'percentage';`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "commission_fixed_amount" real NOT null DEFAULT 0;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "commission_formula" text NOT null DEFAULT 'formula_b';`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "leave_day_rate" real NOT null DEFAULT 0;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_leave_days" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "holiday_day_rate" real NOT null DEFAULT 0;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_holiday_days" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "off_day_rate" real NOT null DEFAULT 0;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_off_days" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "lead_split_2" integer NOT null DEFAULT 80;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "asst_split_2" integer NOT null DEFAULT 20;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "lead_split_3" integer NOT null DEFAULT 60;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "asst1_split_3" integer NOT null DEFAULT 20;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "asst2_split_3" integer NOT null DEFAULT 20;`,
    `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "fixed_base_amount" real NOT null DEFAULT 30000;`,

    // Alter staff table
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "override_payment_method" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "override_commission" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "commission_type_override" text;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "commission_fixed_amount_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "override_formula" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "commission_formula_override" text;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "override_attendance_rates" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "active_day_rate_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "passive_day_rate_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "leave_day_rate_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "pay_leave_days_override" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "holiday_day_rate_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "pay_holiday_days_override" boolean NOT null DEFAULT false;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "off_day_rate_override" real;`,
    `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "pay_off_days_override" boolean NOT null DEFAULT false;`,

    // Alter payroll_entries table
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "leave_days" integer NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "holiday_days" integer NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "off_days" integer NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "absent_days" integer NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "leave_pay" real NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "holiday_pay" real NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "off_day_pay" real NOT null DEFAULT 0;`,
    `ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "calculation_details" jsonb;`
  ];

  for (const q of queries) {
    try {
      console.log(`Executing: ${q.substring(0, 50)}...`);
      await db.execute(sql.raw(q));
    } catch (e: any) {
      console.error(`Failed to execute query: ${q}`, e.message);
      process.exit(1);
    }
  }

  console.log("✅ Database schema migration applied successfully!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
