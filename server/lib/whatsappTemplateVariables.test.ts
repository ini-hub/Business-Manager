import { describe, it, expect } from "vitest";
import { extractVariableCount } from "./whatsappTemplateVariables";

describe("extractVariableCount", () => {
  it("returns 0 for a template with no placeholders", () => {
    expect(extractVariableCount("Thanks for visiting us!")).toBe(0);
  });

  it("returns 1 for a single placeholder", () => {
    expect(extractVariableCount("Hi {{1}}, thanks for stopping by.")).toBe(1);
  });

  it("returns the highest index, not the count of placeholders", () => {
    expect(extractVariableCount("Hi {{1}}, your appointment on {{2}} at {{3}} is confirmed.")).toBe(3);
  });

  it("does not double-count a repeated placeholder", () => {
    expect(extractVariableCount("Hi {{1}}, yes {{1}}, we mean you {{1}}.")).toBe(1);
  });

  it("takes the max even when placeholders are out of order in the text", () => {
    expect(extractVariableCount("{{3}} comes before {{1}} which comes before {{2}}")).toBe(3);
  });
});
