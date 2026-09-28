import { db } from "../db";
import { whatsappTemplates, type InsertWhatsappTemplate, type WhatsappTemplate } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { extractVariableCount } from "../lib/whatsappTemplateVariables";

export class WhatsAppTemplateRepository {
  async list(storeId: string): Promise<WhatsappTemplate[]> {
    return db.select().from(whatsappTemplates).where(eq(whatsappTemplates.storeId, storeId)).orderBy(desc(whatsappTemplates.createdAt));
  }

  async get(id: string): Promise<WhatsappTemplate | undefined> {
    const [row] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, id));
    return row;
  }

  async create(data: Omit<InsertWhatsappTemplate, "variableCount">): Promise<WhatsappTemplate> {
    const [row] = await db.insert(whatsappTemplates).values({
      ...data,
      variableCount: extractVariableCount(data.bodyText),
    }).returning();
    return row;
  }

  async update(id: string, data: Partial<Omit<InsertWhatsappTemplate, "variableCount">>): Promise<WhatsappTemplate | undefined> {
    const patch: Partial<InsertWhatsappTemplate> = { ...data, updatedAt: new Date() } as any;
    if (typeof data.bodyText === "string") {
      patch.variableCount = extractVariableCount(data.bodyText);
    }
    const [row] = await db.update(whatsappTemplates).set(patch).where(eq(whatsappTemplates.id, id)).returning();
    return row;
  }
}
