/**
 * Analytics Explorer — statistics.
 *
 * A pure module: it takes arrays of numbers and returns arrays of numbers, and
 * imports nothing from the database or drizzle. That makes it unit-testable
 * without a database, which matters because these are exactly the functions that
 * ship subtly wrong and are never noticed — an RSI seeded with a simple moving
 * average instead of Wilder's looks entirely plausible on a chart.
 */

import { ANALYTICS_LIMITS } from "@shared/analytics/constants";
import type { StatTransform } from "@shared/analytics/model";

export type Series = (number | null)[];

export interface CorrelationResult {
  r: number;
  r2: number;
  n: number;
  /** Two-sided p-value for H0: r = 0. */
  p: number;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r: number;
  r2: number;
  stdErr: number;
  n: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index pairs where BOTH series have a value — pairwise-complete, not listwise. */
function pairedValues(xs: Series, ys: Series): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const a = xs[i];
    const b = ys[i];
    if (typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)) {
      x.push(a);
      y.push(b);
    }
  }
  return { x, y };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Regularised incomplete beta, used for the t-distribution tail.
 *
 * Continued-fraction expansion (Lentz). ~30 lines is a fair price for being able
 * to say "r = 0.71 (n = 26, p = 0.04)" instead of letting someone read a
 * correlation off five points and act on it.
 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function logGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a t statistic with df degrees of freedom. */
function tDistPValue(t: number, df: number): number {
  if (df <= 0) return 1;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

// ---------------------------------------------------------------------------
// Correlation and regression
// ---------------------------------------------------------------------------

export function pearson(xs: Series, ys: Series): CorrelationResult | null {
  const { x, y } = pairedValues(xs, ys);
  const n = x.length;
  if (n < ANALYTICS_LIMITS.minCorrelationN) return null;

  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  // A constant series has no variance, so correlation is undefined — not zero.
  if (dx2 === 0 || dy2 === 0) return null;

  const r = Math.max(-1, Math.min(1, num / Math.sqrt(dx2 * dy2)));
  const df = n - 2;
  const p =
    df > 0 && Math.abs(r) < 1
      ? tDistPValue(Math.abs(r) * Math.sqrt(df / (1 - r * r)), df)
      : 0;

  return { r, r2: r * r, n, p };
}

export function linearRegression(xs: Series, ys: Series): RegressionResult | null {
  const { x, y } = pairedValues(xs, ys);
  const n = x.length;
  if (n < ANALYTICS_LIMITS.minCorrelationN) return null;

  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept;
    ssRes += (y[i] - predicted) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const stdErr = n > 2 ? Math.sqrt(ssRes / (n - 2) / sxx) : 0;

  return { slope, intercept, r: Math.sign(slope) * Math.sqrt(Math.max(0, r2)), r2, stdErr, n };
}

/**
 * Correlation at each lag in [-maxLag, +maxLag].
 *
 * A positive lag means x LEADS y — x is shifted forward, so "does staffing today
 * predict revenue tomorrow" is answered by a peak at a positive lag.
 */
export function crossCorrelation(
  xs: Series,
  ys: Series,
  maxLag: number,
): { lag: number; r: number; n: number }[] {
  const out: { lag: number; r: number; n: number }[] = [];
  const limit = Math.max(0, Math.min(maxLag, Math.floor(xs.length / 2)));

  for (let lag = -limit; lag <= limit; lag++) {
    const a: Series = [];
    const b: Series = [];
    for (let i = 0; i < xs.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= ys.length) continue;
      a.push(xs[i]);
      b.push(ys[j]);
    }
    const result = pearson(a, b);
    if (result) out.push({ lag, r: result.r, n: result.n });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function pctChange(values: Series): Series {
  const out: Series = [null];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    out.push(
      typeof prev === "number" && typeof cur === "number" && prev !== 0
        ? ((cur - prev) / Math.abs(prev)) * 100
        : null,
    );
  }
  return out;
}

export function difference(values: Series, lag = 1): Series {
  const out: Series = [];
  for (let i = 0; i < values.length; i++) {
    const prev = values[i - lag];
    const cur = values[i];
    out.push(
      i >= lag && typeof prev === "number" && typeof cur === "number" ? cur - prev : null,
    );
  }
  return out;
}

export function applyTransform(values: Series, transform: StatTransform): Series {
  switch (transform) {
    case "pct_change":
      return pctChange(values);
    case "difference":
      return difference(values);
    case "none":
    default:
      return values;
  }
}

/**
 * Whether a series is strongly trending, by correlating it against time.
 *
 * Two independent series that both grow will correlate near 1.0 on raw levels.
 * That is the single easiest way for an analytics tool to produce confident
 * nonsense, so the endpoints use this to warn and default to % change instead.
 */
export function isStronglyTrending(values: Series): boolean {
  const index = values.map((_, i) => i);
  const result = pearson(index, values);
  return result !== null && Math.abs(result.r) > ANALYTICS_LIMITS.spuriousTrendThreshold;
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export function sma(values: Series, period: number): Series {
  const out: Series = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (typeof v === "number") {
        sum += v;
        count += 1;
      }
    }
    out.push(count === period ? sum / period : null);
  }
  return out;
}

export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  // Seeded with the SMA of the first full window, the conventional choice.
  let seedSum = 0;
  let seedCount = 0;
  let seedIndex = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number") continue;
    seedSum += v;
    seedCount += 1;
    if (seedCount === period) {
      seedIndex = i;
      break;
    }
  }
  if (seedIndex === -1) return out;

  let prev = seedSum / period;
  out[seedIndex] = prev;
  for (let i = seedIndex + 1; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number") {
      out[i] = null;
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface RsiResult {
  values: Series;
  insufficientData: boolean;
  required: number;
  got: number;
}

/**
 * Wilder's RSI.
 *
 * Deliberately NOT a simple moving average of gains and losses: after seeding
 * with the mean of the first `period` changes, Wilder smooths with
 * `(prev * (period - 1) + current) / period`. Using an SMA instead produces a
 * curve that looks right and is wrong, which is why this has a unit test.
 *
 * The edge cases matter more than the main path for a small business:
 *  - no losses in the window   -> 100
 *  - no gains AND no losses    -> 50, not NaN. A flat revenue series is common
 *                                 for a quiet store, and NaN would blank the chart.
 */
export function rsi(values: Series, period = 14): RsiResult {
  const out: Series = new Array(values.length).fill(null);
  const required = period + 1;

  if (values.length < required) {
    return { values: out, insufficientData: true, required, got: values.length };
  }

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (typeof prev !== "number" || typeof cur !== "number") {
      gains.push(0);
      losses.push(0);
      continue;
    }
    const delta = cur - prev;
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }

  let avgGain = mean(gains.slice(0, period));
  let avgLoss = mean(losses.slice(0, period));

  const toRsi = (g: number, l: number): number => {
    if (l === 0 && g === 0) return 50;
    if (l === 0) return 100;
    if (g === 0) return 0;
    return 100 - 100 / (1 + g / l);
  };

  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i + 1] = toRsi(avgGain, avgLoss);
  }

  return { values: out, insufficientData: false, required, got: values.length };
}

export function rollingZScore(values: Series, window: number): Series {
  const out: Series = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    const slice = values
      .slice(i - window + 1, i + 1)
      .filter((v): v is number => typeof v === "number");
    if (slice.length < window) {
      out.push(null);
      continue;
    }
    const m = mean(slice);
    const sd = Math.sqrt(mean(slice.map((v) => (v - m) ** 2)));
    const cur = values[i];
    out.push(sd === 0 || typeof cur !== "number" ? null : (cur - m) / sd);
  }
  return out;
}

export function momentum(values: Series, lag: number): Series {
  return difference(values, lag);
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

export interface CorrelationMatrix {
  keys: string[];
  matrix: (number | null)[][];
  n: number[][];
  p: (number | null)[][];
}

export function correlationMatrix(
  columns: Record<string, Series>,
  transform: StatTransform = "pct_change",
): CorrelationMatrix {
  const keys = Object.keys(columns);
  const prepared = keys.map((k) => applyTransform(columns[k], transform));

  const matrix: (number | null)[][] = [];
  const n: number[][] = [];
  const p: (number | null)[][] = [];

  for (let i = 0; i < keys.length; i++) {
    matrix[i] = [];
    n[i] = [];
    p[i] = [];
    for (let j = 0; j < keys.length; j++) {
      if (i === j) {
        matrix[i][j] = 1;
        n[i][j] = prepared[i].filter((v) => typeof v === "number").length;
        p[i][j] = 0;
        continue;
      }
      const result = pearson(prepared[i], prepared[j]);
      // Null rather than 0 when there is too little overlap: an empty cell reads
      // as "unknown", a zero reads as "no relationship", and they are different.
      matrix[i][j] = result?.r ?? null;
      n[i][j] = result?.n ?? 0;
      p[i][j] = result?.p ?? null;
    }
  }

  return { keys, matrix, n, p };
}
