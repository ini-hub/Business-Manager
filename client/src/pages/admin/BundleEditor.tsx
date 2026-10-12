import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
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
import { BUSINESS_STRUCTURES, BUSINESS_STRUCTURE_LABELS } from "@shared/schema/_helpers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_LABELS, formatMoney } from "@/lib/pricing";
import type { BundleRow } from "./Bundles";
import { Spinner } from "@/components/ui/loader";

const EMPTY = {
  name: "", tagline: "", featureKeys: [] as string[], discountPct: "0", bullets: "",
  fixedPriceMonthly: "", fixedPriceAnnual: "", businessStructure: "none",
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
      fixedPriceMonthly: existing.fixedPriceMonthly == null ? "" : String(Number(existing.fixedPriceMonthly)),
      fixedPriceAnnual: existing.fixedPriceAnnual == null ? "" : String(Number(existing.fixedPriceAnnual)),
      businessStructure: existing.businessStructure ?? "none",
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

  // A blank fixed price means "use the % discount" for that cycle.
  const fixedOf = (v: string) => (v.trim() === "" ? null : Number(v));
  const previewFor = (cycle: "monthly" | "annual") => {
    const pct = Number(form.discountPct) || 0;
    const fixed = fixedOf(cycle === "annual" ? form.fixedPriceAnnual : form.fixedPriceMonthly);
    return priceSelection(
      form.featureKeys,
      (k) => { const f = featureByKey.get(k); return (cycle === "annual" ? f?.priceAnnual : f?.priceMonthly) ?? 0; },
      [{ key: "preview", name: form.name, featureKeys: form.featureKeys, discountPct: pct, fixedPrice: fixed != null && Number.isFinite(fixed) ? fixed : null }],
    );
  };
  const preview = useMemo(() => previewFor("monthly"), [form.featureKeys, form.discountPct, form.fixedPriceMonthly, form.name, featureByKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewAnnual = useMemo(() => previewFor("annual"), [form.featureKeys, form.discountPct, form.fixedPriceAnnual, form.name, featureByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name, tagline: form.tagline, featureKeys: form.featureKeys, discountPct: Number(form.discountPct),
        fixedPriceMonthly: fixedOf(form.fixedPriceMonthly), fixedPriceAnnual: fixedOf(form.fixedPriceAnnual),
        businessStructure: form.businessStructure === "none" ? null : form.businessStructure,
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

  if (!isNew && isLoading) return <div className="p-6"><Spinner className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
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
        <h1>{isNew ? "New bundle" : `Edit ${existing?.name}`}</h1>
        <p className="text-sm text-muted-foreground">Pick what is in it. The price is the members' catalog prices, less the discount, while a business holds all of them.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
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
            <div className="space-y-2">
              <Label htmlFor="bundle-fixed-monthly">Fixed price per month (optional)</Label>
              <Input id="bundle-fixed-monthly" type="number" min={0} value={form.fixedPriceMonthly} placeholder="Blank = use the discount"
                onChange={(e) => setForm({ ...form, fixedPriceMonthly: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bundle-fixed-annual">Fixed price per year (optional)</Label>
              <Input id="bundle-fixed-annual" type="number" min={0} value={form.fixedPriceAnnual} placeholder="Blank = use the discount"
                onChange={(e) => setForm({ ...form, fixedPriceAnnual: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              A fixed price replaces the feature-by-feature total (and the discount) while a business holds every feature in this bundle.
              It can never charge more than the features' list prices. Features outside the bundle still bill at list.
            </p>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bundle-structure">Recommended for</Label>
              <Select value={form.businessStructure} onValueChange={(v) => setForm({ ...form, businessStructure: v })}>
                <SelectTrigger id="bundle-structure" className="sm:w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No business type</SelectItem>
                  {BUSINESS_STRUCTURES.map((k) => <SelectItem key={k} value={k}>{BUSINESS_STRUCTURE_LABELS[k].name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Businesses of this type open checkout on this bundle when their trial ends. One active bundle per type.</p>
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
          <CardTitle>Features in this bundle ({form.featureKeys.length})</CardTitle>
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
          {" · "}<strong>{formatMoney(previewAnnual.total, currency)}</strong> /year
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/super-admin/bundles")}>Cancel</Button>
          {isSuperAdmin && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim() || form.featureKeys.length === 0}>
              {save.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
