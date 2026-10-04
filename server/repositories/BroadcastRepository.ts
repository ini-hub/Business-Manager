import { db } from "../db";
import {
  whatsappBroadcasts,
  whatsappBroadcastRecipients,
  whatsappTemplates,
  whatsappOptIns,
  customers,
  type InsertWhatsappBroadcast,
  type WhatsappBroadcast,
} from "@shared/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { pickOptedInCustomerIds } from "../lib/whatsappOptIn";

export class BroadcastRepository {
  async listTemplates(storeId: string) {
    return db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.storeId, storeId), eq(whatsappTemplates.status, "approved")));
  }

  /**
   * Latest opt-in/opt-out event per customer wins. Customers with no event at
   * all are treated as not opted in - broadcast targeting must be explicit
   * consent, not "we have their number so we assume it's fine" (NDPA/GDPR).
   */
  async filterOptedInCustomerIds(customerIds: string[]): Promise<string[]> {
    if (customerIds.length === 0) return [];
    const events = await db
      .select({ customerId: whatsappOptIns.customerId, event: whatsappOptIns.event, createdAt: whatsappOptIns.createdAt })
      .from(whatsappOptIns)
      .where(inArray(whatsappOptIns.customerId, customerIds))
      .orderBy(desc(whatsappOptIns.createdAt));

    return pickOptedInCustomerIds(customerIds, events as { customerId: string; event: "opt_in" | "opt_out"; createdAt: Date }[]);
  }

  async createBroadcast(data: InsertWhatsappBroadcast, customerIds: string[]): Promise<WhatsappBroadcast> {
    return db.transaction(async (tx) => {
      const [broadcast] = await tx.insert(whatsappBroadcasts).values({ ...data, totalRecipients: customerIds.length }).returning();
      if (customerIds.length > 0) {
        await tx.insert(whatsappBroadcastRecipients).values(customerIds.map((customerId) => ({ broadcastId: broadcast.id, customerId, status: "queued" })));
      }
      return broadcast;
    });
  }

  async getBroadcast(id: string): Promise<WhatsappBroadcast | undefined> {
    const [row] = await db.select().from(whatsappBroadcasts).where(eq(whatsappBroadcasts.id, id));
    return row;
  }

  async listBroadcasts(storeId: string) {
    return db.select().from(whatsappBroadcasts).where(eq(whatsappBroadcasts.storeId, storeId)).orderBy(desc(whatsappBroadcasts.createdAt));
  }

  async getRecipients(broadcastId: string) {
    return db
      .select({ recipient: whatsappBroadcastRecipients, customerName: customers.name })
      .from(whatsappBroadcastRecipients)
      .innerJoin(customers, eq(whatsappBroadcastRecipients.customerId, customers.id))
      .where(eq(whatsappBroadcastRecipients.broadcastId, broadcastId));
  }

  async markSending(id: string): Promise<void> {
    await db.update(whatsappBroadcasts).set({ status: "sending" }).where(eq(whatsappBroadcasts.id, id));
  }

  async setRecipientMessage(recipientId: string, whatsappMessageId: string): Promise<void> {
    await db.update(whatsappBroadcastRecipients).set({ whatsappMessageId }).where(eq(whatsappBroadcastRecipients.id, recipientId));
  }
}
