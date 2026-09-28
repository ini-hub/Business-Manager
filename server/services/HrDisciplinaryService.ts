import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { hrDisciplinaryRecords, type HrDisciplinaryRecord, type UpsertHrDisciplinaryRecordInput } from "@shared/schema";

export class HrDisciplinaryService {
  async list(staffId: string): Promise<HrDisciplinaryRecord[]> {
    return db.select().from(hrDisciplinaryRecords).where(eq(hrDisciplinaryRecords.staffId, staffId)).orderBy(desc(hrDisciplinaryRecords.incidentDate));
  }

  async create(staffId: string, createdByUserId: string, input: UpsertHrDisciplinaryRecordInput): Promise<HrDisciplinaryRecord> {
    const [row] = await db.insert(hrDisciplinaryRecords).values({
      staffId, createdByUserId, ...input, closedDate: input.closedDate || null,
    }).returning();
    return row;
  }

  async update(staffId: string, id: string, input: UpsertHrDisciplinaryRecordInput): Promise<HrDisciplinaryRecord | undefined> {
    const [row] = await db.update(hrDisciplinaryRecords)
      .set({ ...input, closedDate: input.closedDate || null, updatedAt: new Date() })
      .where(and(eq(hrDisciplinaryRecords.id, id), eq(hrDisciplinaryRecords.staffId, staffId)))
      .returning();
    return row;
  }
}

export const hrDisciplinaryService = new HrDisciplinaryService();
