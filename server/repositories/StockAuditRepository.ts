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

    for (const item of data.items) {
      const variance = item.physicalQuantity - item.systemQuantity;
      await db.insert(stockAuditItems).values({
        auditId: audit.id,
        inventoryId: item.inventoryId,
        systemQuantity: item.systemQuantity,
        physicalQuantity: item.physicalQuantity,
        variance,
        reason: item.reason,
      });
    }

    return audit;
  }

  async approveAudit(id: string, approvedByUserId: string): Promise<StockAudit> {
    const auditDetails = await this.getAudit(id);
    if (!auditDetails) {
      throw new Error("not_found:Stock audit not found.");
    }
    if (auditDetails.status === "approved") {
      throw new Error("bad_request:Stock audit is already approved.");
    }

    // Update physical inventory counts in the database based on the audited quantities
    for (const item of auditDetails.items) {
      await db
        .update(inventory)
        .set({
          quantity: item.physicalQuantity,
        })
        .where(eq(inventory.id, item.inventoryId));
    }

    const [updated] = await db
      .update(stockAudits)
      .set({
        status: "approved",
        approvedByUserId,
        approvedAt: new Date(),
      })
      .where(eq(stockAudits.id, id))
      .returning();

    return updated;
  }
}
