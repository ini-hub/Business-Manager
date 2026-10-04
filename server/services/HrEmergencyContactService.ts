import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { hrEmergencyContacts, type HrEmergencyContact, type UpsertHrEmergencyContactInput } from "@shared/schema";

class HrEmergencyContactService {
  async list(staffId: string): Promise<HrEmergencyContact[]> {
    return db.select().from(hrEmergencyContacts)
      .where(eq(hrEmergencyContacts.staffId, staffId))
      .orderBy(hrEmergencyContacts.sortOrder);
  }

  async create(staffId: string, input: UpsertHrEmergencyContactInput): Promise<HrEmergencyContact> {
    const existing = await this.list(staffId);
    const [row] = await db.insert(hrEmergencyContacts).values({
      staffId,
      ...input,
      email: input.email || null,
      sortOrder: existing.length,
    }).returning();
    return row;
  }

  async update(staffId: string, id: string, input: UpsertHrEmergencyContactInput): Promise<HrEmergencyContact | undefined> {
    const [row] = await db.update(hrEmergencyContacts)
      .set({ ...input, email: input.email || null, updatedAt: new Date() })
      .where(and(eq(hrEmergencyContacts.id, id), eq(hrEmergencyContacts.staffId, staffId)))
      .returning();
    return row;
  }

  async remove(staffId: string, id: string): Promise<boolean> {
    const deleted = await db.delete(hrEmergencyContacts)
      .where(and(eq(hrEmergencyContacts.id, id), eq(hrEmergencyContacts.staffId, staffId)))
      .returning({ id: hrEmergencyContacts.id });
    return deleted.length > 0;
  }
}

export const hrEmergencyContactService = new HrEmergencyContactService();
