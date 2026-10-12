import { db } from "../db";
import { encryptIfNeeded, decryptIfNeeded } from "../lib/credentialEncryption";
import {
  businesses,
  organisations,
  organisationMembers,
  stores,
  storeCounters,
  staff,
  staffStoreAssignments,
  settings,
  promotions,
  customRoles,
  storeIntegrations,
  customers,
  inventory,
  type Business,
  type InsertBusiness,
  type Store,
  type InsertStore,
  type Organisation,
  type InsertOrganisation,
  type OrganisationMember,
  type InsertOrganisationMember,
  type Settings,
  type InsertSettings,
  type Promotion,
  type InsertPromotion,
  type CustomRole,
  type InsertCustomRole,
  type StoreIntegration,
  type InsertStoreIntegration,
  users,
} from "@shared/schema";
import { eq, and, ilike, count, isNull, sql } from "drizzle-orm";
import { seedDefaultHrConfig } from "../lib/hrDefaults";
import { assertWithinCountLimit } from "../lib/entitlements";
import { createTtlCache } from "../lib/ttlCache";

export interface StoreDeletionBlocker { table: string; count: number }
type FkTarget = { table: string; column: string };

// Per-staff rows (profile and schedule config, no history) removed with the staff.
const STAFF_DELETE_CLEARED_TABLES = new Set([
  "staff_devices", "staff_schedules", "staff_schedule_exceptions", "hr_time_off_balances",
  "hr_emergency_contacts", "hr_dependants", "hr_estate_beneficiaries", "hr_field_values",
  "hr_job_info_history", "hr_additional_job_info_history", "staff_store_assignments",
]);
// Store-keyed tables that never block a delete: removed with the store (or
// handled separately, like zero-stock inventory and customer_phones).
const STORE_DELETE_CLEARED_TABLES = new Set([
  ...Array.from(STAFF_DELETE_CLEARED_TABLES),
  "staff", "store_counters", "settings", "store_integrations", "promotions", "notifications",
  "checkout_idempotency_keys", "service_consumables", "hr_store_holidays", "tax_rates",
  "expense_categories", "products", "inventory", "customer_phones",
]);

const settingsCache = createTtlCache<string, Settings>(10_000);

export class BusinessRepository {
  // ─── Organisations ────────────────────────────────────────────────────────
  async getOrganisationsByUserId(userId: string): Promise<any[]> {
    const rows = await db
      .select({
        id: organisations.id,
        organisationId: organisations.id,
        name: organisations.name,
        slug: organisations.slug,
        role: organisationMembers.role,
        status: organisationMembers.status,
        memberId: organisationMembers.id,
        // Note: distinct from `status` above, which is the membership's own
        // status (active/pending/partial) - this is the organisation's
        // billing/trial state, needed to tell whether a workspace is locked.
        orgStatus: organisations.status,
        trialEndsAt: organisations.trialEndsAt,
      })
      .from(organisationMembers)
      .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
      .where(and(eq(organisationMembers.userId, userId), isNull(organisations.deletedAt)));
    return rows;
  }

  async getOrganisationMember(userId: string, organisationId: string): Promise<OrganisationMember | undefined> {
    const [member] = await db
      .select()
      .from(organisationMembers)
      .where(and(eq(organisationMembers.userId, userId), eq(organisationMembers.organisationId, organisationId)));
    return member;
  }

  async createOrganisation(data: InsertOrganisation): Promise<Organisation> {
    const [org] = await db.insert(organisations).values(data).returning();
    // Every business needs hr_section_config rows or hrProfileGate.ts
    // (server/lib/hrProfileGate.ts) has nothing to read for it - see
    // server/lib/hrDefaults.ts for why this can't just live in a migration.
    await seedDefaultHrConfig(org.id);
    return org;
  }

  async createOrganisationMember(data: InsertOrganisationMember): Promise<OrganisationMember> {
    const [member] = await db.insert(organisationMembers).values(data).returning();
    return member;
  }

  async updateOrganisationMemberStatus(id: string, status: string, activatedAt?: Date): Promise<OrganisationMember> {
    const updateData: Partial<OrganisationMember> = { status };
    if (activatedAt) {
      updateData.activatedAt = activatedAt;
    }
    const [member] = await db
      .update(organisationMembers)
      .set(updateData)
      .where(eq(organisationMembers.id, id))
      .returning();
    if (!member) throw new Error("Organisation member not found.");
    return member;
  }

  async getOrganisationMembers(organisationId: string): Promise<(OrganisationMember & { user: any })[]> {
    const rows = await db
      .select({
        member: organisationMembers,
        user: users,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, organisationId));

    return rows.map(r => ({
      ...r.member,
      user: r.user,
    }));
  }

  async getOrganisationMemberById(id: string): Promise<OrganisationMember | undefined> {
    const [member] = await db.select().from(organisationMembers).where(eq(organisationMembers.id, id));
    return member;
  }

  async getOrganisationBySlug(slug: string): Promise<Organisation | undefined> {
    const [org] = await db.select().from(organisations).where(eq(organisations.slug, slug.trim().toLowerCase()));
    return org;
  }

  async deleteOrganisationMember(id: string): Promise<void> {
    await db.delete(organisationMembers).where(eq(organisationMembers.id, id));
  }

  async updateOrganisationMember(id: string, data: Partial<OrganisationMember>): Promise<OrganisationMember> {
    const [member] = await db
      .update(organisationMembers)
      .set(data)
      .where(eq(organisationMembers.id, id))
      .returning();
    if (!member) throw new Error("Organisation member not found.");
    return member;
  }

  // ─── Business ─────────────────────────────────────────────────────────────
  async getBusinessByUserId(userId: string, getUser: (id: string) => Promise<any>): Promise<Business | undefined> {
    const user = await getUser(userId);
    if (!user || !user.businessId) return undefined;
    const [business] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
    return business;
  }

  async getBusiness(): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).limit(1);
    return business;
  }

  async getBusinessById(id: string): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, id));
    return business;
  }

  async createBusiness(business: InsertBusiness): Promise<Business> {
    const [newBusiness] = await db.insert(businesses).values(business).returning();
    return newBusiness;
  }

  async updateBusiness(id: string, businessData: Partial<InsertBusiness>): Promise<Business | undefined> {
    const [updated] = await db.update(businesses).set(businessData).where(eq(businesses.id, id)).returning();
    return updated;
  }

  // ─── Stores ───────────────────────────────────────────────────────────────
  async getStores(businessId: string): Promise<Store[]> {
    return await db.select().from(stores).where(eq(stores.businessId, businessId));
  }

  async getStore(id: string): Promise<Store | undefined> {
    const [store] = await db.select().from(stores).where(eq(stores.id, id));
    return store;
  }

  async getStoreByName(businessId: string, name: string): Promise<Store | undefined> {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.businessId, businessId), ilike(stores.name, name)))
      .limit(1);
    return store;
  }

  async getStoreByCode(businessId: string, code: string): Promise<Store | undefined> {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.businessId, businessId), eq(stores.code, code.trim().toUpperCase())))
      .limit(1);
    return store;
  }

  async createStore(store: InsertStore & { isMain?: boolean }): Promise<Store> {
    return db.transaction(async (tx) => {
      // Free-tier store cap, checked under the same lock/transaction as the insert.
      if (store.businessId) await assertWithinCountLimit(tx, store.businessId, "store_count");
      const [newStore] = await tx.insert(stores).values(store).returning();
      await tx.insert(storeCounters).values({ storeId: newStore.id, nextCustomerNumber: 1 });
      return newStore;
    });
  }

  async updateStore(id: string, storeData: Partial<InsertStore>): Promise<Store | undefined> {
    const [updated] = await db.update(stores).set(storeData).where(eq(stores.id, id)).returning();
    return updated;
  }

  // Why a store can't be permanently deleted. Staff never block: they are removed
  // with the store. Anything that is history (sales, expenses, payroll, stock
  // movements, ...) does, found by following every foreign key into stores/staff
  // so a table added later blocks by default instead of failing on a constraint.
  async getStoreDeletionBlockers(id: string): Promise<StoreDeletionBlocker[]> {
    const fks = await this.getStoreFkTargets();
    const parts = [
      ...fks.store.map((f) => sql`SELECT ${f.table}::text AS t, count(*)::int AS c FROM ${sql.identifier(f.table)} WHERE ${sql.identifier(f.column)} = ${id}`),
      ...fks.staff.map((f) => sql`SELECT ${f.table}::text AS t, count(*)::int AS c FROM ${sql.identifier(f.table)} WHERE ${sql.identifier(f.column)} IN (SELECT id FROM staff WHERE store_id = ${id})`),
      // Zero-stock items are setup leftovers; items still holding stock are not.
      sql`SELECT 'inventory_with_stock'::text AS t, count(*)::int AS c FROM inventory WHERE store_id = ${id} AND quantity <> 0 AND NOT is_deleted`,
    ];
    const result = await db.execute(sql.join(parts, sql` UNION ALL `));
    const byTable = new Map<string, number>();
    for (const row of result.rows as Array<{ t: string; c: number }>) {
      if (row.c > 0) byTable.set(row.t, Math.max(byTable.get(row.t) ?? 0, row.c));
    }
    return Array.from(byTable, ([table, n]) => ({ table, count: n }));
  }

  private storeFkTargets?: Promise<{ store: FkTarget[]; staff: FkTarget[] }>;

  private getStoreFkTargets() {
    this.storeFkTargets ??= (async () => {
      const rows = (await db.execute(sql`
        SELECT t.relname AS "table", a.attname AS "column", r.relname AS "ref"
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_class r ON r.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = current_schema()
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confdeltype <> 'c' AND r.relname IN ('stores', 'staff')
      `)).rows as Array<FkTarget & { ref: string }>;
      return {
        store: rows.filter((r) => r.ref === "stores" && !STORE_DELETE_CLEARED_TABLES.has(r.table)),
        staff: rows.filter((r) => r.ref === "staff" && r.table !== "stores" && r.table !== "staff" && !STAFF_DELETE_CLEARED_TABLES.has(r.table)),
      };
    })().catch((e) => { this.storeFkTargets = undefined; throw e; });
    return this.storeFkTargets;
  }

  // Callers check getStoreDeletionBlockers first; this only clears what that
  // check deliberately lets through (staff, setup, zero-stock catalog).
  async deleteStore(id: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const ownStaff = sql`(SELECT id FROM staff WHERE store_id = ${id})`;
      for (const t of Array.from(STAFF_DELETE_CLEARED_TABLES)) {
        await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE staff_id IN ${ownStaff}`);
      }
      for (const t of ["notifications", "checkout_idempotency_keys", "service_consumables", "hr_store_holidays", "tax_rates", "expense_categories"]) {
        await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE store_id = ${id}`);
      }
      const ownInventory = sql`(SELECT id FROM inventory WHERE store_id = ${id})`;
      await tx.execute(sql`DELETE FROM bundle_components WHERE parent_inventory_id IN ${ownInventory} OR component_inventory_id IN ${ownInventory}`);
      await tx.execute(sql`DELETE FROM inventory WHERE store_id = ${id}`);
      await tx.execute(sql`DELETE FROM products WHERE store_id = ${id}`);
      // Assignments of people homed elsewhere reference this store without a cascade.
      await tx.delete(staffStoreAssignments).where(eq(staffStoreAssignments.storeId, id));
      await tx.update(stores).set({ managerStaffId: null }).where(eq(stores.id, id));
      await tx.delete(staff).where(eq(staff.storeId, id));
      await tx.delete(storeCounters).where(eq(storeCounters.storeId, id));
      await tx.delete(settings).where(eq(settings.storeId, id));
      const result = await tx.delete(stores).where(eq(stores.id, id)).returning();
      return result.length > 0;
    });
  }

  async archiveStore(id: string): Promise<Store | undefined> {
    const [updated] = await db.update(stores).set({ isActive: false }).where(eq(stores.id, id)).returning();
    return updated;
  }

  async restoreStore(id: string): Promise<Store | undefined> {
    return db.transaction(async (tx) => {
      const [current] = await tx.select({ businessId: stores.businessId, isActive: stores.isActive }).from(stores).where(eq(stores.id, id)).limit(1);
      // Reactivating an archived store takes a store slot back, so it's subject to the same free-tier cap as a new one.
      if (current && !current.isActive && current.businessId) {
        await assertWithinCountLimit(tx, current.businessId, "store_count");
      }
      const [updated] = await tx.update(stores).set({ isActive: true }).where(eq(stores.id, id)).returning();
      return updated;
    });
  }

  async countActiveStores(businessId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(stores)
      .where(and(eq(stores.businessId, businessId), eq(stores.isActive, true)));
    return result[0].count;
  }

  async getMainStore(businessId: string): Promise<Store | undefined> {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.businessId, businessId), eq(stores.isMain, true)))
      .limit(1);
    return store;
  }

  // Flips isMain off the current main store (if any) and onto storeId in one
  // transaction, so the partial unique index (uq_stores_single_main_per_business)
  // never sees two rows both true at once.
  async setMainStore(businessId: string, storeId: string): Promise<Store> {
    return await db.transaction(async (tx) => {
      await tx
        .update(stores)
        .set({ isMain: false })
        .where(and(eq(stores.businessId, businessId), eq(stores.isMain, true)));
      const [updated] = await tx
        .update(stores)
        .set({ isMain: true })
        .where(eq(stores.id, storeId))
        .returning();
      return updated;
    });
  }

  async hasStoreData(id: string): Promise<boolean> {
    const customerCount = await db.select({ count: count() }).from(customers).where(eq(customers.storeId, id));
    const staffCount = await db.select({ count: count() }).from(staff).where(eq(staff.storeId, id));
    const inventoryCount = await db.select({ count: count() }).from(inventory).where(eq(inventory.storeId, id));
    // People homed elsewhere but assigned here count as staff data too.
    const assignedCount = await db.select({ count: count() }).from(staffStoreAssignments).where(eq(staffStoreAssignments.storeId, id));
    return customerCount[0].count > 0 || staffCount[0].count > 0 || assignedCount[0].count > 0 || inventoryCount[0].count > 0;
  }

  // ─── Store Integrations ────────────────────────────────────────────────────
  // secretKey / webhookSecret are AES-256-GCM encrypted at rest; callers always
  // see plaintext (legacy un-prefixed rows pass through until backfilled).
  private decryptIntegration(row: StoreIntegration): StoreIntegration {
    return {
      ...row,
      secretKey: decryptIfNeeded(row.secretKey) as string | null,
      webhookSecret: decryptIfNeeded(row.webhookSecret) as string | null,
    };
  }

  async getStoreIntegrations(storeId: string): Promise<StoreIntegration[]> {
    const rows = await db.select().from(storeIntegrations).where(eq(storeIntegrations.storeId, storeId));
    return rows.map((r) => this.decryptIntegration(r));
  }

  async getStoreIntegrationByProvider(storeId: string, provider: string): Promise<StoreIntegration | undefined> {
    const [row] = await db
      .select()
      .from(storeIntegrations)
      .where(and(eq(storeIntegrations.storeId, storeId), eq(storeIntegrations.provider, provider)));
    return row ? this.decryptIntegration(row) : undefined;
  }

  async upsertStoreIntegration(data: InsertStoreIntegration & { storeId: string; provider: string }): Promise<StoreIntegration> {
    const existing = await this.getStoreIntegrationByProvider(data.storeId, data.provider);
    const values = { ...data };
    if (values.secretKey !== undefined) values.secretKey = encryptIfNeeded(values.secretKey) as string | null;
    if (values.webhookSecret !== undefined) values.webhookSecret = encryptIfNeeded(values.webhookSecret) as string | null;
    if (existing) {
      const [updated] = await db
        .update(storeIntegrations)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(storeIntegrations.id, existing.id))
        .returning();
      return this.decryptIntegration(updated);
    }
    const [inserted] = await db.insert(storeIntegrations).values(values).returning();
    return this.decryptIntegration(inserted);
  }

  async deleteStoreIntegration(id: string): Promise<void> {
    await db.delete(storeIntegrations).where(eq(storeIntegrations.id, id));
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  async getSettings(storeId: string): Promise<Settings> {
    // Read on most store-scoped requests and twice per checkout. upsertSettings is the only writer and
    // invalidates; the short TTL covers a write made on another instance. Callers get a copy.
    const row = await settingsCache.get(storeId, async () => {
      const [found] = await db.select().from(settings).where(eq(settings.storeId, storeId));
      if (found) return found;
      // DO NOTHING + re-read: concurrent first requests for a new store must not fail on the unique store_id.
      const [inserted] = await db.insert(settings).values({ storeId }).onConflictDoNothing().returning();
      if (inserted) return inserted;
      const [created] = await db.select().from(settings).where(eq(settings.storeId, storeId));
      return created;
    });
    return { ...row };
  }

  async upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings> {
    const [updated] = await db.insert(settings)
      .values({ storeId, ...data })
      .onConflictDoUpdate({
        target: settings.storeId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    settingsCache.invalidate(storeId);
    return updated;
  }

  // ─── Promotions ────────────────────────────────────────────────────────────
  async getPromotions(storeId: string): Promise<Promotion[]> {
    const { asc } = await import("drizzle-orm");
    return await db.select().from(promotions).where(and(eq(promotions.storeId, storeId), eq(promotions.isDeleted, false))).orderBy(asc(promotions.name));
  }

  async createPromotion(data: InsertPromotion & { storeId: string }): Promise<Promotion> {
    const [row] = await db.insert(promotions).values(data).returning();
    return row;
  }

  async updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion | undefined> {
    const [row] = await db.update(promotions).set(data).where(eq(promotions.id, id)).returning();
    return row;
  }

  async deletePromotion(id: string): Promise<boolean> {
    const res = await db.update(promotions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(promotions.id, id))
      .returning();
    return res.length > 0;
  }

  // ─── Custom Roles ──────────────────────────────────────────────────────────
  async getCustomRoles(businessId: string): Promise<CustomRole[]> {
    const { asc } = await import("drizzle-orm");
    return await db.select().from(customRoles).where(and(eq(customRoles.businessId, businessId), eq(customRoles.isDeleted, false))).orderBy(asc(customRoles.name));
  }

  async createCustomRole(data: InsertCustomRole & { businessId: string }): Promise<CustomRole> {
    const [row] = await db.insert(customRoles).values({
      businessId: data.businessId,
      name: data.name,
      description: data.description || null,
      permissions: data.permissions || [],
    }).returning();
    return row;
  }

  async updateCustomRole(id: string, data: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    const [row] = await db.update(customRoles).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(customRoles.id, id)).returning();
    return row;
  }

  async deleteCustomRole(id: string): Promise<boolean> {
    const res = await db.update(customRoles)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(customRoles.id, id))
      .returning();
    return res.length > 0;
  }
}
