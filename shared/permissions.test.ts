import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULTS,
  canGrant,
  effectivePermissions,
  expandPermissions,
  findPermissionForPath,
  normalizePermissions,
} from "./permissions";
import { NAV_ITEMS, resolveSidebarLayout } from "./sidebarLayout";

const urls = (sections: { items: { url: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.url));

describe("permission catalog", () => {
  it("has one permission per sidebar page, each in a module", () => {
    expect(PERMISSIONS.map((p) => p.key).sort()).toEqual(NAV_ITEMS.map((i) => i.url).sort());
    expect(PERMISSIONS.every((p) => !!p.module)).toBe(true);
  });
});

describe("expandPermissions", () => {
  it("expands a module name to its pages (how roles saved before per-page permissions keep working)", () => {
    const set = expandPermissions(["Customers"]);
    expect(set.has("/customers")).toBe(true);
    expect(set.has("/bookings")).toBe(true);
    expect(set.has("/vendors")).toBe(false);
  });

  it("always includes self-service pages and ignores unknown entries", () => {
    const set = expandPermissions(["Nope", "/nope"]);
    expect([...set].sort()).toEqual(["/", "/staff/attendance", "/staff/payroll"]);
  });
});

describe("effectivePermissions", () => {
  it("gives the owner everything and managers/staff their previous sidebar", () => {
    expect(effectivePermissions("owner").size).toBe(ALL_PERMISSION_KEYS.length);
    expect(effectivePermissions("manager").has("/inventory")).toBe(false);
    expect(effectivePermissions("manager").has("/profit-loss")).toBe(true);
    expect([...effectivePermissions("staff")].sort()).toEqual([...SYSTEM_ROLE_DEFAULTS.staff].sort());
  });

  it("uses a saved override row for a built-in role", () => {
    const set = effectivePermissions("staff", [{ name: "Staff", kind: "system", permissions: ["/vendors"] }]);
    expect(set.has("/vendors")).toBe(true);
    expect(set.has("/customers")).toBe(false);
  });

  it("resolves a custom role by name and ignores a same-named system row", () => {
    const rows = [{ name: "Cashier", kind: "custom", permissions: ["/sales/new", "Customers"] }];
    const set = effectivePermissions("cashier", rows);
    expect(set.has("/sales/new")).toBe(true);
    expect(set.has("/bookings")).toBe(true);
    expect(set.has("/inventory")).toBe(false);
  });

  it("gives an unknown custom role only the self-service pages", () => {
    expect([...effectivePermissions("ghost")].sort()).toEqual(["/", "/staff/attendance", "/staff/payroll"]);
  });
});

describe("canGrant", () => {
  it("lets a manager grant only what they hold", () => {
    const manager = effectivePermissions("manager");
    expect(canGrant(manager, ["/customers", "Sales & Checkout"]).ok).toBe(true);
    expect(canGrant(manager, ["/inventory"])).toEqual({ ok: false, missing: ["/inventory"] });
  });
});

describe("normalizePermissions", () => {
  it("dedupes, drops pages covered by a ticked module and self-service pages", () => {
    const result = normalizePermissions(["Customers", "/customers", "/vendors", "/vendors", "/staff/payroll"]);
    expect(result).toEqual({ ok: true, permissions: ["Customers", "/vendors"] });
  });

  it("rejects unknown entries", () => {
    expect(normalizePermissions(["/nope"]).ok).toBe(false);
  });
});

describe("sidebar from permissions", () => {
  it("shows a custom role only its permitted pages, in the owner's sections", () => {
    const allowed = effectivePermissions("cashier", [{ name: "Cashier", kind: "custom", permissions: ["/sales/new", "/transactions"] }]);
    const sections = resolveSidebarLayout(null, "cashier", allowed);
    expect(urls(sections).sort()).toEqual(["/", "/sales/new", "/staff/attendance", "/staff/payroll", "/transactions"].sort());
  });

  it("shows a page granted to staff even though staff's default layout hid it", () => {
    const allowed = effectivePermissions("staff", [{ name: "Staff", kind: "system", permissions: [...SYSTEM_ROLE_DEFAULTS.staff, "/vendors"] }]);
    expect(urls(resolveSidebarLayout(null, "staff", allowed))).toContain("/vendors");
  });

  it("matches today's sidebar for each built-in role when nothing was edited", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const withPerms = urls(resolveSidebarLayout(null, role, effectivePermissions(role))).sort();
      const without = urls(resolveSidebarLayout(null, role)).sort();
      expect(withPerms).toEqual(without);
    }
  });
});

describe("findPermissionForPath", () => {
  it("maps sub-routes to their page and prefers the longest key", () => {
    expect(findPermissionForPath("/staffs/12/edit")?.key).toBe("/staffs");
    expect(findPermissionForPath("/staffs/performance/analytics")?.key).toBe("/staffs/performance");
    expect(findPermissionForPath("/settings/billing")?.key).toBe("/settings");
    expect(findPermissionForPath("/settings/taxes")?.key).toBe("/settings/taxes");
    expect(findPermissionForPath("/staff/payroll/abc")?.key).toBe("/staff/payroll");
  });

  it("matches the dashboard only on /", () => {
    expect(findPermissionForPath("/")?.key).toBe("/");
    expect(findPermissionForPath("/help-support")).toBeUndefined();
  });
});
