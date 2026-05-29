import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  quotes,
  quoteItems,
  customers,
  inventory,
  type Quote,
  type InsertQuote,
  type QuoteItem,
  type InsertQuoteItem,
  type Customer,
  type Inventory,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export class QuoteRepository extends BaseRepository<typeof quotes> {
  constructor() {
    super(quotes);
  }

  async getQuotes(storeId: string): Promise<(Quote & { customer: Customer | null })[]> {
    const rows = await db
      .select({
        quote: quotes,
        customer: customers,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .where(eq(quotes.storeId, storeId))
      .orderBy(desc(quotes.createdAt));

    return rows.map(r => ({
      ...r.quote,
      customer: r.customer,
    }));
  }

  async getQuote(id: string): Promise<(Quote & { customer: Customer | null; items: (QuoteItem & { inventory: Inventory })[] }) | undefined> {
    const [row] = await db
      .select({
        quote: quotes,
        customer: customers,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .where(eq(quotes.id, id));

    if (!row) return undefined;

    const itemRows = await db
      .select({
        item: quoteItems,
        inv: inventory,
      })
      .from(quoteItems)
      .innerJoin(inventory, eq(quoteItems.inventoryId, inventory.id))
      .where(eq(quoteItems.quoteId, id));

    return {
      ...row.quote,
      customer: row.customer,
      items: itemRows.map(ir => ({
        ...ir.item,
        inventory: ir.inv,
      })),
    };
  }

  async createQuote(data: InsertQuote & { items: { inventoryId: string; quantity: number; unitPrice: number }[] }): Promise<Quote> {
    const { items, ...quoteData } = data;
    
    return db.transaction(async (tx) => {
      const totalPrice = items.reduce((sum: number, item: { quantity: number; unitPrice: number }) => sum + (item.quantity * item.unitPrice), 0);
      
      const [newQuote] = await tx
        .insert(quotes)
        .values({
          ...quoteData,
          totalPrice,
        })
        .returning();

      if (items.length > 0) {
        await tx.insert(quoteItems).values(
          items.map((item: { inventoryId: string; quantity: number; unitPrice: number }) => ({
            quoteId: newQuote.id,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          }))
        );
      }

      return newQuote;
    });
  }

  async updateQuoteStatus(id: string, status: string): Promise<Quote | undefined> {
    const [updated] = await db
      .update(quotes)
      .set({ status, updatedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning();
    return updated;
  }

  async deleteQuote(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
      const [deleted] = await tx.delete(quotes).where(eq(quotes.id, id)).returning();
      return !!deleted;
    });
  }
}
