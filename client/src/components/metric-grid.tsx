/**
 * Layout for a row of metric tiles.
 *
 * Column counts come from the number of tiles actually rendered, so a row never
 * declares more columns than it fills. Phones always get two columns — a single
 * column pushed the page's real content (the list or table) below the fold.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/** Full class strings only — Tailwind's JIT cannot see computed names. */
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

const OVERFLOW = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

/** A lone trailing tile stretches across both mobile columns instead of leaving a hole. */
const ODD_TAIL = "[&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1";

/**
 * Tiles as a flat list.
 *
 * `React.Children.toArray` drops null/false — so role-gated tiles don't inflate
 * the column count — but it does not look inside fragments, and call sites group
 * tiles in one when a whole set is conditional. Unwrap those too, or a branch of
 * three tiles counts as one.
 */
function flattenTiles(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement(child) && child.type === React.Fragment
      ? flattenTiles((child.props as { children?: React.ReactNode }).children)
      : [child],
  );
}

interface MetricGridProps {
  children: React.ReactNode;
  className?: string;
}

export function MetricGrid({ children, className }: MetricGridProps) {
  // Re-keyed positionally: flattening two fragments can otherwise collide on ".0".
  const items = flattenTiles(children).map((child, i) =>
    React.isValidElement(child) ? React.cloneElement(child, { key: `metric-${i}` }) : child,
  );
  const count = items.length;

  if (count === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-3 sm:gap-4",
        COLUMNS[count] ?? OVERFLOW,
        count > 1 && count % 2 === 1 && ODD_TAIL,
        className,
      )}
    >
      {items}
    </div>
  );
}
