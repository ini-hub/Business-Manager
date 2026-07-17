import { db } from "../db";
import { eq } from "drizzle-orm";
import { auditLogger } from "../audit";
import type { AuditContext } from "../routes/helpers";

interface AuditedWriteOptions {
  resource: string;
  action: string;
}

export abstract class BaseRepository<TTable extends { id: any }> {
  protected table: TTable;

  constructor(table: TTable) {
    this.table = table;
  }

  /**
   * Find a single record by its primary ID key
   */
  public async findById(id: string): Promise<any | undefined> {
    const [record] = await db
      .select()
      .from(this.table as any)
      .where(eq((this.table as any).id, id));
    return record;
  }

  /**
   * Delete a single record by its primary ID key
   */
  public async deleteById(id: string): Promise<void> {
    await db.delete(this.table as any).where(eq((this.table as any).id, id));
  }

  /**
   * Which top-level keys differ between two flat row objects. Used to derive
   * audit_logs.changed_fields — comparing serialized values so Date/number/
   * jsonb columns diff correctly without a deep-equal dependency.
   */
  protected diffFields(before: Record<string, any> | undefined, after: Record<string, any> | undefined): string[] {
    if (!before || !after) return [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];
    keys.forEach((key) => {
      const a = before[key];
      const b = after[key];
      const serialize = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v));
      if (serialize(a) !== serialize(b)) changed.push(key);
    });
    return changed;
  }

  /**
   * Insert + write a CREATE audit row in one call. `data` is the full insert
   * payload; the inserted row (via RETURNING) becomes audit_logs.new_values.
   */
  public async createWithAudit(
    data: Record<string, any>,
    ctx: AuditContext,
    opts: AuditedWriteOptions
  ): Promise<any> {
    const [created] = (await db.insert(this.table as any).values(data as any).returning()) as any[];
    auditLogger.logEvent(ctx, opts.action, opts.resource, created?.id, "success", {
      newValues: created,
    });
    return created;
  }

  /**
   * Fetch-before-write UPDATE + audit row with previous_values/new_values/
   * changed_fields populated. Skips writing an audit row entirely if the
   * patch was a no-op (nothing actually changed) — avoids noise in the log.
   */
  public async updateWithAudit(
    id: string,
    patch: Record<string, any>,
    ctx: AuditContext,
    opts: AuditedWriteOptions
  ): Promise<any> {
    const before = await this.findById(id);
    const [after] = await db
      .update(this.table as any)
      .set(patch as any)
      .where(eq((this.table as any).id, id))
      .returning();
    const changedFields = this.diffFields(before, after);
    if (changedFields.length > 0) {
      auditLogger.logEvent(ctx, opts.action, opts.resource, id, "success", {
        previousValues: before,
        newValues: after,
        changedFields,
      });
    }
    return after;
  }

  /** Soft-delete/archive — same mechanics as updateWithAudit, distinct action name expected. */
  public async softDeleteWithAudit(
    id: string,
    softDeleteFields: Record<string, any>,
    ctx: AuditContext,
    opts: AuditedWriteOptions
  ): Promise<any> {
    return this.updateWithAudit(id, softDeleteFields, ctx, opts);
  }

  /** Restore from soft-delete/archive — same mechanics, distinct action name expected. */
  public async restoreWithAudit(
    id: string,
    restoreFields: Record<string, any>,
    ctx: AuditContext,
    opts: AuditedWriteOptions
  ): Promise<any> {
    return this.updateWithAudit(id, restoreFields, ctx, opts);
  }

  /**
   * Hard delete — captures the full row as previous_values before removing it,
   * since this audit row becomes the only remaining record of the deleted row.
   */
  public async hardDeleteWithAudit(
    id: string,
    ctx: AuditContext,
    opts: AuditedWriteOptions
  ): Promise<void> {
    const before = await this.findById(id);
    await db.delete(this.table as any).where(eq((this.table as any).id, id));
    auditLogger.logEvent(ctx, opts.action, opts.resource, id, "success", {
      previousValues: before,
    });
  }
}
