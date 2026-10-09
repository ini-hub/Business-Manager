/** Rollout values an admin can choose. `by_plan` is legacy: kept on rows that already have it, never offered. */
const CHOICES = ["on", "off", "scoped"];

function idsOf(raw: unknown): unknown[] {
  if (typeof raw === "string") {
    try { return idsOf(JSON.parse(raw)); } catch { return []; }
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * Input checks for a flag update that need no database. Returns the message to send back, or null.
 * `current` is the stored flag, `scopedOrgIds` the new list when the request carries one.
 */
export function flagUpdateProblem(
  input: { status?: unknown; scopedOrgIds?: unknown },
  current: { status: string; scopedOrgIds: unknown },
): string | null {
  const { status, scopedOrgIds } = input;
  if (status !== undefined && (typeof status !== "string" || !(CHOICES.includes(status) || (status === "by_plan" && current.status === "by_plan")))) {
    return "Rollout must be on, off or scoped.";
  }
  if (scopedOrgIds !== undefined && (!Array.isArray(scopedOrgIds) || scopedOrgIds.some((v) => typeof v !== "string"))) {
    return "Pick businesses from the list.";
  }
  const next = status !== undefined ? status : current.status;
  if (next === "scoped") {
    const list = scopedOrgIds !== undefined ? (scopedOrgIds as unknown[]) : idsOf(current.scopedOrgIds);
    if (list.length === 0) return "Pick at least one business, or set the rollout to Off.";
  }
  return null;
}
