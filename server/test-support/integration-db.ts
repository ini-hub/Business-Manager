import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import {
  organisations,
  stores,
  staff,
  customers,
  creditEntries,
  payrollPeriods,
  salaryAdvances,
} from "@shared/schema";

/**
 * Support for the `.itest.ts` suites, which run against a real Postgres.
 *
 * These tests exist because the properties worth guarding cannot be observed
 * from pure functions: that a row lock actually prevents a double repayment,
 * that a waived line survives the recalculation which fires on every sale, and
 * that settling shop debt moves wage expense, cash and the receivable in the
 * three different directions the books require.
 */

/**
 * Runtime re-check of the guard in vitest.integration.config.ts.
 *
 * The config refuses to start when TEST_DATABASE_URL is missing or equals
 * DATABASE_URL, but that check runs in the config process. This one runs in the
 * worker actually holding the connection, so a misconfigured run cannot reach
 * the point of deleting anything.
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const testUrl = process.env.TEST_DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is unset inside the test worker.");
  if (testUrl && url !== testUrl) {
    throw new Error(
      "Refusing to run: the worker's DATABASE_URL is not TEST_DATABASE_URL.\n" +
      "These tests delete rows and must never touch the working database."
    );
  }
}

/**
 * Confirms the test database has a schema, with an actionable message if not.
 *
 * `runMigrations()` cannot build one from empty: it seeds the pre-runner
 * migrations into `_migrations` as already-applied (server/migrate.ts), so on a
 * fresh database it would skip the files that create the base tables. Pushing
 * the Drizzle schema is the supported way to stand one up.
 */
export async function ensureSchema(): Promise<void> {
  const { rows } = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.payroll_deductions') IS NOT NULL AS present`
  );
  if (rows[0]?.present) {
    const { rows: colRows } = await pool.query<{ present: boolean }>(
      `SELECT COUNT(*) FILTER (WHERE column_name = 'is_waived') > 0 AS present
         FROM information_schema.columns WHERE table_name = 'payroll_deductions'`
    );
    if (colRows[0]?.present) return;
  }
  throw new Error(
    "The test database has no schema (or is out of date).\n\n" +
    "Stand it up once with:\n\n" +
    "  DATABASE_URL=\"$TEST_DATABASE_URL\" npx drizzle-kit push\n"
  );
}

export type Fixture = {
  businessId: string;
  storeId: string;
  staffId: string;
  /** Customer profile linked to the staff member via customers.staff_id. */
  customerId: string;
  /** Adds an open debt for the linked profile and returns its id. */
  addDebt: (amount: number, description?: string) => Promise<string>;
  /** Adds a second customer profile pointing at the same staff record. */
  addSecondProfile: () => Promise<string>;
  /** Adds an approved, unrecovered salary advance for the staff member. */
  addAdvance: (amount: number, opts?: { date?: string; notes?: string }) => Promise<string>;
  cleanup: () => Promise<void>;
};

let seq = 0;

/**
 * A self-contained store with one fixed-salary staff member and a customer
 * profile linked to them.
 *
 * Salary is `fixed` on purpose: netPay then comes straight from payPerMonth
 * with no dependence on attendance records or commission splits, so the
 * assertions here are about deduction and settlement rather than about the
 * commission engine, which has its own coverage.
 */
export async function createFixture(opts?: { payPerMonth?: number }): Promise<Fixture> {
  assertTestDatabase();
  const tag = `itest-${Date.now()}-${++seq}`;

  const [business] = await db.insert(organisations).values({
    name: `Integration Test Co ${tag}`,
  }).returning();

  const [store] = await db.insert(stores).values({
    businessId: business.id,
    name: `Test Store ${tag}`,
    code: `T${seq}${String(Date.now()).slice(-5)}`,
    timezone: "Africa/Lagos",
  }).returning();

  const [staffMember] = await db.insert(staff).values({
    storeId: store.id,
    name: "Ada Test",
    email: `ada-${tag}@example.test`,
    staffNumber: `S-${tag}`,
    mobileNumber: "08000000000",
    payPerMonth: opts?.payPerMonth ?? 120_000,
    paymentMethod: "fixed",
    // Without this flag the engine ignores payPerMonth/paymentMethod entirely
    // and falls back to settings.defaultPaymentMethod and
    // settings.fixedBaseAmount (PayrollService resolvedComp), which would make
    // netPay a store default rather than the figure these tests set.
    overridePaymentMethod: true,
  }).returning();

  const [customer] = await db.insert(customers).values({
    storeId: store.id,
    name: "Ada Test",
    customerNumber: `C-${tag}`,
    address: "",
    staffId: staffMember.id,
  }).returning();

  let debtSeq = 0;
  let profileSeq = 0;

  return {
    businessId: business.id,
    storeId: store.id,
    staffId: staffMember.id,
    customerId: customer.id,

    async addDebt(amount: number, description?: string) {
      const [entry] = await db.insert(creditEntries).values({
        storeId: store.id,
        customerId: customer.id,
        amountOwed: amount,
        amountPaidUpfront: 0,
        outstandingBalance: amount,
        description: description ?? `Checkout Receipt #TEST-${++debtSeq}`,
        status: "owing",
      }).returning();
      return entry.id;
    },

    async addSecondProfile() {
      const [extra] = await db.insert(customers).values({
        storeId: store.id,
        name: "Ada Test (duplicate)",
        customerNumber: `C2-${tag}-${++profileSeq}`,
        address: "",
        staffId: staffMember.id,
      }).returning();
      return extra.id;
    },

    async addAdvance(amount: number, opts?: { date?: string; notes?: string }) {
      const [advance] = await db.insert(salaryAdvances).values({
        storeId: store.id,
        staffId: staffMember.id,
        amount,
        outstandingBalance: amount,
        date: opts?.date ?? "2099-01-05",
        notes: opts?.notes ?? null,
        status: "approved",
        recoveryStatus: "unrecovered",
        isRecovered: false,
      }).returning();
      return advance.id;
    },

    cleanup: () => destroyStore(store.id, business.id),
  };
}

/**
 * Removes everything the fixture created, children before parents.
 *
 * Scoped to one store id rather than truncating tables, so a stray run against
 * a database holding other data still cannot take anything else with it.
 */
export async function destroyStore(storeId: string, businessId: string): Promise<void> {
  // payroll_deductions references repayments, credit_entries and
  // salary_advances, so it has to go before all three.
  await db.execute(sql`DELETE FROM payroll_deductions WHERE store_id = ${storeId}`);
  // payroll_postings.salary_advance_id also references salary_advances (the
  // disbursement posting) — has to go before it too, same reason.
  await db.execute(sql`DELETE FROM payroll_postings WHERE store_id = ${storeId}`);
  // salary_advances references payroll_periods (recovered_period_id), so it
  // has to go before that table too.
  await db.execute(sql`DELETE FROM salary_advances WHERE store_id = ${storeId}`);
  await db.execute(sql`
    DELETE FROM repayments r USING credit_entries ce
      WHERE r.credit_entry_id = ce.id AND ce.store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM credit_entries WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM payslip_records WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM payroll_disbursements WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM payroll_entries WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM payroll_periods WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM attendance_records WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM expenses WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM expense_categories WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM settings WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM customers WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM staff WHERE store_id = ${storeId}`);
  await db.execute(sql`DELETE FROM stores WHERE id = ${storeId}`);
  await db.execute(sql`DELETE FROM organisations WHERE id = ${businessId}`);
}

/** Creates a monthly payroll period covering a window that contains all debts. */
export async function createPeriod(storeId: string, startDate: string, endDate: string) {
  const [period] = await db.insert(payrollPeriods).values({
    storeId,
    periodType: "monthly",
    startDate,
    endDate,
    status: "pending",
  }).returning();
  return period;
}

/**
 * Clears residue left by an earlier run that died before its cleanup.
 *
 * A failed assertion aborts the test body, and a fixture created after that
 * point is never registered for teardown — so without this a red run leaves
 * stores behind that the next run would trip over. Matches only the
 * fixture-generated names, so nothing else in the database is at risk.
 */
export async function sweepResidue(): Promise<void> {
  assertTestDatabase();
  const { rows } = await pool.query<{ id: string; business_id: string }>(
    `SELECT id, business_id FROM stores WHERE name LIKE 'Test Store itest-%'`
  );
  for (const row of rows) {
    await destroyStore(row.id, row.business_id);
  }
  await pool.query(
    `DELETE FROM organisations WHERE name LIKE 'Integration Test Co itest-%'
       AND NOT EXISTS (SELECT 1 FROM stores WHERE stores.business_id = organisations.id)`
  );
}

/** vitest leaves the process hanging otherwise — the pg pool is a singleton. */
export async function closePool(): Promise<void> {
  await pool.end();
}
