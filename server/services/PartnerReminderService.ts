import { db } from "../db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { organisations, stores, partnerObligations, partnerTransfers, partnerStatementLog, businessPartnerships } from "@shared/schema";
import { storage } from "../storage";
import { sendPartnerReminderEmail, sendPartnerStatementEmail } from "../email";
import { getOwnerContact } from "../lib/billing";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { reminderDue, shouldSendStatement, statementPeriod, periodRange, type ReminderKind } from "../lib/partnerEngagement";
import { PartnerRepository } from "../repositories/PartnerRepository";
import { PartnerTransferRepository } from "../repositories/PartnerTransferRepository";
import { broadcastDataChange } from "../websocket";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // every hour, like the credit reminders

const MESSAGE: Record<ReminderKind, (partner: string) => string> = {
  upcoming: (p) => `A balance you owe ${p} is due in the next few days.`,
  due: (p) => `A balance you owe ${p} is due today.`,
  overdue: (p) => `A balance you owe ${p} is overdue. Record your payment or contact them.`,
};

/** Reminds each debtor of the balances they owe partners, on the schedule in `reminderDue`. */
export async function runPartnerReminders(now = new Date(), onlyOrgIds?: string[]): Promise<number> {
  const open = await db.select({
    id: partnerObligations.id,
    transferId: partnerObligations.transferId,
    creditorOrgId: partnerObligations.creditorOrgId,
    debtorOrgId: partnerObligations.debtorOrgId,
    amountDue: partnerObligations.amountDue,
    amountSettled: partnerObligations.amountSettled,
    dueDate: partnerObligations.dueDate,
    lastRemindedAt: partnerObligations.lastRemindedAt,
    debtorStoreId: partnerTransfers.toStoreId,
    creditorStoreId: partnerTransfers.fromStoreId,
  }).from(partnerObligations)
    .innerJoin(partnerTransfers, eq(partnerTransfers.id, partnerObligations.transferId))
    .where(and(
      eq(partnerObligations.status, "open"), isNotNull(partnerObligations.dueDate),
      onlyOrgIds ? inArray(partnerObligations.debtorOrgId, onlyOrgIds) : undefined,
    ));

  let sent = 0;
  for (const ob of open) {
    try {
      const kind = reminderDue({ now, dueDate: ob.dueDate, lastRemindedAt: ob.lastRemindedAt });
      if (!kind || !ob.dueDate) continue;
      const remaining = Math.round((ob.amountDue - ob.amountSettled) * 100) / 100;
      if (remaining <= 0) continue;

      // Claim the reminder first so two instances racing on the same hour cannot both send it.
      const claimed = await db.update(partnerObligations).set({ lastRemindedAt: now })
        .where(and(eq(partnerObligations.id, ob.id), ob.lastRemindedAt ? eq(partnerObligations.lastRemindedAt, ob.lastRemindedAt) : sql`${partnerObligations.lastRemindedAt} IS NULL`))
        .returning({ id: partnerObligations.id });
      if (!claimed.length) continue;

      const [creditor] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ob.creditorOrgId));
      const [debtor] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ob.debtorOrgId));
      const [store] = await db.select({ currency: stores.currency }).from(stores).where(eq(stores.id, ob.debtorStoreId));

      await storage.notifyAllStaff(ob.debtorStoreId, "partner_reminder", MESSAGE[kind](creditor?.name ?? "a partner"));
      if (kind === "overdue") {
        await storage.notifyAllStaff(ob.creditorStoreId, "partner_reminder", `${debtor?.name ?? "A partner"} is overdue on a balance they owe you.`);
        broadcastDataChange(ob.creditorOrgId, "partner-transfer", ob.creditorStoreId, "mutated");
      }
      broadcastDataChange(ob.debtorOrgId, "partner-transfer", ob.debtorStoreId, "mutated");

      const owner = await getOwnerContact(ob.debtorOrgId);
      if (owner) {
        sendPartnerReminderEmail(owner.email, owner.name, {
          kind, partnerName: creditor?.name ?? "your partner", amount: remaining, currency: store?.currency ?? "NGN", dueDate: ob.dueDate, transferId: ob.transferId,
        });
      }
      sent++;
    } catch (err) {
      console.error(`[PartnerReminder] obligation ${ob.id}:`, err);
    }
  }
  return sent;
}

const monthLabel = (period: string) => {
  const { from } = periodRange(period);
  return from.toLocaleString("en-GB", { month: "long", year: "numeric" });
};

/** Emails each business with partners a summary of last month, once, during the first week. */
export async function runPartnerStatements(now = new Date(), onlyOrgIds?: string[]): Promise<number> {
  const period = statementPeriod(now);
  if (!period) return 0;
  const { from, to } = periodRange(period);

  const links = await db.select({ a: businessPartnerships.requesterOrgId, b: businessPartnerships.addresseeOrgId })
    .from(businessPartnerships).where(eq(businessPartnerships.status, "active"));
  const orgIds = Array.from(new Set(links.flatMap((l) => [l.a, l.b]))).filter((id) => !onlyOrgIds || onlyOrgIds.includes(id));
  const partnerRepo = new PartnerRepository();
  const transferRepo = new PartnerTransferRepository();

  let sent = 0;
  for (const orgId of orgIds) {
    try {
      const [done] = await db.select().from(partnerStatementLog).where(and(eq(partnerStatementLog.orgId, orgId), eq(partnerStatementLog.period, period)));
      if (done) continue;

      const ledger = await transferRepo.ledger(orgId);
      const [activity] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerTransfers).where(and(
        sql`(${partnerTransfers.fromOrgId} = ${orgId} OR ${partnerTransfers.toOrgId} = ${orgId})`,
        sql`${partnerTransfers.createdAt} >= ${from} AND ${partnerTransfers.createdAt} < ${to}`,
      ));
      const openBalances = ledger.obligations.filter((o) => o.status === "open").length;
      if (!shouldSendStatement({ openBalances, activityInPeriod: activity?.n ?? 0 })) continue;

      // Log first: a primary-key clash means another instance already took this month.
      const claimed = await db.insert(partnerStatementLog).values({ orgId, period }).onConflictDoNothing().returning({ orgId: partnerStatementLog.orgId });
      if (!claimed.length) continue;

      const owner = await getOwnerContact(orgId);
      if (!owner) continue;
      const [org] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
      const orgStores = await db.select({ currency: stores.currency, isMain: stores.isMain }).from(stores).where(eq(stores.businessId, orgId));
      const currency = (orgStores.find((s) => s.isMain) ?? orgStores[0])?.currency ?? "NGN";

      sendPartnerStatementEmail(owner.email, owner.name, {
        businessName: org?.name ?? "Your business",
        periodLabel: monthLabel(period),
        currency,
        partners: ledger.partners.map((p) => ({ name: p.name, balance: p.balance })),
        transfersInPeriod: activity?.n ?? 0,
        partnerCode: await partnerRepo.ensurePartnerCode(orgId),
      });
      sent++;
    } catch (err) {
      console.error(`[PartnerStatement] org ${orgId}:`, err);
    }
  }
  return sent;
}

export function startPartnerReminderService(): void {
  const tick = () => withAdvisoryLock("partner-reminders", async () => {
    await runPartnerReminders();
    await runPartnerStatements();
  }).catch((e) => console.error("[PartnerReminder]", e));
  setTimeout(tick, 20_000);
  setInterval(tick, POLL_INTERVAL_MS);
  console.log("[PartnerReminder] Service started — polling every hour.");
}
