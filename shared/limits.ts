/**
 * The count caps (stores, staff seats, customers, items): one place that names each cap and holds its wording and
 * defaults. The server limit logic, the admin threshold planner, the over-cap report and the client gates and
 * nudges all read this, so a new cap starts here and TypeScript then points at every `Record<LimitType, ...>`
 * that still needs an entry.
 *
 * Adding a cap, end to end:
 *  1. Add its key to LIMIT_TYPES and an entry to LIMITS below.
 *  2. Register its unlimited add-on in shared/features.ts (tier "paid_metered_limit", the same `limitType`, no
 *     `tierCapacity`, and `freeLimit` equal to `defaultFree` here). shared/limits.test.ts checks this.
 *  3. Count it: `countUsed` and `orgWideCounts` in server/lib/entitlements.ts, `usageByOrganisation` in
 *     server/lib/overCapReport.ts. Each is typed per cap, so the compiler flags a missing branch.
 *  4. Enforce it where records are created: `assertWithinCountLimit(tx, businessId, "<cap>")` in the repository
 *     transaction, plus `requireCountLimit` or `checkCountLimit` on the route for a fast rejection.
 *  5. Return it from `getCountLimitStatuses` and surface it in the client's useEntitlements.
 * Packs between the free cap and unlimited need no code: a super admin adds them as thresholds.
 */

/** Display order for the admin screens. */
export const LIMIT_TYPES = ["store_count", "staff_seats", "customer_count", "item_count"] as const;
export type LimitType = (typeof LIMIT_TYPES)[number];

export interface LimitMeta {
  /** Catalog key of the cap's unlimited add-on (the row whose `freeLimit` is the free cap). */
  unlimitedFeatureKey: string;
  /** The free cap when the catalog row has none: the documented free tier, never 0. */
  defaultFree: number;
  /** Counted per store (staff seats), not across the business. */
  perStore: boolean;
  /** Singular noun in messages: "1 staff member", "1 store". */
  noun: string;
  /** Plural noun in titles and messages. */
  plural: string;
  /** Short heading, e.g. on the "limit reached" card. */
  short: string;
  /** Phrasing in the nudge banner. */
  nudge: { one: string; many: string };
  /** Super-admin labels. */
  adminLabel: string;
  adminUnit: string;
  /** Threshold planner: label, unit after "Up to N", key prefix and the description it writes. */
  capLabel: string;
  capUnit: string;
  keyPrefix: string;
  describe: (limit: number) => string;
}

export const LIMITS: Record<LimitType, LimitMeta> = {
  store_count: {
    unlimitedFeatureKey: "store_addon", defaultFree: 1, perStore: false,
    noun: "store", plural: "stores", short: "Stores",
    nudge: { one: "store", many: "stores" },
    adminLabel: "Stores", adminUnit: "stores",
    capLabel: "Stores", capUnit: "stores", keyPrefix: "store_pack",
    describe: (n) => `Up to ${n} stores in total, with Stock Transfers and Staff Transfers included.`,
  },
  staff_seats: {
    unlimitedFeatureKey: "staff_seats_addon", defaultFree: 2, perStore: true,
    noun: "staff member", plural: "staff", short: "Staff",
    nudge: { one: "staff member in this store", many: "staff in this store" },
    adminLabel: "Staff seats", adminUnit: "seats",
    capLabel: "Staff Seats", capUnit: "staff per store", keyPrefix: "staff_seats",
    describe: (n) => `Up to ${n} staff per store. The owner never uses a seat.`,
  },
  customer_count: {
    unlimitedFeatureKey: "customer_capacity_addon", defaultFree: 30, perStore: false,
    noun: "customer", plural: "customers", short: "Customers",
    nudge: { one: "customer", many: "customers" },
    adminLabel: "Customers", adminUnit: "customers",
    capLabel: "Customers", capUnit: "customers", keyPrefix: "customer_pack",
    describe: (n) => `Up to ${n} customers in total.`,
  },
  item_count: {
    unlimitedFeatureKey: "item_capacity_addon", defaultFree: 50, perStore: false,
    noun: "item", plural: "items", short: "Items",
    nudge: { one: "item", many: "items" },
    adminLabel: "Inventory items", adminUnit: "items",
    capLabel: "Inventory items", capUnit: "items", keyPrefix: "item_pack",
    describe: (n) => `Up to ${n} inventory items in total.`,
  },
};

export const isLimitType = (v: unknown): v is LimitType => typeof v === "string" && (LIMIT_TYPES as readonly string[]).includes(v);

/** "per store (the owner doesn't count)" for staff seats, empty for the rest. Same wording on server and client. */
export function limitScopeNote(limitType: LimitType): string {
  return LIMITS[limitType].perStore ? " per store (the owner doesn't count)" : "";
}
