/**
 * Stock ledger reconciliation gate.
 *
 * `stock_movements` is an append-only record of every change to inventory.quantity. This gate
 * runs against real data and checks that the record and the stock agree. Modelled on
 * scripts/payroll-postings-parity.ts: not a unit test, because it needs a real database.
 * Exits non-zero on any mismatch so CI can gate on it.
 *
 * The checks:
 *   L1  every inventory row: quantity = SUM(stock_movements.delta)
 *   L2  every movement: delta = quantity_after - quantity_before
 *   L3  per inventory row, movements chain: each quantity_before equals the previous quantity_after
 *   L4  every inventory row has an opening_balance movement
 *   L5  no movement belongs to a different store than its inventory row
 *
 * A failure in L1 or L3 means some code path changed inventory.quantity without recording it
 * (or recorded it from a stale read). The report names the row so the path can be found.
 */

import { pool, db } from "../server/db";
import { sql } from "drizzle-orm";

const TOLERANCE = 0.0001;
const SAMPLE = 15;

type Failure = { check: string; detail: string };
const failures: Failure[] = [];

function fail(check: string, detail: string) {
  failures.push({ check, detail });
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function main() {
  const [{ n: inventoryCount }] = await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM inventory`);
  const [{ n: movementCount }] = await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM stock_movements`);
  console.log(`Checking ${inventoryCount} inventory rows against ${movementCount} movements\n`);

  // L1
  const drift = await rows<{ id: string; name: string; store_id: string; quantity: string; ledger: string }>(sql`
    SELECT i.id, i.name, i.store_id, i.quantity::text AS quantity, COALESCE(SUM(m.delta), 0)::text AS ledger
    FROM inventory i
    LEFT JOIN stock_movements m ON m.inventory_id = i.id
    GROUP BY i.id
    HAVING abs(i.quantity - COALESCE(SUM(m.delta), 0)) > ${TOLERANCE}
    ORDER BY abs(i.quantity - COALESCE(SUM(m.delta), 0)) DESC
  `);
  for (const r of drift.slice(0, SAMPLE)) {
    fail("L1", `"${r.name}" (${r.id}) store ${r.store_id}: stock ${r.quantity} but ledger sums to ${r.ledger}`);
  }
  if (drift.length > SAMPLE) fail("L1", `...and ${drift.length - SAMPLE} more rows with drift`);

  // L2
  const badDelta = await rows<{ id: string; inventory_id: string }>(sql`
    SELECT id, inventory_id FROM stock_movements
    WHERE abs(delta - (quantity_after - quantity_before)) > ${TOLERANCE}
    LIMIT ${SAMPLE}
  `);
  for (const r of badDelta) fail("L2", `movement ${r.id} on ${r.inventory_id}: delta does not equal after - before`);

  // L3
  const breaks = await rows<{ id: string; inventory_id: string; reason: string; expected: string; before: string }>(sql`
    SELECT id, inventory_id, reason, expected::text, before::text FROM (
      SELECT id, inventory_id, reason, quantity_before AS before,
             LAG(quantity_after) OVER (PARTITION BY inventory_id ORDER BY created_at, id) AS expected
      FROM stock_movements
    ) t
    WHERE expected IS NOT NULL AND abs(before - expected) > ${TOLERANCE}
    LIMIT ${SAMPLE}
  `);
  for (const r of breaks) {
    fail("L3", `movement ${r.id} (${r.reason}) on ${r.inventory_id}: started from ${r.before} but the previous movement ended at ${r.expected}`);
  }

  // L4
  const noOpening = await rows<{ id: string; name: string }>(sql`
    SELECT i.id, i.name FROM inventory i
    WHERE NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.inventory_id = i.id AND m.reason = 'opening_balance')
    LIMIT ${SAMPLE}
  `);
  for (const r of noOpening) fail("L4", `"${r.name}" (${r.id}) has no opening_balance movement`);

  // L5
  const crossStore = await rows<{ id: string; inventory_id: string }>(sql`
    SELECT m.id, m.inventory_id FROM stock_movements m
    JOIN inventory i ON i.id = m.inventory_id
    WHERE m.store_id <> i.store_id
    LIMIT ${SAMPLE}
  `);
  for (const r of crossStore) fail("L5", `movement ${r.id} is filed under a different store than item ${r.inventory_id}`);

  if (failures.length === 0) {
    console.log("PASS  L1–L5: the stock ledger agrees with inventory.quantity");
    return;
  }
  console.error(`FAIL  ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  [${f.check}] ${f.detail}`);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
