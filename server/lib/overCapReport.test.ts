import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("./entitlements", () => ({ getCountLimitStatus: vi.fn() }));
vi.mock("./billing", () => ({ getOwnerContact: vi.fn() }));

import { rankOverCap } from "./overCapReport";

describe("rankOverCap", () => {
  it("puts the biggest overshoot first, then the larger org", () => {
    const rows = [
      { id: "a", over: 1, used: 3 },
      { id: "b", over: 5, used: 7 },
      { id: "c", over: 1, used: 10 },
    ];
    expect(rankOverCap(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate its input", () => {
    const rows = [{ over: 1, used: 1 }, { over: 2, used: 1 }];
    rankOverCap(rows);
    expect(rows[0].over).toBe(1);
  });
});
