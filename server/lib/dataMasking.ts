import type { Request } from "express";

/**
 * Per-business masking of contact details and sensitive figures for non-owner/manager
 * roles (organisations.mask_contact_roles / mask_figures_roles, migration 0128).
 *
 *  - Owner and manager are never masked.
 *  - Every other role is masked only when its key (req.user.role: "staff" or a custom
 *    role's lower-cased name) is listed. Empty lists mask nothing (the default).
 *  - Fails closed: if the business row can't be loaded, a non-owner/manager is masked.
 *
 * The pure helpers carry no database import so they can be unit tested; the loader
 * imports storage lazily for the same reason (see transactionAccess.ts).
 */

export interface MaskPolicy {
  contact: boolean;
  figures: boolean;
}

type MaskUser = { role?: string; businessId?: string } | undefined;
type MaskBusiness = { maskContactRoles?: string[] | null; maskFiguresRoles?: string[] | null } | undefined | null;

export const MASK_TEXT = "••••";
export const NO_MASK: MaskPolicy = { contact: false, figures: false };

export function isUnmaskedRole(user: MaskUser): boolean {
  return user?.role === "owner" || user?.role === "manager";
}

/** Pure: the policy for `user` given the business's role lists. A missing business masks everything. */
export function policyFromBusiness(user: MaskUser, business: MaskBusiness): MaskPolicy {
  if (isUnmaskedRole(user)) return NO_MASK;
  const role = (user?.role ?? "").toLowerCase();
  if (!business) return { contact: true, figures: true };
  return {
    contact: (business.maskContactRoles ?? []).includes(role),
    figures: (business.maskFiguresRoles ?? []).includes(role),
  };
}

const cache = new WeakMap<object, Promise<MaskPolicy>>();

/** The viewer's policy, loaded once per request. */
export function getMaskPolicy(req: Request): Promise<MaskPolicy> {
  const hit = cache.get(req);
  if (hit) return hit;
  const user = (req as any).user as MaskUser;
  const pending: Promise<MaskPolicy> = (async () => {
    if (isUnmaskedRole(user)) return NO_MASK;
    if (!user?.businessId) return { contact: true, figures: true };
    try {
      const { storage } = await import("../storage");
      const business = await storage.getBusinessById(user.businessId);
      return policyFromBusiness(user, business);
    } catch (error) {
      console.error("getMaskPolicy error:", error);
      return { contact: true, figures: true };
    }
  })();
  cache.set(req, pending);
  return pending;
}

// ── Value helpers ────────────────────────────────────────────────────────────

type Row = Record<string, any>;

function mask<T extends Row>(row: T, fields: readonly string[], replacement: unknown): T {
  const out: Row = { ...row };
  for (const f of fields) {
    if (f in out && out[f] !== null && out[f] !== undefined && out[f] !== "") out[f] = replacement;
  }
  return out as T;
}

const CUSTOMER_CONTACT_FIELDS = ["mobileNumber", "phone", "address", "email"] as const;
const STAFF_CONTACT_FIELDS = ["email", "mobileNumber", "workPhone"] as const;
const VENDOR_CONTACT_FIELDS = ["contactName", "email", "phone", "address"] as const;
const PHONE_ROW_FIELDS = ["phoneNumber", "number", "mobileNumber"] as const;

export function maskCustomer<T extends Row | null | undefined>(c: T): T {
  if (!c) return c;
  return mask(c, CUSTOMER_CONTACT_FIELDS, MASK_TEXT);
}

export function maskCustomerPhone<T extends Row>(p: T): T {
  return mask(p, PHONE_ROW_FIELDS, MASK_TEXT);
}

export function maskStaffContact<T extends Row | null | undefined>(s: T): T {
  if (!s) return s;
  return mask(s, STAFF_CONTACT_FIELDS, MASK_TEXT);
}

export function maskVendor<T extends Row | null | undefined>(v: T): T {
  if (!v) return v;
  return mask(v, VENDOR_CONTACT_FIELDS, MASK_TEXT);
}

/**
 * True when a free-text search looks like a phone number (3+ digits). Masked viewers
 * can't search by number, otherwise they could recover a hidden number by guessing.
 */
export function isPhoneLikeQuery(q: unknown): boolean {
  return typeof q === "string" && (q.match(/\d/g)?.length ?? 0) >= 3;
}

/**
 * Drops request-body fields that still hold the mask placeholder. A masked viewer's form
 * is prefilled with MASK_TEXT, so writing it back would overwrite the real value.
 */
export function stripMaskedValues<T extends Row>(body: T): T {
  if (!body || typeof body !== "object") return body;
  const out: Row = { ...body };
  for (const k of Object.keys(out)) if (out[k] === MASK_TEXT) delete out[k];
  return out as T;
}

/** Zero the named numeric fields. Callers pass the field list for the shape they hold. */
export function maskMoney<T extends Row>(row: T, fields: readonly string[]): T {
  const out: Row = { ...row };
  for (const f of fields) if (f in out && out[f] !== null && out[f] !== undefined) out[f] = 0;
  return out as T;
}

/** Walks a transaction/receipt payload masking embedded customer and staff rows. */
export function maskDocumentContacts<T extends Row>(doc: T): T {
  const out: Row = { ...doc };
  if (out.customer) out.customer = maskCustomer(out.customer);
  for (const key of ["staff", "leadStaff", "assistingStaff1", "assistingStaff2"]) {
    if (out[key]) out[key] = maskStaffContact(out[key]);
  }
  if (Array.isArray(out.items)) {
    out.items = out.items.map((i: Row) => (i && typeof i === "object" ? maskDocumentContacts(i) : i));
  }
  if (out.checkout && typeof out.checkout === "object") {
    out.checkout = { ...out.checkout };
    if (out.checkout.staff) out.checkout.staff = maskStaffContact(out.checkout.staff);
    if (out.checkout.customer) out.checkout.customer = maskCustomer(out.checkout.customer);
  }
  return out as T;
}

// ── Sensitive-figure masking (response wrapper) ──────────────────────────────

const COST_KEYS = [
  "costPrice", "unitCost", "averageCost", "totalCost", "cost",
  "previousCostPrice", "newCostPrice", "previousUnitCost", "newUnitCost",
];

type FigureRule = { pattern: RegExp; mode: "all" } | { pattern: RegExp; mode: "keys"; keys: readonly string[] };

/** Which GET responses carry sensitive figures. "all" zeroes every number (except pagination). */
export const FIGURE_RULES: FigureRule[] = [
  {
    pattern: /^\/dashboard\/stats$/, mode: "keys",
    keys: ["totalTransactions", "totalRevenue", "grossRevenue", "returnedRevenue", "totalProfit", "revenueMix", "lossSales"],
  },
  { pattern: /^\/charts\//, mode: "all" },
  { pattern: /^\/inventory\/[^/]+\/sustaining-costs$/, mode: "all" },
  { pattern: /^\/(inventory|products)(\/|$)/, mode: "keys", keys: COST_KEYS },
  { pattern: /^\/reports\/cash-flow$/, mode: "all" },
  { pattern: /^\/accounting\/(balance-sheet|capital|assets|liabilities)(\/|$)/, mode: "all" },
  { pattern: /^\/cash-register\/sessions?(\/|$)/, mode: "all" },
  { pattern: /^\/credit\/(summary|ledger|reports)(\/|$)/, mode: "all" },
  { pattern: /^\/vendors\/bills(\/|$)/, mode: "all" },
  {
    pattern: /^\/purchase-orders(\/|$)/, mode: "keys",
    keys: ["totalAmount", "unitCost", "totalCost", "amountPaid", "subtotal"],
  },
];

// ── Contact masking for embedded rows (response wrapper) ────────────────────

/** GET responses that embed customer / vendor / staff rows under well-known keys. */
export const CONTACT_PATHS: RegExp[] = [
  /^\/bookings(\/|$)/,
  /^\/quotes(\/|$)/,
  /^\/credit\/(ledger|reports)(\/|$)/,
  /^\/search$/,
  /^\/purchase-orders(\/|$)/,
  /^\/stock-audits(\/|$)/,
];

const CONTAINER_MASKERS: Record<string, (v: any) => any> = {
  customer: maskCustomer,
  customers: (v) => (Array.isArray(v) ? v.map(maskCustomer) : v),
  topOwing: (v) => (Array.isArray(v) ? v.map(maskCustomer) : v),
  vendor: maskVendor,
  leadStaff: maskStaffContact,
  staff: maskStaffContact,
};

/** Pure: mask contact fields inside the known container keys, at any depth. */
export function maskContactBody(v: any): any {
  if (Array.isArray(v)) return v.map(maskContactBody);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Row = {};
    for (const [k, val] of Object.entries(v)) {
      const masker = CONTAINER_MASKERS[k] as ((x: any) => any) | undefined;
      out[k] = masker && val && typeof val === "object" ? masker(val) : maskContactBody(val);
    }
    return out;
  }
  return v;
}

function zeroNumbers(v: any): any {
  if (typeof v === "number") return 0;
  if (Array.isArray(v)) return v.map(zeroNumbers);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Row = {};
    for (const [k, val] of Object.entries(v)) out[k] = k === "pagination" ? val : zeroNumbers(val);
    return out;
  }
  return v;
}

function zeroKeys(v: any, keys: ReadonlySet<string>): any {
  if (Array.isArray(v)) return v.map((x) => zeroKeys(x, keys));
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Row = {};
    for (const [k, val] of Object.entries(v)) out[k] = keys.has(k) ? zeroNumbers(val) : zeroKeys(val, keys);
    return out;
  }
  return v;
}

/** Pure: apply a figure rule to a response body. */
export function maskFigureBody(body: unknown, rule: FigureRule): unknown {
  return rule.mode === "all" ? zeroNumbers(body) : zeroKeys(body, new Set(rule.keys));
}

/**
 * Mounted on /api before the routes. Wraps res.json for GETs matching FIGURE_RULES and,
 * once the handler has produced its body (req.user is set by then), zeroes the figures
 * for viewers whose role is masked. Costs nothing for unmatched requests.
 */
export function figureMaskMiddleware() {
  return (req: Request, res: any, next: () => void) => {
    if (req.method !== "GET") return next();
    const figureRule = FIGURE_RULES.find((r) => r.pattern.test(req.path));
    const contactRule = CONTACT_PATHS.some((r) => r.test(req.path));
    if (!figureRule && !contactRule) return next();
    const original = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 400) return original(body);
      getMaskPolicy(req).then(
        (policy) => {
          let out = body;
          if (policy.figures && figureRule) out = maskFigureBody(out, figureRule);
          if (policy.contact && contactRule) out = maskContactBody(out);
          original(out);
        },
        () => original(body),
      );
      return res;
    };
    next();
  };
}
