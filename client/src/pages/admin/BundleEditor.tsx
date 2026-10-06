import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { priceSelection, type PublicPricing } from "@shared/bundles";
import { CATEGORY_LABELS, formatMoney } from "@/lib/pricing";
import type { BundleRow } from "./Bundles";

const EMPTY = {
  name: "", tagline: "", featureKeys: [] as string[], discountPct: "0", bullets: "",
  featured: false, showOnLanding: true, isActive: true, sortOrder: "0",
};

/**
 * Create (/super-admin/bundles/new) or edit (/super-admin/bundles/:id) one
 * bundle on its own screen. A bundle grants nothing - it only prices a set of
 * catalog features while a business holds all of them - see shared/bundles.ts.
 */
export default function BundleEditor() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const [, navigate] = useLocation();
  const { admin } = useAdminAuth();
  const { toast } = useToast();
  const isSuperAdmin = admin?.role === "super_admin";

  const { data, isLoading } = useQuery<{ bundles: BundleRow[] }>({ queryKey: ["/api/admin/bundles"], enabled: !isNew });
  // Active sold features with their sold dependencies - exactly what a bundle may contain.
  const { data: pricing } = useQuery<PublicPricing>({ queryKey: ["/api/billing/pricing"] });
  const features = pricing?.features ?? [];
  const featureByKey = useMemo(() => new Map(features.map((f) => [f.key, f])), [features]);
  const currency = pricing?.currency ?? "NGN";

  const existing = data?.bundles.find((b) => b.id === id);
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name, tagline: existing.tagline, featureKeys: existing.featureKeys, discountPct: String(Number(existing.discountPct)),
      bullets: existing.bullets.join("\n"), featured: existing.featured, showOnLanding: existing.showOnLanding, isActive: existing.isActive,
      sortOrder: String(existing.sortOrder),
    });
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFeature = (key: string) => {
    setForm((f) => {
      const next = new Set(f.featureKeys);
      if (next.has(key)) {
        next.delete(key);
        // Dropping a feature also drops anything that cannot work without it.
        let changed = true;
        while (changed) {
          changed = false;
          next.forEach((k) => {
            if (featureByKey.get(k)?.dependsOn.some((d) => !next.has(d))) { next.delete(k); changed = true; }
          });
        }
      } else {
        const add = (k: string) => {
          if (next.has(k)) return;
          next.add(k);
          featureByKey.get(k)?.dependsOn.forEach(add);
        };
        add(key);
      }
      return { ...f, featureKeys: Array.from(next) };
    });
  };

  const preview = useMemo(() => {
    const pct = Number(form.discountPct) || 0;
    return priceSelection(form.featureKeys, (k) => featureByKey.get(k)?.priceMonthly ?? 0, [{ key: "preview", name: form.name, featureKeys: form.featureKeys, discountPct: pct }]);
  }, [form.featureKeys, form.discountPct, form.name, featureByKey]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name, tagline: form.tagline, featureKeys: form.featureKeys, discountPct: Number(form.discountPct),
        bullets: form.bullets.split("\n").map((l) => l.trim()).filter(Boolean),
        featured: form.featured, showOnLanding: form.showOnLanding, isActive: form.isActive, sortOrder: Number(form.sortOrder) || 0,
      };
      const res = await apiRequest(isNew ? "POST" : "PUT", isNew ? "/api/admin/bundles" : `/api/admin/bundles/${id}`, payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't save the bundle");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bundles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/pricing"] });
      toast({ title: "Bundle saved", description: "The landing page and checkout use it now." });
      navigate("/super-admin/bundles");
    },
    onError: (err: Error) => toast({ title: "Couldn't save the bundle", description: err.message, variant: "destructive" }),
  });

  const byCategory = features.reduce<Record<string, PublicPricing["features"]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  if (!isNew && isLoading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!isNew && !existing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">That bundle no longer exists.</p>
        <Link href="/super-admin/bundles" className="text-sm underline">Back to bundles</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/super-admin/bundles" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Bundles
        </Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New bundle" : `Edit ${existing?.name}`}</h1>
        <p className="text-sm text-muted-foreground">Pick what is in it. The price is the members' catalog prices, less the discount, while a business holds all of them.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bundle-name">Name</Label>
              <Input id="bundle-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bundle-discount">Discount (%)</Label>
              <Input id="bundle-discount" type="number" min={0} max={90} value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bundle-tagline">Tagline</Label>
              <Input id="bundle-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="For shops selling on credit" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bundle-bullets">Landing bullets (one per line)</Label>
              <Textarea id="bundle-bullets" rows={3} value={form.bullets} onChange={(e) => setForm({ ...form, bullets: e.target.value })} placeholder="Leave empty to list the features automatically" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} /> Active</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.showOnLanding} onCheckedChange={(v) => setForm({ ...form, showOnLanding: v })} /> Show on landing page</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} /> Most popular</label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bundle-order">Display order</Label>
            <Input id="bundle-order" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="w-28" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Features in this bundle ({form.featureKeys.length})</CardTitle>
          <CardDescription>Ticking a feature also adds anything it needs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat} className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[cat] ?? cat}</p>
              {list.map((f) => (
                <label key={f.key} className="flex items-center gap-3 py-1 text-sm">
                  <Checkbox checked={form.featureKeys.includes(f.key)} onCheckedChange={() => toggleFeature(f.key)} />
                  <span className="flex-1">{f.name}</span>
                  <span className="text-muted-foreground">{formatMoney(f.priceMonthly, currency)}</span>
                </label>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-3">
        <p className="text-sm" aria-live="polite">
          Customers pay <strong>{formatMoney(preview.total, currency)}</strong> /month
          {preview.discount > 0 && <> (instead of {formatMoney(preview.subtotal, currency)}, saving {formatMoney(preview.discount, currency)})</>}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/super-admin/bundles")}>Cancel</Button>
          {isSuperAdmin && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim() || form.featureKeys.length === 0}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
