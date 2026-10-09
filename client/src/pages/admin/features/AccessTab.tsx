import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PagerBar } from "@/components/pager-bar";
import { OrgPicker, type PickedOrg } from "@/components/admin/OrgPicker";
import { StatusBadge, type BadgeTone } from "@/components/admin/StatusBadge";
import type { Paginated } from "@/lib/paginated";
import type { FeatureDetailData } from "./detailTypes";

interface Holder { organisationId: string; name: string; source: string; status: string; removalEffectiveAt: string | null; since: string }
type Counts = Record<string, number>;

const SOURCES: { value: string; label: string; tone: BadgeTone }[] = [
  { value: "purchased", label: "Purchased", tone: "green" },
  { value: "grandfathered", label: "Grandfathered", tone: "blue" },
  { value: "grandfathered_sunset", label: "Sunset", tone: "amber" },
  { value: "admin_grant", label: "Admin grant", tone: "neutral" },
];
const toneOf = (source: string) => SOURCES.find((s) => s.value === source)?.tone ?? "neutral";
const labelOf = (source: string) => SOURCES.find((s) => s.value === source)?.label ?? source;

export function AccessTab({ data, canGrant }: { data: FeatureDetailData; canGrant: boolean }) {
  const { feature } = data;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(q.trim(), 300);
  const [granting, setGranting] = useState(false);
  const [picked, setPicked] = useState<PickedOrg | null>(null);
  const [revoking, setRevoking] = useState<Holder | null>(null);
  const [reason, setReason] = useState("");

  const { data: result, isLoading, isFetching, error, refetch } = useQuery<Paginated<Holder> & { counts: Counts }>({
    queryKey: ["/api/admin/feature-catalog", "access", feature.id, source, debounced, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (source !== "all") params.set("source", source);
      if (debounced) params.set("q", debounced);
      return (await apiRequest("GET", `/api/admin/feature-catalog/${feature.id}/entitlements?${params}`)).json();
    },
    placeholderData: keepPreviousData,
  });
  const counts = result?.counts ?? {};
  const total = Object.values(counts).reduce((n, v) => n + v, 0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog", "access", feature.id] });

  const grant = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/organisations/${picked!.id}/feature-entitlements`, { featureKey: feature.key })).json(),
    onSuccess: () => { toast({ title: "Granted", description: `${picked?.name} now has ${feature.name}.` }); setGranting(false); setPicked(null); refresh(); },
    onError: (err: Error) => toast({ title: "Couldn't grant it", description: err.message, variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/organisations/${revoking!.organisationId}/feature-entitlements/${encodeURIComponent(feature.key)}`, { reason: reason.trim() || undefined })).json(),
    onSuccess: () => { toast({ title: "Revoked", description: `${revoking?.name} no longer has ${feature.name}.` }); setRevoking(null); setReason(""); refresh(); },
    onError: (err: Error) => toast({ title: "Couldn't revoke it", description: err.message, variant: "destructive" }),
  });

  const chip = (value: string, label: string, n: number) => (
    <button
      key={value}
      type="button"
      aria-pressed={source === value}
      onClick={() => { setSource(value); setPage(1); }}
      className={cn("rounded-full border px-3 min-h-9 text-xs font-bold transition-colors", source === value ? "bg-foreground text-background border-foreground" : "bg-background border-border hover:bg-muted")}
    >
      {label} <span className="tabular-nums opacity-80">{n}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by how they got it">
        {chip("all", "All", total)}
        {SOURCES.map((s) => chip(s.value, s.label, counts[s.value] ?? 0))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 rounded-xl bg-background" placeholder="Search businesses" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search businesses" />
        </div>
        {canGrant && <Button className="rounded-xl h-11 sm:h-10" onClick={() => setGranting(true)}>Grant to a business</Button>}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : error ? (
        <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">Couldn't load who has this. <button className="underline" onClick={() => refetch()}>Retry</button></p>
      ) : (result?.data.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{debounced || source !== "all" ? "No business matches." : "No business has this feature yet."}</p>
      ) : (
        <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border overflow-hidden" aria-label="Businesses with this feature">
          {result!.data.map((h) => (
            <li key={`${h.organisationId}-${h.source}`} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="access-row">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground break-words">{h.name}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <StatusBadge tone={toneOf(h.source)}>{labelOf(h.source)}</StatusBadge>
                  {h.removalEffectiveAt && <span className="text-xs text-muted-foreground">ends {new Date(h.removalEffectiveAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
                </div>
              </div>
              {canGrant && (
                <Button size="sm" variant="outline" className="rounded-xl h-9 shrink-0" onClick={() => { setRevoking(h); setReason(""); }}>Revoke</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <PagerBar pagination={result?.pagination} onPage={setPage} busy={isFetching} noun="businesses" />

      <Dialog open={granting} onOpenChange={(o) => !o && !grant.isPending && (setGranting(false), setPicked(null))}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Grant "{feature.name}"</DialogTitle>
            <DialogDescription>The business gets it without paying. It is recorded as an admin grant.</DialogDescription>
          </DialogHeader>
          <OrgPicker value={picked ? [picked] : []} onChange={(next) => setPicked(next[next.length - 1] ?? null)} />
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setGranting(false); setPicked(null); }} disabled={grant.isPending}>Cancel</Button>
            <Button disabled={!picked || grant.isPending} onClick={() => grant.mutate()}>Grant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revoking} onOpenChange={(o) => !o && !revoke.isPending && setRevoking(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Revoke from {revoking?.name}?</DialogTitle>
            <DialogDescription>They lose access straight away, with no grace period. A mistaken grant or a fraud case is the usual reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="revoke-reason">Reason (kept in the history)</Label>
            <Textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl" rows={3} maxLength={500} />
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Cancel</Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
