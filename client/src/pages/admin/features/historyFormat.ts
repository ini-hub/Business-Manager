export interface HistoryEntry {
  id: string;
  action: string;
  adminEmail: string;
  createdAt: string;
  details: any;
  organisationName?: string | null;
}

export interface HistoryLine {
  title: string;
  /** One line saying what changed; may be empty. */
  detail: string;
}

const money = (v: unknown) => (v == null || v === "" ? "none" : Number(v).toLocaleString());
const date = (v: unknown) => (v ? new Date(v as string).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "no date");

function rolloutDetail(d: any): string {
  const before = d?.before?.status as string | undefined;
  const after = d?.status as string | undefined;
  const scoped = Array.isArray(d?.scopedOrgIds) ? ` (${d.scopedOrgIds.length} business${d.scopedOrgIds.length === 1 ? "" : "es"})` : "";
  if (before && after && before !== after) return `${before} → ${after}${scoped}`;
  if (after) return `${after}${scoped}`;
  return "";
}

/** Only the fields an admin can change from the Pricing tab, as "before → after". */
function pricingDetail(d: any): string {
  const changed = d?.changed ?? d?.after ?? {};
  const before = d?.before ?? {};
  const parts: string[] = [];
  if ("priceMonthly" in changed) parts.push(`monthly ${money(before.priceMonthly)} → ${money(changed.priceMonthly)}`);
  if ("priceAnnual" in changed) parts.push(`annual ${money(before.priceAnnual)} → ${money(changed.priceAnnual)}`);
  if ("isActive" in changed) parts.push(changed.isActive ? "sold to businesses: on" : "sold to businesses: off");
  return parts.join(", ");
}

export function formatHistory(e: HistoryEntry): HistoryLine {
  const d = e.details ?? {};
  switch (e.action) {
    case "toggle_feature_flag": return { title: "Rollout changed", detail: rolloutDetail(d) };
    case "update_feature_catalog_pricing": return { title: "Pricing or sales changed", detail: pricingDetail(d) };
    case "publish_feature_catalog_entry": {
      const n = Number(d.grandfathered ?? 0);
      return { title: "Published", detail: n ? `${n} existing business${n === 1 ? "" : "es"} granted it free` : "No existing business granted it" };
    }
    case "create_feature_catalog_entry": return { title: "Created", detail: "" };
    case "create_feature_threshold": return { title: "Threshold added", detail: d.limit ? `up to ${d.limit} at ${money(d.priceMonthly)}/mo` : "" };
    case "schedule_feature_sunset": return { title: "Sunset scheduled", detail: `paywall on ${date(d.paywallEffectiveAt)}, ${d.affectedOrgs ?? 0} on notice` };
    case "reschedule_feature_sunset": return { title: "Sunset rescheduled", detail: `${date(d.previousEffectiveAt)} → ${date(d.paywallEffectiveAt)}` };
    case "cancel_feature_sunset": return { title: "Sunset cancelled", detail: `${d.restoredOrgs ?? 0} keep it free` };
    case "add_feature_dependency": return { title: "Dependency added", detail: d.dependsOnKey ? `needs ${d.dependsOnKey}` : "" };
    case "remove_feature_dependency": return { title: "Dependency removed", detail: d.dependsOnKey ? `no longer needs ${d.dependsOnKey}` : "" };
    case "create_gate_rule": return { title: "Gate rule added", detail: [d.kind, d.methods].filter(Boolean).join(" ") };
    case "update_gate_rule": return { title: "Gate rule edited", detail: "" };
    case "enable_gate_rule": return { title: "Gate rule turned on", detail: d.affectedOrgs ? `${d.affectedOrgs} business${d.affectedOrgs === 1 ? "" : "es"} lost access` : "" };
    case "disable_gate_rule": return { title: "Gate rule turned off", detail: "" };
    case "admin_grant_feature": return { title: "Granted to a business", detail: e.organisationName ?? d.organisationId ?? "" };
    case "admin_revoke_feature": return { title: "Revoked from a business", detail: [e.organisationName ?? d.organisationId, d.reason].filter(Boolean).join(": ") };
    default: return { title: e.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), detail: "" };
  }
}
