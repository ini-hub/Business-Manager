import { db } from "../db";
import {
  gamificationPointsLedger,
  gamificationBadgeAwards,
  gamificationStreaks,
  customers,
  staff,
  type GamificationSubjectType,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { BADGE_DEFINITIONS, POINTS_RULES } from "@shared/gamification/badges";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LeaderboardEntry = {
  subjectId: string;
  name: string;
  points: number;
};

export class GamificationRepository {
  async awardPoints(
    storeId: string,
    subjectType: GamificationSubjectType,
    subjectId: string,
    points: number,
    reason: string,
    sourceType?: string,
    sourceId?: string,
    tx: Tx | typeof db = db,
  ) {
    await tx.insert(gamificationPointsLedger).values({
      storeId,
      subjectType,
      subjectId,
      points,
      reason,
      sourceType: sourceType ?? null,
      sourceId: sourceId ?? null,
    });
  }

  async getPointsTotal(storeId: string, subjectType: GamificationSubjectType, subjectId: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${gamificationPointsLedger.points}), 0)` })
      .from(gamificationPointsLedger)
      .where(and(
        eq(gamificationPointsLedger.storeId, storeId),
        eq(gamificationPointsLedger.subjectType, subjectType),
        eq(gamificationPointsLedger.subjectId, subjectId),
      ));
    return Number(row?.total ?? 0);
  }

  async getLeaderboard(storeId: string, subjectType: GamificationSubjectType, limit = 10): Promise<LeaderboardEntry[]> {
    const rows = await db
      .select({
        subjectId: gamificationPointsLedger.subjectId,
        points: sql<number>`coalesce(sum(${gamificationPointsLedger.points}), 0)`,
      })
      .from(gamificationPointsLedger)
      .where(and(
        eq(gamificationPointsLedger.storeId, storeId),
        eq(gamificationPointsLedger.subjectType, subjectType),
      ))
      .groupBy(gamificationPointsLedger.subjectId)
      .orderBy(desc(sql`sum(${gamificationPointsLedger.points})`))
      .limit(limit);

    if (rows.length === 0) return [];

    const ids = rows.map(r => r.subjectId);
    const nameById = new Map<string, string>();
    if (subjectType === "customer") {
      const people = await db.select({ id: customers.id, name: customers.name }).from(customers)
        .where(sql`${customers.id} = any(${ids})`);
      for (const p of people) nameById.set(p.id, p.name);
    } else if (subjectType === "staff") {
      const people = await db.select({ id: staff.id, name: staff.name }).from(staff)
        .where(sql`${staff.id} = any(${ids})`);
      for (const p of people) nameById.set(p.id, p.name);
    }

    return rows.map(r => ({
      subjectId: r.subjectId,
      name: nameById.get(r.subjectId) ?? "Unknown",
      points: Number(r.points),
    }));
  }

  async getBadges(storeId: string, subjectType: GamificationSubjectType, subjectId: string) {
    const awards = await db.select().from(gamificationBadgeAwards)
      .where(and(
        eq(gamificationBadgeAwards.storeId, storeId),
        eq(gamificationBadgeAwards.subjectType, subjectType),
        eq(gamificationBadgeAwards.subjectId, subjectId),
      ));
    return awards.map(a => ({
      ...BADGE_DEFINITIONS.find(b => b.key === a.badgeKey),
      awardedAt: a.awardedAt,
    }));
  }

  async getStreak(storeId: string, subjectType: GamificationSubjectType, subjectId: string, streakType: string) {
    const [row] = await db.select().from(gamificationStreaks)
      .where(and(
        eq(gamificationStreaks.storeId, storeId),
        eq(gamificationStreaks.subjectType, subjectType),
        eq(gamificationStreaks.subjectId, subjectId),
        eq(gamificationStreaks.streakType, streakType),
      ));
    return row ?? null;
  }

  private async awardBadgeIfNew(
    storeId: string,
    subjectType: GamificationSubjectType,
    subjectId: string,
    badgeKey: string,
    tx: Tx | typeof db = db,
  ) {
    await tx.insert(gamificationBadgeAwards)
      .values({ storeId, subjectType, subjectId, badgeKey })
      .onConflictDoNothing();
  }

  // Called after a checkout commits. Awards the customer points for the visit,
  // bumps their weekly visit streak, and checks milestone badges based on
  // lifetime visit count. Runs in the same transaction as the checkout so a
  // failed checkout never leaves a dangling points entry.
  async recordCustomerVisit(storeId: string, customerId: string, checkoutId: string, tx: Tx) {
    await this.awardPoints(storeId, "customer", customerId, POINTS_RULES.customer_visit, "checkout_visit", "checkout", checkoutId, tx);

    const [{ visitCount }] = await tx
      .select({ visitCount: sql<number>`count(*)` })
      .from(gamificationPointsLedger)
      .where(and(
        eq(gamificationPointsLedger.storeId, storeId),
        eq(gamificationPointsLedger.subjectType, "customer"),
        eq(gamificationPointsLedger.subjectId, customerId),
        eq(gamificationPointsLedger.reason, "checkout_visit"),
      ));
    const count = Number(visitCount);

    if (count === 1) await this.awardBadgeIfNew(storeId, "customer", customerId, "first_visit", tx);
    if (count === 5) await this.awardBadgeIfNew(storeId, "customer", customerId, "regular_5", tx);
    if (count === 20) await this.awardBadgeIfNew(storeId, "customer", customerId, "vip_20", tx);

    await this.bumpWeeklyStreak(storeId, "customer", customerId, "visit_week", tx, "loyalty_streak_4", 4);
  }

  // Called after a checkout commits, once per staff member credited on it
  // (checkout processor + lead/assisting staff). Sales-count badges only,
  // not tied to revenue value, so a modest ticket counts the same as a big one.
  async recordStaffSale(storeId: string, staffId: string, checkoutId: string, tx: Tx) {
    await this.awardPoints(storeId, "staff", staffId, POINTS_RULES.staff_sale, "checkout_sale", "checkout", checkoutId, tx);

    const [{ saleCount }] = await tx
      .select({ saleCount: sql<number>`count(*)` })
      .from(gamificationPointsLedger)
      .where(and(
        eq(gamificationPointsLedger.storeId, storeId),
        eq(gamificationPointsLedger.subjectType, "staff"),
        eq(gamificationPointsLedger.subjectId, staffId),
        eq(gamificationPointsLedger.reason, "checkout_sale"),
      ));
    const count = Number(saleCount);

    if (count === 1) await this.awardBadgeIfNew(storeId, "staff", staffId, "first_sale", tx);
    if (count === 50) await this.awardBadgeIfNew(storeId, "staff", staffId, "sales_50", tx);
    if (count === 200) await this.awardBadgeIfNew(storeId, "staff", staffId, "sales_200", tx);
  }

  // Called once per staff member per attendance punch. Consecutive on-time
  // punches build the streak; a single late/missed punch resets it to 0.
  async recordAttendancePunch(storeId: string, staffId: string, isOnTime: boolean) {
    const streakType = "on_time_shift";
    const existing = await this.getStreak(storeId, "staff", staffId, streakType);

    if (!isOnTime) {
      if (existing) {
        await db.update(gamificationStreaks)
          .set({ currentCount: 0, updatedAt: new Date() })
          .where(eq(gamificationStreaks.id, existing.id));
      }
      return;
    }

    await this.awardPoints(storeId, "staff", staffId, POINTS_RULES.staff_on_time_shift, "on_time_shift");

    const newCount = (existing?.currentCount ?? 0) + 1;
    const newLongest = Math.max(existing?.longestCount ?? 0, newCount);

    if (existing) {
      await db.update(gamificationStreaks)
        .set({ currentCount: newCount, longestCount: newLongest, lastQualifyingAt: new Date(), updatedAt: new Date() })
        .where(eq(gamificationStreaks.id, existing.id));
    } else {
      await db.insert(gamificationStreaks).values({
        storeId, subjectType: "staff", subjectId: staffId, streakType,
        currentCount: newCount, longestCount: newLongest, lastQualifyingAt: new Date(),
      });
    }

    if (newCount === 10) await this.awardBadgeIfNew(storeId, "staff", staffId, "on_time_streak_10");
    if (newCount === 30) await this.awardBadgeIfNew(storeId, "staff", staffId, "on_time_streak_30");
  }

  private async bumpWeeklyStreak(
    storeId: string,
    subjectType: GamificationSubjectType,
    subjectId: string,
    streakType: string,
    tx: Tx,
    milestoneBadgeKey: string,
    milestoneCount: number,
  ) {
    const [existing] = await tx.select().from(gamificationStreaks)
      .where(and(
        eq(gamificationStreaks.storeId, storeId),
        eq(gamificationStreaks.subjectType, subjectType),
        eq(gamificationStreaks.subjectId, subjectId),
        eq(gamificationStreaks.streakType, streakType),
      ));

    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const withinCurrentOrNextWeek = existing?.lastQualifyingAt
      ? now.getTime() - new Date(existing.lastQualifyingAt).getTime() <= 2 * weekMs
      : false;

    if (existing && withinCurrentOrNextWeek) {
      const sameWeek = now.getTime() - new Date(existing.lastQualifyingAt!).getTime() < weekMs;
      if (sameWeek) return; // already counted this week

      const newCount = existing.currentCount + 1;
      await tx.update(gamificationStreaks)
        .set({ currentCount: newCount, longestCount: Math.max(existing.longestCount, newCount), lastQualifyingAt: now, updatedAt: now })
        .where(eq(gamificationStreaks.id, existing.id));
      if (newCount === milestoneCount) await this.awardBadgeIfNew(storeId, subjectType, subjectId, milestoneBadgeKey, tx);
    } else if (existing) {
      await tx.update(gamificationStreaks)
        .set({ currentCount: 1, lastQualifyingAt: now, updatedAt: now })
        .where(eq(gamificationStreaks.id, existing.id));
    } else {
      await tx.insert(gamificationStreaks).values({
        storeId, subjectType, subjectId, streakType, currentCount: 1, longestCount: 1, lastQualifyingAt: now,
      });
    }
  }

  // Owner/business milestone badges - cheap to recompute on read since they
  // only fire a handful of times over a store's lifetime.
  async evaluateOwnerBadges(storeId: string) {
    const [{ customerCount }] = await db
      .select({ customerCount: sql<number>`count(*)` })
      .from(customers)
      .where(eq(customers.storeId, storeId));

    if (Number(customerCount) >= 100) await this.awardBadgeIfNew(storeId, "owner", storeId, "customers_100");
  }
}

export const gamificationRepository = new GamificationRepository();
