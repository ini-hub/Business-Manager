import { parseDbTimestamp } from "./dbTime";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getBusinessOwners } from "./adminBusinesses";

/**
 * The onboarding funnel. Each business sits at the furthest stage it has reached:
 *   registered (no store) -> configured (a store, no inventory) -> staffed (inventory, no active staff)
 *   -> first_sale (staff, no sale yet) -> active (has a sale).
 *
 * This used to load every business on the platform and run up to five queries for each, and return all of them.
 * The stage of every business is now worked out by the database in one statement; each stage's exact count comes
 * back with only its newest few businesses, so the response no longer grows with the number of customers.
 */
const STAGE_SQL = sql`
  SELECT o.id, o.name, o.created_at,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM stores s WHERE s.business_id = o.id) THEN 'registered'
      WHEN NOT EXISTS (SELECT 1 FROM inventory i JOIN stores s ON s.id = i.store_id WHERE s.business_id = o.id) THEN 'configured'
      WHEN NOT EXISTS (SELECT 1 FROM staff st JOIN stores s ON s.id = st.store_id WHERE s.business_id = o.id AND st.is_archived = false) THEN 'staffed'
      WHEN NOT EXISTS (SELECT 1 FROM checkouts c JOIN stores s ON s.id = c.store_id WHERE s.business_id = o.id AND c.is_voided = false) THEN 'first_sale'
      ELSE 'active'
    END AS stage
  FROM organisations o
  WHERE o.deleted_at IS NULL`;

const STAGES = ["registered", "configured", "staffed", "first_sale", "active"] as const;
type Stage = (typeof STAGES)[number];

const STUCK_REASON: Record<Exclude<Stage, "active">, { label: string; reason: string }> = {
  registered: { label: "Registered", reason: "No store locations configured." },
  configured: { label: "Configured", reason: "No inventory items uploaded." },
  staffed: { label: "Staffed", reason: "No staff roster members onboarded." },
  first_sale: { label: "First Sale", reason: " Roster set up but zero transactions recorded." },
};

export const STUCK_AFTER_MS = 48 * 60 * 60 * 1000;

export async function getOnboardingPipeline(opts: { perStage?: number; stuckLimit?: number; now?: number } = {}) {
  const perStage = opts.perStage ?? 50;
  const stuckLimit = opts.stuckLimit ?? 100;
  const now = opts.now ?? Date.now();
  const stuckBefore = new Date(now - STUCK_AFTER_MS).toISOString();

  const [staged, stuck] = await Promise.all([
    db.execute(sql`
      WITH staged AS (${STAGE_SQL}),
      ranked AS (
        SELECT staged.*, count(*) OVER (PARTITION BY stage)::int AS stage_total,
               row_number() OVER (PARTITION BY stage ORDER BY created_at DESC, id) AS rn
        FROM staged
      )
      SELECT id, name, created_at, stage, stage_total FROM ranked WHERE rn <= ${perStage} ORDER BY stage, created_at DESC, id`),
    db.execute(sql`
      WITH staged AS (${STAGE_SQL})
      SELECT id, name, created_at, stage, count(*) OVER ()::int AS stuck_total
      FROM staged WHERE stage <> 'active' AND created_at <= ${stuckBefore}::timestamp
      ORDER BY created_at DESC, id LIMIT ${stuckLimit}`),
  ]);

  // Stage totals come with the rows; a stage with no rows has no entry (and a total of zero).
  const totals = new Map<string, number>();
  for (const r of staged.rows as any[]) totals.set(r.stage, Number(r.stage_total));

  const shown = [...(staged.rows as any[]), ...(stuck.rows as any[])];
  const activeIds = (staged.rows as any[]).filter((r) => r.stage === "active").map((r) => r.id as string);
  const [owners, salesCounts] = await Promise.all([
    getBusinessOwners(Array.from(new Set(shown.map((r) => r.id as string)))),
    activeIds.length === 0
      ? Promise.resolve({ rows: [] as any[] })
      : db.execute(sql`
          SELECT s.business_id, count(c.id)::int AS n
          FROM stores s JOIN checkouts c ON c.store_id = s.id
          WHERE s.business_id IN (${sql.join(activeIds.map((id) => sql`${id}`), sql`, `)}) AND c.is_voided = false
          GROUP BY s.business_id`),
  ]);
  const salesByOrg = new Map((salesCounts.rows as any[]).map((r) => [r.business_id as string, Number(r.n)]));

  const info = (r: any) => {
    const owner = owners.get(r.id);
    return {
      id: r.id as string,
      name: r.name as string,
      createdAt: parseDbTimestamp(r.created_at),
      // The funnel's own fallbacks for a missing name or contact.
      owner: owner
        ? { name: owner.name || "Owner", email: owner.email || owner.phone || "No Contact" }
        : { name: "Unconfigured", email: "Unconfigured" },
    };
  };

  const funnel = Object.fromEntries(
    STAGES.map((stage) => {
      const rows = (staged.rows as any[]).filter((r) => r.stage === stage);
      const items = rows.map((r) => (stage === "active" ? { ...info(r), salesCount: salesByOrg.get(r.id) ?? 0 } : info(r)));
      const count = totals.get(stage) ?? 0;
      return [stage, { count, items, hasMore: count > items.length }];
    }),
  ) as Record<Stage, { count: number; items: any[]; hasMore: boolean }>;

  const stuckBusinesses = (stuck.rows as any[]).map((r) => {
    const detail = STUCK_REASON[r.stage as Exclude<Stage, "active">];
    return { ...info(r), stage: detail.label, stuckDuration: "48hr+", reason: detail.reason };
  });
  const stuckTotal = stuck.rows.length > 0 ? Number((stuck.rows[0] as any).stuck_total) : 0;

  return { funnel, stuckBusinesses, stuckTotal };
}
