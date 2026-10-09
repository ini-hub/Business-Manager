import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { customRoles, staff } from "@shared/schema";
import { createBusinessRole, updateBusinessRole, deleteBusinessRole, checkRoleAssignable } from "./roleManagement";
import { getUserPermissions, invalidateRoleCache } from "./roles";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture } from "../test-support/integration-db";

/**
 * Pins the rules around a business's custom roles (server/lib/roleManagement.ts): who may manage
 * them, that a manager can't hand out access they lack, that a rename carries its holders along,
 * and that a role in use can't be deleted. Also the platform "system" override a super admin saves
 * for the built-in roles (server/lib/roles.ts).
 */

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

const owner = (f: Fixture) => ({ role: "owner", businessId: f.businessId });
const manager = (f: Fixture) => ({ role: "manager", businessId: f.businessId });

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(customRoles).where(eq(customRoles.businessId, f.businessId));
    await f.cleanup();
  }
  fixtures = [];
  await db.delete(customRoles).where(and(isNull(customRoles.businessId), eq(customRoles.kind, "system")));
  invalidateRoleCache();
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("createBusinessRole", () => {
  it("lets an owner create a role and stores page keys", async () => {
    const f = await newFixture();
    const r = await createBusinessRole(owner(f), { name: "Cashier", permissions: ["/sales/new", "Customers"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.permissions).toEqual(["/sales/new", "Customers"]);
      expect(r.value.kind).toBe("custom");
    }
  });

  it("refuses staff and unauthenticated callers", async () => {
    const f = await newFixture();
    expect(await createBusinessRole({ role: "staff", businessId: f.businessId }, { name: "X", permissions: [] })).toMatchObject({ ok: false, status: 403 });
    expect(await createBusinessRole({ role: "owner" }, { name: "X", permissions: [] })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects unknown permissions, built-in names and duplicate names (any case)", async () => {
    const f = await newFixture();
    expect(await createBusinessRole(owner(f), { name: "A", permissions: ["/nope"] })).toMatchObject({ ok: false, status: 400 });
    expect(await createBusinessRole(owner(f), { name: "Manager", permissions: [] })).toMatchObject({ ok: false, status: 400 });
    expect((await createBusinessRole(owner(f), { name: "Cashier", permissions: [] })).ok).toBe(true);
    expect(await createBusinessRole(owner(f), { name: "  cashier ", permissions: [] })).toMatchObject({ ok: false, status: 409 });
  });

  it("lets two businesses use the same role name", async () => {
    const a = await newFixture();
    const b = await newFixture();
    expect((await createBusinessRole(owner(a), { name: "Cashier", permissions: [] })).ok).toBe(true);
    expect((await createBusinessRole(owner(b), { name: "Cashier", permissions: [] })).ok).toBe(true);
  });

  it("caps a manager at the pages they hold", async () => {
    const f = await newFixture();
    // Managers do not hold /inventory by default.
    expect(await createBusinessRole(manager(f), { name: "Stock", permissions: ["/inventory"] })).toMatchObject({ ok: false, status: 403 });
    expect((await createBusinessRole(manager(f), { name: "Front", permissions: ["/customers", "Sales & Checkout"] })).ok).toBe(true);
  });
});

describe("updateBusinessRole", () => {
  it("renames a role and moves its holders with it", async () => {
    const f = await newFixture();
    const created = await createBusinessRole(owner(f), { name: "Cashier", permissions: ["/sales/new"] });
    if (!created.ok) throw new Error("setup failed");
    await db.update(staff).set({ role: "cashier" }).where(eq(staff.id, f.staffId));

    const r = await updateBusinessRole(owner(f), created.value.id, { name: "Till Operator" });
    expect(r.ok).toBe(true);
    const [row] = await db.select({ role: staff.role }).from(staff).where(eq(staff.id, f.staffId));
    expect(row.role).toBe("till operator");
  });

  it("refuses a rename onto an existing name", async () => {
    const f = await newFixture();
    await createBusinessRole(owner(f), { name: "Cashier", permissions: [] });
    const other = await createBusinessRole(owner(f), { name: "Waiter", permissions: [] });
    if (!other.ok) throw new Error("setup failed");
    expect(await updateBusinessRole(owner(f), other.value.id, { name: "cashier" })).toMatchObject({ ok: false, status: 409 });
  });

  it("stops a manager editing a role that reaches further than they do, or granting beyond themselves", async () => {
    const f = await newFixture();
    const wide = await createBusinessRole(owner(f), { name: "Stock Keeper", permissions: ["/inventory"] });
    const narrow = await createBusinessRole(owner(f), { name: "Greeter", permissions: ["/customers"] });
    if (!wide.ok || !narrow.ok) throw new Error("setup failed");

    expect(await updateBusinessRole(manager(f), wide.value.id, { description: "x" })).toMatchObject({ ok: false, status: 403 });
    expect(await updateBusinessRole(manager(f), narrow.value.id, { permissions: ["/customers", "/inventory"] })).toMatchObject({ ok: false, status: 403 });
    expect((await updateBusinessRole(manager(f), narrow.value.id, { permissions: ["/customers", "/bookings"] })).ok).toBe(true);
  });

  it("does not see another business's role", async () => {
    const a = await newFixture();
    const b = await newFixture();
    const created = await createBusinessRole(owner(a), { name: "Cashier", permissions: [] });
    if (!created.ok) throw new Error("setup failed");
    expect(await updateBusinessRole(owner(b), created.value.id, { name: "Hijack" })).toMatchObject({ ok: false, status: 404 });
    expect(await deleteBusinessRole(owner(b), created.value.id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("deleteBusinessRole", () => {
  it("refuses while someone holds the role, then allows it", async () => {
    const f = await newFixture();
    const created = await createBusinessRole(owner(f), { name: "Cashier", permissions: [] });
    if (!created.ok) throw new Error("setup failed");
    await db.update(staff).set({ role: "cashier" }).where(eq(staff.id, f.staffId));

    expect(await deleteBusinessRole(owner(f), created.value.id)).toMatchObject({ ok: false, status: 409 });
    await db.update(staff).set({ role: "staff" }).where(eq(staff.id, f.staffId));
    expect((await deleteBusinessRole(owner(f), created.value.id)).ok).toBe(true);
    // The name is free again.
    expect((await createBusinessRole(owner(f), { name: "Cashier", permissions: [] })).ok).toBe(true);
  });
});

describe("getUserPermissions", () => {
  it("resolves a custom role by name, and gives an unknown role only the always-on pages", async () => {
    const f = await newFixture();
    await createBusinessRole(owner(f), { name: "Cashier", permissions: ["/sales/new"] });
    const cashier = await getUserPermissions({ role: "cashier", businessId: f.businessId });
    expect(cashier.has("/sales/new")).toBe(true);
    expect(cashier.has("/inventory")).toBe(false);
    const ghost = await getUserPermissions({ role: "ghost", businessId: f.businessId });
    expect(Array.from(ghost).sort()).toEqual(["/", "/staff/attendance", "/staff/payroll"]);
  });

  it("applies a platform override to the built-in staff role in every business", async () => {
    const f = await newFixture();
    expect((await getUserPermissions({ role: "staff", businessId: f.businessId })).has("/vendors")).toBe(false);
    await db.insert(customRoles).values({ businessId: null, kind: "system", name: "Staff", permissions: ["/vendors"] });
    invalidateRoleCache();
    const staffPages = await getUserPermissions({ role: "staff", businessId: f.businessId });
    expect(staffPages.has("/vendors")).toBe(true);
    expect(staffPages.has("/customers")).toBe(false);
  });

  it("enforces one platform override per built-in role", async () => {
    await db.insert(customRoles).values({ businessId: null, kind: "system", name: "Staff", permissions: [] });
    await expect(db.insert(customRoles).values({ businessId: null, kind: "system", name: "staff", permissions: [] })).rejects.toThrow();
  });

  it("rejects a business role without a business and a platform role with one", async () => {
    const f = await newFixture();
    await expect(db.execute(sql`INSERT INTO custom_roles (business_id, kind, name) VALUES (NULL, 'custom', 'orphan')`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO custom_roles (business_id, kind, name) VALUES (${f.businessId}, 'template', 'bad')`)).rejects.toThrow();
  });
});

describe("checkRoleAssignable", () => {
  it("never assigns owner, and rejects roles that don't exist", async () => {
    const f = await newFixture();
    expect(await checkRoleAssignable(owner(f), "owner")).toMatchObject({ ok: false, status: 400 });
    expect(await checkRoleAssignable(owner(f), "ghost")).toMatchObject({ ok: false, status: 400 });
    expect((await checkRoleAssignable(owner(f), "manager")).ok).toBe(true);
    expect((await checkRoleAssignable(owner(f), undefined)).ok).toBe(true);
  });

  it("lets a manager assign only roles within their own access", async () => {
    const f = await newFixture();
    await createBusinessRole(owner(f), { name: "Stock Keeper", permissions: ["/inventory"] });
    await createBusinessRole(owner(f), { name: "Greeter", permissions: ["/customers"] });
    expect((await checkRoleAssignable(manager(f), "staff")).ok).toBe(true);
    expect((await checkRoleAssignable(manager(f), "greeter")).ok).toBe(true);
    expect(await checkRoleAssignable(manager(f), "stock keeper")).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses staff", async () => {
    const f = await newFixture();
    expect(await checkRoleAssignable({ role: "staff", businessId: f.businessId }, "staff")).toMatchObject({ ok: false, status: 403 });
  });
});
