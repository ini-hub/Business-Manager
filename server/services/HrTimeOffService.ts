import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  hrTimeOffBalances,
  hrTimeOffRequests,
  hrTimeOffHistory,
  type HrLeaveType,
  type HrTimeOffBalance,
  type HrTimeOffRequest,
  type HrTimeOffHistoryEntry,
  type CreateHrTimeOffRequestInput,
} from "@shared/schema";

type ReviewOutcome =
  | { kind: "approved"; request: HrTimeOffRequest; balance: HrTimeOffBalance }
  | { kind: "rejected"; request: HrTimeOffRequest }
  | { kind: "not_pending"; reason: string };

const ALL_LEAVE_TYPES: HrLeaveType[] = ["annual", "sick", "bereavement", "maternity"];

/**
 * The time-off ledger: hr_time_off_balances is always re-derived by writing
 * a matching hr_time_off_history row in the same transaction as any change
 * (see the HR module plan's risk resolution for why this is a ledger, not a
 * bag of fields). No endpoint ever writes balances directly.
 */
class HrTimeOffService {
  async getBalances(staffId: string): Promise<HrTimeOffBalance[]> {
    const rows = await db.select().from(hrTimeOffBalances).where(eq(hrTimeOffBalances.staffId, staffId));
    const byType = new Map(rows.map((r) => [r.leaveType, r]));
    // Defensive: fill in any leave type missing a row (e.g. staff created
    // before the 0067 seed ran) as a zeroed, unpersisted balance.
    return ALL_LEAVE_TYPES.map((lt) => byType.get(lt) ?? {
      id: "", staffId, leaveType: lt, available: 0, used: 0, earned: 0, updatedAt: new Date(),
    });
  }

  async listRequests(staffId: string): Promise<HrTimeOffRequest[]> {
    return db.select().from(hrTimeOffRequests).where(eq(hrTimeOffRequests.staffId, staffId)).orderBy(desc(hrTimeOffRequests.createdAt));
  }

  async listHistory(staffId: string, leaveType?: HrLeaveType): Promise<HrTimeOffHistoryEntry[]> {
    const conditions = leaveType
      ? and(eq(hrTimeOffHistory.staffId, staffId), eq(hrTimeOffHistory.leaveType, leaveType))
      : eq(hrTimeOffHistory.staffId, staffId);
    return db.select().from(hrTimeOffHistory).where(conditions).orderBy(desc(hrTimeOffHistory.date));
  }

  async createRequest(staffId: string, input: CreateHrTimeOffRequestInput): Promise<HrTimeOffRequest> {
    const [row] = await db.insert(hrTimeOffRequests).values({
      staffId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      daysRequested: input.daysRequested,
      reason: input.reason,
      status: "pending",
    }).returning();
    return row;
  }

  async approve(requestId: string, reviewedByUserId: string): Promise<ReviewOutcome> {
    const [request] = await db.select().from(hrTimeOffRequests).where(eq(hrTimeOffRequests.id, requestId));
    if (!request || request.status !== "pending") {
      return { kind: "not_pending", reason: "This request is not awaiting review." };
    }

    const result = await db.transaction(async (tx) => {
      const [updatedRequest] = await tx.update(hrTimeOffRequests)
        .set({ status: "approved", reviewedByUserId, reviewedAt: new Date() })
        .where(eq(hrTimeOffRequests.id, requestId))
        .returning();

      const [existingBalance] = await tx.select().from(hrTimeOffBalances)
        .where(and(eq(hrTimeOffBalances.staffId, request.staffId), eq(hrTimeOffBalances.leaveType, request.leaveType)));
      const current = existingBalance ?? { available: 0, used: 0, earned: 0 };
      const newUsed = Number(current.used) + Number(request.daysRequested);
      const newAvailable = Number(current.available) - Number(request.daysRequested);

      const [balance] = existingBalance
        ? await tx.update(hrTimeOffBalances)
            .set({ used: newUsed, available: newAvailable, updatedAt: new Date() })
            .where(eq(hrTimeOffBalances.id, existingBalance.id))
            .returning()
        : await tx.insert(hrTimeOffBalances)
            .values({ staffId: request.staffId, leaveType: request.leaveType, used: newUsed, available: newAvailable, earned: 0 })
            .returning();

      await tx.insert(hrTimeOffHistory).values({
        staffId: request.staffId,
        requestId: request.id,
        leaveType: request.leaveType,
        date: request.startDate,
        description: `Time off approved (${request.daysRequested} day(s))`,
        usedDays: request.daysRequested,
        earnedDays: 0,
        balanceAfter: newAvailable,
      });

      return { request: updatedRequest, balance };
    });

    return { kind: "approved", ...result };
  }

  async reject(requestId: string, reviewedByUserId: string): Promise<ReviewOutcome> {
    const [request] = await db.select().from(hrTimeOffRequests).where(eq(hrTimeOffRequests.id, requestId));
    if (!request || request.status !== "pending") {
      return { kind: "not_pending", reason: "This request is not awaiting review." };
    }
    const [updated] = await db.update(hrTimeOffRequests)
      .set({ status: "rejected", reviewedByUserId, reviewedAt: new Date() })
      .where(eq(hrTimeOffRequests.id, requestId))
      .returning();
    return { kind: "rejected", request: updated };
  }

  /** Manager-initiated balance adjustment (e.g. annual accrual), outside the request workflow. */
  async adjustBalance(params: { staffId: string; leaveType: HrLeaveType; earnedDelta?: number; description: string }): Promise<HrTimeOffBalance> {
    const { staffId, leaveType, earnedDelta = 0, description } = params;
    return db.transaction(async (tx) => {
      const [existingBalance] = await tx.select().from(hrTimeOffBalances)
        .where(and(eq(hrTimeOffBalances.staffId, staffId), eq(hrTimeOffBalances.leaveType, leaveType)));
      const current = existingBalance ?? { available: 0, used: 0, earned: 0 };
      const newEarned = Number(current.earned) + earnedDelta;
      const newAvailable = Number(current.available) + earnedDelta;

      const [balance] = existingBalance
        ? await tx.update(hrTimeOffBalances)
            .set({ earned: newEarned, available: newAvailable, updatedAt: new Date() })
            .where(eq(hrTimeOffBalances.id, existingBalance.id))
            .returning()
        : await tx.insert(hrTimeOffBalances)
            .values({ staffId, leaveType, earned: newEarned, available: newAvailable, used: 0 })
            .returning();

      await tx.insert(hrTimeOffHistory).values({
        staffId,
        leaveType,
        date: new Date().toISOString().slice(0, 10),
        description,
        usedDays: 0,
        earnedDays: earnedDelta,
        balanceAfter: newAvailable,
      });

      return balance;
    });
  }
}

export const hrTimeOffService = new HrTimeOffService();
