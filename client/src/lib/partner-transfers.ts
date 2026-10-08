export const PARTNER_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  offered: "Offered",
  accepted: "Accepted",
  shipped: "On its way",
  received: "Received",
  disputed: "Shortfall to resolve",
  closed: "Closed",
  rejected: "Declined",
  cancelled: "Cancelled",
};

export const PARTNER_STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  requested: "outline",
  offered: "outline",
  accepted: "secondary",
  shipped: "secondary",
  received: "default",
  disputed: "destructive",
  closed: "outline",
  rejected: "destructive",
  cancelled: "outline",
};

export const SETTLEMENT_LABEL: Record<string, string> = {
  none: "Not decided yet",
  payable: "Pay later (money)",
  return_in_kind: "Return the same goods",
};

export const SETTLEMENT_HELP: Record<string, string> = {
  none: "Nothing is owed for now. The transfer is still recorded, and either side can agree terms later.",
  payable: "The receiver owes the sender the agreed value, paid in money.",
  return_in_kind: "The receiver owes the same goods back, tracked at the agreed value.",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  pos: "POS",
  goods_return: "Goods returned",
};

export const EVENT_LABEL: Record<string, string> = {
  offered: "Transfer offered",
  requested: "Stock requested",
  accepted: "Accepted",
  rejected: "Declined",
  cancelled: "Cancelled",
  shipped: "Shipped",
  received: "Received in full",
  disputed: "Received with a shortfall",
  dispute_resolved: "Shortfall resolved",
  closed: "Closed",
  settlement_set: "Settlement terms set",
  settlement_proposed: "Settlement terms proposed",
  settlement_agreed: "Settlement terms agreed",
  settlement_declined: "Settlement proposal declined",
  settlement_recorded: "Payment recorded",
  settlement_claimed: "Payment reported, awaiting confirmation",
  settlement_confirmed: "Payment confirmed",
  settlement_rejected: "Payment not accepted",
  balance_waived: "Balance waived",
};
