import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Layers, Plus, Edit2, Trash2, Loader2, ChevronDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { priceSelection, type PublicPricing } from "@shared/bundles";
import { formatMoney } from "@/lib/pricing";

export interface BundleRow {
  id: string;
  key: string;
  name: string;
  tagline: string;
  featureKeys: string[];
  discountPct: number | string;
  bullets: string[];
  featured: boolean;
  showOnLanding: boolean;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Bundles are a pricing convenience over the feature catalog: a named set of
 * features, discounted while a business holds all of it. They grant nothing,
 * so deleting one never removes anyone's access - it only stops the discount
 * and the landing card. Create and edit live on their own screen (BundleEditor).
 */
export default function Bundles() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isSuperAdmin = admin?.role === "super_admin";

  const { data, isLoading } = useQuery<{ bundles: BundleRow[] }>({ queryKey: ["/api/admin/bundles"] });
  const { data: pricing } = useQuery<PublicPricing>({ queryKey: ["/api/billing/pricing"] });
  const featureByKey = useMemo(() => new Map((pricing?.features ?? []).map((f) => [f.key, f])), [pricing]);
  const currency = pricing?.currency ?? "NGN";

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<BundleRow | null>(null);
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/bundles/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't delete the bundle");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bundles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/pricing"] });
      setDeleting(null);
      toast({ title: "Bundle deleted" });
    },
    onError: (err: Error) => toast({ title: "Couldn't delete the bundle", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Layers className="h-6 w-6" /> Bundles</h1>
          <p className="text-sm text-muted-foreground">
            Named sets of features, discounted while a business holds all of them. They grant nothing themselves, so deleting one never removes anyone's access.
          </p>
        </div>
        {isSuperAdmin && (
          <Button asChild data-testid="button-new-bundle">
            <Link href="/super-admin/bundles/new"><Plus className="mr-2 h-4 w-4" /> New bundle</Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (data?.bundles ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No bundles yet. The landing page will show the Free plan and the build-your-own picker only.</p>
      ) : (
        <div className="space-y-3">
          {(data?.bundles ?? []).map((b) => {
            const r = priceSelection(b.featureKeys, (k) => featureByKey.get(k)?.priceMonthly ?? 0, [{ key: b.key, name: b.name, featureKeys: b.featureKeys, discountPct: Number(b.discountPct) }]);
            const broken = b.featureKeys.filter((k) => !featureByKey.has(k));
            const isOpen = expanded.has(b.id);
            return (
              <Card key={b.id} data-testid={`card-bundle-${b.key}`}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      aria-expanded={isOpen}
                      aria-controls={`bundle-features-${b.id}`}
                      onClick={() => toggle(b.id)}
                    >
                      <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
                      <span className="space-y-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {b.name}
                          {b.featured && <Badge>Featured</Badge>}
                          {!b.isActive && <Badge variant="outline">Inactive</Badge>}
                          {b.isActive && !b.showOnLanding && <Badge variant="outline">Not on landing page</Badge>}
                          {broken.length > 0 && <Badge variant="destructive">{broken.length} unavailable feature{broken.length > 1 ? "s" : ""} - hidden from customers</Badge>}
                        </span>
                        <span className="block text-sm text-muted-foreground">{b.tagline || "No tagline"} · {b.featureKeys.length} features · {Number(b.discountPct)}% off</span>
                      </span>
                    </button>
                    <div className="flex items-center gap-4">
                      <p className="text-right text-sm">
                        {r.discount > 0 && <span className="block text-muted-foreground line-through">{formatMoney(r.subtotal, currency)}</span>}
                        <span className="font-semibold">{formatMoney(r.total, currency)}</span> /month
                      </p>
                      {isSuperAdmin && (
                        <div className="flex gap-1">
                          <Button variant="outline" size="icon" aria-label={`Edit ${b.name}`} onClick={() => navigate(`/super-admin/bundles/${b.id}`)}><Edit2 className="h-4 w-4" /></Button>
                          <Button variant="outline" size="icon" aria-label={`Delete ${b.name}`} onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <ul id={`bundle-features-${b.id}`} className="divide-y border-t bg-muted/30 px-4 text-sm">
                      {b.featureKeys.map((k) => {
                        const f = featureByKey.get(k);
                        return (
                          <li key={k} className="flex items-center justify-between gap-4 py-2">
                            <span className={f ? "" : "text-destructive"}>{f?.name ?? `${k} (unavailable)`}</span>
                            <span className="text-muted-foreground">{f ? formatMoney(f.priceMonthly, currency) : "—"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Its landing card and discount disappear. Nobody loses any feature they have, but a business holding all of its features will
              be charged full price at its next renewal unless another bundle covers them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting.id)} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
