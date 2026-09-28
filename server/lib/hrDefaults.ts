import { db } from "../db";
import { hrFieldDefinitions, hrSectionConfig } from "@shared/schema";

// Mirrors migrations/0064_hr_field_definitions.sql and
// migrations/0065_hr_section_config.sql exactly - those migrations only
// backfilled businesses that already existed at deploy time. Every business
// created afterwards goes through BusinessRepository.createOrganisation,
// which calls seedDefaultHrConfig right after the insert, so this is the
// single place both paths (migration backfill, new business) have to agree
// with. Keep the two lists in sync if either changes.

const PERSONAL_FIELDS: Array<{ fieldKey: string; label: string; fieldType: string; sortOrder: number; options?: Array<{ value: string; label: string }> }> = [
  { fieldKey: "employee_id", label: "Employee ID", fieldType: "text", sortOrder: 0 },
  { fieldKey: "first_name", label: "First Name", fieldType: "text", sortOrder: 1 },
  { fieldKey: "middle_name", label: "Middle Name", fieldType: "text", sortOrder: 2 },
  { fieldKey: "last_name", label: "Last Name", fieldType: "text", sortOrder: 3 },
  { fieldKey: "date_of_birth", label: "Date of Birth", fieldType: "date", sortOrder: 4 },
  { fieldKey: "nationality", label: "Nationality", fieldType: "text", sortOrder: 5 },
  { fieldKey: "nationality_id", label: "Nationality ID", fieldType: "text", sortOrder: 6 },
  { fieldKey: "gender", label: "Gender", fieldType: "select", sortOrder: 7, options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }] },
  { fieldKey: "marital_status", label: "Marital Status", fieldType: "select", sortOrder: 8, options: [{ value: "single", label: "Single" }, { value: "married", label: "Married" }, { value: "divorced", label: "Divorced" }, { value: "widowed", label: "Widowed" }] },
  { fieldKey: "allergies", label: "Allergies", fieldType: "textarea", sortOrder: 9 },
  { fieldKey: "bvn", label: "BVN", fieldType: "text", sortOrder: 10 },
  { fieldKey: "ssn", label: "SSN", fieldType: "text", sortOrder: 11 },
  { fieldKey: "shirt_size", label: "Shirt Size", fieldType: "select", sortOrder: 12, options: [{ value: "xs", label: "XS" }, { value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }, { value: "xl", label: "XL" }, { value: "xxl", label: "XXL" }] },
  { fieldKey: "address_street1", label: "Street 1", fieldType: "text", sortOrder: 13 },
  { fieldKey: "address_city", label: "City", fieldType: "text", sortOrder: 14 },
  { fieldKey: "address_state", label: "State", fieldType: "text", sortOrder: 15 },
  { fieldKey: "address_postcode", label: "Postcode", fieldType: "text", sortOrder: 16 },
  { fieldKey: "address_country", label: "Country", fieldType: "text", sortOrder: 17 },
  { fieldKey: "work_phone", label: "Work Phone", fieldType: "phone", sortOrder: 18 },
  { fieldKey: "work_phone_ext", label: "Work Phone Ext", fieldType: "text", sortOrder: 19 },
  { fieldKey: "mobile_number", label: "Mobile Number", fieldType: "phone", sortOrder: 20 },
  { fieldKey: "work_email", label: "Work Email", fieldType: "email", sortOrder: 21 },
  { fieldKey: "home_email", label: "Home Email", fieldType: "email", sortOrder: 22 },
  { fieldKey: "linkedin", label: "LinkedIn", fieldType: "text", sortOrder: 23 },
  { fieldKey: "x_handle", label: "X", fieldType: "text", sortOrder: 24 },
  { fieldKey: "instagram", label: "Instagram", fieldType: "text", sortOrder: 25 },
  { fieldKey: "facebook", label: "Facebook", fieldType: "text", sortOrder: 26 },
  { fieldKey: "tiktok", label: "TikTok", fieldType: "text", sortOrder: 27 },
];

const JOB_CURRENT_FIELDS: typeof PERSONAL_FIELDS = [
  { fieldKey: "hire_date", label: "Hire Date", fieldType: "date", sortOrder: 0 },
  { fieldKey: "team", label: "Team", fieldType: "text", sortOrder: 1 },
  { fieldKey: "people_business_partner", label: "People Business Partner / Manager", fieldType: "text", sortOrder: 2 },
  { fieldKey: "employment_status", label: "Employment Status", fieldType: "select", sortOrder: 3, options: [{ value: "active", label: "Active" }, { value: "on_leave", label: "On Leave" }, { value: "terminated", label: "Terminated" }] },
  { fieldKey: "confirmation_date", label: "Confirmation Date", fieldType: "date", sortOrder: 4 },
  { fieldKey: "confirmation_status", label: "Confirmation Status", fieldType: "select", sortOrder: 5, options: [{ value: "pending", label: "Pending" }, { value: "confirmed", label: "Confirmed" }] },
];

const SECTION_DEFAULTS: Array<{ section: string; isRequiredForOnboarding: boolean }> = [
  { section: "personal", isRequiredForOnboarding: true },
  { section: "job", isRequiredForOnboarding: false },
  { section: "time_off", isRequiredForOnboarding: false },
  { section: "emergency", isRequiredForOnboarding: true },
  { section: "documents", isRequiredForOnboarding: false },
  { section: "benefits", isRequiredForOnboarding: false },
  { section: "disciplinary", isRequiredForOnboarding: false },
  { section: "guarantor", isRequiredForOnboarding: true },
];

/**
 * Seeds the default HR field definitions + section config for a
 * newly-created business, so hrProfileGate.ts never finds a business with
 * no hr_section_config rows. Called once, right after
 * BusinessRepository.createOrganisation inserts the organisation row.
 * Idempotent (ON CONFLICT DO NOTHING) so it's safe to call more than once
 * for the same businessId.
 */
export async function seedDefaultHrConfig(businessId: string): Promise<void> {
  await db.insert(hrFieldDefinitions).values(
    PERSONAL_FIELDS.map((f) => ({
      businessId, section: "personal", fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType,
      options: f.options ?? null, isSystemField: true, sortOrder: f.sortOrder,
    })),
  ).onConflictDoNothing();

  await db.insert(hrFieldDefinitions).values(
    JOB_CURRENT_FIELDS.map((f) => ({
      businessId, section: "job_current", fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType,
      options: f.options ?? null, isSystemField: true, sortOrder: f.sortOrder,
    })),
  ).onConflictDoNothing();

  await db.insert(hrSectionConfig).values(
    SECTION_DEFAULTS.map((s) => ({ businessId, section: s.section, isEnabled: true, isRequiredForOnboarding: s.isRequiredForOnboarding })),
  ).onConflictDoNothing();
}
