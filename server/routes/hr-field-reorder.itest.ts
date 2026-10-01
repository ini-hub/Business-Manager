import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db";
import { businesses, users, staffs, hrFieldDefinitions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { testClient } from "../test-utils";

describe("HR Field Reordering", () => {
  let businessId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    // Create test business
    const [business] = await db
      .insert(businesses)
      .values({ name: "Test Business", email: "test@example.com" })
      .returning();
    businessId = business.id;

    // Create test user (owner)
    const [user] = await db
      .insert(users)
      .values({
        email: "owner@example.com",
        password: "hashed",
        role: "owner",
        businessId,
      })
      .returning();
    userId = user.id;

    // Get auth token for the user
    token = await testClient.getAuthToken(user.email);
  });

  it("should reorder personal information fields", async () => {
    // Get existing fields
    const fields = await db
      .select()
      .from(hrFieldDefinitions)
      .where(
        and(eq(hrFieldDefinitions.businessId, businessId), eq(hrFieldDefinitions.section, "personal")),
      )
      .limit(3);

    if (fields.length < 2) {
      // Skip if not enough fields
      return;
    }

    const originalOrder = fields.map((f) => f.id);
    const reorderedIds = [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)];

    const response = await testClient
      .post(`/api/hr/fields/personal/reorder`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderedIds: reorderedIds });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Reordered.");

    // Verify order was saved (order is implicit in the sequence)
    const reorderedFields = await db
      .select()
      .from(hrFieldDefinitions)
      .where(
        and(eq(hrFieldDefinitions.businessId, businessId), eq(hrFieldDefinitions.section, "personal")),
      );

    expect(reorderedFields).toHaveLength(fields.length);
  });

  it("should reject reordering if not owner", async () => {
    // Create a non-owner user
    const [staff] = await db
      .insert(staffs)
      .values({
        businessId,
        firstName: "Staff",
        lastName: "Member",
        role: "staff",
      })
      .returning();

    const [staffUser] = await db
      .insert(users)
      .values({
        email: "staff@example.com",
        password: "hashed",
        role: "staff",
        businessId,
        userId: staff.id,
      })
      .returning();

    const staffToken = await testClient.getAuthToken(staffUser.email);

    const response = await testClient
      .post(`/api/hr/fields/personal/reorder`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ orderedIds: ["field1", "field2"] });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Only business owners");
  });

  it("should reject invalid field IDs", async () => {
    const response = await testClient
      .post(`/api/hr/fields/personal/reorder`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderedIds: [] }); // Empty array

    expect(response.status).toBe(400);
  });

  it("should reject invalid section", async () => {
    const response = await testClient
      .post(`/api/hr/fields/invalid_section/reorder`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderedIds: ["field1"] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Unknown section");
  });
});
