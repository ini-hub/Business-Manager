import { z } from "zod";

/**
 * The sidebar's contents and how a super admin can rearrange them.
 *
 * The registry below is the only place that knows which pages can appear in the
 * sidebar (title, icon, shortcut). The layout is just data on top of it: per role,
 * an ordered list of named sections holding registry urls, plus the urls the admin
 * chose to hide. DEFAULT_SIDEBAR_LAYOUT is the sidebar as it shipped, used until an
 * admin saves an override. Putting an item in a layout only shows a link: the page
 * and its API keep enforcing role and feature access on their own.
 */

export const NAV_ROLES = ["owner", "manager", "staff"] as const;
export type NavRole = (typeof NAV_ROLES)[number];

export interface NavItemDef {
  /** The client route; also the item's identity in a layout. */
  url: string;
  title: string;
  /** Key into the client's lucide icon map (app-sidebar.tsx). */
  icon: string;
  shortcut?: string;
}

export const NAV_ITEMS: NavItemDef[] = [
  { url: "/", title: "Dashboard", icon: "LayoutDashboard", shortcut: "⌥D" },
  { url: "/customers", title: "Customers", icon: "Users", shortcut: "⌥C" },
  { url: "/staffs", title: "Staff", icon: "UserCog" },
  { url: "/inventory", title: "Inventory", icon: "Package", shortcut: "⌥I" },
  { url: "/stock-transfers", title: "Stock Transfers", icon: "ArrowLeftRight" },
  { url: "/partners", title: "Partners", icon: "Handshake" },
  { url: "/purchase-orders", title: "Purchase Orders", icon: "Truck" },
  { url: "/vendors", title: "Vendors", icon: "Building2" },
  { url: "/sales/new", title: "New Sale", icon: "ShoppingCart", shortcut: "⌥N" },
  { url: "/transactions", title: "Transactions", icon: "Receipt", shortcut: "⌥T" },
  { url: "/credit-sales", title: "Credit Sales", icon: "BookOpen" },
  { url: "/bookings", title: "Bookings", icon: "CalendarClock" },
  { url: "/broadcasts", title: "Broadcasts", icon: "MessageSquare" },
  { url: "/quotes", title: "Quotes", icon: "FileText" },
  { url: "/leaderboard", title: "Leaderboard", icon: "Trophy" },
  { url: "/settings/promotions", title: "Promotions", icon: "Tag" },
  { url: "/settings/taxes", title: "Taxes", icon: "Percent" },
  { url: "/profit-loss", title: "Profit & Loss", icon: "TrendingUp" },
  { url: "/reports/service-profitability", title: "Service Profitability", icon: "BarChart3" },
  { url: "/reports/balance-sheet", title: "Balance Sheet", icon: "Scale" },
  { url: "/staffs/performance", title: "Staff Performance", icon: "Users" },
  { url: "/expenses", title: "Expenses", icon: "Wallet" },
  { url: "/payroll", title: "Payroll", icon: "DollarSign" },
  { url: "/analytics", title: "Analytics Explorer", icon: "Compass" },
  { url: "/analytics/dashboards", title: "Dashboards", icon: "LayoutDashboard" },
  { url: "/reports/audit-logs", title: "Activity Log", icon: "ShieldCheck" },
  { url: "/settings", title: "Settings", icon: "Settings" },
  { url: "/staff/attendance", title: "My Attendance", icon: "CalendarDays" },
  { url: "/staff/payroll", title: "My Payroll", icon: "DollarSign" },
];

const ITEM_BY_URL = new Map(NAV_ITEMS.map((item) => [item.url, item]));
export const getNavItem = (url: string): NavItemDef | undefined => ITEM_BY_URL.get(url);

/**
 * A page whose route has other nav pages beneath it (/staffs, /analytics, /settings)
 * is active only on an exact match, otherwise it would stay lit on its children.
 * Every other page is also active on its sub-routes (/customers/123).
 */
export function isNavItemActive(url: string, location: string): boolean {
  if (location === url) return true;
  if (url === "/") return false;
  if (!location.startsWith(url + "/")) return false;
  return !NAV_ITEMS.some((other) => other.url !== url && other.url.startsWith(url + "/"));
}

export interface SidebarSection {
  /** Stable identity, so renaming a section does not change what "new" items attach to. */
  id: string;
  label: string;
  items: string[];
}

export interface RoleSidebarLayout {
  sections: SidebarSection[];
  /** Registry urls the admin deliberately removed. Urls in neither list are new in code. */
  hidden: string[];
}

export type SidebarLayout = Record<NavRole, RoleSidebarLayout>;

const OWNER_ONLY = new Set(["/inventory", "/reports/service-profitability", "/reports/balance-sheet"]);

const OWNER_SECTIONS: SidebarSection[] = [
  {
    id: "management",
    label: "Management",
    items: ["/", "/customers", "/staffs", "/inventory", "/stock-transfers", "/partners", "/purchase-orders", "/vendors"],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      "/sales/new",
      "/transactions",
      "/credit-sales",
      "/bookings",
      "/broadcasts",
      "/quotes",
      "/leaderboard",
      "/settings/promotions",
      "/settings/taxes",
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      "/profit-loss",
      "/reports/service-profitability",
      "/reports/balance-sheet",
      "/staffs/performance",
      "/expenses",
      "/payroll",
      "/analytics",
      "/analytics/dashboards",
      "/reports/audit-logs",
    ],
  },
  { id: "settings", label: "Settings", items: ["/settings"] },
];

// Staff see their own work, not the business's management menu: what they do
// every shift first (sell, bookings, clock-in), then their own records.
const STAFF_SECTIONS: SidebarSection[] = [
  { id: "work", label: "My Work", items: ["/", "/sales/new", "/bookings", "/staff/attendance", "/staff/payroll"] },
  { id: "more", label: "More", items: ["/customers", "/transactions", "/quotes", "/leaderboard"] },
];

const withHidden = (sections: SidebarSection[]): RoleSidebarLayout => {
  const placed = new Set(sections.flatMap((s) => s.items));
  return { sections, hidden: NAV_ITEMS.map((i) => i.url).filter((url) => !placed.has(url)) };
};

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  owner: withHidden(OWNER_SECTIONS),
  manager: withHidden(OWNER_SECTIONS.map((s) => ({ ...s, items: s.items.filter((url) => !OWNER_ONLY.has(url)) }))),
  staff: withHidden(STAFF_SECTIONS),
};

// ---------------------------------------------------------------------------
// Validation (admin save)
// ---------------------------------------------------------------------------

const sectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i, "Section ids may only contain letters, numbers, - and _."),
  label: z.string().trim().min(1, "Every section needs a name.").max(40, "Section names are limited to 40 characters."),
  items: z.array(z.string()).max(NAV_ITEMS.length),
});

const roleSchema = z.object({
  sections: z.array(sectionSchema).max(20, "At most 20 sections per role."),
  hidden: z.array(z.string()).max(NAV_ITEMS.length).default([]),
});

export const sidebarLayoutSchema = z.object({
  owner: roleSchema,
  manager: roleSchema,
  staff: roleSchema,
});

export type SidebarLayoutValidation = { ok: true; layout: SidebarLayout } | { ok: false; error: string };

export function validateSidebarLayout(input: unknown): SidebarLayoutValidation {
  const parsed = sidebarLayoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid layout." };
  const layout = parsed.data;

  for (const role of NAV_ROLES) {
    const { sections, hidden } = layout[role];
    const sectionIds = new Set<string>();
    const seen = new Set<string>();
    for (const section of sections) {
      if (sectionIds.has(section.id)) return { ok: false, error: `The ${role} layout repeats a section.` };
      sectionIds.add(section.id);
    }
    for (const url of [...sections.flatMap((s) => s.items), ...hidden]) {
      if (!ITEM_BY_URL.has(url)) return { ok: false, error: `Unknown sidebar item "${url}".` };
      if (seen.has(url)) return { ok: false, error: `"${ITEM_BY_URL.get(url)!.title}" appears more than once in the ${role} layout.` };
      seen.add(url);
    }
  }
  // Owners reach billing, team and store setup through Settings, so it can't be removed for them.
  if (!layout.owner.sections.some((s) => s.items.includes("/settings"))) {
    return { ok: false, error: "Settings must stay visible for owners." };
  }
  return { ok: true, layout };
}

// ---------------------------------------------------------------------------
// Resolution (what the sidebar renders)
// ---------------------------------------------------------------------------

export interface ResolvedSection {
  id: string;
  label: string;
  items: NavItemDef[];
}

/**
 * The sections one role sees. Falls back to the default when nothing is saved.
 * Unknown urls (a page removed from code) are dropped, and a page added to code
 * after the layout was saved lands in its default section, so shipping a module
 * never leaves it out of the sidebar until someone re-saves.
 */
export function resolveSidebarLayout(
  saved: Partial<SidebarLayout> | null | undefined,
  role: string,
  allowed?: ReadonlySet<string> | null,
): ResolvedSection[] {
  // A custom role has no layout of its own: it uses the owner's sections and order, filtered by `allowed`.
  const layoutRole: NavRole = (NAV_ROLES as readonly string[]).includes(role) ? (role as NavRole) : "owner";
  const base = saved?.[layoutRole] ?? DEFAULT_SIDEBAR_LAYOUT[layoutRole];
  const sections: SidebarSection[] = base.sections.map((s) => ({ ...s, items: [...s.items] }));

  // With `allowed` (the role's permissions) the role's hidden list no longer decides anything: any
  // permitted page that isn't placed lands in its default section. Without it, only pages that are new
  // in code do (a page the admin hid stays hidden).
  const known = new Set([...sections.flatMap((s) => s.items), ...(allowed ? [] : base.hidden ?? [])]);
  const isCustomRole = layoutRole !== role;
  const lookups = allowed
    ? [
        ...DEFAULT_SIDEBAR_LAYOUT[layoutRole].sections,
        ...DEFAULT_SIDEBAR_LAYOUT.owner.sections,
        // Staff's own pages (attendance, pay) are open to every role, so a custom role finds them too.
        ...(isCustomRole ? DEFAULT_SIDEBAR_LAYOUT.staff.sections : []),
      ]
    : DEFAULT_SIDEBAR_LAYOUT[layoutRole].sections;
  for (const defaultSection of lookups) {
    const fresh = defaultSection.items.filter((url) => !known.has(url) && (!allowed || allowed.has(url)));
    if (fresh.length === 0) continue;
    fresh.forEach((url) => known.add(url));
    const target = sections.find((s) => s.id === defaultSection.id);
    if (target) target.items.push(...fresh);
    else sections.push({ id: defaultSection.id, label: defaultSection.label, items: fresh });
  }

  return sections.map((s) => ({
    id: s.id,
    label: s.label,
    items: s.items
      .filter((url) => !allowed || allowed.has(url))
      .map((url) => ITEM_BY_URL.get(url))
      .filter((item): item is NavItemDef => !!item),
  }));
}
