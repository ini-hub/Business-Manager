import { describe, it, expect } from "vitest";
import { getRateFeed, NullRateFeed } from "./rateFeed";

describe("rate feed (stub)", () => {
  it("has no provider configured and never suggests a rate", async () => {
    const feed = getRateFeed();
    expect(feed).toBeInstanceOf(NullRateFeed);
    expect(feed.isConfigured()).toBe(false);
    expect(await feed.suggest("GHS", "NGN", "2026-06-01")).toBeNull();
  });
});
