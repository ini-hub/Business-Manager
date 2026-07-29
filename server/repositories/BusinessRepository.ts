import { db } from "../db";
import {
  businesses,
  organisations,
  organisationMembers,
  stores,
  storeCounters,
  staff,
  otpCodes,
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
  type OtpCode,
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
import { eq, and, ilike, gt, count } from "drizzle-orm";

export class BusinessRepository {
  // ─── OTP Codes ────────────────────────────────────────────────────────────
  async createOtpCode(data: { userId: string; code: string; type: string; expiresAt: Date }): Promise<OtpCode> {
    const [otp] = await db.insert(otpCodes).values({
      userId: data.userId,
      code: data.code,
      type: data.type,
      expiresAt: data.expiresAt,
      isUsed: false,
    }).returning();
    return otp;
  }

  async getValidOtpCode(userId: string, code: string, type: string): Promise<OtpCode | undefined> {
    const [otp] = await db.select().from(otpCodes).where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.code, code),
        eq(otpCodes.type, type),
        eq(otpCodes.isUsed, false),
        gt(otpCodes.expiresAt, new Date())
      )
    );
    return otp;
  }

  async markOtpCodeAsUsed(id: string): Promise<void> {
    await db.update(otpCodes).set({ isUsed: true }).where(eq(otpCodes.id, id));
  }

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
      .where(eq(organisationMembers.userId, userId));
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

  async createStore(store: InsertStore): Promise<Store> {
    const [newStore] = await db.insert(stores).values(store).returning();
    await db.insert(storeCounters).values({ storeId: newStore.id, nextCustomerNumber: 1 });
    return newStore;
  }

  async updateStore(id: string, storeData: Partial<InsertStore>): Promise<Store | undefined> {
    const [updated] = await db.update(stores).set(storeData).where(eq(stores.id, id)).returning();
    return updated;
  }

  async deleteStore(id: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      await tx.delete(staff).where(eq(staff.storeId, id));
      await tx.delete(storeCounters).where(eq(storeCounters.storeId, id));
      await tx.update(stores).set({ managerStaffId: null }).where(eq(stores.id, id));
      const result = await tx.delete(stores).where(eq(stores.id, id)).returning();
      return result.length > 0;
    });
  }

  async hasStoreData(id: string): Promise<boolean> {
    const customerCount = await db.select({ count: count() }).from(customers).where(eq(customers.storeId, id));
    const staffCount = await db.select({ count: count() }).from(staff).where(eq(staff.storeId, id));
    const inventoryCount = await db.select({ count: count() }).from(inventory).where(eq(inventory.storeId, id));
    return customerCount[0].count > 0 || staffCount[0].count > 0 || inventoryCount[0].count > 0;
  }

  // ─── Store Integrations ────────────────────────────────────────────────────
  async getStoreIntegrations(storeId: string): Promise<StoreIntegration[]> {
    return await db.select().from(storeIntegrations).where(eq(storeIntegrations.storeId, storeId));
  }

  async getStoreIntegrationByProvider(storeId: string, provider: string): Promise<StoreIntegration | undefined> {
    const [row] = await db
      .select()
      .from(storeIntegrations)
      .where(and(eq(storeIntegrations.storeId, storeId), eq(storeIntegrations.provider, provider)));
    return row;
  }

  async upsertStoreIntegration(data: InsertStoreIntegration & { storeId: string; provider: string }): Promise<StoreIntegration> {
    const existing = await this.getStoreIntegrationByProvider(data.storeId, data.provider);
    if (existing) {
      const [updated] = await db
        .update(storeIntegrations)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(storeIntegrations.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(storeIntegrations).values(data).returning();
    return inserted;
  }

  async deleteStoreIntegration(id: string): Promise<void> {
    await db.delete(storeIntegrations).where(eq(storeIntegrations.id, id));
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  async getSettings(storeId: string): Promise<Settings> {
    const [row] = await db.select().from(settings).where(eq(settings.storeId, storeId));
    if (row) return row;
    const [inserted] = await db.insert(settings).values({ storeId }).returning();
    return inserted;
  }

  async upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings> {
    const [updated] = await db.insert(settings)
      .values({ storeId, ...data })
      .onConflictDoUpdate({
        target: settings.storeId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
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
