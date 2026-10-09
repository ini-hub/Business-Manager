import { describe, expect, it } from "vitest";
import { newPasswordSchema, normalizeEmail } from "./authRules";
import { normalizePhoneForStorage } from "./phone-utils";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("phone identifiers", () => {
  it("stores the same value with or without the leading zero", () => {
    const stored = ["0801 234 5678", "801 234 5678", "08012345678"].map((n) => normalizePhoneForStorage(n, "+234"));
    expect(new Set(stored)).toEqual(new Set(["+2348012345678"]));
  });
});

describe("newPasswordSchema", () => {
  it.each([
    ["password1", "no uppercase, no special"],
    ["Password!", "no number"],
    ["PASSWORD1!", "no lowercase"],
    ["Password1", "no special character"],
    ["Pass word1!", "contains a space"],
    ["Pa1!", "too short"],
  ])("rejects %s (%s)", (value) => {
    expect(newPasswordSchema.safeParse(value).success).toBe(false);
  });

  it("accepts a password meeting every rule", () => {
    expect(newPasswordSchema.safeParse("Sunrise#2026").success).toBe(true);
  });
});
