import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { planThreshold, priceWarning, isCapType, type CapType, type LadderStep } from "@shared/thresholds";

interface CapInfo { limitType: CapType; label: string; unit: string; freeLimit: number; ladder: LadderStep[] }

const STATE_LABEL = { live: "Live", needs_review: "Needs review", inactive: "Inactive" } as const;
const STATE_TONE = { live: "green", needs_review: "amber", inactive: "neutral" } as const;

export const thresholdsKey = ["/api/admin/feature-catalog", "thresholds"];

/**
 * Paid steps above a feature's free cap. Adding one queues a catalog row as Needs review: nothing changes for
 * businesses until it is published from the same page.
 */
export function ThresholdsCard({ canEdit, initialCap, startOpen }: { canEdit: boolean; initialCap?: string | null; startOpen?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<CapType | null>(isCapType(initialCap) ? initialCap : null);
  const [adding, setAdding] = useState(!!startOpen && canEdit);
  const [limit, setLimit] = useState("");
  const [monthly, setMonthly] = useState("");
  const [annual, setAnnual] = useState("");

  const { data, isLoading, error } = useQuery<{ caps: CapInfo[] }>({
    queryKey: thresholdsKey,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/feature-catalog/thresholds");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load thresholds");
      return json;
    },
  });
  const caps = data?.caps ?? [];
  const cap = caps.find((c) => c.limitType === picked) ?? caps[0];

  const limitNum = limit.trim() === "" ? NaN : Number(limit);
  const plan = useMemo(
    () => cap && !Number.isNaN(limitNum)
      ? planThreshold({ cap: cap.limitType, limit: limitNum, freeLimit: cap.freeLimit, ladder: cap.ladder, existingKeys: new Set(caps.flatMap((c) => c.ladder.map((s) => s.key))) })
      : null,
    [cap, caps, limitNum],
  );
  const monthlyNum = monthly.trim() === "" ? null : Number(monthly);
  const warning = plan ? priceWarning(monthlyNum, plan.below, plan.above) : null;
  const canAdd = !!plan && plan.problems.length === 0 && monthlyNum != null && monthlyNum >= 0 && !Number.isNaN(monthlyNum);

  const add = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/feature-catalog/thresholds", {
        limitType: cap!.limitType,
        limit: limitNum,
        priceMonthly: monthlyNum,
        priceAnnual: annual.trim() === "" ? null : Number(annual),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add the threshold");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Added to review", description: "Nothing changes for businesses until you publish it." });
      setLimit(""); setMonthly(""); setAnnual(""); setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
    },
    onError: (err: Error) => toast({ title: "Couldn't add the threshold", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  if (error || !cap) return null;

  return (
    <section className="rounded-2xl border border-border/80 bg-card/40 p-4 sm:p-5 space-y-4" aria-labelledby="thr-h" data-testid="thresholds-card">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 id="thr-h" className="text-base font-bold text-foreground">Cap thresholds</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Any capped feature can have paid thresholds above its free cap. Pick the cap, then add a limit.</p>
        </div>
        {canEdit && !adding && (
          <Button variant="outline" className="rounded-xl h-11 sm:h-9 w-full sm:w-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add threshold
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cap">
        {caps.map((c) => {
          const active = c.limitType === cap.limitType;
          const packs = c.ladder.filter((s) => s.capacity !== null).length;
          return (
            <button
              key={c.limitType}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPicked(c.limitType)}
              className={cn("rounded-full border px-4 min-h-10 text-sm font-semibold transition-colors", active ? "bg-foreground text-background border-foreground" : "bg-background border-border hover:bg-muted")}
            >
              {c.label}{packs ? ` (${packs})` : ""}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-2" aria-label={`${cap.label} ladder`}>
        <li className="rounded-xl border border-border bg-background px-3 py-2 min-w-[8.5rem]">
          <p className="text-sm font-bold text-foreground">{cap.freeLimit} {cap.unit.replace(/ per store$/, "")}</p>
          <p className="text-xs text-muted-foreground">Free</p>
          <StatusBadge tone="neutral" className="mt-1">Free cap</StatusBadge>
        </li>
        {cap.ladder.map((s) => (
          <li key={s.key} className="rounded-xl border border-border bg-background px-3 py-2 min-w-[8.5rem]">
            <p className="text-sm font-bold text-foreground">{s.capacity === null ? "Unlimited" : `Up to ${s.capacity} ${cap.unit.replace(/ per store$/, "")}`}</p>
            <p className="text-xs text-muted-foreground">{s.priceMonthly != null ? `${s.priceMonthly.toLocaleString()}/mo` : "Not priced"}</p>
            <StatusBadge tone={STATE_TONE[s.state]} className="mt-1">{STATE_LABEL[s.state]}</StatusBadge>
          </li>
        ))}
      </ul>

      {adding && canEdit && (
        <form
          className="rounded-2xl border-2 border-primary/50 p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (canAdd) add.mutate(); }}
          aria-label={`New threshold for ${cap.label}`}
        >
          <h3 className="text-sm font-bold text-foreground">New threshold for {cap.label}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="thr-limit">Limit</Label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-border bg-muted text-sm text-muted-foreground">Up to</span>
                <Input id="thr-limit" type="number" min={2} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} className="rounded-none h-11 sm:h-10 min-w-0" />
                <span className="inline-flex items-center px-3 rounded-r-xl border border-l-0 border-border bg-muted text-xs text-muted-foreground whitespace-nowrap">{cap.unit.split(" ")[0]}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="thr-monthly">Monthly price</Label>
              <Input id="thr-monthly" type="number" min={0} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="rounded-xl h-11 sm:h-10" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="thr-annual">Annual price (optional)</Label>
              <Input id="thr-annual" type="number" min={0} inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} className="rounded-xl h-11 sm:h-10" />
            </div>
          </div>

          {plan && (
            <div className="rounded-xl bg-muted/60 px-4 py-3 space-y-1" aria-live="polite">
              <p className="text-sm font-bold text-foreground">{plan.name}</p>
              <code className="text-[11px] font-mono text-muted-foreground block">{plan.key}</code>
              {plan.problems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {plan.below || plan.above
                    ? `Sits between ${plan.below?.name ?? `the free cap of ${cap.freeLimit}`} and ${plan.above?.name ?? "the top"}. `
                    : ""}
                  {plan.description}
                </p>
              ) : (
                plan.problems.map((p) => <p key={p} className="text-xs text-rose-700 dark:text-rose-300">{p}</p>)
              )}
              {warning && <p className="text-xs text-amber-800 dark:text-amber-300">{warning}</p>}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">Added to this queue as Needs review. Nothing changes for businesses until you publish.</p>
            <Button type="button" variant="outline" className="rounded-xl h-11 sm:h-9" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" className="rounded-xl h-11 sm:h-9" disabled={!canAdd || add.isPending}>{add.isPending ? "Adding…" : "Add to review"}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
