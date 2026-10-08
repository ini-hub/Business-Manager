// Seeds synthetic volume into the TEST database inside one transaction, runs EXPLAIN (ANALYZE, BUFFERS)
// on the hot queries (approximations of what the handlers issue; see the notes on each), tries candidate
// indexes inside the same transaction, and ROLLS EVERYTHING BACK. Nothing it seeds or creates survives.
//
//   npm run perf:explain                 # default volume
//   PERF_SCALE=0.2 npm run perf:explain  # quick smoke run
//
// Safety: refuses to run unless TEST_DATABASE_URL is set and points at a different host than DATABASE_URL.
// Report is written to PERF_REPORT (default perf-explain-report.md in the current directory).
import "../server/lib/loadEnv";
import fs from "fs";
import { Pool, type PoolClient } from "pg";

const SCALE = Number(process.env.PERF_SCALE || "1");
const REPORT = process.env.PERF_REPORT || "perf-explain-report.md";
const ORGS = 20;
const STORES_PER_ORG = 2;
const STORES = ORGS * STORES_PER_ORG;
const CHECKOUTS = Math.round(150_000 * SCALE);
const SEEDED_TABLES = [
  "stores", "staff", "inventory", "inventory_batches", "customers", "orders", "checkouts", "transactions",
  "attendance_records", "expenses", "payroll_periods", "payroll_entries", "organisation_members", "super_admin_audit_logs",
];
const BIG_ROWS = 10_000; // a table at least this big counts as "large" for seq-scan flags

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").host;
  } catch {
    return "";
  }
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL must be set; this script only ever runs against the test database.");
if (hostOf(testUrl) && hostOf(testUrl) === hostOf(process.env.DATABASE_URL)) {
  throw new Error("TEST_DATABASE_URL points at the same host as DATABASE_URL; refusing to run.");
}

// ── Candidate indexes (from the review). Each is created inside the rolled-back transaction after the
// baseline run, then every query is re-run, so the report shows the before/after plan and time. ──────────
const CANDIDATE_INDEXES: { name: string; ddl: string }[] = [
  { name: "checkouts(created_at) where not voided", ddl: "create index perf_ix_checkouts_created on checkouts (created_at) where is_voided = false" },
  { name: "checkouts(store_id, receipt_number)", ddl: "create index perf_ix_checkouts_store_receipt on checkouts (store_id, receipt_number)" },
  { name: "checkouts(store_id, staff_id, created_at)", ddl: "create index perf_ix_checkouts_staff on checkouts (store_id, staff_id, created_at)" },
  { name: "checkouts(store_id, lead_staff_id, created_at)", ddl: "create index perf_ix_checkouts_lead on checkouts (store_id, lead_staff_id, created_at)" },
  { name: "attendance_records(store_id, date)", ddl: "create index perf_ix_attendance_store_date on attendance_records (store_id, date)" },
  { name: "inventory_batches(inventory_id, expiry_date, created_at) where quantity>0", ddl: "create index perf_ix_batches_fifo on inventory_batches (inventory_id, expiry_date, created_at) where quantity > 0" },
  { name: "super_admin_audit_logs(created_at desc)", ddl: "create index perf_ix_sa_audit_created on super_admin_audit_logs (created_at desc)" },
  { name: "organisation_members(organisation_id, role)", ddl: "create index perf_ix_members_org_role on organisation_members (organisation_id, role)" },
];

interface Q {
  id: string;
  area: string;
  note: string;
  sql: string;
}

// $S = a seeded store id, $ST = a seeded staff id, $ORG = a seeded org id, $RCPT = an existing receipt number,
// $INV = a seeded inventory id. Substituted as literals so the planner sees the real constants.
const QUERIES: Q[] = [
  {
    id: "dashboard.pl_summary.30d",
    area: "dashboard",
    note: "getProfitLossSummary: every order line in the period pulled to Node and summed in JS.",
    sql: `select i.type, i.cost_price, o.quantity, o.returned_quantity, o.refunded_amount, o.total_price
          from orders o join checkouts c on c.order_id = o.id join inventory i on i.id = o.inventory_id
          where c.store_id = '$S' and c.payment_status = 'completed' and c.is_voided = false
            and c.created_at >= now() - interval '30 days'`,
  },
  {
    id: "dashboard.pl_summary.alltime",
    area: "dashboard",
    note: "Same query with no date filter (the dashboard's default range may be all time).",
    sql: `select i.type, i.cost_price, o.quantity, o.returned_quantity, o.refunded_amount, o.total_price
          from orders o join checkouts c on c.order_id = o.id join inventory i on i.id = o.inventory_id
          where c.store_id = '$S' and c.payment_status = 'completed' and c.is_voided = false`,
  },
  {
    id: "dashboard.unique_customers",
    area: "dashboard",
    note: "countDistinct(customer) over transactions joined to checkouts.",
    sql: `select count(distinct t.customer_id) from transactions t join checkouts c on c.id = t.checkout_id
          where c.store_id = '$S' and c.is_voided = false and c.payment_status = 'completed'
            and c.created_at >= now() - interval '30 days'`,
  },
  {
    id: "dashboard.inventory_select_star",
    area: "dashboard",
    note: "getDashboardStats loads every inventory row to count and filter low stock in JS.",
    sql: `select * from inventory where store_id = '$S'`,
  },
  {
    id: "transactions.index.alltime",
    area: "transactions",
    note: "getTransactionIndex: every line for the store, grouped and paged in JS.",
    sql: `select t.id, t.amount, t.transaction_date, c.receipt_number, c.staff_id, c.lead_staff_id
          from transactions t join checkouts c on c.id = t.checkout_id
          where t.store_id = '$S' order by t.transaction_date desc`,
  },
  {
    id: "transactions.by_receipt",
    area: "transactions",
    note: "Receipt / void / receipt-payload lookups, scoped by store.",
    sql: `select * from checkouts where store_id = '$S' and receipt_number = '$RCPT'`,
  },
  {
    id: "checkout.fifo_batches",
    area: "checkout",
    note: "FIFO batch select, executed once per cart line inside the checkout transaction.",
    sql: `select * from inventory_batches where inventory_id = '$INV' and quantity > 0 order by expiry_date asc nulls last, created_at asc`,
  },
  {
    id: "staff.breakdown.or4",
    area: "staff/payroll",
    note: "getStaffBreakdown: OR across four staff columns cannot use a single index.",
    sql: `select c.id, c.total_price, o.inventory_id from checkouts c join orders o on o.id = c.order_id
          where c.store_id = '$S' and c.is_voided = false and c.created_at >= now() - interval '90 days'
            and (c.staff_id = '$ST' or c.lead_staff_id = '$ST' or c.assisting_staff1_id = '$ST' or c.assisting_staff2_id = '$ST')`,
  },
  {
    id: "staff.performance.rows",
    area: "staff/payroll",
    note: "getStaffPerformance: full checkout x order x inventory join for the range, aggregated per staff in JS.",
    sql: `select c.*, o.quantity, o.total_price as line_total, i.type, i.cost_price
          from checkouts c join orders o on o.id = c.order_id join inventory i on i.id = o.inventory_id
          where c.store_id = '$S' and c.is_voided = false and c.created_at >= now() - interval '30 days'`,
  },
  {
    id: "attendance.range.all_staff",
    area: "staff/payroll",
    note: "Attendance for a store over a date range without a staff filter (unique index leads with staff_id).",
    sql: `select * from attendance_records where store_id = '$S' and date between to_char(now() - interval '30 days', 'YYYY-MM-DD') and to_char(now(), 'YYYY-MM-DD')`,
  },
  {
    id: "payroll.periods_by_store",
    area: "staff/payroll",
    note: "getPayrollPeriods: all periods, no limit.",
    sql: `select * from payroll_periods where store_id = '$S' order by created_at desc`,
  },
  {
    id: "payroll.entries_for_all_periods",
    area: "staff/payroll",
    note: "GET /payroll/report issues this once per period (N+1); here the set-based equivalent.",
    sql: `select period_id, count(*), sum(gross_commission), sum(total_transport) from payroll_entries where store_id = '$S' group by period_id`,
  },
  {
    id: "cashflow.checkouts",
    area: "reports",
    note: "cash-flow loads every non-voided checkout row in range to sum by payment method in JS.",
    sql: `select * from checkouts where store_id = '$S' and is_voided = false and created_at >= now() - interval '30 days'`,
  },
  {
    id: "cashflow.expenses",
    area: "reports",
    note: "cash-flow loads the expense rows for the range.",
    sql: `select * from expenses where store_id = '$S' and is_deleted = false and date between to_char(now() - interval '30 days', 'YYYY-MM-DD') and to_char(now(), 'YYYY-MM-DD')`,
  },
  {
    id: "analytics.cube.daily_revenue",
    area: "analytics",
    note: "Shape of an Explorer cube: revenue by local day across all of an org's stores, 90 days.",
    sql: `select date_trunc('day', c.created_at at time zone 'Africa/Lagos') d, sum(o.total_price), count(*)
          from checkouts c join orders o on o.id = c.order_id
          where c.store_id in (select id from stores where business_id = '$ORG') and c.is_voided = false
            and c.created_at >= now() - interval '90 days' group by 1 order by 1`,
  },
  {
    id: "admin.gmv_30d",
    area: "super-admin",
    note: "dashboard/metrics: platform-wide 30-day checkout pull (they fetch rows and sum in JS).",
    sql: `select total_price, created_at from checkouts where is_voided = false and created_at >= now() - interval '30 days'`,
  },
  {
    id: "admin.latest_tx_per_store",
    area: "super-admin",
    note: "dashboard/metrics inactive-store alert: max(created_at) per store over the whole checkouts table.",
    sql: `select store_id, max(created_at) from checkouts group by store_id`,
  },
  {
    id: "admin.org_checkout_rows",
    area: "super-admin",
    note: "/businesses and /onboarding/pipeline: per-org full checkout fetch (one such query per org).",
    sql: `select c.total_price, c.created_at from checkouts c where c.store_id in (select id from stores where business_id = '$ORG')`,
  },
  {
    id: "admin.flagged_transactions",
    area: "super-admin",
    note: "/transactions/flagged: every checkout joined to stores, filtered in JS.",
    sql: `select c.*, s.name from checkouts c join stores s on s.id = c.store_id order by c.created_at desc`,
  },
  {
    id: "admin.audit_logs",
    area: "super-admin",
    note: "/system/audit-logs: whole table ordered by created_at, sliced to 100 in JS.",
    sql: `select * from super_admin_audit_logs order by created_at desc`,
  },
  {
    id: "admin.audit_logs_by_action",
    area: "super-admin",
    note: "suspend_business feed query.",
    sql: `select * from super_admin_audit_logs where action = 'suspend_business' order by created_at desc limit 20`,
  },
  {
    id: "admin.members_by_org_role",
    area: "super-admin",
    note: "Owner lookup inside the per-org loops.",
    sql: `select * from organisation_members where organisation_id = '$ORG' and role = 'owner'`,
  },
];

async function seed(c: PoolClient): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => c.query(sql, params);
  const N = CHECKOUTS;
  const STAFF_PER_STORE = 10;
  const INV_PER_STORE = 100;
  const CUST_PER_STORE = 200;

  await q(`insert into organisations (id, name) select gen_random_uuid()::text, 'perf-org-' || g from generate_series(1, ${ORGS}) g`);
  await q(`create temp table perf_o as select id, row_number() over (order by name) rn from organisations where name like 'perf-org-%'`);
  await q(`insert into stores (id, business_id, name, code)
           select gen_random_uuid()::text, o.id, 'perf-store-' || o.rn || '-' || s, 'PF' || o.rn || '-' || s || '-' || substr(md5(random()::text), 1, 6)
           from perf_o o, generate_series(1, ${STORES_PER_ORG}) s`);
  await q(`create temp table perf_s as select id store_id, business_id, row_number() over (order by name) rn from stores where name like 'perf-store-%'`);

  await q(`insert into staff (id, store_id, name, email, staff_number, mobile_number, pay_per_month)
           select gen_random_uuid()::text, s.store_id, 'staff ' || g, 'perf-' || s.rn || '-' || g || '@perf.test', 'S' || g, '080' || s.rn || g, 50000
           from perf_s s, generate_series(1, ${STAFF_PER_STORE}) g`);
  await q(`create temp table perf_st as select id, store_id, row_number() over (partition by store_id order by staff_number) rn from staff where email like 'perf-%@perf.test'`);

  await q(`insert into inventory (id, store_id, name, type, cost_price, selling_price, quantity, product_id)
           select gen_random_uuid()::text, s.store_id, 'item ' || g, case when g % 4 = 0 then 'service' else 'product' end, 500 + g, 1000 + g, 50, gen_random_uuid()::text
           from perf_s s, generate_series(1, ${INV_PER_STORE}) g`);
  await q(`create temp table perf_i as select id, store_id, row_number() over (partition by store_id order by name) rn from inventory where name like 'item %' and store_id in (select store_id from perf_s)`);
  await q(`insert into inventory_batches (id, store_id, inventory_id, batch_number, expiry_date, quantity, created_at)
           select gen_random_uuid()::text, i.store_id, i.id, 'B' || b, now() + (b || ' months')::interval, 10, now() - (b || ' days')::interval
           from perf_i i, generate_series(1, 3) b`);

  await q(`insert into customers (id, store_id, name, customer_number, address)
           select gen_random_uuid()::text, s.store_id, 'cust ' || g, 'C' || s.rn || '-' || g, 'addr'
           from perf_s s, generate_series(1, ${CUST_PER_STORE}) g`);
  await q(`create temp table perf_cu as select id, store_id, row_number() over (partition by store_id order by customer_number) rn from customers where customer_number like 'C%-%' and store_id in (select store_id from perf_s)`);

  // One sale line per checkout row (the schema's checkouts.order_id is 1:1 with orders).
  await q(`create temp table perf_c as
    select gen_random_uuid()::text cid, gen_random_uuid()::text oid, gen_random_uuid()::text tid, g,
           s.store_id, st.id staff_id, st2.id lead_id, i.id inv_id, cu.id cust_id,
           now() - (random() * 365) * interval '1 day' ts,
           (500 + (g % 40) * 100)::numeric amt, (g % 33 = 0) voided
    from generate_series(1, ${N}) g
    join perf_s s on s.rn = 1 + (g % ${STORES})
    join perf_st st on st.store_id = s.store_id and st.rn = 1 + ((g / ${STORES}) % ${STAFF_PER_STORE})
    join perf_st st2 on st2.store_id = s.store_id and st2.rn = 1 + ((g / ${STORES} + 3) % ${STAFF_PER_STORE})
    join perf_i i on i.store_id = s.store_id and i.rn = 1 + ((g / ${STORES}) % ${INV_PER_STORE})
    join perf_cu cu on cu.store_id = s.store_id and cu.rn = 1 + ((g / ${STORES}) % ${CUST_PER_STORE})`);
  await q(`insert into orders (id, store_id, inventory_id, quantity, total_price) select oid, store_id, inv_id, 1, amt from perf_c`);
  await q(`insert into checkouts (id, store_id, staff_id, lead_staff_id, order_id, receipt_number, total_price, total_charged, payment_method, payment_status, is_voided, created_at)
           select cid, store_id, staff_id, lead_id, oid, 'PERF-' || g, amt, amt, case when g % 3 = 0 then 'transfer' else 'cash' end, 'completed', voided, ts from perf_c`);
  await q(`insert into transactions (id, store_id, customer_id, inventory_id, amount, checkout_id, transaction_date)
           select tid, store_id, cust_id, inv_id, amt, cid, ts from perf_c`);

  // Attendance: every staff, every day of the last year.
  await q(`insert into attendance_records (id, store_id, staff_id, date, status)
           select gen_random_uuid()::text, st.store_id, st.id, to_char(now() - (d || ' days')::interval, 'YYYY-MM-DD'), case when d % 11 = 0 then 'absent' else 'present' end
           from perf_st st, generate_series(0, 364) d`);

  await q(`insert into expenses (id, store_id, title, amount, category_id, date)
           select gen_random_uuid()::text, s.store_id, 'exp ' || g, 1000 + g, gen_random_uuid()::text, to_char(now() - ((g % 365) || ' days')::interval, 'YYYY-MM-DD')
           from perf_s s, generate_series(1, 500) g`);

  await q(`insert into payroll_periods (id, store_id, start_date, end_date, created_at)
           select gen_random_uuid()::text, s.store_id, to_char(now() - ((m * 30 + 29) || ' days')::interval, 'YYYY-MM-DD'), to_char(now() - ((m * 30) || ' days')::interval, 'YYYY-MM-DD'), now() - ((m * 30) || ' days')::interval
           from perf_s s, generate_series(0, 23) m`);
  await q(`insert into payroll_entries (id, period_id, store_id, staff_id, gross_commission, total_transport, net_pay)
           select gen_random_uuid()::text, p.id, p.store_id, st.id, 10000, 2000, 12000
           from payroll_periods p join perf_st st on st.store_id = p.store_id where p.store_id in (select store_id from perf_s)`);

  await q(`insert into super_admin_audit_logs (id, admin_id, admin_email, admin_role, action, target, ip_address, created_at)
           select gen_random_uuid()::text, gen_random_uuid()::text, 'a@perf.test', 'admin', case when g % 50 = 0 then 'suspend_business' else 'view_business' end, 't' || g, '127.0.0.1', now() - (g || ' minutes')::interval
           from generate_series(1, ${Math.round(20_000 * SCALE)}) g`);

  await q(`insert into organisation_members (id, user_id, organisation_id, role)
           select gen_random_uuid()::text, gen_random_uuid()::text, o.id, case when g = 1 then 'owner' else 'staff' end
           from perf_o o, generate_series(1, 5) g`);

  await q(`analyze organisations; analyze stores; analyze staff; analyze inventory; analyze inventory_batches; analyze customers;
           analyze orders; analyze checkouts; analyze transactions; analyze attendance_records; analyze expenses;
           analyze payroll_periods; analyze payroll_entries; analyze super_admin_audit_logs; analyze organisation_members`);
}

interface PlanStats {
  planningMs: number;
  executionMs: number;
  rowsReturned: number;
  sharedHit: number;
  sharedRead: number;
  rootNode: string;
  seqScans: { table: string; rows: number; removed: number }[];
  sortSpill: boolean;
  worstEstimate: number; // max ratio of actual/estimated rows (or inverse), >=1
}

function walk(node: any, acc: PlanStats): void {
  if (node["Node Type"] === "Seq Scan") {
    const loops = node["Actual Loops"] || 1;
    acc.seqScans.push({
      table: node["Relation Name"],
      rows: Math.round((node["Actual Rows"] || 0) * loops + (node["Rows Removed by Filter"] || 0) * loops),
      removed: (node["Rows Removed by Filter"] || 0) * loops,
    });
  }
  if (node["Node Type"] === "Sort" && /Disk/i.test(node["Sort Space Type"] || "")) acc.sortSpill = true;
  const est = Math.max(node["Plan Rows"] || 1, 1);
  const act = Math.max(node["Actual Rows"] || 1, 1);
  acc.worstEstimate = Math.max(acc.worstEstimate, Math.max(est / act, act / est));
  for (const child of node["Plans"] || []) walk(child, acc);
}

async function explain(c: PoolClient, sql: string): Promise<PlanStats> {
  const res = await c.query(`explain (analyze, buffers, format json) ${sql}`);
  const doc = res.rows[0]["QUERY PLAN"][0];
  const plan = doc.Plan;
  const acc: PlanStats = {
    planningMs: doc["Planning Time"],
    executionMs: doc["Execution Time"],
    rowsReturned: plan["Actual Rows"],
    sharedHit: plan["Shared Hit Blocks"] || 0,
    sharedRead: plan["Shared Read Blocks"] || 0,
    rootNode: plan["Node Type"],
    seqScans: [],
    sortSpill: false,
    worstEstimate: 1,
  };
  walk(plan, acc);
  return acc;
}

const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

async function main() {
  const pool = new Pool({ connectionString: testUrl, max: 1, connectionTimeoutMillis: 30_000 });
  const c = await pool.connect();
  const started = Date.now();
  try {
    await c.query("begin");
    await c.query("set local statement_timeout = '300s'");
    // The role cannot SET session_replication_role (not a superuser), so lift the foreign keys on the tables we
    // seed instead. DDL is transactional in Postgres: the constraints come back with the rollback.
    const fks = (
      await c.query(
        `select conrelid::regclass::text tbl, conname from pg_constraint
         where contype = 'f' and conrelid::regclass::text = any($1)`,
        [SEEDED_TABLES],
      )
    ).rows;
    for (const fk of fks) await c.query(`alter table ${fk.tbl} drop constraint "${fk.conname}"`);

    process.stderr.write(`Seeding ${CHECKOUTS.toLocaleString()} checkouts across ${STORES} stores...\n`);
    await seed(c);
    process.stderr.write(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

    const one = async (sql: string) => (await c.query(sql)).rows[0];
    const s = (await one(`select store_id from perf_s order by rn limit 1`)).store_id;
    const org = (await one(`select business_id from perf_s order by rn limit 1`)).business_id;
    const st = (await one(`select id from perf_st where store_id = '${s}' order by rn limit 1`)).id;
    const inv = (await one(`select id from perf_i where store_id = '${s}' order by rn limit 1`)).id;
    const rcpt = (await one(`select receipt_number from checkouts where store_id = '${s}' order by created_at desc limit 1`)).receipt_number;
    const sub = (sql: string) => sql.replaceAll("$S", s).replaceAll("$ST", st).replaceAll("$ORG", org).replaceAll("$INV", inv).replaceAll("$RCPT", rcpt);

    const sizes = (
      await c.query(`select relname, pg_size_pretty(pg_total_relation_size(oid)) size
                     from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname in
                     ('checkouts','orders','transactions','inventory','inventory_batches','attendance_records','expenses','payroll_entries','super_admin_audit_logs','stores')
                     order by pg_total_relation_size(oid) desc`)
    ).rows;
    const reltuples = (
      await c.query(`select c.relname, c.reltuples::bigint n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)
    ).rows;
    const tableRows = new Map<string, number>(reltuples.map((r: any) => [r.relname, Number(r.n)]));

    const existingIdx = (
      await c.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in
                     ('checkouts','orders','transactions','inventory_batches','attendance_records','expenses','payroll_periods','payroll_entries','super_admin_audit_logs','stores','organisation_members')
                     order by tablename, indexname`)
    ).rows;

    // Warm the cache once so the baseline is not dominated by cold reads of freshly written pages.
    for (const q of QUERIES) await c.query(sub(q.sql)).catch(() => undefined);

    const baseline = new Map<string, PlanStats | string>();
    for (const q of QUERIES) {
      try {
        baseline.set(q.id, await explain(c, sub(q.sql)));
      } catch (err) {
        baseline.set(q.id, (err as Error).message);
      }
    }

    const applied: { name: string; error?: string }[] = [];
    for (const idx of CANDIDATE_INDEXES) {
      // A savepoint per index: one failing DDL (a column that does not exist yet) must not abort the run.
      await c.query("savepoint ix");
      try {
        await c.query(idx.ddl);
        await c.query("release savepoint ix");
        applied.push({ name: idx.name });
      } catch (err) {
        await c.query("rollback to savepoint ix");
        applied.push({ name: idx.name, error: (err as Error).message });
      }
    }
    await c.query(`analyze checkouts; analyze orders; analyze attendance_records; analyze inventory_batches; analyze super_admin_audit_logs; analyze stores; analyze organisation_members`);
    for (const q of QUERIES) await c.query(sub(q.sql)).catch(() => undefined);

    const after = new Map<string, PlanStats | string>();
    for (const q of QUERIES) {
      try {
        after.set(q.id, await explain(c, sub(q.sql)));
      } catch (err) {
        after.set(q.id, (err as Error).message);
      }
    }

    // ── report ──
    const out: string[] = [];
    out.push(`# perf-explain report`, ``, `Run: ${new Date().toISOString()} against the TEST database (host ${hostOf(testUrl)}). Everything seeded and every index created below was rolled back.`, ``);
    out.push(`Scale ${SCALE}: ${CHECKOUTS.toLocaleString()} checkouts (1:1 orders and transactions), ${STORES} stores, ${STORES * 10} staff. Timings include network to Neon only for planning; execution time is server-side. Compare **plan shape and buffers** across runs, not absolute milliseconds.`, ``);
    out.push(`## Seeded table sizes`, ``, `| table | rows (estimate) | size |`, `|---|---|---|`);
    for (const r of sizes) out.push(`| ${r.relname} | ${(tableRows.get(r.relname) ?? 0).toLocaleString()} | ${r.size} |`);
    out.push(``, `## Results (baseline = indexes that exist today)`, ``);
    out.push(`| query | area | exec ms | rows out | buffers hit/read | seq scans on large tables | flags |`, `|---|---|---|---|---|---|---|`);
    const flagged: string[] = [];
    for (const q of QUERIES) {
      const r = baseline.get(q.id)!;
      if (typeof r === "string") {
        out.push(`| ${q.id} | ${q.area} | ERROR | | | | ${r.replace(/\|/g, "/").slice(0, 80)} |`);
        continue;
      }
      const bigSeq = r.seqScans.filter((x) => (tableRows.get(x.table) ?? 0) >= BIG_ROWS);
      const flags: string[] = [];
      if (bigSeq.length) flags.push("SEQ SCAN");
      if (r.sortSpill) flags.push("SORT SPILL");
      if (r.worstEstimate >= 100) flags.push(`ESTIMATE x${Math.round(r.worstEstimate)}`);
      if (r.rowsReturned >= 20_000) flags.push(`${r.rowsReturned.toLocaleString()} rows to Node`);
      out.push(
        `| ${q.id} | ${q.area} | ${fmt(r.executionMs)} | ${r.rowsReturned.toLocaleString()} | ${r.sharedHit.toLocaleString()}/${r.sharedRead.toLocaleString()} | ${bigSeq.map((x) => `${x.table} (${x.rows.toLocaleString()} rows, ${x.removed.toLocaleString()} filtered)`).join("; ") || "-"} | ${flags.join(", ") || "-"} |`,
      );
      if (flags.length) flagged.push(q.id);
    }

    out.push(``, `## Effect of the candidate indexes (same data, same queries, after creating them)`, ``);
    out.push(`| query | before ms | after ms | before buffers | after buffers | seq scans after |`, `|---|---|---|---|---|---|`);
    for (const q of QUERIES) {
      const b = baseline.get(q.id)!;
      const a = after.get(q.id)!;
      if (typeof b === "string" || typeof a === "string") continue;
      const aSeq = a.seqScans.filter((x) => (tableRows.get(x.table) ?? 0) >= BIG_ROWS).map((x) => x.table).join(", ") || "-";
      const better = a.executionMs < b.executionMs * 0.7 ? " (faster)" : a.executionMs > b.executionMs * 1.3 ? " (slower)" : "";
      out.push(`| ${q.id} | ${fmt(b.executionMs)} | ${fmt(a.executionMs)}${better} | ${(b.sharedHit + b.sharedRead).toLocaleString()} | ${(a.sharedHit + a.sharedRead).toLocaleString()} | ${aSeq} |`);
    }
    out.push(``, `Indexes tried:`, ...applied.map((x) => `- ${x.name}${x.error ? `  ⚠ not created: ${x.error}` : ""}`));

    out.push(``, `## What each query models`, ``);
    for (const q of QUERIES) out.push(`- **${q.id}**: ${q.note}`);

    out.push(``, `## Indexes that already exist on the hot tables`, ``);
    for (const r of existingIdx) if (!r.indexname.startsWith("perf_ix_")) out.push(`- \`${r.tablename}\`: ${r.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\./, "$1")}`);
    out.push(``, `## Caveats`, ``, `- Handlers do not run these exact statements; they run drizzle-built equivalents with the same tables, joins and filters. Treat each row as the shape of the work, not a replay.`, `- Synthetic data is evenly distributed. Real stores are skewed (a few very busy ones), so real seq-scan costs are usually worse.`, `- Network round trips (about 0.3s each on Neon) are not in these numbers; they are what the per-request statement counter in System Health measures.`);

    fs.writeFileSync(REPORT, out.join("\n") + "\n");
    process.stderr.write(`Report written to ${REPORT}. Flagged: ${flagged.length}/${QUERIES.length}. Total ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
