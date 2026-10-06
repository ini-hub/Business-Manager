import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { z } from "zod";
import { organisations } from "./organisations";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0064_hr_field_definitions.sql for the full rationale.
// All HR sections are now configurable by business owners/managers.
// Each section allows custom field creation and configuration.
export const hrFieldSectionEnum = ["personal", "job_current", "time_off", "emergency", "documents", "benefits", "disciplinary", "guarantor"] as const;
export type HrFieldSection = typeof hrFieldSectionEnum[number];

export const hrFieldTypeEnum = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
  "email",
  "phone",
] as const;
export type HrFieldType = typeof hrFieldTypeEnum[number];

// One row per configurable field, per business, per section. isSystemField
// rows are seeded by the migration for every field named explicitly in the
// product spec (employeeId, firstName, ...) so a business gets a sane
// default form out of the box; a super admin may relabel/reorder/disable a
// system field but never delete it (HrFieldDefinitionService enforces this -
// deleting the row would silently orphan any hr_field_values already
// collected against it).
export const hrFieldDefinitions = pgTable("hr_field_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => organisations.id),
  section: text("section").notNull(), // hrFieldSectionEnum
  fieldKey: text("field_key").notNull(), // stable machine key, e.g. "national_id"
  label: text("label").notNull(), // admin-editable display label
  fieldType: text("field_type").notNull(), // hrFieldTypeEnum
  options: jsonb("options"), // [{value, label}] - select/multiselect only
  validation: jsonb("validation"), // HrFieldValidation - format/range rules, per fieldType. See shared/hr-field-validation.ts
  isRequired: boolean("is_required").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isSystemField: boolean("is_system_field").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("hr_field_definitions_business_section_key_unique").on(table.businessId, table.section, table.fieldKey),
  index("idx_hr_field_definitions_business_section").on(table.businessId, table.section, table.sortOrder),
]);

// Typed value columns, not a single jsonb blob: the field's fieldType
// deterministically says which column to read/write, so the onboarding
// gate's required-field check and any future "staff missing BVN" report
// stay simple NULL checks instead of jsonb ->> casts. valueJson is reserved
// for multiselect only, where a real array is unavoidable.
export const hrFieldValues = pgTable("hr_field_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  fieldDefinitionId: varchar("field_definition_id").notNull().references(() => hrFieldDefinitions.id),
  valueText: text("value_text"),
  valueNumber: numeric("value_number", { precision: 18, scale: 4, mode: "number" }),
  valueDate: timestamp("value_date"),
  valueBoolean: boolean("value_boolean"),
  valueJson: jsonb("value_json"), // multiselect only
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("hr_field_values_staff_field_unique").on(table.staffId, table.fieldDefinitionId),
  index("idx_hr_field_values_staff").on(table.staffId),
]);

export const hrFieldDefinitionsRelations = relations(hrFieldDefinitions, ({ one, many }) => ({
  business: one(organisations, {
    fields: [hrFieldDefinitions.businessId],
    references: [organisations.id],
  }),
  values: many(hrFieldValues),
}));

export const hrFieldValuesRelations = relations(hrFieldValues, ({ one }) => ({
  staff: one(staff, {
    fields: [hrFieldValues.staffId],
    references: [staff.id],
  }),
  fieldDefinition: one(hrFieldDefinitions, {
    fields: [hrFieldValues.fieldDefinitionId],
    references: [hrFieldDefinitions.id],
  }),
}));

export type HrFieldDefinition = typeof hrFieldDefinitions.$inferSelect;
export type InsertHrFieldDefinition = typeof hrFieldDefinitions.$inferInsert;
export type HrFieldValue = typeof hrFieldValues.$inferSelect;
export type InsertHrFieldValue = typeof hrFieldValues.$inferInsert;

// ─── API input schemas ──────────────────────────────────────────────────────

export const hrFieldOptionSchema = z.object({
  value: z.string().trim().min(1),
  label: z.string().trim().min(1),
});

// Google-Forms-style "response validation", one bag of optional rules whose
// applicable subset depends on the field's fieldType - see
// shared/hr-field-validation.ts for what each rule means per type and how
// it's enforced (shared between DynamicFieldForm's client-side check and
// HrPersonalProfileService's server-side one, so they can never drift).
export const hrFieldValidationSchema = z.object({
  minLength: z.number().int().min(0).optional(), // text, textarea, phone
  maxLength: z.number().int().min(1).optional(), // text, textarea, phone
  min: z.number().optional(), // number
  max: z.number().optional(), // number
  integerOnly: z.boolean().optional(), // number
  pattern: z.string().trim().min(1).optional(), // text, textarea - a regex source
  patternErrorMessage: z.string().trim().min(1).optional(), // shown when pattern fails
}).refine(
  (v) => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength,
  { message: "Minimum length must be less than or equal to maximum length", path: ["minLength"] },
).refine(
  (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
  { message: "Minimum value must be less than or equal to maximum value", path: ["min"] },
).refine(
  (v) => {
    if (!v.pattern) return true;
    try { new RegExp(v.pattern); return true; } catch { return false; }
  },
  { message: "Not a valid regular expression", path: ["pattern"] },
);
export type HrFieldValidation = z.infer<typeof hrFieldValidationSchema>;

export const createHrFieldDefinitionSchema = z.object({
  fieldKey: z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only"),
  label: z.string().trim().min(1),
  fieldType: z.enum(hrFieldTypeEnum),
  options: z.array(hrFieldOptionSchema).optional(),
  validation: hrFieldValidationSchema.optional(),
  isRequired: z.boolean().optional().default(false),
  isEnabled: z.boolean().optional().default(true),
}).refine(
  (data) => !["select", "multiselect"].includes(data.fieldType) || (data.options && data.options.length > 0),
  { message: "Select fields require at least one option", path: ["options"] },
);
export type CreateHrFieldDefinitionInput = z.infer<typeof createHrFieldDefinitionSchema>;

export const updateHrFieldDefinitionSchema = z.object({
  label: z.string().trim().min(1).optional(),
  options: z.array(hrFieldOptionSchema).optional(),
  validation: hrFieldValidationSchema.nullable().optional(),
  isRequired: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});
export type UpdateHrFieldDefinitionInput = z.infer<typeof updateHrFieldDefinitionSchema>;

export const reorderHrFieldDefinitionsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});
export type ReorderHrFieldDefinitionsInput = z.infer<typeof reorderHrFieldDefinitionsSchema>;

// Value builder per fieldType - which column a submitted value lands in.
export const hrFieldValueInputSchema = z.object({
  fieldDefinitionId: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
});
export const upsertHrFieldValuesSchema = z.object({
  values: z.array(hrFieldValueInputSchema),
});
export type UpsertHrFieldValuesInput = z.infer<typeof upsertHrFieldValuesSchema>;
