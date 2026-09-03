import { db } from "../db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  staffContracts,
  staffContractVersions,
  staffContractSignatures,
  type StaffContract,
  type StaffContractVersion,
  type StaffContractSignature,
} from "@shared/schema";

export class StaffContractRepository {
  async getByStaffId(staffId: string): Promise<StaffContract | undefined> {
    const [row] = await db.select().from(staffContracts).where(eq(staffContracts.staffId, staffId));
    return row;
  }

  /** One query for a whole page of staff, mirroring getInviteProjection's batching. */
  async getByStaffIds(staffIds: string[]): Promise<StaffContract[]> {
    if (staffIds.length === 0) return [];
    return db.select().from(staffContracts).where(inArray(staffContracts.staffId, staffIds));
  }

  async getById(id: string): Promise<StaffContract | undefined> {
    const [row] = await db.select().from(staffContracts).where(eq(staffContracts.id, id));
    return row;
  }

  async getVersionById(id: string): Promise<StaffContractVersion | undefined> {
    const [row] = await db.select().from(staffContractVersions).where(eq(staffContractVersions.id, id));
    return row;
  }

  /** Every version ever written for a contract, newest first - for the manager-facing history view. */
  async getAllVersions(staffContractId: string): Promise<StaffContractVersion[]> {
    return db.select().from(staffContractVersions)
      .where(eq(staffContractVersions.staffContractId, staffContractId))
      .orderBy(desc(staffContractVersions.versionNumber));
  }

  async getSignatureForContract(staffContractId: string): Promise<StaffContractSignature | undefined> {
    const [row] = await db
      .select()
      .from(staffContractSignatures)
      .where(eq(staffContractSignatures.staffContractId, staffContractId))
      .orderBy(desc(staffContractSignatures.signedAt));
    return row;
  }

  /**
   * First-ever contract for a staff member: creates the aggregate row and
   * version 1 in one transaction. Callers must have already confirmed no
   * staff_contracts row exists for this staffId (unique constraint backs
   * this up regardless).
   */
  async createContractWithFirstVersion(params: {
    staffId: string;
    createdByUserId: string;
    version: Omit<typeof staffContractVersions.$inferInsert, "id" | "staffContractId" | "versionNumber" | "createdByUserId" | "createdAt" | "supersededAt">;
  }): Promise<{ contract: StaffContract; version: StaffContractVersion }> {
    return db.transaction(async (tx) => {
      const [contract] = await tx.insert(staffContracts).values({
        staffId: params.staffId,
        status: "pending_signature",
      }).returning();

      const [version] = await tx.insert(staffContractVersions).values({
        ...params.version,
        staffContractId: contract.id,
        versionNumber: 1,
        createdByUserId: params.createdByUserId,
      }).returning();

      const [updated] = await tx.update(staffContracts)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(staffContracts.id, contract.id))
        .returning();

      return { contract: updated, version };
    });
  }

  /**
   * Replaces a not-yet-signed contract: inserts version N+1, stamps the
   * previous current version's supersededAt, repoints currentVersionId.
   * Never mutates an existing version's content columns.
   */
  async addReplacementVersion(params: {
    contract: StaffContract;
    createdByUserId: string;
    version: Omit<typeof staffContractVersions.$inferInsert, "id" | "staffContractId" | "versionNumber" | "createdByUserId" | "createdAt" | "supersededAt">;
  }): Promise<{ contract: StaffContract; version: StaffContractVersion }> {
    return db.transaction(async (tx) => {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: staffContractVersions.versionNumber })
        .from(staffContractVersions)
        .where(eq(staffContractVersions.staffContractId, params.contract.id))
        .orderBy(desc(staffContractVersions.versionNumber))
        .limit(1);

      if (params.contract.currentVersionId) {
        await tx.update(staffContractVersions)
          .set({ supersededAt: new Date() })
          .where(eq(staffContractVersions.id, params.contract.currentVersionId));
      }

      const [version] = await tx.insert(staffContractVersions).values({
        ...params.version,
        staffContractId: params.contract.id,
        versionNumber: (maxVersion ?? 0) + 1,
        createdByUserId: params.createdByUserId,
      }).returning();

      const [updated] = await tx.update(staffContracts)
        .set({ currentVersionId: version.id, status: "pending_signature", updatedAt: new Date() })
        .where(eq(staffContracts.id, params.contract.id))
        .returning();

      return { contract: updated, version };
    });
  }

  /** Inserts the append-only signature row and flips the contract to 'signed', atomically. */
  async recordSignature(params: {
    staffContractId: string;
    staffContractVersionId: string;
    staffId: string;
    userId: string;
    typedFullName: string;
    affirmedReadAndAgree: boolean;
    consentedElectronicSignature: boolean;
    ipAddress: string;
    userAgent: string;
    contentHashAtSigning: string;
  }): Promise<{ contract: StaffContract; signature: StaffContractSignature }> {
    return db.transaction(async (tx) => {
      const [signature] = await tx.insert(staffContractSignatures).values(params).returning();
      const [contract] = await tx.update(staffContracts)
        .set({ status: "signed", updatedAt: new Date() })
        .where(eq(staffContracts.id, params.staffContractId))
        .returning();
      return { contract, signature };
    });
  }

  async recordDecline(params: {
    staffContractId: string;
    reason?: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<StaffContract> {
    const [contract] = await db.update(staffContracts)
      .set({
        status: "declined",
        declinedAt: new Date(),
        declinedReason: params.reason ?? null,
        declinedIp: params.ipAddress,
        declinedUserAgent: params.userAgent,
        updatedAt: new Date(),
      })
      .where(eq(staffContracts.id, params.staffContractId))
      .returning();
    return contract;
  }
}
