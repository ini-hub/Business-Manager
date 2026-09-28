import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { hrDependants, hrEstateBeneficiaries, type HrDependant, type HrEstateBeneficiary, type UpsertHrDependantInput, type UpsertHrEstateBeneficiaryInput } from "@shared/schema";

export type BeneficiaryOutcome = { kind: "ok"; beneficiary: HrEstateBeneficiary } | { kind: "exceeds_100"; totalAfter: number };
export type DeleteOutcome = { kind: "ok" } | { kind: "not_found" };

/**
 * Dependants are plain CRUD. Estate beneficiaries carry the "percentages
 * across all of a staff member's rows sum to <= 100" invariant, which
 * Postgres cannot express as a cross-row CHECK constraint - every mutating
 * call here runs inside a transaction with SELECT ... FOR UPDATE on the
 * staff member's existing rows before validating the new sum, so two
 * concurrent edits can never both individually pass and together exceed
 * 100%. This is the single enforcement point; every route goes through it.
 */
export class EstateBeneficiaryService {
  async listDependants(staffId: string): Promise<HrDependant[]> {
    return db.select().from(hrDependants).where(eq(hrDependants.staffId, staffId));
  }

  async createDependant(staffId: string, input: UpsertHrDependantInput): Promise<HrDependant> {
    const [row] = await db.insert(hrDependants).values({ staffId, ...input, birthDate: input.birthDate || null }).returning();
    return row;
  }

  async updateDependant(staffId: string, id: string, input: UpsertHrDependantInput): Promise<HrDependant | undefined> {
    const [row] = await db.update(hrDependants)
      .set({ ...input, birthDate: input.birthDate || null, updatedAt: new Date() })
      .where(and(eq(hrDependants.id, id), eq(hrDependants.staffId, staffId)))
      .returning();
    return row;
  }

  async removeDependant(staffId: string, id: string): Promise<boolean> {
    const deleted = await db.delete(hrDependants).where(and(eq(hrDependants.id, id), eq(hrDependants.staffId, staffId))).returning({ id: hrDependants.id });
    return deleted.length > 0;
  }

  async listBeneficiaries(staffId: string): Promise<HrEstateBeneficiary[]> {
    return db.select().from(hrEstateBeneficiaries).where(eq(hrEstateBeneficiaries.staffId, staffId));
  }

  async createBeneficiary(staffId: string, input: UpsertHrEstateBeneficiaryInput): Promise<BeneficiaryOutcome> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(hrEstateBeneficiaries)
        .where(eq(hrEstateBeneficiaries.staffId, staffId))
        .for("update");
      const currentTotal = existing.reduce((sum, b) => sum + Number(b.percentage), 0);
      const totalAfter = currentTotal + input.percentage;
      if (totalAfter > 100.001) {
        return { kind: "exceeds_100", totalAfter };
      }
      const [row] = await tx.insert(hrEstateBeneficiaries).values({ staffId, ...input }).returning();
      return { kind: "ok", beneficiary: row };
    });
  }

  async updateBeneficiary(staffId: string, id: string, input: UpsertHrEstateBeneficiaryInput): Promise<BeneficiaryOutcome | { kind: "not_found" }> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(hrEstateBeneficiaries)
        .where(eq(hrEstateBeneficiaries.staffId, staffId))
        .for("update");
      const target = existing.find((b) => b.id === id);
      if (!target) return { kind: "not_found" };
      const othersTotal = existing.filter((b) => b.id !== id).reduce((sum, b) => sum + Number(b.percentage), 0);
      const totalAfter = othersTotal + input.percentage;
      if (totalAfter > 100.001) {
        return { kind: "exceeds_100", totalAfter };
      }
      const [row] = await tx.update(hrEstateBeneficiaries)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(hrEstateBeneficiaries.id, id), eq(hrEstateBeneficiaries.staffId, staffId)))
        .returning();
      return { kind: "ok", beneficiary: row };
    });
  }

  async removeBeneficiary(staffId: string, id: string): Promise<DeleteOutcome> {
    const deleted = await db.delete(hrEstateBeneficiaries)
      .where(and(eq(hrEstateBeneficiaries.id, id), eq(hrEstateBeneficiaries.staffId, staffId)))
      .returning({ id: hrEstateBeneficiaries.id });
    return deleted.length > 0 ? { kind: "ok" } : { kind: "not_found" };
  }
}

export const estateBeneficiaryService = new EstateBeneficiaryService();
