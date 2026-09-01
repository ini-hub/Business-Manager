/**
 * A duration in minutes as `Xh Ym`. For repeated values — a table column, a
 * list of history rows — where a wall of raw minute counts (340m, 1240m...)
 * reads as noise. Drops the hour segment entirely under 60m, and never shows
 * "0h" or "0m" together.
 */
export function formatDurationCompact(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * A duration in minutes as "8 hours, 7 minutes". For a single prominent
 * value — a stat card, a headline, an alert — not for a table column, where
 * this reads as too much text repeated down every row.
 */
export function formatDurationLong(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hourPart = h > 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const minutePart = m > 0 || h === 0 ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
  return [hourPart, minutePart].filter(Boolean).join(", ");
}
