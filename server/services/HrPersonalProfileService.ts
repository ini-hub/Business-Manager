import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  hrFieldDefinitions,
  hrFieldValues,
  type HrFieldDefinition,
  type HrFieldValue,
  type HrFieldSection,
  type UpsertHrFieldValuesInput,
  type HrFieldType,
  type HrFieldValidation,
} from "@shared/schema";
import { validateHrFieldValue, isFieldValueEmpty, type HrFieldValueInput } from "@shared/hr-field-validation";
import type { Staff } from "@shared/schema";

// Fields whose value is derived from real staff data rather than typed in -
// "employee_id" mirrors staff.staffNumber (StaffRepository's store-scoped
// auto-numbering, e.g. "EXB-001"), so the HR profile always shows the
// employee's actual ID instead of a free-text field they could fill in
// themselves or leave blank/inconsistent with the real one. getValues
// overrides these at read time; upsertValues drops them at write time so a
// stale/tampered client payload can never overwrite the real value.
const SYSTEM_MANAGED_FIELD_KEYS: Record<string, (staff: Staff) => string | null> = {
  employee_id: (staff) => staff.staffNumber,
};

// The "personal" fields that duplicate data already collected (and
// compulsory) at staff creation - unlike employee_id these stay freely
// editable on the HR profile (a home address/mobile can legitimately change,
// and "work_email" isn't necessarily the login email), so rather than
// locking them read-only, IdentitySync.ts mirrors changes on either side
// onto the other. See syncHrPersonalFieldsToStaff/syncStaffToHrPersonalFields.
const STAFF_LINKED_FIELD_KEYS = ["first_name", "last_name", "work_email", "mobile_number"] as const;

/**
 * Owns the dynamic field builder's read/write path: fetching a business's
 * field definitions for "personal" / "job_current" and upserting a staff
 * member's values against them. Deliberately does not own field-definition
 * CRUD (add/reorder/delete custom fields) - that's admin-only and lives in
 * HrFieldDefinitionService.
 */
class HrPersonalProfileService {
  async getBusinessIdForStaff(staffId: string): Promise<string | undefined> {
    const staff = await storage.getStaff(staffId);
    if (!staff) return undefined;
    const store = await storage.getStore(staff.storeId);
    return store?.businessId;
  }

  async getFieldDefinitions(businessId: string, section: HrFieldSection): Promise<HrFieldDefinition[]> {
    return db.select().from(hrFieldDefinitions)
      .where(and(
        eq(hrFieldDefinitions.businessId, businessId),
        eq(hrFieldDefinitions.section, section),
        eq(hrFieldDefinitions.isEnabled, true),
      ))
      .orderBy(hrFieldDefinitions.sortOrder);
  }

  async getValues(staffId: string, section: HrFieldSection, businessId: string): Promise<Array<HrFieldDefinition & { value: string | number | boolean | string[] | null }>> {
    const definitions = await this.getFieldDefinitions(businessId, section);
    if (definitions.length === 0) return [];
    const defIds = definitions.map((d) => d.id);
    const values = await db.select().from(hrFieldValues)
      .where(and(eq(hrFieldValues.staffId, staffId), inArray(hrFieldValues.fieldDefinitionId, defIds)));
    const byDefId = new Map(values.map((v) => [v.fieldDefinitionId, v]));

    const needsStaff = definitions.some((d) => d.fieldKey in SYSTEM_MANAGED_FIELD_KEYS);
    const staff = needsStaff ? await storage.getStaff(staffId) : undefined;

    return definitions.map((def) => {
      const systemValue = staff && SYSTEM_MANAGED_FIELD_KEYS[def.fieldKey];
      return {
        ...def,
        value: systemValue ? systemValue(staff) : this.projectValue(def.fieldType, byDefId.get(def.id)),
      };
    });
  }

  /** One transaction, one row per submitted field - upsert semantics via ON CONFLICT. */
  async upsertValues(params: {
    staffId: string;
    businessId: string;
    section: HrFieldSection;
    updatedByUserId: string;
    input: UpsertHrFieldValuesInput;
  }): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
    const { staffId, businessId, section, updatedByUserId, input } = params;
    const definitions = await this.getFieldDefinitions(businessId, section);
    const defById = new Map(definitions.map((d) => [d.id, d]));

    const submittedValues = input.values.filter((entry) => {
      const def = defById.get(entry.fieldDefinitionId);
      return !(def && def.fieldKey in SYSTEM_MANAGED_FIELD_KEYS);
    });

    for (const entry of submittedValues) {
      const def = defById.get(entry.fieldDefinitionId);
      if (!def) {
        return { ok: false, error: `Unknown or disabled field: ${entry.fieldDefinitionId}`, field: entry.fieldDefinitionId };
      }
      if (def.isRequired && isFieldValueEmpty(entry.value)) {
        return { ok: false, error: `${def.label} is required.`, field: entry.fieldDefinitionId };
      }
      if (def.fieldType === "select" && entry.value !== null && typeof entry.value === "string") {
        const allowed = (def.options as Array<{ value: string }> | null)?.map((o) => o.value) ?? [];
        if (!allowed.includes(entry.value)) {
          return { ok: false, error: `"${entry.value}" is not a valid option for ${def.label}.`, field: entry.fieldDefinitionId };
        }
      }
      const result = validateHrFieldValue(
        def.fieldType as HrFieldType,
        entry.value as HrFieldValueInput,
        def.validation as HrFieldValidation | null,
        def.label,
      );
      if (!result.ok) {
        return { ok: false, error: result.error, field: entry.fieldDefinitionId };
      }
    }

    await db.transaction(async (tx) => {
      for (const entry of submittedValues) {
        const def = defById.get(entry.fieldDefinitionId)!;
        const columns = this.buildColumns(def.fieldType, entry.value);
        await tx.insert(hrFieldValues).values({
          staffId,
          fieldDefinitionId: entry.fieldDefinitionId,
          updatedByUserId,
          ...columns,
        }).onConflictDoUpdate({
          target: [hrFieldValues.staffId, hrFieldValues.fieldDefinitionId],
          set: { ...columns, updatedByUserId, updatedAt: new Date() },
        });
      }
    });

    // Keep staff.firstName/lastName/email/mobileNumber in step - see
    // IdentitySync. Dynamic import breaks the otherwise-circular module
    // dependency (IdentitySync also calls back into this service for the
    // opposite direction). Both sides store first/last name separately, so
    // this is a direct, lossless mirror - no joining into a combined string.
    const touchedKeys = new Set(submittedValues.map((e) => defById.get(e.fieldDefinitionId)!.fieldKey));
    if (section === "personal" && STAFF_LINKED_FIELD_KEYS.some((k) => touchedKeys.has(k))) {
      const merged = await this.getValues(staffId, "personal", businessId);
      const byKey = new Map(merged.map((f) => [f.fieldKey, f.value]));
      const { syncHrPersonalFieldsToStaff } = await import("./IdentitySync");
      await syncHrPersonalFieldsToStaff(staffId, {
        firstName: (byKey.get("first_name") as string | null) ?? undefined,
        lastName: (byKey.get("last_name") as string | null) ?? undefined,
        email: (byKey.get("work_email") as string | null) ?? undefined,
        mobileNumber: (byKey.get("mobile_number") as string | null) ?? undefined,
      });
    }

    return { ok: true };
  }

  /**
   * Sets one or more field values by fieldKey rather than fieldDefinitionId -
   * used by IdentitySync's staff -> HR-profile mirror, which knows the
   * staff record's field names, not this business's field-definition UUIDs.
   * Skips (rather than errors on) a fieldKey with no enabled definition, since
   * an admin may have disabled/renamed a normally-system-linked field.
   */
  async setValuesByFieldKey(params: {
    staffId: string;
    businessId: string;
    section: HrFieldSection;
    updatedByUserId: string | undefined;
    values: Record<string, string | null>;
  }): Promise<void> {
    const definitions = await this.getFieldDefinitions(params.businessId, params.section);
    const defByKey = new Map(definitions.map((d) => [d.fieldKey, d]));
    for (const [fieldKey, value] of Object.entries(params.values)) {
      const def = defByKey.get(fieldKey);
      if (!def) continue;
      const columns = this.buildColumns(def.fieldType, value);
      await db.insert(hrFieldValues).values({
        staffId: params.staffId,
        fieldDefinitionId: def.id,
        updatedByUserId: params.updatedByUserId,
        ...columns,
      }).onConflictDoUpdate({
        target: [hrFieldValues.staffId, hrFieldValues.fieldDefinitionId],
        set: { ...columns, updatedByUserId: params.updatedByUserId, updatedAt: new Date() },
      });
    }
  }

  private projectValue(
    fieldType: string,
    row: HrFieldValue | undefined,
  ): string | number | boolean | string[] | null {
    if (!row) return null;
    switch (fieldType) {
      case "number":
        return row.valueNumber ?? null;
      case "date":
        return row.valueDate ? row.valueDate.toISOString().slice(0, 10) : null;
      case "boolean":
        return row.valueBoolean ?? null;
      case "multiselect":
        return Array.isArray(row.valueJson) ? (row.valueJson as string[]) : null;
      default:
        return row.valueText ?? null;
    }
  }

  private buildColumns(fieldType: string, value: unknown) {
    const empty = {
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueDate: null as Date | null,
      valueBoolean: null as boolean | null,
      valueJson: null as unknown,
    };
    if (value === null || value === undefined) return empty;
    switch (fieldType) {
      case "number":
        return { ...empty, valueNumber: Number(value) };
      case "date":
        return { ...empty, valueDate: new Date(String(value)) };
      case "boolean":
        return { ...empty, valueBoolean: Boolean(value) };
      case "multiselect":
        return { ...empty, valueJson: Array.isArray(value) ? value : [value] };
      default:
        return { ...empty, valueText: String(value) };
    }
  }
}

export const hrPersonalProfileService = new HrPersonalProfileService();
