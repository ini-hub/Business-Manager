import { describe, it, expect } from "vitest";
import { limitNudgeState } from "./limit-nudge";

describe("limitNudgeState", () => {
  it("stays quiet well under the cap and for unlimited orgs", () => {
    expect(limitNudgeState({ limit: 30, used: 10, unlimited: false })).toBe("none");
    expect(limitNudgeState({ limit: 30, used: 29, unlimited: true })).toBe("none");
    expect(limitNudgeState(undefined)).toBe("none");
  });

  it("nudges from 80% and flags a full cap", () => {
    expect(limitNudgeState({ limit: 30, used: 24, unlimited: false })).toBe("near");
    expect(limitNudgeState({ limit: 30, used: 29, unlimited: false })).toBe("near");
    expect(limitNudgeState({ limit: 30, used: 30, unlimited: false })).toBe("full");
    expect(limitNudgeState({ limit: 2, used: 4, unlimited: false })).toBe("full"); // over-cap orgs
    expect(limitNudgeState({ limit: 5, used: 4, unlimited: false })).toBe("near");
  });
});
