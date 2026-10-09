import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { apiRequest } from "@/lib/queryClient";
import { GateRulesDialog } from "../GateRulesDialog";
import type { FeatureDetailData } from "./detailTypes";

interface Rule { id: string; kind: string; methods: string; pattern: string; status: "draft" | "active"; note: string | null }
interface Baseline { kind: string; methods: string; pattern: string }

/** What gates this feature today. Changing it uses the full gate-rules dialog, which previews the impact first. */
export function GateRulesTab({ data, canEdit }: { data: FeatureDetailData; canEdit: boolean }) {
  const { feature, registry } = data;
  const [open, setOpen] = useState(false);
  const { data: result, isLoading, error } = useQuery<{ rules: Rule[]; baseline: Baseline[] }>({
    queryKey: ["/api/admin/feature-gate-rules", feature.id],
    queryFn: async () => (await apiRequest("GET", `/api/admin/feature-gate-rules?featureId=${feature.id}`)).json(),
  });
  const rules = result?.rules ?? [];
  const baseline = result?.baseline ?? [];

  return (
    <div className="space-y-4">
      {registry.gatePending && (
        <p className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Nothing in the app is gated for this feature yet. Add a rule, or confirm in code that it needs none.
        </p>
      )}

      <section className="space-y-2" aria-labelledby="own-rules">
        <h3 id="own-rules" className="text-sm font-bold text-foreground">Rules added here</h3>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : error ? (
          <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">Couldn't load the rules.</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">None. The built-in rules below still apply.</p>
        ) : (
          <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-foreground break-all">{r.pattern}</p>
                  <p className="text-xs text-muted-foreground">{r.kind === "screen" ? "Screen" : `API ${r.methods}`}{r.note ? ` · ${r.note}` : ""}</p>
                </div>
                <StatusBadge tone={r.status === "active" ? "green" : "amber"}>{r.status === "active" ? "On" : "Draft"}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button variant="outline" className="rounded-xl h-11 sm:h-9 w-full sm:w-auto" onClick={() => setOpen(true)}>Manage gate rules</Button>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="built-in">
        <h3 id="built-in" className="text-sm font-bold text-foreground">Built into the code</h3>
        {baseline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No built-in rules for this feature.</p>
        ) : (
          <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border">
            {baseline.map((b, i) => (
              <li key={`${b.pattern}-${i}`} className="px-4 py-3">
                <p className="text-sm font-mono text-foreground break-all">{b.pattern}</p>
                <p className="text-xs text-muted-foreground">{b.kind === "screen" ? "Screen" : `API ${b.methods}`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <GateRulesDialog feature={feature} onClose={() => setOpen(false)} />}
    </div>
  );
}
