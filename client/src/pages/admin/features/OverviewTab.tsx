import { useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { FEATURE_SECTION_LABELS } from "@shared/features";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { GateRulesDialog } from "../GateRulesDialog";
import { TIER_LABEL, isPriced } from "./featureRow";
import type { FeatureDetailData } from "./detailTypes";

const BANNER = {
  hidden: { text: "Hidden from customers", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
  scoped: { text: "Visible to the scoped businesses only", cls: "bg-primary/10 text-primary" },
  visible: { text: "Visible to customers", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
} as const;

const RESULT = {
  pass: { label: "Pass", tone: "green" },
  blocks: { label: "Blocks", tone: "rose" },
  note: { label: "Scoped", tone: "blue" },
} as const;

export function OverviewTab({ data, canEdit }: { data: FeatureDetailData; canEdit: boolean }) {
  const { feature, visibility, registry } = data;
  const [gating, setGating] = useState(false);
  const banner = BANNER[visibility.status];
  const limits = [
    feature.freeLimit != null ? `${feature.freeLimit} free included` : null,
    feature.tierCapacity != null ? `up to ${feature.tierCapacity} in total` : null,
  ].filter(Boolean).join(", ");

  const fields: [string, string][] = [
    ["Name", feature.name],
    ["Description", feature.description || "None"],
    ["Tier", TIER_LABEL[feature.tierType] ?? feature.tierType],
    ["Section", feature.section ? (FEATURE_SECTION_LABELS as Record<string, string>)[feature.section] ?? feature.section : "Other"],
    ["Parent", registry.parentKey ?? "None"],
    ["Limits", limits || "None"],
    ["Permission module", feature.permissionModule ?? "None"],
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className={`rounded-xl px-4 py-3 text-sm font-bold ${banner.cls}`} data-testid="visibility-banner">{banner.text}</p>
        <p className="text-xs text-muted-foreground">
          Customers see a feature only when it is active, its flag isn't off, and its parent and dependencies are visible.
        </p>
      </div>

      <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border overflow-hidden" aria-label="Visibility checks">
        {visibility.checks.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`check-${c.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">{c.label}</p>
              <p className="text-xs text-muted-foreground break-words">{c.detail}</p>
            </div>
            <StatusBadge tone={RESULT[c.result].tone}>{RESULT[c.result].label}</StatusBadge>
          </li>
        ))}
      </ul>

      {registry.gatePending && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3" data-testid="gate-pending-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1 space-y-2">
            <p className="text-sm text-amber-900 dark:text-amber-200">Gate rules aren't confirmed. Check them before publishing or selling.</p>
            {canEdit && isPriced(feature.tierType) && (
              <Button size="sm" variant="outline" className="rounded-xl h-9" onClick={() => setGating(true)}>Open gate rules</Button>
            )}
          </div>
        </div>
      )}

      <section aria-labelledby="from-code" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="from-code" className="text-sm font-bold text-foreground">From the code</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground">
            <Lock className="h-3 w-3" /> Managed in code, synced on deploy
          </span>
        </div>
        <dl className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border">
          {fields.map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-0.5 sm:gap-3 px-4 py-3">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="text-sm text-foreground break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          To change these, edit the feature registry in code. Edits made here would be overwritten on the next deploy, so they are read-only.
        </p>
        {!registry.inRegistry && (
          <p className="text-xs text-amber-700 dark:text-amber-400">This feature is not in the code registry, so the next sync may flag it as database-only.</p>
        )}
      </section>

      {gating && <GateRulesDialog feature={feature} onClose={() => setGating(false)} />}
    </div>
  );
}
