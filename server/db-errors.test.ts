import { describe, it, expect } from "vitest";
import { isUniqueViolation, getViolatedConstraint, findPgError } from "./db-errors";

const pg = (code: string, constraint?: string) => Object.assign(new Error("duplicate key"), { code, constraint });
// drizzle-orm wraps the driver error: the message is the SQL, the driver error is `cause`.
const wrapped = (cause: unknown) => Object.assign(new Error("Failed query: insert into ..."), { cause });

describe("db-errors", () => {
  it("recognises a bare driver unique violation and its constraint", () => {
    expect(isUniqueViolation(pg("23505", "users_email_unique"))).toBe(true);
    expect(getViolatedConstraint(pg("23505", "users_email_unique"))).toBe("users_email_unique");
  });

  it("sees through drizzle's wrapper (and wrappers of wrappers)", () => {
    const inner = pg("23505", "feature_gate_rules_unique");
    expect(isUniqueViolation(wrapped(inner))).toBe(true);
    expect(isUniqueViolation(wrapped(wrapped(inner)))).toBe(true);
    expect(getViolatedConstraint(wrapped(inner))).toBe("feature_gate_rules_unique");
  });

  it("does not mistake other errors for a unique violation", () => {
    expect(isUniqueViolation(pg("23503"))).toBe(false);
    expect(isUniqueViolation(wrapped(pg("40P01")))).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(getViolatedConstraint(wrapped(pg("23503", "fk")))).toBeUndefined();
  });

  it("stops on a cyclic cause chain", () => {
    const a: any = new Error("a");
    a.cause = a;
    expect(findPgError(a)).toBeUndefined();
  });
});
