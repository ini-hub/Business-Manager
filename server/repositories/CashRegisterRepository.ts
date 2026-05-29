import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  cashRegisterSessions,
  cashDrops,
  type CashRegisterSession,
  type CashDrop,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export class CashRegisterRepository extends BaseRepository<typeof cashRegisterSessions> {
  constructor() {
    super(cashRegisterSessions);
  }

  async getSessions(storeId: string): Promise<CashRegisterSession[]> {
    return db
      .select()
      .from(cashRegisterSessions)
      .where(eq(cashRegisterSessions.storeId, storeId))
      .orderBy(desc(cashRegisterSessions.openedAt));
  }

  async getActiveSession(storeId: string): Promise<CashRegisterSession | undefined> {
    const [session] = await db
      .select()
      .from(cashRegisterSessions)
      .where(
        and(
          eq(cashRegisterSessions.storeId, storeId),
          eq(cashRegisterSessions.status, "open")
        )
      )
      .limit(1);
    return session;
  }

  async openSession(data: {
    storeId: string;
    openedByUserId: string;
    openingFloat: number;
    notes?: string;
  }): Promise<CashRegisterSession> {
    const [existingOpen] = await db
      .select()
      .from(cashRegisterSessions)
      .where(
        and(
          eq(cashRegisterSessions.storeId, data.storeId),
          eq(cashRegisterSessions.status, "open")
        )
      );

    if (existingOpen) {
      throw new Error("conflict:A cash register session is already open for this store.");
    }

    const [inserted] = await db
      .insert(cashRegisterSessions)
      .values({
        storeId: data.storeId,
        openedByUserId: data.openedByUserId,
        openingFloat: data.openingFloat,
        expectedCash: data.openingFloat, // Initial expected is opening float
        status: "open",
        notes: data.notes,
      })
      .returning();

    return inserted;
  }

  async addToExpectedCash(sessionId: string, amount: number): Promise<void> {
    await db
      .update(cashRegisterSessions)
      .set({
        expectedCash: sql`${cashRegisterSessions.expectedCash} + ${amount}`,
      })
      .where(eq(cashRegisterSessions.id, sessionId));
  }

  async recordCashDrop(data: {
    sessionId: string;
    amount: number;
    droppedByUserId: string;
    notes?: string;
  }): Promise<CashDrop> {
    const session = await this.findById(data.sessionId);
    if (!session || session.status !== "open") {
      throw new Error("bad_request:Cannot record drop on a closed or non-existent session.");
    }

    const [inserted] = await db
      .insert(cashDrops)
      .values({
        sessionId: data.sessionId,
        amount: data.amount,
        droppedByUserId: data.droppedByUserId,
        notes: data.notes,
      })
      .returning();

    // Adjust expected cash down by the dropped amount
    await db
      .update(cashRegisterSessions)
      .set({
        expectedCash: sql`${cashRegisterSessions.expectedCash} - ${data.amount}`,
      })
      .where(eq(cashRegisterSessions.id, data.sessionId));

    return inserted;
  }

  async getSessionDrops(sessionId: string): Promise<CashDrop[]> {
    return db
      .select()
      .from(cashDrops)
      .where(eq(cashDrops.sessionId, sessionId))
      .orderBy(desc(cashDrops.droppedAt));
  }

  async closeSession(
    sessionId: string,
    data: {
      closedByUserId: string;
      actualCash: number;
      notes?: string;
    }
  ): Promise<CashRegisterSession> {
    const session = await this.findById(sessionId);
    if (!session || session.status !== "open") {
      throw new Error("bad_request:Session is not open.");
    }

    const difference = data.actualCash - session.expectedCash;

    const [closed] = await db
      .update(cashRegisterSessions)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedByUserId: data.closedByUserId,
        actualCash: data.actualCash,
        difference: difference,
        notes: data.notes,
      })
      .where(eq(cashRegisterSessions.id, sessionId))
      .returning();

    return closed;
  }
}
