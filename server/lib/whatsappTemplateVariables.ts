/**
 * Derives a template's variable count from its body text rather than
 * trusting a client-supplied number, so the composer's placeholder-mapping
 * form (client/src/pages/broadcasts/index.tsx) always matches what the
 * template actually contains. Meta templates number placeholders
 * contiguously from {{1}}, so the count is the highest index found, not the
 * number of distinct placeholders (a template referencing {{1}} twice still
 * has a variable count of 1).
 */
export function extractVariableCount(bodyText: string): number {
  const matches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g));
  let max = 0;
  for (const m of matches) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}
