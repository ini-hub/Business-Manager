import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  stockAudits,
  stockAuditItems,
  inventory,
  staff,
  users,
  type StockAudit,
  type StockAuditItem,
  type Inventory,
  type Staff,
  type User,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { settleSupplyVariance, localDateString } from "../services/SupplyCostingService";
import { getStoreTimezone } from "../lib/dateUtils";

export class StockAuditRepository extends BaseRepository<typeof stockAudits> {
  constructor() {
    super(stockAudits);
  }

  async getAudits(storeId: string): Promise<StockAudit[]> {
    return db
      .select()
      .from(stockAudits)
      .where(eq(stockAudits.storeId, storeId))
      .orderBy(desc(stockAudits.createdAt));
  }

  async getAudit(id: string): Promise<
    | (StockAudit & {
        items: (StockAuditItem & { inventory: Inventory })[];
        conductedBy: Staff | null;
        approvedBy: User | null;
      })
    | undefined
  > {
    const audit = await this.findById(id);
    if (!audit) return undefined;

    const [conductedBy] = audit.conductedByStaffId
      ? await db.select().from(staff).where(eq(staff.id, audit.conductedByStaffId)).limit(1)
      : [null];

    const [approvedBy] = audit.approvedByUserId
      ? await db.select().from(users).where(eq(users.id, audit.approvedByUserId)).limit(1)
      : [null];

    const itemsRows = await db
      .select({
        item: stockAuditItems,
        inventory: inventory,
      })
      .from(stockAuditItems)
      .innerJoin(inventory, eq(stockAuditItems.inventoryId, inventory.id))
      .where(eq(stockAuditItems.auditId, id));

    const items = itemsRows.map((r) => ({
      ...r.item,
      inventory: r.inventory,
    }));

    return {
      ...audit,
      conductedBy,
      approvedBy,
      items,
    };
  }

  async createAudit(data: {
    storeId: string;
    conductedByStaffId?: string | null;
    notes?: string;
    items: {
      inventoryId: string;
      systemQuantity: number;
      physicalQuantity: number;
      reason?: string;
    }[];
  }): Promise<StockAudit> {
    const [audit] = await db
      .insert(stockAudits)
      .values({
        storeId: data.storeId,
        conductedByStaffId: data.conductedByStaffId,
        notes: data.notes,
        status: "draft",
      })
      .returning();

    if (data.items.length > 0) {
      await db.insert(stockAuditItems).values(
        data.items.map((item) => ({
          auditId: audit.id,
          inventoryId: item.inventoryId,
          systemQuantity: item.systemQuantity,
          physicalQuantity: item.physicalQuantity,
          variance: item.physicalQuantity - item.systemQuantity,
          reason: item.reason,
        }))
      );
    }

    return audit;
  }

  async approveAudit(id: string, approvedByUserId: string): Promise<StockAudit & { varianceTotal: number }> {
    const auditDetails = await this.getAudit(id);
    if (!auditDetails) {
      throw new Error("not_found:Stock audit not found.");
    }
    if (auditDetails.status === "approved") {
      throw new Error("bad_request:Stock audit is already approved.");
    }

    const tz = await getStoreTimezone(auditDetails.storeId);
    const countDate = localDateString(tz);
    let varianceTotal = 0;

    const updated = await db.transaction(async (tx) => {
      // Settle metered supplies BEFORE the quantity is overwritten — the variance
      // is the gap between what the recipes thought was left and what was counted,
      // and the pre-count figure is only available until this update lands.
      //
      // This is what makes a guessed recipe rate safe: whatever the rate got wrong
      // is caught here, so total cost over a period bounded by two counts equals
      // exactly what was really consumed.
      for (const item of auditDetails.items) {
        varianceTotal += await settleSupplyVariance(tx, {
          storeId: auditDetails.storeId,
          item: item.inventory,
          systemQuantity: Number(item.systemQuantity),
          physicalQuantity: Number(item.physicalQuantity),
          date: countDate,
          reference: `Stock count ${id}`,
        });
      }

      // Update physical inventory counts in one batched statement instead of one UPDATE per item
      if (auditDetails.items.length > 0) {
        const valueRows = sql.join(
          auditDetails.items.map((item) => sql`(${item.inventoryId}::varchar, ${item.physicalQuantity}::numeric)`),
          sql`, `
        );
        await tx.execute(sql`
          UPDATE inventory AS inv
          SET quantity = v.quantity
          FROM (VALUES ${valueRows}) AS v(id, quantity)
          WHERE inv.id = v.id
        `);
      }

      const [row] = await tx
        .update(stockAudits)
        .set({
          status: "approved",
          approvedByUserId,
          approvedAt: new Date(),
        })
        .where(eq(stockAudits.id, id))
        .returning();

      return row;
    });

    return { ...updated, varianceTotal };
  }

  /**
   * What approving this audit would cost, without approving it. An owner should
   * see "this count writes off ₦4,200" before committing to it.
   */
  async previewVariance(id: string): Promise<{ total: number; lines: { name: string; variance: number; cost: number }[] }> {
    const auditDetails = await this.getAudit(id);
    if (!auditDetails) return { total: 0, lines: [] };

    const lines = auditDetails.items
      .filter((item) => item.inventory.type === "supply" && item.inventory.costingMode === "metered")
      .map((item) => {
        const missing = Number(item.systemQuantity) - Number(item.physicalQuantity);
        return {
          name: item.inventory.name,
          variance: -missing,
          cost: Math.round((missing * Number(item.inventory.costPrice) + Number.EPSILON) * 100) / 100,
        };
      })
      .filter((l) => l.cost !== 0);

    return { total: lines.reduce((s, l) => s + l.cost, 0), lines };
  }
}
