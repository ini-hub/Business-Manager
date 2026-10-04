export type SupplierEmailOutcome = "sent" | "no_email" | "failed" | undefined;

/** What to tell the user after a PO is placed, based on whether the supplier was emailed. */
export function placedOrderMessage(outcome: SupplierEmailOutcome, vendorName?: string): string {
  const who = vendorName || "the supplier";
  switch (outcome) {
    case "sent": return `Order placed and emailed to ${who}.`;
    case "no_email": return `Order placed. ${who} has no email on file, so nothing was sent - contact them directly.`;
    case "failed": return `Order placed, but the email to ${who} couldn't be sent. Contact them directly.`;
    default: return "Order placed.";
  }
}
