import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  NAV_ITEMS,
  isNavItemActive,
  resolveSidebarLayout,
  validateSidebarLayout,
  type SidebarLayout,
} from "./sidebarLayout";

const clone = (): SidebarLayout => JSON.parse(JSON.stringify(DEFAULT_SIDEBAR_LAYOUT));
const urls = (sections: { items: { url: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.url));

describe("default layout", () => {
  it("matches the sidebar as it shipped", () => {
    const owner = resolveSidebarLayout(null, "owner");
    expect(owner.map((s) => s.label)).toEqual(["Management", "Sales", "Reports", "Settings"]);
    expect(owner[0].items.map((i) => i.title)).toEqual([
      "Dashboard", "Customers", "Staff", "Inventory", "Stock Transfers", "Partners", "Purchase Orders", "Vendors",
    ]);
    expect(resolveSidebarLayout(null, "staff").map((s) => s.label)).toEqual(["My Work", "More"]);
  });

  it("hides owner-only pages from managers", () => {
    const manager = urls(resolveSidebarLayout(null, "manager"));
    expect(manager).not.toContain("/inventory");
    expect(manager).not.toContain("/reports/balance-sheet");
    expect(manager).toContain("/profit-loss");
  });

  it("is valid", () => {
    expect(validateSidebarLayout(DEFAULT_SIDEBAR_LAYOUT).ok).toBe(true);
  });

  it("accounts for every registry item in each role (placed or hidden)", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const { sections, hidden } = DEFAULT_SIDEBAR_LAYOUT[role];
      const all = [...sections.flatMap((s) => s.items), ...hidden].sort();
      expect(all).toEqual(NAV_ITEMS.map((i) => i.url).sort());
    }
  });
});

describe("resolveSidebarLayout", () => {
  it("honours a saved split of Management", () => {
    const layout = clone();
    layout.owner.sections = [
      { id: "business", label: "Business management", items: ["/", "/customers", "/staffs"] },
      { id: "stock", label: "Stock management", items: ["/inventory", "/stock-transfers", "/partners", "/purchase-orders", "/vendors"] },
      ...layout.owner.sections.filter((s) => s.id !== "management"),
    ];
    const resolved = resolveSidebarLayout(layout, "owner");
    expect(resolved.slice(0, 2).map((s) => s.label)).toEqual(["Business management", "Stock management"]);
    expect(resolved[1].items.map((i) => i.title)).toContain("Vendors");
  });

  it("drops urls that no longer exist in code", () => {
    const layout = clone();
    layout.owner.sections[0].items.push("/removed-page");
    expect(urls(resolveSidebarLayout(layout, "owner"))).not.toContain("/removed-page");
  });

  it("does not bring back an item the admin hid", () => {
    const layout = clone();
    layout.owner.sections[1].items = layout.owner.sections[1].items.filter((u) => u !== "/broadcasts");
    layout.owner.hidden.push("/broadcasts");
    expect(urls(resolveSidebarLayout(layout, "owner"))).not.toContain("/broadcasts");
  });

  it("puts a page added to code after the save into its default section", () => {
    const layout = clone();
    layout.owner.sections[1].items = layout.owner.sections[1].items.filter((u) => u !== "/quotes");
    // not in hidden either: this is what a page shipped after the layout was saved looks like
    const sales = resolveSidebarLayout(layout, "owner").find((s) => s.id === "sales")!;
    expect(sales.items.map((i) => i.url)).toContain("/quotes");
  });

  it("recreates the default section when the admin deleted it", () => {
    const layout = clone();
    layout.owner.sections = layout.owner.sections.filter((s) => s.id !== "reports");
    const resolved = resolveSidebarLayout(layout, "owner");
    expect(resolved.at(-1)?.id).toBe("reports");
  });

  it("falls back per role when only some roles are saved", () => {
    const layout = clone();
    const resolved = resolveSidebarLayout({ owner: layout.owner }, "staff");
    expect(resolved.map((s) => s.label)).toEqual(["My Work", "More"]);
  });
});

describe("validateSidebarLayout", () => {
  it("rejects unknown items", () => {
    const layout = clone();
    layout.manager.sections[0].items.push("/nope");
    expect(validateSidebarLayout(layout)).toMatchObject({ ok: false });
  });

  it("rejects an item placed twice in one role", () => {
    const layout = clone();
    layout.staff.sections[1].items.push("/");
    const result = validateSidebarLayout(layout);
    expect(result.ok).toBe(false);
  });

  it("rejects an item that is both placed and hidden", () => {
    const layout = clone();
    layout.manager.hidden.push("/customers");
    expect(validateSidebarLayout(layout).ok).toBe(false);
  });

  it("rejects blank section names and repeated section ids", () => {
    const blank = clone();
    blank.owner.sections[0].label = "   ";
    expect(validateSidebarLayout(blank).ok).toBe(false);
    const repeated = clone();
    repeated.owner.sections[1].id = repeated.owner.sections[0].id;
    expect(validateSidebarLayout(repeated).ok).toBe(false);
  });

  it("keeps Settings visible for owners but not for other roles", () => {
    const owner = clone();
    owner.owner.sections = owner.owner.sections.map((s) => ({ ...s, items: s.items.filter((u) => u !== "/settings") }));
    owner.owner.hidden.push("/settings");
    expect(validateSidebarLayout(owner)).toEqual({ ok: false, error: "Settings must stay visible for owners." });

    const manager = clone();
    manager.manager.sections = manager.manager.sections.map((s) => ({ ...s, items: s.items.filter((u) => u !== "/settings") }));
    manager.manager.hidden.push("/settings");
    expect(validateSidebarLayout(manager).ok).toBe(true);
  });
});

describe("isNavItemActive", () => {
  it("matches sub-routes of leaf pages", () => {
    expect(isNavItemActive("/customers", "/customers/42")).toBe(true);
    expect(isNavItemActive("/payroll", "/payroll/period/1")).toBe(true);
  });

  it("keeps parents with nav children exact", () => {
    expect(isNavItemActive("/staffs", "/staffs/performance")).toBe(false);
    expect(isNavItemActive("/staffs", "/staffs")).toBe(true);
    expect(isNavItemActive("/settings", "/settings/taxes")).toBe(false);
    expect(isNavItemActive("/analytics", "/analytics/dashboards")).toBe(false);
  });

  it("only lights the dashboard on /", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/customers")).toBe(false);
  });
});
