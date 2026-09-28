import { describe, it, expect } from "vitest";
import { passwordSchema } from "./auth";

describe("passwordSchema", () => {
  it("accepts underscore as a valid special character", () => {
    expect(passwordSchema.safeParse("123_CiEn").success).toBe(true);
  });

  it("accepts every character in the allowed special-character set", () => {
    const allowed = ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", ",", ".", "?", '"', ":", "{", "}", "|", "<", ">", "_", "-", "+", "=", "~", "`", "[", "]", ";", "'", "/", "\\"];
    for (const symbol of allowed) {
      const password = `Abc1${symbol}defg`;
      expect(passwordSchema.safeParse(password).success, `expected "${symbol}" to be accepted`).toBe(true);
    }
  });

  it("rejects a password with no special character", () => {
    expect(passwordSchema.safeParse("Abcdefg1").success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(passwordSchema.safeParse("Ab1_efg").success).toBe(false);
  });

  it("rejects a password missing an uppercase letter", () => {
    expect(passwordSchema.safeParse("abc1_defg").success).toBe(false);
  });

  it("rejects a password missing a lowercase letter", () => {
    expect(passwordSchema.safeParse("ABC1_DEFG").success).toBe(false);
  });

  it("rejects a password missing a number", () => {
    expect(passwordSchema.safeParse("Abc_defgh").success).toBe(false);
  });

  it("rejects a password containing spaces", () => {
    expect(passwordSchema.safeParse("Abc1_def gh").success).toBe(false);
  });
});
