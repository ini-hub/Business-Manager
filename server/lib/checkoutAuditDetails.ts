import { db } from "../db";
import { checkouts, creditEntries, storeCreditTransactions } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * Money side-effects of a receipt, for the Activity log: debt the customer owes
 * us (credit sale) and store credit we owe them (change owed / redeemed /
 * reversed by a void). Read after the fact so the sale and void paths stay
 * untouched. Returns only the keys that apply, so a plain cash sale adds nothing.
 */
export async function getCheckoutMoneyDetails(checkoutIds: string[]): Promise<Record<string, unknown>> {
  if (checkoutIds.length === 0) return {};
  // Credit rows hang off the receipt's first checkout; match the whole receipt to be safe.
  const [first] = await db.select({ receiptNumber: checkouts.receiptNumber }).from(checkouts).where(eq(checkouts.id, checkoutIds[0]));
  const ids = first
    ? (await db.select({ id: checkouts.id }).from(checkouts).where(eq(checkouts.receiptNumber, first.receiptNumber))).map(r => r.id)
    : checkoutIds;

  const [debts, credits] = await Promise.all([
    db.select().from(creditEntries).where(inArray(creditEntries.linkedTransactionId, ids)),
    db.select().from(storeCreditTransactions).where(inArray(storeCreditTransactions.checkoutId, ids)),
  ]);

  const out: Record<string, unknown> = {};
  if (debts.length) {
    out.creditSaleAmount = debts.reduce((s, d) => s + d.amountOwed, 0);
    out.creditPaidUpfront = debts.reduce((s, d) => s + d.amountPaidUpfront, 0);
    out.creditOutstanding = debts.reduce((s, d) => s + d.outstandingBalance, 0);
    out.creditStatus = debts.map(d => d.status).join(", ");
  }
  const sum = (type: string) => credits.filter(c => c.type === type).reduce((s, c) => s + c.amount, 0);
  if (credits.some(c => c.type === "change_owed")) out.storeCreditOwedToCustomer = sum("change_owed");
  if (credits.some(c => c.type === "purchase_redemption")) out.storeCreditRedeemed = -sum("purchase_redemption");
  if (credits.some(c => c.type === "void_reversal")) out.storeCreditReversedByVoid = sum("void_reversal");
  return out;
}
