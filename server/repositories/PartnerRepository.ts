import crypto from "crypto";
import { db } from "../db";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import {
  businessPartnerships,
  organisations,
  stores,
  inventory,
  partnerInvites,
  type BusinessPartnership,
} from "@shared/schema";
import { PartnerRuleError } from "../lib/partnerTransfer";

// No 0/O/1/I so a code read aloud or off a receipt survives being retyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const normalisePartnerCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

function randomCode(): string {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PT-${out}`;
}

export type PartnershipView = BusinessPartnership & {
  partner: { id: string; name: string; logoUrl: string | null };
  /** "outgoing": we asked; "incoming": they asked. */
  direction: "outgoing" | "incoming";
};

/**
 * Org-level trust links between businesses. A partnership is mutual and carries no
 * stock by itself; it only unlocks partner transfers between the two parties.
 */
export class PartnerRepository {
  /** The org's shareable code, minted on first use. */
  async ensurePartnerCode(orgId: string): Promise<string> {
    const [org] = await db.select({ code: organisations.partnerCode }).from(organisations).where(eq(organisations.id, orgId));
    if (!org) throw new PartnerRuleError("Business not found.");
    if (org.code) return org.code;

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode();
      try {
        const [row] = await db.update(organisations)
          .set({ partnerCode: code })
          .where(and(eq(organisations.id, orgId), sql`${organisations.partnerCode} IS NULL`))
          .returning({ code: organisations.partnerCode });
        if (row?.code) return row.code;
        // Lost a race with another request that minted it first.
        const [again] = await db.select({ code: organisations.partnerCode }).from(organisations).where(eq(organisations.id, orgId));
        if (again?.code) return again.code;
      } catch (err: any) {
        if (err?.code !== "23505") throw err; // unique collision: draw another code
      }
    }
    throw new Error("Could not generate a partner code.");
  }

  async getPartnership(id: string): Promise<BusinessPartnership | undefined> {
    const [row] = await db.select().from(businessPartnerships).where(eq(businessPartnerships.id, id));
    return row;
  }

  /** The partnership between two orgs in any state, whichever side asked first. */
  async findBetween(orgA: string, orgB: string): Promise<BusinessPartnership | undefined> {
    const [row] = await db.select().from(businessPartnerships).where(or(
      and(eq(businessPartnerships.requesterOrgId, orgA), eq(businessPartnerships.addresseeOrgId, orgB)),
      and(eq(businessPartnerships.requesterOrgId, orgB), eq(businessPartnerships.addresseeOrgId, orgA)),
    ));
    return row;
  }

  async getActiveBetween(orgA: string, orgB: string): Promise<BusinessPartnership | undefined> {
    const row = await this.findBetween(orgA, orgB);
    return row?.status === "active" ? row : undefined;
  }

  async countActive(orgId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(businessPartnerships).where(and(
      eq(businessPartnerships.status, "active"),
      or(eq(businessPartnerships.requesterOrgId, orgId), eq(businessPartnerships.addresseeOrgId, orgId)),
    ));
    return row?.n ?? 0;
  }

  async list(orgId: string): Promise<PartnershipView[]> {
    const rows = await db.select().from(businessPartnerships).where(
      or(eq(businessPartnerships.requesterOrgId, orgId), eq(businessPartnerships.addresseeOrgId, orgId)),
    );
    if (!rows.length) return [];
    const partnerIds = rows.map((r) => (r.requesterOrgId === orgId ? r.addresseeOrgId : r.requesterOrgId));
    const orgs = await db.select({ id: organisations.id, name: organisations.name, logoUrl: organisations.logoUrl })
      .from(organisations).where(inArray(organisations.id, partnerIds));
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return rows
      .map((r) => {
        const partnerId = r.requesterOrgId === orgId ? r.addresseeOrgId : r.requesterOrgId;
        return {
          ...r,
          partner: byId.get(partnerId) ?? { id: partnerId, name: "Unknown business", logoUrl: null },
          direction: (r.requesterOrgId === orgId ? "outgoing" : "incoming") as "outgoing" | "incoming",
        };
      })
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }

  /**
   * Ask the owner of `code` to partner. If they already asked us, this is the other half
   * of a handshake and the link goes straight to active rather than leaving two
   * mirror-image requests waiting on each other.
   */
  async request(requesterOrgId: string, userId: string | null, rawCode: string): Promise<BusinessPartnership> {
    const code = normalisePartnerCode(rawCode);
    if (!code) throw new PartnerRuleError("Enter a partner code.");
    const [target] = await db.select({ id: organisations.id, status: organisations.status, deletedAt: organisations.deletedAt })
      .from(organisations).where(eq(organisations.partnerCode, code));
    if (!target || target.deletedAt) throw new PartnerRuleError("No business uses that partner code.");
    if (target.id === requesterOrgId) throw new PartnerRuleError("That is your own partner code.");
    if (target.status === "suspended") throw new PartnerRuleError("That business cannot accept partners right now.");

    const existing = await this.findBetween(requesterOrgId, target.id);
    const now = new Date();
    if (!existing) {
      const [row] = await db.insert(businessPartnerships).values({
        requesterOrgId, addresseeOrgId: target.id, requestedByUserId: userId, status: "pending",
      }).onConflictDoNothing().returning();
      if (row) return row;
      // Both sides raced to ask: fall through to the handshake path.
      const raced = await this.findBetween(requesterOrgId, target.id);
      if (!raced) throw new Error("Could not create the partnership.");
      return this.reconcileExisting(raced, requesterOrgId, userId, now);
    }
    return this.reconcileExisting(existing, requesterOrgId, userId, now);
  }

  private async reconcileExisting(existing: BusinessPartnership, requesterOrgId: string, userId: string | null, now: Date): Promise<BusinessPartnership> {
    if (existing.status === "active") throw new PartnerRuleError("You are already partners.");
    if (existing.status === "pending") {
      if (existing.requesterOrgId === requesterOrgId) throw new PartnerRuleError("A request is already waiting for their answer.");
      // They asked us first, so asking back is agreeing.
      const [row] = await db.update(businessPartnerships)
        .set({ status: "active", respondedByUserId: userId, respondedAt: now, updatedAt: now })
        .where(and(eq(businessPartnerships.id, existing.id), eq(businessPartnerships.status, "pending")))
        .returning();
      return row ?? existing;
    }
    // declined or revoked: either side may start over; the asker becomes the requester.
    const [row] = await db.update(businessPartnerships).set({
      status: "pending",
      requesterOrgId,
      addresseeOrgId: existing.requesterOrgId === requesterOrgId ? existing.addresseeOrgId : existing.requesterOrgId,
      requestedByUserId: userId,
      respondedByUserId: null,
      respondedAt: null,
      revokedByOrgId: null,
      updatedAt: now,
    }).where(eq(businessPartnerships.id, existing.id)).returning();
    return row;
  }

  async respond(id: string, orgId: string, userId: string | null, accept: boolean): Promise<BusinessPartnership> {
    const p = await this.getPartnership(id);
    if (!p || p.addresseeOrgId !== orgId) throw new PartnerRuleError("Partner request not found.");
    if (p.status !== "pending") throw new PartnerRuleError(`This request is already ${p.status}.`);
    const now = new Date();
    const [row] = await db.update(businessPartnerships)
      .set({ status: accept ? "active" : "declined", respondedByUserId: userId, respondedAt: now, updatedAt: now })
      .where(and(eq(businessPartnerships.id, id), eq(businessPartnerships.status, "pending")))
      .returning();
    if (!row) throw new PartnerRuleError("This request has already been answered.");
    return row;
  }

  /**
   * Either side may end a link, and the requester may withdraw a pending one. Open
   * transfers and obligations are left exactly as they are: ending trust must never
   * erase a debt.
   */
  async revoke(id: string, orgId: string): Promise<BusinessPartnership> {
    const p = await this.getPartnership(id);
    if (!p || (p.requesterOrgId !== orgId && p.addresseeOrgId !== orgId)) throw new PartnerRuleError("Partnership not found.");
    if (p.status === "pending" && p.requesterOrgId !== orgId) throw new PartnerRuleError("Decline this request instead of revoking it.");
    if (p.status !== "active" && p.status !== "pending") throw new PartnerRuleError(`This partnership is already ${p.status}.`);
    const [row] = await db.update(businessPartnerships)
      .set({ status: "revoked", revokedByOrgId: orgId, updatedAt: new Date() })
      .where(eq(businessPartnerships.id, id)).returning();
    return row;
  }

  /** One limit per partnership, applied both ways: the most either side may owe the other at once. Null means no limit. */
  async setTradeCreditLimit(id: string, orgId: string, limit: number | null): Promise<BusinessPartnership> {
    const p = await this.getPartnership(id);
    if (!p || (p.requesterOrgId !== orgId && p.addresseeOrgId !== orgId)) throw new PartnerRuleError("Partnership not found.");
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) throw new PartnerRuleError("The credit limit must be zero or more.");
    const [row] = await db.update(businessPartnerships)
      .set({ tradeCreditLimit: limit, updatedAt: new Date() })
      .where(eq(businessPartnerships.id, id)).returning();
    return row;
  }

  /** Stores of an active partner that can be picked as a destination. Names only; never their stock. */
  async listPartnerStores(callerOrgId: string, partnerOrgId: string) {
    if (!(await this.getActiveBetween(callerOrgId, partnerOrgId))) throw new PartnerRuleError("You are not partners with that business.");
    return db.select({ id: stores.id, name: stores.name, address: stores.address })
      .from(stores)
      .where(and(eq(stores.businessId, partnerOrgId), eq(stores.isActive, true), eq(stores.acceptsPartnerTransfers, true)));
  }

  async orgName(orgId: string): Promise<string> {
    const [row] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
    return row?.name ?? "A partner";
  }

  /**
   * Replaces the set of a store's products that partners may see and request. Sharing is opt-in
   * and per item, so a business never exposes stock it did not choose to. Only the store's own
   * products can be listed; anything else in the list is ignored.
   */
  async setSharedItems(storeId: string, inventoryIds: string[]): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.update(inventory).set({ sharedWithPartners: false }).where(and(eq(inventory.storeId, storeId), eq(inventory.sharedWithPartners, true)));
      if (!inventoryIds.length) return 0;
      const rows = await tx.update(inventory).set({ sharedWithPartners: true }).where(and(
        eq(inventory.storeId, storeId), inArray(inventory.id, inventoryIds), eq(inventory.type, "product"), eq(inventory.isDeleted, false),
      )).returning({ id: inventory.id });
      return rows.length;
    });
  }

  async getSharedItemIds(storeId: string): Promise<string[]> {
    const rows = await db.select({ id: inventory.id }).from(inventory).where(and(eq(inventory.storeId, storeId), eq(inventory.sharedWithPartners, true)));
    return rows.map((r) => r.id);
  }

  /**
   * What a partner store has chosen to share. Shows whether an item is in stock, not how many, and
   * never the cost: a requester needs to know what to ask for, not the supplier's books.
   */
  async listSharedCatalog(callerOrgId: string, partnerOrgId: string, storeId: string) {
    if (!(await this.getActiveBetween(callerOrgId, partnerOrgId))) throw new PartnerRuleError("You are not partners with that business.");
    const [store] = await db.select({ businessId: stores.businessId, isActive: stores.isActive }).from(stores).where(eq(stores.id, storeId));
    if (!store || store.businessId !== partnerOrgId || !store.isActive) throw new PartnerRuleError("That store is not one of your partner's.");
    const rows = await db.select({
      id: inventory.id, name: inventory.name, sku: inventory.sku, unit: inventory.unit,
      quantity: inventory.quantity, listPrice: inventory.sellingPrice, allowFractional: inventory.allowFractional,
    }).from(inventory).where(and(
      eq(inventory.storeId, storeId), eq(inventory.sharedWithPartners, true), eq(inventory.type, "product"), eq(inventory.isDeleted, false),
    )).orderBy(inventory.name);
    return rows.map(({ quantity, ...r }) => ({ ...r, inStock: quantity > 0 }));
  }

  /** Email an invitation to a business that is not on the platform yet. Once per address a week, and capped per day. */
  async recordInvite(orgId: string, userId: string | null, rawEmail: string): Promise<{ email: string }> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PartnerRuleError("Enter a valid email address.");

    const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerInvites)
      .where(and(eq(partnerInvites.orgId, orgId), sql`${partnerInvites.createdAt} > now() - interval '1 day'`));
    if ((today?.n ?? 0) >= 10) throw new PartnerRuleError("You have sent the most invitations allowed today. Try again tomorrow.");

    const [existing] = await db.select().from(partnerInvites).where(and(eq(partnerInvites.orgId, orgId), sql`lower(${partnerInvites.email}) = ${email}`));
    if (existing) {
      if (existing.acceptedAt) throw new PartnerRuleError("That business has already joined as your partner.");
      if (Date.now() - new Date(existing.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000) throw new PartnerRuleError("You already invited that address in the last week.");
      await db.update(partnerInvites).set({ createdAt: new Date(), invitedByUserId: userId }).where(eq(partnerInvites.id, existing.id));
    } else {
      await db.insert(partnerInvites).values({ orgId, email, invitedByUserId: userId });
    }
    return { email };
  }
}
