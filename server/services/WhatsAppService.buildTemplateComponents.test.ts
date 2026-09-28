import { describe, it, expect } from "vitest";
import { buildTemplateComponents } from "./WhatsAppService";

describe("buildTemplateComponents", () => {
  it("returns undefined for a template with no variables", () => {
    expect(buildTemplateComponents({})).toBeUndefined();
  });

  it("builds a single-variable body component", () => {
    expect(buildTemplateComponents({ "1": "Ada" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Ada" }] },
    ]);
  });

  it("orders variables numerically, not lexically", () => {
    // String sort would put "10" before "2" - a template with 10+
    // placeholders would silently swap variables without this.
    const variables = { "2": "second", "10": "tenth", "1": "first" };
    expect(buildTemplateComponents(variables)).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
          { type: "text", text: "tenth" },
        ],
      },
    ]);
  });
});
