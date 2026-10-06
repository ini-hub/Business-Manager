import { describe, it, expect } from "vitest";
import { percentileFromHist, parseRange, LATENCY_BOUNDS } from "./healthMetrics";

const hist = (counts: Record<number, number>) => {
  const h = new Array(LATENCY_BOUNDS.length + 1).fill(0);
  for (const [i, n] of Object.entries(counts)) h[Number(i)] = n;
  return h;
};

describe("healthMetrics", () => {
  it("reads percentiles off a latency histogram as bucket upper bounds", () => {
    // 90 requests <=25ms, 9 in (100,200], 1 in (2000,3000]
    const h = hist({ 0: 90, 3: 9, 10: 1 });
    expect(percentileFromHist(h, 50)).toBe(25);
    expect(percentileFromHist(h, 95)).toBe(200);
    expect(percentileFromHist(h, 100)).toBe(3000);
    expect(percentileFromHist(hist({}), 50)).toBe(0);
  });

  it("caps the overflow bucket at the last bound", () => {
    expect(percentileFromHist(hist({ [LATENCY_BOUNDS.length]: 5 }), 99)).toBe(5000);
  });

  it("falls back to 24h for unknown ranges", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("1y")).toBe("24h");
    expect(parseRange(undefined)).toBe("24h");
  });
});
