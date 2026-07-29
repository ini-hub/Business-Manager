import { describe, expect, it } from "vitest";
import {
  correlationMatrix,
  crossCorrelation,
  difference,
  ema,
  isStronglyTrending,
  linearRegression,
  momentum,
  pctChange,
  pearson,
  rollingZScore,
  rsi,
  sma,
} from "./stats";

describe("pearson", () => {
  it("returns 1 for a perfect positive relationship", () => {
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r?.r).toBeCloseTo(1, 10);
    expect(r?.r2).toBeCloseTo(1, 10);
    expect(r?.n).toBe(5);
  });

  it("returns -1 for a perfect inverse relationship", () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])?.r).toBeCloseTo(-1, 10);
  });

  it("matches a known worked example", () => {
    // Classic textbook pair; r = 0.9749 to 4dp.
    const r = pearson([43, 21, 25, 42, 57, 59], [99, 65, 79, 75, 87, 81]);
    expect(r?.r).toBeCloseTo(0.5298, 3);
  });

  it("is pairwise-complete rather than dropping the whole series", () => {
    const r = pearson([1, null, 3, 4], [2, 5, 6, 8]);
    expect(r?.n).toBe(3);
  });

  it("returns null below the minimum sample size", () => {
    expect(pearson([1, 2], [2, 4])).toBeNull();
  });

  it("returns null for a constant series — undefined, not zero", () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });

  it("reports a small p-value for a strong relationship on enough points", () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const ys = xs.map((x) => x * 2 + (x % 3));
    const r = pearson(xs, ys);
    expect(r!.p).toBeLessThan(0.001);
  });

  it("reports a large p-value for a weak relationship on few points", () => {
    const r = pearson([1, 2, 3, 4], [2, 1, 4, 3]);
    expect(r!.p).toBeGreaterThan(0.2);
  });
});

describe("linearRegression", () => {
  it("recovers the generating line exactly", () => {
    const fit = linearRegression([0, 1, 2, 3, 4], [3, 5, 7, 9, 11]);
    expect(fit?.slope).toBeCloseTo(2, 10);
    expect(fit?.intercept).toBeCloseTo(3, 10);
    expect(fit?.r2).toBeCloseTo(1, 10);
  });

  it("returns a negative r for a descending fit", () => {
    const fit = linearRegression([0, 1, 2, 3], [10, 8, 6, 4]);
    expect(fit?.slope).toBeCloseTo(-2, 10);
    expect(fit?.r).toBeLessThan(0);
  });
});

describe("rsi (Wilder)", () => {
  /**
   * The canonical Wilder RSI-14 worked example, at full precision.
   *
   * The decimals matter: rounding these closes to 2dp shifts the result by ~0.07,
   * which is enough to mask a genuinely wrong smoothing method. Published values
   * are 70.5327, 66.3186, 66.5498, 69.4064.
   */
  const WILDER_CLOSES = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245,
    45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028,
    46.0328, 46.4116, 46.221, 45.6376,
  ];

  it("matches the published first value to 4dp", () => {
    const result = rsi(WILDER_CLOSES, 14);
    expect(result.insufficientData).toBe(false);
    expect(result.values[14]).toBeCloseTo(70.5327, 3);
  });

  it("matches the published run (Wilder smoothing, not SMA)", () => {
    const result = rsi(WILDER_CLOSES, 14);
    // A simple-moving-average implementation diverges from the second value on,
    // which is exactly what this pins down.
    expect(result.values[15]).toBeCloseTo(66.3186, 3);
    expect(result.values[16]).toBeCloseTo(66.5498, 3);
    expect(result.values[17]).toBeCloseTo(69.4064, 3);
  });

  it("leaves the first `period` entries null", () => {
    const result = rsi(WILDER_CLOSES, 14);
    expect(result.values.slice(0, 14).every((v) => v === null)).toBe(true);
  });

  it("returns 100 when there are no losses", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14).values[14]).toBe(100);
  });

  it("returns 0 when there are no gains", () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14).values[14]).toBe(0);
  });

  it("returns 50 for a flat series rather than NaN", () => {
    // A quiet store with identical daily takings is common; 0/0 must not blank
    // the chart.
    const flat = new Array(20).fill(100);
    const result = rsi(flat, 14);
    expect(result.values[14]).toBe(50);
    expect(Number.isNaN(result.values[14] as number)).toBe(false);
  });

  it("reports insufficient data instead of an all-null array", () => {
    const result = rsi([1, 2, 3], 14);
    expect(result.insufficientData).toBe(true);
    expect(result.required).toBe(15);
    expect(result.got).toBe(3);
  });

  it("stays within 0..100 throughout", () => {
    const result = rsi(WILDER_CLOSES, 14);
    for (const v of result.values) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("sma / ema", () => {
  it("computes a simple moving average over the full window only", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 10);
    expect(result[4]).toBeCloseTo(4, 10);
  });

  it("seeds the EMA with the first full SMA window", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const result = ema(values, 3);
    expect(result[2]).toBeCloseTo(2, 10);
    // k = 2/(3+1) = 0.5 -> next = 4*0.5 + 2*0.5 = 3
    expect(result[3]).toBeCloseTo(3, 10);
  });

  it("tracks a constant series exactly", () => {
    const result = ema(new Array(10).fill(7), 4);
    expect(result[9]).toBeCloseTo(7, 10);
  });
});

describe("transforms", () => {
  it("computes percentage change with a null first element", () => {
    const result = pctChange([100, 110, 99]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(10, 10);
    expect(result[2]).toBeCloseTo(-10, 10);
  });

  it("returns null rather than Infinity when the previous value is zero", () => {
    expect(pctChange([0, 50])[1]).toBeNull();
  });

  it("differences at an arbitrary lag", () => {
    const result = difference([1, 3, 6, 10], 2);
    expect(result[0]).toBeNull();
    expect(result[2]).toBe(5);
    expect(momentum([1, 3, 6, 10], 2)[3]).toBe(7);
  });
});

describe("rollingZScore", () => {
  it("returns 0 at the centre of a symmetric window", () => {
    expect(rollingZScore([1, 2, 3], 3)[2]).toBeCloseTo(1.2247, 3);
  });

  it("returns null when the window has no variance", () => {
    expect(rollingZScore([5, 5, 5], 3)[2]).toBeNull();
  });
});

describe("crossCorrelation", () => {
  it("peaks at the lag by which x leads y", () => {
    const x = [1, 5, 2, 8, 3, 9, 4, 10, 5, 11, 6, 12];
    // y is x shifted one step later.
    const y = [0, 1, 5, 2, 8, 3, 9, 4, 10, 5, 11, 6];
    const results = crossCorrelation(x, y, 3);
    const best = results.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
    expect(best.lag).toBe(1);
    expect(best.r).toBeGreaterThan(0.9);
  });
});

describe("isStronglyTrending", () => {
  it("flags a monotonic series", () => {
    expect(isStronglyTrending(Array.from({ length: 20 }, (_, i) => i * 3))).toBe(true);
  });

  it("does not flag an oscillating series", () => {
    expect(
      isStronglyTrending(Array.from({ length: 20 }, (_, i) => Math.sin(i))),
    ).toBe(false);
  });
});

describe("correlationMatrix", () => {
  it("has a unit diagonal and is symmetric", () => {
    const result = correlationMatrix(
      {
        a: [1, 2, 3, 4, 5, 6],
        b: [2, 4, 6, 8, 10, 12],
        c: [6, 5, 4, 3, 2, 1],
      },
      "none",
    );
    expect(result.matrix[0][0]).toBe(1);
    expect(result.matrix[0][1]).toBeCloseTo(result.matrix[1][0]!, 10);
    expect(result.matrix[0][1]).toBeCloseTo(1, 10);
    expect(result.matrix[0][2]).toBeCloseTo(-1, 10);
  });

  it("nulls cells with too little overlap instead of reporting zero", () => {
    const result = correlationMatrix({ a: [1, 2], b: [3, 4] }, "none");
    expect(result.matrix[0][1]).toBeNull();
    expect(result.n[0][1]).toBe(0);
  });

  it("defaults to percentage change, which breaks a spurious level correlation", () => {
    // Two independent series that both grow correlate near 1 on raw levels.
    const a = Array.from({ length: 40 }, (_, i) => 100 + i * 10 + (i % 5));
    const b = Array.from({ length: 40 }, (_, i) => 50 + i * 7 + ((i * 3) % 11));
    const onLevels = correlationMatrix({ a, b }, "none").matrix[0][1]!;
    const onChanges = correlationMatrix({ a, b }, "pct_change").matrix[0][1]!;
    expect(onLevels).toBeGreaterThan(0.99);
    expect(Math.abs(onChanges)).toBeLessThan(Math.abs(onLevels));
  });
});
