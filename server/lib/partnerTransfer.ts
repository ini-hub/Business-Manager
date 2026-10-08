import type { PartnerTransferStatus, SettlementType } from "@shared/schema";

/**
 * Pure rules for partner (inter-business) transfers: who may move a transfer
 * to which state, what is owed, and whether the two sides still reconcile.
 * No DB access, so the repository can lean on it and tests can pin it.
 */

export type PartnerSide = "sender" | "receiver";
export type PartnerKind = "send" | "request";
export type PartnerAction = "accept" | "reject" | "cancel" | "ship" | "receive" | "resolve" | "close";

type Transition = { from: PartnerTransferStatus[]; by: PartnerSide; to: PartnerTransferStatus };

// Who answers an opening move depends on who made it. A send is offered by the sender and
// answered by the receiver; a request is made by the receiver and answered by the sender.
// From "accepted" onward the two kinds run the same way: sender ships, receiver confirms.
const TRANSITIONS: Record<PartnerKind, Record<PartnerAction, Transition>> = {
  send: {
    accept: { from: ["offered"], by: "receiver", to: "accepted" },
    reject: { from: ["offered"], by: "receiver", to: "rejected" },
    cancel: { from: ["offered", "accepted"], by: "sender", to: "cancelled" },
    ship: { from: ["accepted"], by: "sender", to: "shipped" },
    // `receive` lands on "received" or "disputed" depending on shortfall; see receiveOutcome.
    receive: { from: ["shipped"], by: "receiver", to: "received" },
    resolve: { from: ["disputed"], by: "sender", to: "closed" },
    close: { from: ["received"], by: "sender", to: "closed" },
  },
  request: {
    accept: { from: ["requested"], by: "sender", to: "accepted" },
    reject: { from: ["requested"], by: "sender", to: "rejected" },
    // The requester may withdraw until the supplier has taken it on; after that only the supplier can call it off.
    cancel: { from: ["requested"], by: "receiver", to: "cancelled" },
    ship: { from: ["accepted"], by: "sender", to: "shipped" },
    receive: { from: ["shipped"], by: "receiver", to: "received" },
    resolve: { from: ["disputed"], by: "sender", to: "closed" },
    close: { from: ["received"], by: "sender", to: "closed" },
  },
};

export function nextStatus(action: PartnerAction, status: PartnerTransferStatus, side: PartnerSide, kind: PartnerKind = "send"): PartnerTransferStatus {
  let t = TRANSITIONS[kind][action];
  // Once a request is accepted the supplier can still call it off before shipping.
  if (kind === "request" && action === "cancel" && status === "accepted") t = { from: ["accepted"], by: "sender", to: "cancelled" };
  if (t.by !== side) throw new PartnerRuleError(`Only the ${t.by} can ${action} a transfer.`);
  if (!t.from.includes(status)) throw new PartnerRuleError(`A ${status} transfer cannot be ${action}ed.`);
  return t.to;
}

/** Who has to act next, so each side's screen can say whose turn it is. */
export function awaiting(status: PartnerTransferStatus, kind: PartnerKind): PartnerSide | null {
  switch (status) {
    case "offered": return "receiver";
    case "requested": return "sender";
    case "accepted": return "sender";
    case "shipped": return "receiver";
    case "disputed": return "sender";
    default: return null;
  }
}

export class PartnerRuleError extends Error {}

/** Stock leaves the sender only once the transfer ships; it enters the receiver only when received. */
export function sideOf(orgId: string, t: { fromOrgId: string; toOrgId: string }): PartnerSide | null {
  if (orgId === t.fromOrgId) return "sender";
  if (orgId === t.toOrgId) return "receiver";
  return null;
}

const money = (n: number) => Math.round(n * 100) / 100;
const qty = (n: number) => Math.round(n * 10_000) / 10_000;

interface PricedLine {
  quantity: number;
  confirmedQuantity?: number | null;
  unitCostSnapshot: number;
  agreedUnitPrice?: number | null;
}

/** Price per unit: the agreed price when set, otherwise the sender's cost at the time. */
export const lineUnitPrice = (l: Pick<PricedLine, "unitCostSnapshot" | "agreedUnitPrice">) =>
  l.agreedUnitPrice ?? l.unitCostSnapshot;

/** Value of what was offered (before receipt) or confirmed (after). */
export function transferValue(lines: PricedLine[], basis: "offered" | "confirmed"): number {
  return money(lines.reduce((sum, l) => {
    const q = basis === "confirmed" ? (l.confirmedQuantity ?? 0) : l.quantity;
    return sum + q * lineUnitPrice(l);
  }, 0));
}

/** Quantity the receiver confirmed vs. what was shipped. Over-receipt is refused. */
export function receiveOutcome(lines: { id: string; quantity: number; confirmed: number }[]): {
  status: Extract<PartnerTransferStatus, "received" | "disputed">;
  shortfall: { id: string; quantity: number }[];
} {
  const shortfall: { id: string; quantity: number }[] = [];
  for (const l of lines) {
    if (l.confirmed < 0) throw new PartnerRuleError("Received quantity cannot be negative.");
    if (qty(l.confirmed) > qty(l.quantity)) throw new PartnerRuleError("Received quantity cannot exceed what was shipped.");
    const short = qty(l.quantity - l.confirmed);
    if (short > 0) shortfall.push({ id: l.id, quantity: short });
  }
  return { status: shortfall.length ? "disputed" : "received", shortfall };
}

export interface ObligationPlan {
  kind: "money" | "goods";
  amountDue: number;
}

/**
 * What the receiver owes once goods are confirmed. `none` is "not decided yet" and
 * creates nothing, but the transfer itself is still on record. Money and goods are
 * both tracked in value terms so a partial return reduces the balance consistently.
 */
export function planObligation(settlement: SettlementType, lines: PricedLine[]): ObligationPlan | null {
  if (settlement === "none") return null;
  const amountDue = transferValue(lines, "confirmed");
  if (amountDue <= 0) return null;
  return { kind: settlement === "payable" ? "money" : "goods", amountDue };
}

/** A transfer's terms may only be (re)agreed from `none`, or before any settlement is recorded. */
export function canChangeSettlement(current: SettlementType, settledSoFar: number): boolean {
  return current === "none" || settledSoFar === 0;
}

export function obligationStatus(amountDue: number, amountSettled: number, waived = false): "open" | "settled" | "waived" {
  if (waived) return "waived";
  return money(amountSettled) >= money(amountDue) ? "settled" : "open";
}

/** A settlement can never push the settled total past what is due. */
export function maxSettleable(amountDue: number, amountSettled: number): number {
  return Math.max(0, money(amountDue - amountSettled));
}

/**
 * Reconciliation gate: stock that left the sender must be accounted for at the receiver,
 * on the way, or recorded as a shortfall. Returns the unexplained quantity (0 when sound).
 */
export function unreconciledQty(l: { shipped: number; received: number; inTransit: number; shortfall: number }): number {
  return qty(l.shipped - l.received - l.inTransit - l.shortfall);
}

/** Net position between two businesses from `me`'s side: positive means they owe me. */
export function partnerBalance(
  me: string,
  obligations: { creditorOrgId: string; debtorOrgId: string; amountDue: number; amountSettled: number; status: string }[],
): number {
  return money(obligations.reduce((sum, o) => {
    if (o.status !== "open") return sum;
    const open = o.amountDue - o.amountSettled;
    return o.creditorOrgId === me ? sum + open : o.debtorOrgId === me ? sum - open : sum;
  }, 0));
}
