import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Merges two staff rows that are the same person (same login, same business) into one.
 *
 * Before staff_store_assignments (migration 0129) a person working in two stores was two staff rows. After
 * the merge one row (the survivor) is the person, and the other row's store becomes an assignment on it.
 *
 * Everything runs in one transaction. The final DELETE of the duplicate row is the completeness check: every
 * table with a foreign key to staff.id must have been repointed first, so a reference this file does not know
 * about makes that DELETE fail and the whole merge roll back, rather than losing history.
 */

type Col = readonly [table: string, column: string];

/** Plain references with no uniqueness on the staff column: moved wholesale. */
const REPOINT: readonly Col[] = [
  ["bookings", "lead_staff_id"], ["bookings", "assisting_staff_id"],
  ["checkouts", "staff_id"], ["checkouts", "lead_staff_id"], ["checkouts", "assisting_staff1_id"], ["checkouts", "assisting_staff2_id"],
  ["hr_additional_job_info_history", "staff_id"], ["hr_dependants", "staff_id"], ["hr_disciplinary_records", "staff_id"],
  ["hr_documents", "staff_id"], ["hr_emergency_contacts", "staff_id"], ["hr_estate_beneficiaries", "staff_id"],
  ["hr_guarantor_form_signatures", "staff_id"], ["hr_job_info_history", "staff_id"],
  ["hr_time_off_history", "staff_id"], ["hr_time_off_requests", "staff_id"],
  ["inventory_restock_events", "staff_id"],
  ["payroll_deductions", "staff_id"], ["payroll_disbursements", "staff_id"], ["payroll_postings", "staff_id"], ["payslip_records", "staff_id"],
  ["repayments", "recorded_by_staff_id"], ["return_logs", "staff_id"], ["salary_advances", "staff_id"], ["sale_drafts", "staff_id"],
  ["staff_contract_signatures", "staff_id"], ["stock_audits", "conducted_by_staff_id"], ["stock_movements", "actor_staff_id"],
  // Soft references (no foreign key): still point at the person.
  ["customers", "staff_id"], ["stores", "manager_staff_id"], ["organisations", "default_trial_staff_id"],
  ["whatsapp_broadcasts", "created_by_staff_id"],
];

type Unique = { table: string; /** Columns that, with staff_id, form one unique index. */ keys: readonly string[][] };

/** History that must not be dropped or overwritten: a collision refuses the merge. */
const UNIQUE_HISTORY: readonly Unique[] = [
  { table: "attendance_records", keys: [["store_id", "date"]] },
  { table: "attendance_punches", keys: [["client_punch_id"], ["local_date", "kind"]] },
  { table: "attendance_retro_requests", keys: [["date"]] },
  { table: "payroll_entries", keys: [["period_id"]] },
  { table: "staff_contracts", keys: [[]] },
  { table: "hr_guarantor_forms", keys: [[]] },
];

/** Settings-like rows: where both people have one, the survivor's wins and the other is discarded (and reported). */
const UNIQUE_CONFIG: readonly Unique[] = [
  { table: "staff_devices", keys: [["device_id"]] },
  { table: "staff_schedules", keys: [[]] },
  { table: "staff_schedule_exceptions", keys: [["date"]] },
  { table: "hr_field_values", keys: [["field_definition_id"]] },
  { table: "hr_time_off_balances", keys: [["leave_type"]] },
];

/** One salary per person: these decide pay, so they must agree or the caller picks a side. */
const PAY_COLUMNS = [
  "pay_per_month", "payment_method", "override_payment_method", "override_commission", "commission_rate_override",
  "commission_type_override", "commission_fixed_amount_override", "override_formula", "commission_formula_override",
  "override_attendance_rates", "active_day_rate_override", "passive_day_rate_override", "leave_day_rate_override",
  "pay_leave_days_override", "holiday_day_rate_override", "pay_holiday_days_override", "off_day_rate_override",
  "pay_off_days_override",
] as const;

/** Every table.column the merge knows how to move; the itest compares this with the database's foreign keys. */
export const MERGE_COVERED_COLUMNS: readonly string[] = [
  ...REPOINT.map(([t, c]) => `${t}.${c}`),
  ...[...UNIQUE_HISTORY, ...UNIQUE_CONFIG].map((u) => `${u.table}.staff_id`),
  "staff_store_assignments.staff_id",
];

export type MergeConflict = { code: string; detail: string };

export type MergeReport = {
  ok: boolean;
  dryRun: boolean;
  survivorId: string;
  loserId: string;
  /** Rows repointed to the survivor, by table.column. Zero entries are omitted. */
  moved: Record<string, number>;
  /** Settings-like rows dropped because the survivor already had one. */
  discarded: Record<string, number>;
  /** Pay columns on which the two rows disagree. */
  payDifferences: string[];
  conflicts: MergeConflict[];
  /** The removed row, for the audit log. */
  loser: Record<string, unknown> | null;
};

export type MergeOptions = {
  survivorId: string;
  loserId: string;
  businessId: string;
  /** Which row's pay settings to keep when they differ. Required in that case. */
  payFrom?: "survivor" | "loser";
  dryRun?: boolean;
};

class DryRunRollback extends Error {}

const id = (name: string) => sql.identifier(name);

export class StaffMergeService {
  async merge(opts: MergeOptions): Promise<MergeReport> {
    const report: MergeReport = {
      ok: false, dryRun: !!opts.dryRun, survivorId: opts.survivorId, loserId: opts.loserId,
      moved: {}, discarded: {}, payDifferences: [], conflicts: [], loser: null,
    };
    const fail = (code: string, detail: string) => { report.conflicts.push({ code, detail }); };

    if (opts.survivorId === opts.loserId) {
      fail("same_row", "Choose two different staff records.");
      return report;
    }

    try {
      await db.transaction(async (tx) => {
        // Lock both rows in a fixed order so two merges touching the same person cannot deadlock.
        const ids = [opts.survivorId, opts.loserId].sort();
        const locked = await tx.execute(sql`
          SELECT s.id, s.user_id, s.store_id, st.business_id
          FROM staff s JOIN stores st ON st.id = s.store_id
          WHERE s.id IN (${ids[0]}, ${ids[1]}) ORDER BY s.id FOR UPDATE OF s`);
        const rows = locked.rows as Array<{ id: string; user_id: string | null; store_id: string; business_id: string }>;
        const survivor = rows.find((r) => r.id === opts.survivorId);
        const loser = rows.find((r) => r.id === opts.loserId);
        if (!survivor || !loser) { fail("not_found", "One of the staff records no longer exists."); return; }
        if (survivor.business_id !== opts.businessId || loser.business_id !== opts.businessId) {
          fail("wrong_business", "Both staff records must belong to this business.");
          return;
        }
        if (!survivor.user_id || survivor.user_id !== loser.user_id) {
          fail("different_person", "These records are not linked to the same login, so they cannot be treated as one person.");
          return;
        }

        // A person holds one assignment per store.
        const shared = await tx.execute(sql`
          SELECT a.store_id FROM staff_store_assignments a
          JOIN staff_store_assignments b ON b.store_id = a.store_id AND b.staff_id = ${opts.loserId}
          WHERE a.staff_id = ${opts.survivorId}`);
        if (shared.rows.length > 0) {
          fail("shared_store", "Both records are assigned to the same store. Move or archive one of them first.");
        }

        // History tables: a collision means both people have real data for the same slot.
        for (const u of UNIQUE_HISTORY) {
          for (const key of u.keys) {
            const n = await this.countCollisions(tx, u.table, key, opts);
            if (n > 0) fail("history_conflict", `${u.table}: ${n} record(s) exist for both people${key.length ? ` on the same ${key.join(" + ")}` : ""}.`);
          }
        }

        // Pay.
        const diff = await tx.execute(sql`
          SELECT ${sql.join(PAY_COLUMNS.map((c) => sql`(s.${id(c)} IS DISTINCT FROM l.${id(c)}) AS ${id(c)}`), sql`, `)}
          FROM staff s, staff l WHERE s.id = ${opts.survivorId} AND l.id = ${opts.loserId}`);
        const flags = (diff.rows[0] ?? {}) as Record<string, boolean>;
        report.payDifferences = PAY_COLUMNS.filter((c) => flags[c]);
        if (report.payDifferences.length > 0 && !opts.payFrom) {
          fail("pay_differs", `The two records have different pay settings (${report.payDifferences.join(", ")}). Choose which to keep.`);
        }

        if (report.conflicts.length > 0) return;

        // ── Apply ────────────────────────────────────────────────────────────────
        const loserRow = await tx.execute(sql`SELECT * FROM staff WHERE id = ${opts.loserId}`);
        report.loser = (loserRow.rows[0] ?? null) as Record<string, unknown> | null;

        if (opts.payFrom === "loser" && report.payDifferences.length > 0) {
          await tx.execute(sql`
            UPDATE staff s SET ${sql.join(PAY_COLUMNS.map((c) => sql`${id(c)} = l.${id(c)}`), sql`, `)}
            FROM staff l WHERE s.id = ${opts.survivorId} AND l.id = ${opts.loserId}`);
        }

        for (const u of UNIQUE_CONFIG) {
          const dropped = await this.dropCollisions(tx, u, opts);
          if (dropped > 0) report.discarded[u.table] = dropped;
        }

        const repoint = async (table: string, column: string) => {
          const r = await tx.execute(sql`
            UPDATE ${id(table)} SET ${id(column)} = ${opts.survivorId} WHERE ${id(column)} = ${opts.loserId}`);
          const n = r.rowCount ?? 0;
          if (n > 0) report.moved[`${table}.${column}`] = n;
        };
        for (const [table, column] of REPOINT) await repoint(table, column);
        for (const u of [...UNIQUE_HISTORY, ...UNIQUE_CONFIG]) await repoint(u.table, "staff_id");
        // Before the DELETE: assignments would otherwise cascade away with the duplicate row.
        await repoint("staff_store_assignments", "staff_id");

        await tx.execute(sql`DELETE FROM staff WHERE id = ${opts.loserId}`);
        report.ok = true;

        if (opts.dryRun) throw new DryRunRollback();
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) {
        if ((err as { code?: string }).code === "23503") {
          // A table references staff.id that this service does not know about: nothing was changed.
          report.ok = false;
          fail("unmapped_reference", `Another record still references the duplicate: ${(err as { detail?: string }).detail ?? "unknown table"}. Nothing was merged.`);
          return report;
        }
        throw err;
      }
    }
    return report;
  }

  /** Rows of the loser that would collide with an existing survivor row on one unique key. */
  private async countCollisions(tx: any, table: string, key: readonly string[], opts: MergeOptions): Promise<number> {
    const match = key.length
      ? sql.join(key.map((c) => sql`s.${id(c)} = l.${id(c)}`), sql` AND `)
      : sql`true`;
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n FROM ${id(table)} l
      WHERE l.staff_id = ${opts.loserId}
        AND EXISTS (SELECT 1 FROM ${id(table)} s WHERE s.staff_id = ${opts.survivorId} AND ${match})`);
    return Number((r.rows[0] as { n: number }).n);
  }

  private async dropCollisions(tx: any, u: Unique, opts: MergeOptions): Promise<number> {
    let total = 0;
    for (const key of u.keys) {
      const match = key.length
        ? sql.join(key.map((c) => sql`s.${id(c)} = l.${id(c)}`), sql` AND `)
        : sql`true`;
      const r = await tx.execute(sql`
        DELETE FROM ${id(u.table)} l
        WHERE l.staff_id = ${opts.loserId}
          AND EXISTS (SELECT 1 FROM ${id(u.table)} s WHERE s.staff_id = ${opts.survivorId} AND ${match})`);
      total += r.rowCount ?? 0;
    }
    return total;
  }

  /** People who appear more than once in a business: same login, several staff rows. */
  async findCandidates(businessId: string) {
    const r = await db.execute(sql`
      SELECT s.id, s.user_id, s.store_id, st.name AS store_name, st.currency AS currency, s.name, s.email, s.staff_number,
             s.pay_per_month, s.is_archived, s.created_at
      FROM staff s JOIN stores st ON st.id = s.store_id
      WHERE st.business_id = ${businessId} AND s.user_id IN (
        SELECT s2.user_id FROM staff s2 JOIN stores st2 ON st2.id = s2.store_id
        WHERE st2.business_id = ${businessId} AND s2.user_id IS NOT NULL
        GROUP BY s2.user_id HAVING count(*) > 1)
      ORDER BY s.user_id, s.is_archived, s.created_at, s.id`);
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of r.rows as Array<Record<string, any>>) {
      const list = groups.get(row.user_id) ?? [];
      list.push({
        id: row.id, storeId: row.store_id, storeName: row.store_name, currency: row.currency, name: row.name, email: row.email,
        staffNumber: row.staff_number, payPerMonth: Number(row.pay_per_month), isArchived: row.is_archived,
        createdAt: row.created_at,
      });
      groups.set(row.user_id, list);
    }
    return Array.from(groups.entries()).map(([userId, members]) => ({
      userId,
      // Oldest active record: the one with the most history is the natural keeper.
      suggestedSurvivorId: members[0].id as string,
      members,
    }));
  }
}

export const staffMergeService = new StaffMergeService();
