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
import { normalizePhoneForStorage, splitNormalizedPhone } from "@shared/phone-utils";
import { isUniqueViolation } from "../db-errors";

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

// "mobile_number" is the staff member's PRIMARY number and has exactly one
// home: staff.mobileNumber/countryCode (what the staff list, invites, login
// matching and the store-unique index all use). The HR field is a view onto
// it - read from staff, written through to staff - never a second stored copy
// that a mirror has to keep in step. (It used to be mirrored, and the mirror
// failed silently on a unique clash / unparseable value / bulk-upload row, so
// the list and the profile drifted.) A separate number, "work_phone", is its
// own ordinary HR field with no staff-side twin.
const STAFF_BACKED_PHONE_KEY = "mobile_number";
const staffPrimaryPhone = (staff: Staff): string | null =>
  staff.mobileNumber ? normalizePhoneForStorage(staff.mobileNumber, staff.countryCode || "+234") : null;

// The "personal" fields that duplicate data already collected (and
// compulsory) at staff creation - unlike employee_id these stay freely
// editable on the HR profile ("work_email" isn't necessarily the login
// email), so rather than locking them read-only, IdentitySync.ts mirrors
// changes on either side onto the other. See
// syncHrPersonalFieldsToStaff/syncStaffToHrPersonalFields.
const STAFF_LINKED_FIELD_KEYS = ["first_name", "last_name", "work_email"] as const;

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

    const needsStaff = definitions.some((d) => d.fieldKey in SYSTEM_MANAGED_FIELD_KEYS || d.fieldKey === STAFF_BACKED_PHONE_KEY);
    const staff = needsStaff ? await storage.getStaff(staffId) : undefined;

    return definitions.map((def) => {
      if (staff && def.fieldKey === STAFF_BACKED_PHONE_KEY) return { ...def, value: staffPrimaryPhone(staff) };
      const systemValue = staff && SYSTEM_MANAGED_FIELD_KEYS[def.fieldKey];
      return {
        ...def,
        value: systemValue ? systemValue(staff) : this.projectValue(def.fieldType, byDefId.get(def.id)),
      };
    });
  }

  /** staffId -> work phone (canonical dial-code string) for the staff list; one query for the whole page. */
  async getWorkPhones(staffIds: string[], businessId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (staffIds.length === 0) return out;
    const rows = await db.select({ staffId: hrFieldValues.staffId, value: hrFieldValues.valueText })
      .from(hrFieldValues)
      .innerJoin(hrFieldDefinitions, eq(hrFieldValues.fieldDefinitionId, hrFieldDefinitions.id))
      .where(and(
        eq(hrFieldDefinitions.businessId, businessId),
        eq(hrFieldDefinitions.fieldKey, "work_phone"),
        eq(hrFieldDefinitions.isEnabled, true),
        inArray(hrFieldValues.staffId, staffIds),
      ));
    for (const r of rows) if (r.value) out.set(r.staffId, r.value);
    return out;
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

    // Primary number: write straight to staff and fail the save loudly (e.g.
    // the number is already another staff member's at this store) instead of
    // storing a second copy that silently diverges.
    const phoneEntry = submittedValues.find((e) => defById.get(e.fieldDefinitionId)!.fieldKey === STAFF_BACKED_PHONE_KEY);
    if (phoneEntry) {
      const split = typeof phoneEntry.value === "string" && phoneEntry.value ? splitNormalizedPhone(phoneEntry.value) : undefined;
      if (!split || !split.localNumber) {
        return { ok: false, error: "Mobile number is required and must include a country code.", field: phoneEntry.fieldDefinitionId };
      }
      try {
        await storage.updateStaff(staffId, { mobileNumber: split.localNumber, countryCode: split.countryCode });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { ok: false, error: "This mobile number is already used by another staff member.", field: phoneEntry.fieldDefinitionId };
        }
        throw err;
      }
    }

    await db.transaction(async (tx) => {
      for (const entry of submittedValues) {
        const def = defById.get(entry.fieldDefinitionId)!;
        if (def.fieldKey === STAFF_BACKED_PHONE_KEY) continue;
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
