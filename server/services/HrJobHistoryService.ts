import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import {
  hrJobInfoHistory,
  hrAdditionalJobInfoHistory,
  type HrJobInfoHistory,
  type HrAdditionalJobInfoHistory,
  type CreateHrJobInfoInput,
  type CreateHrAdditionalJobInfoInput,
} from "@shared/schema";

/** Insert-only history tables - see shared/schema/hr-job.ts. */
export class HrJobHistoryService {
  async listJobInfo(staffId: string): Promise<HrJobInfoHistory[]> {
    return db.select().from(hrJobInfoHistory).where(eq(hrJobInfoHistory.staffId, staffId)).orderBy(desc(hrJobInfoHistory.effectiveDate));
  }

  async addJobInfo(staffId: string, createdByUserId: string, input: CreateHrJobInfoInput): Promise<HrJobInfoHistory> {
    const [row] = await db.insert(hrJobInfoHistory).values({ staffId, createdByUserId, ...input }).returning();
    return row;
  }

  async listAdditionalJobInfo(staffId: string): Promise<HrAdditionalJobInfoHistory[]> {
    return db.select().from(hrAdditionalJobInfoHistory).where(eq(hrAdditionalJobInfoHistory.staffId, staffId)).orderBy(desc(hrAdditionalJobInfoHistory.effectiveDate));
  }

  async addAdditionalJobInfo(staffId: string, createdByUserId: string, input: CreateHrAdditionalJobInfoInput): Promise<HrAdditionalJobInfoHistory> {
    const [row] = await db.insert(hrAdditionalJobInfoHistory).values({ staffId, createdByUserId, ...input }).returning();
    return row;
  }
}

export const hrJobHistoryService = new HrJobHistoryService();
