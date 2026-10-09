import { describe, it, expect } from "vitest";
import { flagUpdateProblem } from "./flagRollout";

const on = { status: "on", scopedOrgIds: null };

describe("flagUpdateProblem", () => {
  it("accepts the three choices", () => {
    expect(flagUpdateProblem({ status: "off" }, on)).toBeNull();
    expect(flagUpdateProblem({ status: "on" }, on)).toBeNull();
    expect(flagUpdateProblem({ status: "scoped", scopedOrgIds: ["a"] }, on)).toBeNull();
  });

  it("rejects unknown statuses, and by_plan unless the row already has it", () => {
    expect(flagUpdateProblem({ status: "maybe" }, on)).toMatch(/on, off or scoped/);
    expect(flagUpdateProblem({ status: "by_plan" }, on)).toMatch(/on, off or scoped/);
    expect(flagUpdateProblem({ status: "by_plan" }, { status: "by_plan", scopedOrgIds: null })).toBeNull();
  });

  it("rejects a non-list or non-string ids", () => {
    expect(flagUpdateProblem({ scopedOrgIds: "abc" }, on)).toMatch(/from the list/);
    expect(flagUpdateProblem({ scopedOrgIds: [1] }, on)).toMatch(/from the list/);
  });

  it("refuses an empty scope, using the stored list when the request has none", () => {
    expect(flagUpdateProblem({ status: "scoped", scopedOrgIds: [] }, on)).toMatch(/at least one/);
    expect(flagUpdateProblem({ status: "scoped" }, on)).toMatch(/at least one/);
    expect(flagUpdateProblem({ status: "scoped" }, { status: "on", scopedOrgIds: JSON.stringify(["a"]) })).toBeNull();
    expect(flagUpdateProblem({ status: "scoped" }, { status: "off", scopedOrgIds: ["a"] })).toBeNull();
  });
});
