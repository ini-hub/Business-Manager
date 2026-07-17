// One-time backfill: populate business_id/store_id on historical audit_logs rows
// written before migration 0014 added those columns. Run this AFTER 0014 lands and
// BEFORE 0016 (the append-only trigger) is installed, since the trigger blocks the
// plain UPDATEs this script performs.
//
// Strategy:
//   1. business_id: join audit_logs.user_id -> users.business_id (covers rows where
//      the actor is known — most rows going forward once the getUserId() fix ships;
//      historically many rows have a null user_id due to the getUserId() bug, so
//      this alone won't resolve everything).
//   2. store_id: look up audit_logs.resource_id against the storeId column of the
//      table matching audit_logs.resource, for the resource types that carry a
//      direct storeId (inventory, expense, customer, staff, vendor, salary_advance,
//      payroll_period). Anything else — or any row whose resourceId no longer
//      resolves because the record was hard-deleted — is left null and reported.
//
// Rows that remain unresolved after this script are still fully queryable via the
// existing users-join fallback in storage.getAuditLogs(); this script only improves
// the fast path, it isn't required for correctness.

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const STORE_SCOPED_RESOURCES: Record<string, string> = {
  inventory: "inventory",
  expense: "expenses",
  customer: "customers",
  staff: "staff",
  vendor: "vendors",
  vendor_bill: "vendor_bills",
  salary_advance: "salary_advances",
  payroll_period: "payroll_periods",
  payroll_deduction: "payroll_deductions",
  payroll_disbursement: "payroll_disbursements",
};

async function main() {
  console.log("=== Backfilling audit_logs.business_id / store_id ===");

  const businessIdResult = await db.execute(sql`
    UPDATE audit_logs a
    SET business_id = u.business_id
    FROM users u
    WHERE a.user_id = u.id
      AND a.business_id IS NULL
      AND u.business_id IS NOT NULL;
  `);
  console.log(`business_id backfilled from users: ${(businessIdResult as any).rowCount ?? "unknown"} rows`);

  for (const [resource, table] of Object.entries(STORE_SCOPED_RESOURCES)) {
    const result = await db.execute(sql`
      UPDATE audit_logs a
      SET store_id = t.store_id
      FROM ${sql.raw(table)} t
      WHERE a.resource = ${resource}
        AND a.resource_id = t.id::text
        AND a.store_id IS NULL;
    `);
    console.log(`store_id backfilled for resource="${resource}" from ${table}: ${(result as any).rowCount ?? "unknown"} rows`);
  }

  // business_id fallback: derive from store_id via stores.business_id for rows a
  // user_id join couldn't resolve (e.g. the getUserId() bug left user_id null).
  const businessFromStoreResult = await db.execute(sql`
    UPDATE audit_logs a
    SET business_id = s.business_id
    FROM stores s
    WHERE a.store_id = s.id
      AND a.business_id IS NULL;
  `);
  console.log(`business_id backfilled from store_id: ${(businessFromStoreResult as any).rowCount ?? "unknown"} rows`);

  const [{ count: unresolved }] = (await db.execute(sql`
    SELECT count(*)::int AS count FROM audit_logs WHERE business_id IS NULL;
  `)) as unknown as Array<{ count: number }>;
  console.log(`\nRows still unresolved (business_id IS NULL): ${unresolved}`);
  console.log("These remain readable via the existing users-join fallback in storage.getAuditLogs().");
  console.log("=== Backfill complete ===");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Backfill error:", err);
  process.exit(1);
});
