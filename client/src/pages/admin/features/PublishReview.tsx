import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/loader";
import { isPriced, toFeatureRows } from "./featureRow";
import { missingForPublish, missingSentence, toPublishPayload } from "./reviewQueue";
import { ThresholdsCard } from "./ThresholdsCard";

interface PreviewItem {
  id: string;
  grandfathered: number;
  gatePending: boolean;
  alreadyPublished: boolean;
  dependsOn: { key: string; name: string; pending: boolean; id: string | null }[];
}
interface Draft { included: boolean; monthly: string; annual: string; gateChecked: boolean }

const symbol = (c: string) => (c === "NGN" ? "₦" : `${c} `);

export default function PublishReview() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState(false);
  const search = new URLSearchParams(window.location.search);
  const initialCap = search.get("cap");
  const startAdding = search.get("add") === "1";

  const catalog = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
  });

  const pending = useMemo(
    () => toFeatureRows(catalog.data?.features ?? [], []).filter((r) => r.state === "needs_review").sort((a, b) => a.sortOrder - b.sortOrder),
    [catalog.data],
  );
  const ids = pending.map((r) => r.id);

  const preview = useQuery<{ items: PreviewItem[] }>({
    queryKey: ["/api/admin/feature-catalog/publish-preview", ids.join(",")],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/admin/feature-catalog/publish-preview", { ids });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to preview");
      return json;
    },
    enabled: ids.length > 0,
  });
  const previewById = new Map((preview.data?.items ?? []).map((p) => [p.id, p]));

  // Seed a draft for each pending feature the first time it shows up, keeping anything already typed.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of pending) {
        if (!next[r.id]) next[r.id] = { included: true, monthly: r.price != null ? String(r.price) : "", annual: "", gateChecked: false };
      }
      return next;
    });
  }, [pending]);

  const patch = (id: string, change: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...change } }));

  const queueItems = pending.map((r) => {
    const d = drafts[r.id] ?? { included: true, monthly: "", annual: "", gateChecked: false };
    return { id: r.id, name: r.name, tier: r.tier, included: d.included, monthly: d.monthly, annual: d.annual, gatePending: previewById.get(r.id)?.gatePending ?? r.gatePending, gateChecked: d.gateChecked };
  });
  const missing = missingForPublish(queueItems);
  const included = queueItems.filter((i) => i.included);
  const totalGrandfathered = included.reduce((n, i) => n + (previewById.get(i.id)?.grandfathered ?? 0), 0);
  const ready = included.length > 0 && missing.length === 0 && !preview.isLoading;

  const publish = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/feature-catalog/publish", { items: toPublishPayload(queueItems) });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.error || "Failed to publish");
      return json as { success: boolean; results: { key: string; ok: boolean; error?: string }[]; grandfathered: number };
    },
    onSuccess: (body) => {
      const ok = body.results.filter((r) => r.ok).length;
      const failed = body.results.filter((r) => !r.ok);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
      setConfirming(false);
      if (failed.length) {
        toast({ title: `${ok} published, ${failed.length} failed`, description: failed.map((f) => `${f.key}: ${f.error}`).join(" "), variant: "destructive" });
        return;
      }
      toast({
        title: `${ok} feature${ok === 1 ? "" : "s"} published`,
        description: body.grandfathered ? `${body.grandfathered} existing business grant${body.grandfathered === 1 ? "" : "s"} made, free.` : "Now live and purchasable.",
      });
      navigate("/super-admin/features");
    },
    onError: (err: Error) => { setConfirming(false); toast({ title: "Couldn't publish", description: err.message, variant: "destructive" }); },
  });

  const back = (
    <button type="button" onClick={() => navigate("/super-admin/features")} className="inline-flex items-center gap-1 text-sm font-semibold text-primary min-h-11">
      <ChevronLeft className="h-4 w-4" /> Features
    </button>
  );

  return (
    <div className="space-y-5 font-sans max-w-3xl">
      <div>
        {back}
        <h1 className="text-[26px] font-bold text-foreground tracking-tight">Review new features</h1>
        <p className="text-muted-foreground text-sm mt-1">Added by a release and hidden until published. Price each one, check the impact, then publish together.</p>
      </div>

      {!catalog.isLoading && !catalog.error && <ThresholdsCard canEdit={canEdit} initialCap={initialCap} startOpen={startAdding} />}

      {catalog.isLoading ? (
        <div className="flex justify-center py-12"><Spinner className="h-8 w-8 animate-spin text-primary" /></div>
      ) : catalog.error ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="flex-1">Couldn't load the review queue.</span>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => catalog.refetch()}>Retry</Button>
        </div>
      ) : pending.length === 0 ? (
        <div className="text-center py-16 bg-card/20 border border-border/80 rounded-2xl">
          <h3 className="text-sm font-bold text-foreground">Nothing to review</h3>
          <p className="text-xs text-muted-foreground mt-1">New features from a release appear here until you publish them.</p>
          <Button variant="outline" className="mt-4 rounded-xl" onClick={() => navigate("/super-admin/features")}>Back to features</Button>
        </div>
      ) : (
        <>
          {preview.error && (
            <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">Couldn't load the impact preview, so publishing is paused. Reload to try again.</p>
          )}
          <ul className="space-y-4">
            {pending.map((r) => {
              const d = drafts[r.id];
              const p = previewById.get(r.id);
              const priced = isPriced(r.tier);
              if (!d) return null;
              const depIncluded = (depId: string | null) => !!depId && pending.some((x) => x.id === depId && drafts[x.id]?.included);
              return (
                <li key={r.id} className={`rounded-2xl border-2 p-4 sm:p-5 space-y-4 ${d.included ? "border-primary/60 bg-card/40" : "border-border/80 bg-card/20 opacity-70"}`} data-testid={`review-item-${r.key}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox id={`inc-${r.id}`} checked={d.included} onCheckedChange={(v) => patch(r.id, { included: v === true })} disabled={!canEdit} className="mt-1 h-5 w-5" aria-label={`Include ${r.name}`} />
                    <div className="min-w-0">
                      <p className="font-bold text-foreground break-words">{r.name}</p>
                      <code className="text-[11px] font-mono text-muted-foreground break-all">{r.key}</code>
                      {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                    </div>
                  </div>

                  {priced ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {([["Monthly price", "monthly"], ["Annual price", "annual"]] as const).map(([label, field]) => (
                        <div key={field} className="space-y-1">
                          <Label className="text-xs" htmlFor={`${field}-${r.id}`}>{label}</Label>
                          <div className="flex">
                            <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-border bg-muted text-sm text-muted-foreground">{symbol(r.currency).trim()}</span>
                            <Input id={`${field}-${r.id}`} type="number" min={0} inputMode="decimal" value={d[field]} onChange={(e) => patch(r.id, { [field]: e.target.value })} disabled={!canEdit} className="rounded-l-none rounded-r-xl h-11 sm:h-10" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{r.tier === "bundle_child" ? "Priced with its bundle." : "Free, so there is no price to set."}</p>
                  )}

                  <div className="rounded-xl bg-muted/60 px-4 py-3 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Impact if published</p>
                    {!p ? (
                      <p className="text-sm text-muted-foreground">{preview.isLoading ? "Checking…" : "Preview unavailable."}</p>
                    ) : (
                      <>
                        <p className="text-sm text-foreground">
                          {p.grandfathered > 0
                            ? `${p.grandfathered} existing business${p.grandfathered === 1 ? "" : "es"} get it free (grandfathered), because it used to be free.`
                            : "No existing business is granted it. Businesses get it only by buying it."}
                        </p>
                        {p.gatePending && <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Gate rules not confirmed yet</p>}
                        {p.dependsOn.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No dependencies</p>
                        ) : (
                          p.dependsOn.map((dep) => (
                            <p key={dep.key} className="text-xs text-muted-foreground">
                              Needs {dep.name}
                              {dep.pending ? (depIncluded(dep.id) ? " (also in this queue)" : " (not published yet, so this stays hidden until it is)") : ""}
                            </p>
                          ))
                        )}
                      </>
                    )}
                  </div>

                  {p?.gatePending && (
                    <div className="flex items-center gap-3">
                      <Checkbox id={`gate-${r.id}`} checked={d.gateChecked} onCheckedChange={(v) => patch(r.id, { gateChecked: v === true })} disabled={!canEdit || !d.included} className="h-5 w-5" />
                      <Label htmlFor={`gate-${r.id}`} className="text-sm font-semibold cursor-pointer">I checked the gate rules for this feature</Label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-3 z-10 rounded-2xl border border-border bg-background/95 backdrop-blur shadow-sm">
            <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className={`text-xs flex-1 ${missing.length ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`} role="status">
                {included.length === 0 ? "Include at least one feature." : missingSentence(missing) || `${included.length} feature${included.length === 1 ? "" : "s"} ready to publish.`}
              </p>
              {canEdit ? (
                <Button className="rounded-xl h-11 sm:h-10 w-full sm:w-auto" disabled={!ready || publish.isPending} onClick={() => setConfirming(true)} data-testid="button-publish-all">
                  Publish {included.length} feature{included.length === 1 ? "" : "s"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Only a super admin can publish.</p>
              )}
            </div>
          </div>

          <Dialog open={confirming} onOpenChange={(o) => !o && !publish.isPending && setConfirming(false)}>
            <DialogContent className="max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle>Publish {included.length} feature{included.length === 1 ? "" : "s"}?</DialogTitle>
                <DialogDescription>
                  Businesses will be able to see {included.length === 1 ? "it" : "them"} straight away.{" "}
                  {totalGrandfathered > 0
                    ? `${totalGrandfathered} free grant${totalGrandfathered === 1 ? "" : "s"} will be made to existing businesses.`
                    : "No existing business is granted any of them for free."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={publish.isPending}>Cancel</Button>
                <Button onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending ? "Publishing…" : "Publish"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
