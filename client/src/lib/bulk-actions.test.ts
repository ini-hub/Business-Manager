import { describe, it, expect } from "vitest";
import { runBulkFanOut } from "./bulk-actions";

describe("runBulkFanOut", () => {
  it("buckets outcomes and keeps the message of each failure, in selection order", async () => {
    const result = await runBulkFanOut(["a", "b", "c", "d"], async (id) => {
      if (id === "b") throw new Error("Can't archive this item yet: it's on 1 open purchase order.");
      if (id === "d") throw "plain string failure";
      return "archived" as const;
    });
    expect(result.counts).toEqual({ archived: 2, failed: 2 });
    expect(result.byOutcome.archived).toEqual(["a", "c"]);
    expect(result.byOutcome.failed).toEqual(["b", "d"]);
    expect(result.errors).toEqual([
      { id: "b", message: "Can't archive this item yet: it's on 1 open purchase order." },
      { id: "d", message: "plain string failure" },
    ]);
  });

  it("returns no errors when everything succeeds", async () => {
    const result = await runBulkFanOut([1, 2], async () => "ok" as const);
    expect(result.errors).toEqual([]);
    expect(result.counts).toEqual({ ok: 2 });
  });
});
