/**
 * Reads a timestamp that came back from a raw `db.execute(sql...)` query.
 *
 * Every timestamp column holds naive UTC. Drizzle's query builder converts them correctly, but raw SQL results
 * arrive as zone-less strings ("2026-10-08 15:02:50.628"), which `new Date(...)` would read as LOCAL time and
 * so be off by the server's UTC offset. Use this for any timestamp read from a raw query.
 */
export function parseDbTimestamp(value: unknown): Date {
  if (value instanceof Date) return value;
  const text = String(value);
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(text.trim());
  return new Date(hasZone ? text.replace(" ", "T") : `${text.trim().replace(" ", "T")}Z`);
}
