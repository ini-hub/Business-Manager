import { describe, it, expect } from "vitest";
import { dependencyProblem } from "./dependencyGraph";

const name = (id: string) => id.toUpperCase();
const edges = [
  { featureId: "b", dependsOnFeatureId: "a" },
  { featureId: "c", dependsOnFeatureId: "b" },
];

describe("dependencyProblem", () => {
  it("rejects a feature depending on itself", () => {
    expect(dependencyProblem([], "a", "a", name)).toBe("A cannot depend on itself.");
  });

  it("accepts a new, acyclic edge", () => {
    expect(dependencyProblem(edges, "d", "a", name)).toBeNull();
    expect(dependencyProblem(edges, "c", "a", name)).toBeNull();
  });

  it("rejects a direct loop and names it", () => {
    expect(dependencyProblem(edges, "a", "b", name)).toBe("That would make a loop: A needs B needs A.");
  });

  it("rejects an indirect loop", () => {
    expect(dependencyProblem(edges, "a", "c", name)).toBe("That would make a loop: A needs C needs B needs A.");
  });
});
