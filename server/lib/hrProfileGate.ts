import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  hrSectionConfig,
  hrFieldDefinitions,
  hrFieldValues,
  hrEmergencyContacts,
  hrGuarantorForms,
} from "@shared/schema";

export interface HrProfileGateResult {
  complete: boolean;
  /** Which required-and-enabled sections are still outstanding, for the UI to route to. */
  outstandingSections: Array<"personal" | "emergency" | "guarantor">;
  /** Every required-and-enabled section, regardless of completion, so the UI can keep showing a section (e.g. to display already-saved data) after it stops being outstanding. */
  requiredSections: Array<"personal" | "emergency" | "guarantor">;
  /** Human-readable reason per outstanding section, so callers can surface *why* (e.g. guarantor invited but not yet signed) instead of just *what*. */
  outstandingReasons: Partial<Record<"personal" | "emergency" | "guarantor", string>>;
}

/**
 * Whether staffId has satisfied every section this businessId has marked
 * both enabled and required-for-onboarding (hr_section_config, seeded with
 * defaults by migration 0065). Only ever called at session-issuance choke
 * points (login, activation, org-switch) in server/lib/authFlow.ts - never
 * per-request - so an admin editing requirements later never retroactively
 * locks out an already-active member. Fully config-driven: a missing
 * hr_section_config row for a section is treated as "not required" rather
 * than falling back to a hard-coded default, since the seed migration
 * guarantees every business has a row for all 8 sections.
 */
export async function isHrProfileComplete(staffId: string, businessId: string): Promise<HrProfileGateResult> {
  const configs = await db.select().from(hrSectionConfig).where(eq(hrSectionConfig.businessId, businessId));
  const requiredSections = new Set(
    configs.filter((c) => c.isEnabled && c.isRequiredForOnboarding).map((c) => c.section),
  );

  const outstanding: Array<"personal" | "emergency" | "guarantor"> = [];
  const outstandingReasons: Partial<Record<"personal" | "emergency" | "guarantor", string>> = {};

  if (requiredSections.has("personal")) {
    const missing = await hasMissingRequiredFieldValues(staffId, businessId, "personal");
    if (missing) {
      outstanding.push("personal");
      outstandingReasons.personal = "Some required personal information fields are still empty.";
    }
  }

  if (requiredSections.has("emergency")) {
    const [contact] = await db.select({ id: hrEmergencyContacts.id })
      .from(hrEmergencyContacts)
      .where(eq(hrEmergencyContacts.staffId, staffId))
      .limit(1);
    if (!contact) {
      outstanding.push("emergency");
      outstandingReasons.emergency = "You haven't added an emergency contact yet.";
    }
  }

  if (requiredSections.has("guarantor")) {
    const [form] = await db.select({ status: hrGuarantorForms.status })
      .from(hrGuarantorForms)
      .where(eq(hrGuarantorForms.staffId, staffId));
    if (form?.status !== "signed") {
      outstanding.push("guarantor");
      outstandingReasons.guarantor =
        !form || form.status === "pending_submission"
          ? "You haven't submitted your guarantor's details yet."
          : form.status === "declined"
          ? "Your guarantor declined to sign. Please submit a new guarantor."
          : "We're still waiting on your guarantor to open their link and sign - they've been sent an email with it.";
    }
  }

  return {
    complete: outstanding.length === 0,
    outstandingSections: outstanding,
    requiredSections: (["personal", "emergency", "guarantor"] as const).filter((s) => requiredSections.has(s)),
    outstandingReasons,
  };
}

async function hasMissingRequiredFieldValues(
  staffId: string,
  businessId: string,
  section: "personal" | "job_current",
): Promise<boolean> {
  const requiredFields = await db.select({ id: hrFieldDefinitions.id })
    .from(hrFieldDefinitions)
    .where(and(
      eq(hrFieldDefinitions.businessId, businessId),
      eq(hrFieldDefinitions.section, section),
      eq(hrFieldDefinitions.isEnabled, true),
      eq(hrFieldDefinitions.isRequired, true),
    ));
  if (requiredFields.length === 0) return false;

  const requiredIds = requiredFields.map((f) => f.id);
  const values = await db.select({
    fieldDefinitionId: hrFieldValues.fieldDefinitionId,
    valueText: hrFieldValues.valueText,
    valueNumber: hrFieldValues.valueNumber,
    valueDate: hrFieldValues.valueDate,
    valueBoolean: hrFieldValues.valueBoolean,
    valueJson: hrFieldValues.valueJson,
  }).from(hrFieldValues).where(and(
    eq(hrFieldValues.staffId, staffId),
    inArray(hrFieldValues.fieldDefinitionId, requiredIds),
  ));

  const filledIds = new Set(
    values.filter((v) => isFilled(v)).map((v) => v.fieldDefinitionId),
  );
  return requiredIds.some((id) => !filledIds.has(id));
}

function isFilled(v: {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
}): boolean {
  if (v.valueText !== null && v.valueText.trim() !== "") return true;
  if (v.valueNumber !== null) return true;
  if (v.valueDate !== null) return true;
  if (v.valueBoolean !== null) return true;
  if (Array.isArray(v.valueJson) && v.valueJson.length > 0) return true;
  return false;
}
