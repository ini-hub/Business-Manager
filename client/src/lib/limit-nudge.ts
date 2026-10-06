/** When to start nudging: at 80% of the cap. The cap itself is handled by the add buttons and gates. */
const NUDGE_FROM = 0.8;

/** "none" until the org is close to a cap, "near" from 80%, "full" once it has reached it. Unlimited never nudges. */
export function limitNudgeState(status: { limit: number; used: number; unlimited: boolean } | undefined): "none" | "near" | "full" {
  if (!status || status.unlimited || status.limit <= 0) return "none";
  if (status.used >= status.limit) return "full";
  return status.used / status.limit >= NUDGE_FROM ? "near" : "none";
}
