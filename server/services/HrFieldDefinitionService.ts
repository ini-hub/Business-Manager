import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  hrFieldDefinitions,
  hrSectionConfig,
  type HrFieldDefinition,
  type HrFieldSection,
  type HrSection,
  type HrSectionConfig,
  type CreateHrFieldDefinitionInput,
  type UpdateHrFieldDefinitionInput,
} from "@shared/schema";

type DeleteFieldOutcome = { kind: "deleted" } | { kind: "refused_system_field" } | { kind: "not_found" };

/**
 * Super-admin-only CRUD over the dynamic field builder (hr_field_definitions)
 * and the per-business section enable/require toggles (hr_section_config).
 * The validation + "never delete a system field" rule lives here, not at the
 * route boundary, so it can't be bypassed by any other caller later.
 */
class HrFieldDefinitionService {
  // ─── Field definitions (personal / job_current) ─────────────────────────

  async list(businessId: string, section: HrFieldSection): Promise<HrFieldDefinition[]> {
    return db.select().from(hrFieldDefinitions)
      .where(and(eq(hrFieldDefinitions.businessId, businessId), eq(hrFieldDefinitions.section, section)))
      .orderBy(hrFieldDefinitions.sortOrder);
  }

  async create(businessId: string, section: HrFieldSection, input: CreateHrFieldDefinitionInput): Promise<HrFieldDefinition | { error: string }> {
    const existing = await this.list(businessId, section);
    if (existing.some((f) => f.fieldKey === input.fieldKey)) {
      return { error: `A field with key "${input.fieldKey}" already exists in this section.` };
    }
    const [row] = await db.insert(hrFieldDefinitions).values({
      businessId,
      section,
      fieldKey: input.fieldKey,
      label: input.label,
      fieldType: input.fieldType,
      options: input.options ?? null,
      validation: input.validation ?? null,
      isRequired: input.isRequired ?? false,
      isEnabled: input.isEnabled ?? true,
      isSystemField: false,
      sortOrder: existing.length,
    }).returning();
    return row;
  }

  async update(businessId: string, fieldId: string, input: UpdateHrFieldDefinitionInput): Promise<HrFieldDefinition | undefined> {
    const [row] = await db.update(hrFieldDefinitions)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(hrFieldDefinitions.id, fieldId), eq(hrFieldDefinitions.businessId, businessId)))
      .returning();
    return row;
  }

  async remove(businessId: string, fieldId: string): Promise<DeleteFieldOutcome> {
    const [existing] = await db.select().from(hrFieldDefinitions)
      .where(and(eq(hrFieldDefinitions.id, fieldId), eq(hrFieldDefinitions.businessId, businessId)));
    if (!existing) return { kind: "not_found" };
    if (existing.isSystemField) return { kind: "refused_system_field" };
    await db.delete(hrFieldDefinitions).where(eq(hrFieldDefinitions.id, fieldId));
    return { kind: "deleted" };
  }

  async reorder(businessId: string, section: HrFieldSection, orderedIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(hrFieldDefinitions)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(and(
            eq(hrFieldDefinitions.id, orderedIds[i]),
            eq(hrFieldDefinitions.businessId, businessId),
            eq(hrFieldDefinitions.section, section),
          ));
      }
    });
  }

  // ─── Section config ──────────────────────────────────────────────────────

  async listSections(businessId: string): Promise<HrSectionConfig[]> {
    return db.select().from(hrSectionConfig).where(eq(hrSectionConfig.businessId, businessId));
  }

  async updateSection(businessId: string, section: HrSection, input: { isEnabled?: boolean; isRequiredForOnboarding?: boolean }): Promise<HrSectionConfig | undefined> {
    const [row] = await db.update(hrSectionConfig)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(hrSectionConfig.businessId, businessId), eq(hrSectionConfig.section, section)))
      .returning();
    return row;
  }
}

export const hrFieldDefinitionService = new HrFieldDefinitionService();
