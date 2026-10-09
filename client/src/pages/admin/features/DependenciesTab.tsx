import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FeatureDetailData } from "./detailTypes";

interface Needed { dependencyId: string; id: string; key: string; name: string; fromRegistry?: boolean }

export function DependenciesTab({ data, canEdit }: { data: FeatureDetailData; canEdit: boolean }) {
  const { feature } = data;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState("");
  const key = ["/api/admin/feature-catalog", "dependencies", feature.id];

  const deps = useQuery<{ needs: Needed[]; neededBy: Needed[] }>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/admin/feature-catalog/${feature.id}/dependencies`)).json(),
  });
  const catalog = useQuery<{ features: { id: string; key: string; name: string }[] }>({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
  });

  const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/feature-catalog/${feature.id}/dependencies`, { dependsOnFeatureId: adding })).json(),
    onSuccess: () => { setAdding(""); queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] }); toast({ title: "Dependency added" }); },
    onError: (err) => toast({ title: "Couldn't add the dependency", description: errorMessage(err), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (dependencyId: string) => (await apiRequest("DELETE", `/api/admin/feature-catalog/dependencies/${dependencyId}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] }); toast({ title: "Dependency removed" }); },
    onError: (err) => toast({ title: "Couldn't remove the dependency", description: errorMessage(err), variant: "destructive" }),
  });

  if (deps.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (deps.error || !deps.data) return <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">Couldn't load the dependencies.</p>;
  const { needs, neededBy } = deps.data;
  const taken = new Set([feature.id, ...needs.map((n) => n.id)]);
  const options = (catalog.data?.features ?? []).filter((f) => !taken.has(f.id)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        A business must hold everything this feature needs before it can buy it. These are checked at purchase time.
      </p>

      <section className="space-y-2" aria-labelledby="needs-h">
        <h3 id="needs-h" className="text-sm font-bold text-foreground">Needs these first</h3>
        {needs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing.</p> : (
          <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border">
            {needs.map((n) => (
              <li key={n.dependencyId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{n.name}</p>
                  <code className="text-[11px] font-mono text-muted-foreground break-all">{n.key}</code>
                </div>
                {n.fromRegistry ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground" title="Defined in the code registry">
                    <Lock className="h-3 w-3" /> In code
                  </span>
                ) : canEdit && (
                  <Button size="sm" variant="outline" className="h-9 w-9 p-0 rounded-xl" aria-label={`Remove ${n.name}`} disabled={remove.isPending} onClick={() => remove.mutate(n.dependencyId)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger className="rounded-xl bg-background" aria-label="Add a dependency"><SelectValue placeholder="Add a feature it needs…" /></SelectTrigger>
              <SelectContent>{options.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="rounded-xl h-11 sm:h-10" disabled={!adding || add.isPending} onClick={() => add.mutate()}>Add</Button>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="by-h">
        <h3 id="by-h" className="text-sm font-bold text-foreground">Needed by</h3>
        {neededBy.length === 0 ? <p className="text-sm text-muted-foreground">No other feature needs this one.</p> : (
          <ul className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border">
            {neededBy.map((n) => (
              <li key={n.dependencyId} className="px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{n.name}</p>
                <code className="text-[11px] font-mono text-muted-foreground break-all">{n.key}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
