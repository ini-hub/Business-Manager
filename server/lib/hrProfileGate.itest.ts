import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  hrSectionConfig, hrFieldDefinitions, hrFieldValues,
  hrEmergencyContacts, hrGuarantorForms,
} from "@shared/schema";
import { seedDefaultHrConfig } from "./hrDefaults";
import { isHrProfileComplete } from "./hrProfileGate";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture } from "../test-support/integration-db";

/**
 * The gate's behavior lives in a join across hr_section_config,
 * hr_field_definitions/hr_field_values and hr_emergency_contacts/
 * hr_guarantor_forms - not observable from a pure function. Covers the
 * default-config case (personal/emergency/guarantor required), that
 * disabling a section makes it a no-op even if incomplete, and that each
 * required section is independently satisfied.
 */

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  await seedDefaultHrConfig(f.businessId);
  return f;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(hrGuarantorForms).where(eq(hrGuarantorForms.staffId, f.staffId));
    await db.delete(hrEmergencyContacts).where(eq(hrEmergencyContacts.staffId, f.staffId));
    await db.delete(hrFieldValues).where(eq(hrFieldValues.staffId, f.staffId));
    await db.delete(hrFieldDefinitions).where(eq(hrFieldDefinitions.businessId, f.businessId));
    await db.delete(hrSectionConfig).where(eq(hrSectionConfig.businessId, f.businessId));
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("isHrProfileComplete", () => {
  it("is incomplete by default on the structural sections (emergency/guarantor) - personal has no required fields until an admin sets one", async () => {
    // Seeding marks the "personal" section required-for-onboarding, but none
    // of its seeded fields are individually required by default (per the
    // product decision: section-level "required" and field-level "required"
    // are configured separately by the super admin) - so with zero required
    // fields, hasMissingRequiredFieldValues has nothing to find missing.
    // See the next test for the case once a field is marked required.
    const f = await newFixture();
    const result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.complete).toBe(false);
    expect(result.outstandingSections.sort()).toEqual(["emergency", "guarantor"]);
  });

  it("adds 'personal' to outstanding once an admin marks at least one personal field required and it's unfilled", async () => {
    const f = await newFixture();
    const personalFields = await db.select().from(hrFieldDefinitions)
      .where(eq(hrFieldDefinitions.businessId, f.businessId));
    const [someField] = personalFields.filter((field) => field.section === "personal");
    await db.update(hrFieldDefinitions).set({ isRequired: true }).where(eq(hrFieldDefinitions.id, someField.id));

    const result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.outstandingSections).toContain("personal");
  });

  it("drops 'personal' once every required personal field has a value", async () => {
    const f = await newFixture();
    await db.update(hrFieldDefinitions)
      .set({ isRequired: true })
      .where(eq(hrFieldDefinitions.businessId, f.businessId));

    const requiredFields = await db.select().from(hrFieldDefinitions)
      .where(eq(hrFieldDefinitions.businessId, f.businessId));
    const personalFields = requiredFields.filter((field) => field.section === "personal");

    for (const field of personalFields) {
      await db.insert(hrFieldValues).values({ staffId: f.staffId, fieldDefinitionId: field.id, valueText: "filled" });
    }

    const result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.outstandingSections).not.toContain("personal");
  });

  it("treats a disabled section as satisfied even with nothing filled in", async () => {
    const f = await newFixture();
    await db.update(hrSectionConfig)
      .set({ isEnabled: false })
      .where(eq(hrSectionConfig.businessId, f.businessId));

    const result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.complete).toBe(true);
  });

  it("drops 'emergency' once at least one contact exists", async () => {
    const f = await newFixture();
    await db.insert(hrEmergencyContacts).values({ staffId: f.staffId, name: "Next of Kin" });
    const result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.outstandingSections).not.toContain("emergency");
  });

  it("only drops 'guarantor' once the form status is 'signed'", async () => {
    const f = await newFixture();
    await db.insert(hrGuarantorForms).values({ staffId: f.staffId, status: "awaiting_guarantor" });
    let result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.outstandingSections).toContain("guarantor");

    await db.update(hrGuarantorForms).set({ status: "signed" }).where(eq(hrGuarantorForms.staffId, f.staffId));
    result = await isHrProfileComplete(f.staffId, f.businessId);
    expect(result.outstandingSections).not.toContain("guarantor");
  });
});
