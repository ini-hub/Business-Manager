export type OptInEvent = { customerId: string; event: "opt_in" | "opt_out"; createdAt: Date };

/**
 * Pure "latest event wins" resolver, pulled out of
 * BroadcastRepository.filterOptedInCustomerIds so the consent logic itself
 * is unit-testable without a DB. A customer with no event at all is treated
 * as not opted in - broadcast targeting must be explicit consent, not "we
 * have their number so we assume it's fine" (NDPA/GDPR).
 *
 * events must be pre-sorted newest-first (as BroadcastRepository's query
 * already orders them) - this function takes the first event it sees per
 * customer, it does not re-sort.
 */
export function pickOptedInCustomerIds(customerIds: string[], eventsNewestFirst: OptInEvent[]): string[] {
  const latestByCustomer = new Map<string, string>();
  for (const e of eventsNewestFirst) {
    if (!latestByCustomer.has(e.customerId)) latestByCustomer.set(e.customerId, e.event);
  }
  return customerIds.filter((id) => latestByCustomer.get(id) === "opt_in");
}
