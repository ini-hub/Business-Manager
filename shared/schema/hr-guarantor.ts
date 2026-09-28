import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0072_hr_guarantor_signing.sql and
// migrations/0073_hr_guarantor_split_and_signature_image.sql for the full
// rationale. This mirrors shared/schema/staff-contracts.ts (one row per
// staff, immutable versioned content, append-only signatures) with two
// deliberate deviations:
//
//   1. The guarantor is not a users row, so their step is reached through an
//      unauthenticated, short-lived signed-token link (see server/auth.ts
//      guarantor token family), not a login-gated POST.
//   2. The form is filled in two disjoint steps by two different people -
//      the employee only ever fills Employee + Next of Kin data (the
//      "initiate" step); the guarantor section (identity, business info,
//      eligibility checklist, ID/photo, and the signature itself) can only
//      ever be filled by the actual guarantor, via the link the employee
//      shares with them. GuarantorFormService.fillAndSign is the ONE place
//      guarantor-* columns are ever written, and it refuses to run a second
//      time (status must be exactly "awaiting_guarantor") - so "the
//      guarantor can only fill this once, and it's immutable after" is
//      enforced by a status guard, not a second version row.
//
// Status lifecycle: pending_submission (nothing filled yet) ->
// awaiting_guarantor (employee has submitted Employee+NOK, guarantor link is
// live) -> signed (guarantor filled + signed, immutable) | declined.
export const guarantorFormStatusEnum = ["pending_submission", "awaiting_guarantor", "signed", "declined"] as const;
export type GuarantorFormStatus = typeof guarantorFormStatusEnum[number];

export const guarantorPartyEnum = ["employee", "next_of_kin", "guarantor"] as const;
export type GuarantorParty = typeof guarantorPartyEnum[number];

export const hrGuarantorForms = pgTable("hr_guarantor_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().unique().references(() => staff.id),
  currentVersionId: varchar("current_version_id"),
  status: text("status").notNull().default("pending_submission"),
  // Where to deliver the signing link - routing metadata the employee
  // provides at initiate time, not part of the guarantor's own (immutable,
  // guarantor-filled) legal content on hr_guarantor_form_versions. Lives
  // here rather than on the version so re-initiating to fix a wrong email
  // doesn't require superseding a version. See
  // server/services/GuarantorFormService.initiate and
  // server/email.ts sendGuarantorSigningRequestEmail.
  guarantorContactEmail: text("guarantor_contact_email"),
  guarantorContactPhone: text("guarantor_contact_phone"),
  declinedAt: timestamp("declined_at"),
  declinedReason: text("declined_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_guarantor_forms_status").on(table.status),
]);

// Immutable snapshot of all 3 parties' data, submitted once by the employee.
// contentHash is the same immutability anchor idea as staff_contract_versions.
export const hrGuarantorFormVersions = pgTable("hr_guarantor_form_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guarantorFormId: varchar("guarantor_form_id").notNull().references(() => hrGuarantorForms.id),
  versionNumber: integer("version_number").notNull(),

  employeeTitle: text("employee_title"),
  employeeSurname: text("employee_surname"),
  employeeOtherNames: text("employee_other_names"),
  employeeDob: text("employee_dob"),
  employeeNin: text("employee_nin"),
  employeeAddress: text("employee_address"),
  employeeAddressCountry: text("employee_address_country"), // isoCode - see client/src/lib/location-data.ts
  employeeAddressState: text("employee_address_state"), // isoCode
  employeeAddressCity: text("employee_address_city"), // name - LGA for Nigeria, city elsewhere
  employeeNearestBusStop: text("employee_nearest_bus_stop"),
  employeeLandmark: text("employee_landmark"),
  employeeMobile: text("employee_mobile"),
  employeeEmail: text("employee_email"),

  nokTitle: text("nok_title"),
  nokSurname: text("nok_surname"),
  nokOtherNames: text("nok_other_names"),
  nokDob: text("nok_dob"),
  nokNin: text("nok_nin"),
  nokAddress: text("nok_address"),
  nokAddressCountry: text("nok_address_country"),
  nokAddressState: text("nok_address_state"),
  nokAddressCity: text("nok_address_city"),
  nokNearestBusStop: text("nok_nearest_bus_stop"),
  nokLandmark: text("nok_landmark"),
  nokMobile: text("nok_mobile"),
  nokEmail: text("nok_email"),
  nokRelationship: text("nok_relationship"), // e.g. "Sister", "Uncle" - required by initiateGuarantorFormSchema but had no column until migration 0081

  guarantorTitle: text("guarantor_title"),
  guarantorSurname: text("guarantor_surname"),
  guarantorOtherNames: text("guarantor_other_names"),
  guarantorDob: text("guarantor_dob"),
  guarantorNin: text("guarantor_nin"),
  guarantorAddress: text("guarantor_address"),
  guarantorAddressCountry: text("guarantor_address_country"),
  guarantorAddressState: text("guarantor_address_state"),
  guarantorAddressCity: text("guarantor_address_city"),
  guarantorNearestBusStop: text("guarantor_nearest_bus_stop"),
  guarantorLandmark: text("guarantor_landmark"),
  guarantorMobile: text("guarantor_mobile"),
  guarantorEmail: text("guarantor_email"),
  guarantorBusinessName: text("guarantor_business_name"),
  guarantorBusinessAddress: text("guarantor_business_address"),
  guarantorOccupation: text("guarantor_occupation"),
  guarantorJobGrade: text("guarantor_job_grade"),
  guarantorOfficialEmail: text("guarantor_official_email"),

  eligibilityChecklist: jsonb("eligibility_checklist").notNull(), // {label: boolean} - hard-coded checklist, not admin-configurable
  contentHash: text("content_hash").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  supersededAt: timestamp("superseded_at"),
}, (table) => [
  unique("hr_guarantor_form_versions_form_version_unique").on(table.guarantorFormId, table.versionNumber),
  index("idx_hr_guarantor_form_versions_form").on(table.guarantorFormId),
]);

// One row per uploaded ID doc / photo, keyed by which of the 3 parties it belongs to.
export const hrGuarantorFormDocuments = pgTable("hr_guarantor_form_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guarantorFormVersionId: varchar("guarantor_form_version_id").notNull().references(() => hrGuarantorFormVersions.id),
  party: text("party").notNull(), // guarantorPartyEnum
  docType: text("doc_type").notNull(), // 'id_document' | 'photo'
  storageKey: text("storage_key").notNull(),
  fileMimeType: text("file_mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  fileOriginalName: text("file_original_name").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_guarantor_form_documents_version").on(table.guarantorFormVersionId),
]);

// Append-only, matches staff_contract_signatures shape plus the
// declaration-specific fields from the attached form template.
export const hrGuarantorFormSignatures = pgTable("hr_guarantor_form_signatures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guarantorFormId: varchar("guarantor_form_id").notNull().references(() => hrGuarantorForms.id),
  guarantorFormVersionId: varchar("guarantor_form_version_id").notNull().references(() => hrGuarantorFormVersions.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id), // denormalized, avoids a join
  // Printed name for the record - no longer the signature artifact itself
  // (see signatureImageStorageKey below). Kept because a legible printed
  // name next to a photographed signature is standard practice on the
  // physical form this digitizes.
  printedFullName: text("printed_full_name").notNull(),
  // The actual signature: a photographed/uploaded image of the guarantor's
  // handwritten signature, not a typed name - materially harder to repudiate
  // or submit on someone else's behalf than a text field, which is the
  // whole reason this replaced the original typed-name-as-signature design.
  signatureImageStorageKey: text("signature_image_storage_key").notNull(),
  signatureImageMimeType: text("signature_image_mime_type").notNull(),
  signatureImageSizeBytes: integer("signature_image_size_bytes").notNull(),
  yearsKnownEmployee: integer("years_known_employee").notNull(),
  relationshipToEmployee: text("relationship_to_employee").notNull(),
  affirmedReadAndAgree: boolean("affirmed_read_and_agree").notNull(),
  acceptsLiability: boolean("accepts_liability").notNull(),
  consentedElectronicSignature: boolean("consented_electronic_signature").notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  contentHashAtSigning: text("content_hash_at_signing").notNull(),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_guarantor_form_signatures_staff").on(table.staffId),
]);

export const hrGuarantorFormsRelations = relations(hrGuarantorForms, ({ one, many }) => ({
  staff: one(staff, { fields: [hrGuarantorForms.staffId], references: [staff.id] }),
  currentVersion: one(hrGuarantorFormVersions, {
    fields: [hrGuarantorForms.currentVersionId],
    references: [hrGuarantorFormVersions.id],
  }),
  versions: many(hrGuarantorFormVersions),
}));
export const hrGuarantorFormVersionsRelations = relations(hrGuarantorFormVersions, ({ one, many }) => ({
  form: one(hrGuarantorForms, { fields: [hrGuarantorFormVersions.guarantorFormId], references: [hrGuarantorForms.id] }),
  documents: many(hrGuarantorFormDocuments),
}));
export const hrGuarantorFormDocumentsRelations = relations(hrGuarantorFormDocuments, ({ one }) => ({
  version: one(hrGuarantorFormVersions, {
    fields: [hrGuarantorFormDocuments.guarantorFormVersionId],
    references: [hrGuarantorFormVersions.id],
  }),
}));
export const hrGuarantorFormSignaturesRelations = relations(hrGuarantorFormSignatures, ({ one }) => ({
  form: one(hrGuarantorForms, { fields: [hrGuarantorFormSignatures.guarantorFormId], references: [hrGuarantorForms.id] }),
  version: one(hrGuarantorFormVersions, {
    fields: [hrGuarantorFormSignatures.guarantorFormVersionId],
    references: [hrGuarantorFormVersions.id],
  }),
}));

export type HrGuarantorForm = typeof hrGuarantorForms.$inferSelect;
export type HrGuarantorFormVersion = typeof hrGuarantorFormVersions.$inferSelect;
export type HrGuarantorFormDocument = typeof hrGuarantorFormDocuments.$inferSelect;
export type HrGuarantorFormSignature = typeof hrGuarantorFormSignatures.$inferSelect;

// ─── API input schemas ──────────────────────────────────────────────────────

const partyDataSchema = z.object({
  title: z.string().trim().min(1),
  surname: z.string().trim().min(1),
  otherNames: z.string().trim().min(1),
  dob: z.string().trim().min(1), // ISO date (YYYY-MM-DD) - a real date input on the client, see LocationSelect's sibling date-picker fix
  nin: z.string().trim().min(1),
  address: z.string().trim().min(1), // street line - Country/State/LGA are the fields below
  addressCountry: z.string().trim().optional(), // isoCode, see client/src/lib/location-data.ts
  addressState: z.string().trim().optional(), // isoCode
  addressCity: z.string().trim().optional(), // name - LGA for Nigeria, city elsewhere
  nearestBusStop: z.string().trim().optional(),
  landmark: z.string().trim().optional(),
  mobile: z.string().trim().min(1),
  email: z.string().trim().email("Enter a valid email address, or leave it blank").optional().or(z.literal("")),
});

const documentInputSchema = z.object({
  party: z.enum(guarantorPartyEnum),
  docType: z.enum(["id_document", "photo"]),
  storageKey: z.string().min(1),
  fileMimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  fileOriginalName: z.string().min(1),
});

// What the EMPLOYEE submits - Employee + Next of Kin data only, plus where
// to deliver the signing link. Deliberately excludes every guarantor-*
// field: that section is not the employee's data to enter, and this schema
// being unable to carry it is what makes the separation structural rather
// than just a UI convention.
export const initiateGuarantorFormSchema = z.object({
  employee: partyDataSchema,
  nextOfKin: partyDataSchema.extend({ relationship: z.string().trim().min(1) }),
  documents: z.array(documentInputSchema.extend({ party: z.enum(["employee", "next_of_kin"]) })).optional().default([]),
  guarantorContactEmail: z.string().trim().email("A valid email for your guarantor is required so we can send them the signing link"),
  guarantorContactPhone: z.string().trim().optional(),
});
export type InitiateGuarantorFormInput = z.infer<typeof initiateGuarantorFormSchema>;

// What the GUARANTOR submits - their own identity/business data, the
// eligibility checklist (these are attestations about the guarantor, so the
// guarantor answers them, not the employee), their own ID/photo uploads,
// and the signature image. This single call both fills the guarantor
// section and signs it - see GuarantorFormService.fillAndSign for why that's
// one atomic, one-time action rather than a separate fill-then-sign pair.
export const fillAndSignGuarantorFormSchema = z.object({
  guarantor: partyDataSchema.extend({
    businessName: z.string().trim().min(1),
    businessAddress: z.string().trim().min(1),
    occupation: z.string().trim().min(1),
    jobGrade: z.string().trim().min(1),
    officialEmail: z.string().trim().email(),
  }),
  eligibilityChecklist: z.record(z.string(), z.boolean()),
  documents: z.array(documentInputSchema.extend({ party: z.literal("guarantor") })).min(1, "At least one ID document is required"),
  printedFullName: z.string().trim().min(1, "Your printed name is required"),
  signatureImage: z.object({
    storageKey: z.string().min(1),
    fileMimeType: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
  }),
  yearsKnownEmployee: z.number().int().min(0),
  relationshipToEmployee: z.string().trim().min(1),
  affirmedReadAndAgree: z.literal(true, {
    errorMap: () => ({ message: "You must confirm you have read and agree to the declaration" }),
  }),
  acceptsLiability: z.literal(true, {
    errorMap: () => ({ message: "You must accept the liability terms to sign" }),
  }),
  consentedElectronicSignature: z.literal(true, {
    errorMap: () => ({ message: "You must consent to sign electronically" }),
  }),
});
export type FillAndSignGuarantorFormInput = z.infer<typeof fillAndSignGuarantorFormSchema>;

export const declineGuarantorFormSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type DeclineGuarantorFormInput = z.infer<typeof declineGuarantorFormSchema>;

export const ALLOWED_GUARANTOR_DOC_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_GUARANTOR_DOC_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
