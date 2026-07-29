/**
 * Analytics Explorer — chart palette.
 *
 * Reads the validated `--viz-*` tokens from index.css so light/dark swap in one
 * place. Do not use `--chart-1..5` here: that is a sequential ramp being used
 * categorically and it fails colour-blind separation AND the normal-vision floor.
 */

import { OTHER_MEMBER_KEY } from "@shared/analytics/constants";

/** Fixed order. Assigned by slot and never cycled — a 9th series folds to "Other". */
export const VIZ_SLOTS = 8;

export const SERIES_COLORS: string[] = Array.from(
  { length: VIZ_SLOTS },
  (_, i) => `hsl(var(--viz-${i + 1}))`,
);

/**
 * Forms where every series can sit next to every other (scatter, bubble) need
 * all-pairs separation, which the full eight cannot clear. Three can.
 */
export const ALL_PAIRS_SERIES_CAP = 3;

/** Neutral for the folded-together remainder — it is not an entity, so it gets no hue. */
export const OTHER_COLOR = "hsl(var(--muted-foreground))";

/**
 * Stable member → slot assignment.
 *
 * Colour follows the entity, not its rank: filtering one store out must not
 * repaint the survivors. Callers persist the returned map into the saved view so
 * the assignment survives a reload too.
 */
export function assignColors(
  members: string[],
  existing: Record<string, number> = {},
): Record<string, number> {
  const assignment: Record<string, number> = { ...existing };
  const used = new Set(Object.values(assignment));

  let next = 0;
  const takeSlot = () => {
    while (used.has(next) && next < VIZ_SLOTS) next += 1;
    const slot = next < VIZ_SLOTS ? next : VIZ_SLOTS - 1;
    used.add(slot);
    return slot;
  };

  for (const member of members) {
    if (member === OTHER_MEMBER_KEY) continue;
    if (assignment[member] === undefined) assignment[member] = takeSlot();
  }
  return assignment;
}

export function colorFor(member: string, assignment: Record<string, number>): string {
  if (member === OTHER_MEMBER_KEY) return OTHER_COLOR;
  const slot = assignment[member];
  return slot === undefined ? SERIES_COLORS[0] : SERIES_COLORS[slot % VIZ_SLOTS];
}

/** Sequential ramp stop for a 0..1 magnitude. One hue, light → dark. */
export function sequentialColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  return `color-mix(in oklab, hsl(var(--viz-seq-to)) ${Math.round(clamped * 100)}%, hsl(var(--viz-seq-from)))`;
}

/**
 * Diverging ramp for a value in [-1, 1], through a NEUTRAL midpoint.
 *
 * The midpoint must be grey: a hue at zero reads as a value, which is exactly
 * wrong for "no correlation".
 */
export function divergingColor(value: number): string {
  const v = Math.min(1, Math.max(-1, value));
  const pole = v < 0 ? "hsl(var(--viz-div-neg))" : "hsl(var(--viz-div-pos))";
  const strength = Math.round(Math.abs(v) * 100);
  return `color-mix(in oklab, ${pole} ${strength}%, hsl(var(--viz-div-mid)))`;
}
