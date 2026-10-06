import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, Package, Gauge, Layers, Gift, Tag } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERMISSION_MODULES } from "@shared/permissionModules";
import { DisableImpactNote, disableAllowed } from "./DisableImpactNote";

const CATEGORIES = ["vendor_mgmt", "staff_mgmt", "customer_mgmt", "financial_mgmt", "tax_compliance", "inventory_mgmt", "analytics", "business_settings"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  vendor_mgmt: "Vendor Management",
  staff_mgmt: "Staff Management",
  customer_mgmt: "Customer Management",
  financial_mgmt: "Financial Management",
  tax_compliance: "Tax, Compliance & Audit",
  inventory_mgmt: "Inventory Management",
  analytics: "Analytics",
  business_settings: "Business & Settings",
};

/** The symbolic keys the enforcement code switches on (shared/features.ts `limitType`). */
const LIMIT_TYPES = [
  { value: "staff_seats", label: "Staff seats", unit: "seats" },
  { value: "customer_count", label: "Customers", unit: "customers" },
  { value: "item_count", label: "Inventory items", unit: "items" },
  { value: "store_count", label: "Stores", unit: "stores" },
] as const;

const TIERS = [
  { value: "free", label: "Free", icon: Gift, blurb: "Available to every business. No price." },
  { value: "paid_flat", label: "Paid", icon: Tag, blurb: "One purchase unlocks it." },
  { value: "paid_metered_limit", label: "Capped add-on", icon: Gauge, blurb: "Free up to a limit, paid beyond it." },
  { value: "bundle_parent", label: "Bundle", icon: Package, blurb: "A purchase that grants its child features." },
  { value: "bundle_child", label: "In a bundle", icon: Layers, blurb: "Only granted through a bundle. No price." },
] as const;

const LIST_PATH = "/super-admin/feature-catalog";

const EMPTY_FORM = {
  key: "",
  name: "",
  description: "",
  category: "staff_mgmt" as string,
  tierType: "paid_flat" as string,
  priceMonthly: "",
  priceAnnual: "",
  freeLimit: "",
  limitType: "" as string,
  tierCapacity: "",
  parentFeatureId: "" as string,
  permissionModule: "none" as string,
  isActive: true,
  confirmKey: "",
};
type FormState = typeof EMPTY_FORM;

const hasPrice = (tier: string) => tier === "paid_flat" || tier === "paid_metered_limit" || tier === "bundle_parent";
const money = (v: string) => (v ? `₦${Number(v).toLocaleString()}` : "—");

/** Create (/feature-catalog/new) or edit (/feature-catalog/:id) one catalog feature. */
export default function FeatureEditor() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
  });
  const features = (data?.features ?? []) as any[];
  const existing = isNew ? undefined : features.find((f) => f.id === id);
  const bundles = features.filter((f) => f.tierType === "bundle_parent" || f.tierType === "paid_metered_limit");

  useEffect(() => {
    if (!existing) return;
    setForm({
      key: existing.key,
      name: existing.name,
      description: existing.description || "",
      category: existing.category,
      tierType: existing.tierType,
      priceMonthly: existing.priceMonthly != null ? String(existing.priceMonthly) : "",
      priceAnnual: existing.priceAnnual != null ? String(existing.priceAnnual) : "",
      freeLimit: existing.freeLimit != null ? String(existing.freeLimit) : "",
      limitType: existing.limitType ?? "",
      tierCapacity: existing.tierCapacity != null ? String(existing.tierCapacity) : "",
      parentFeatureId: existing.parentFeatureId ?? "",
      permissionModule: existing.permissionModule ?? "none",
      isActive: existing.isActive,
      confirmKey: "",
    });
  }, [existing?.id]);

  // Only send what the chosen tier uses, so switching tiers never leaves stale limits or prices behind.
  const buildPayload = () => ({
    key: form.key.trim().toLowerCase().replace(/\s+/g, "_"),
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    category: form.category,
    tierType: form.tierType,
    priceMonthly: hasPrice(form.tierType) && form.priceMonthly ? Number(form.priceMonthly) : null,
    priceAnnual: hasPrice(form.tierType) && form.priceAnnual ? Number(form.priceAnnual) : null,
    freeLimit: form.tierType === "paid_metered_limit" && form.freeLimit !== "" ? Number(form.freeLimit) : null,
    limitType: form.tierType === "paid_metered_limit" ? form.limitType || null : null,
    tierCapacity: form.tierType === "paid_metered_limit" && form.tierCapacity !== "" ? Number(form.tierCapacity) : null,
    parentFeatureId: form.tierType === "bundle_child" ? form.parentFeatureId || null : null,
    permissionModule: form.permissionModule === "none" ? null : form.permissionModule,
    isActive: form.isActive,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const res = isNew
        ? await apiRequest("POST", "/api/admin/feature-catalog", payload)
        : await apiRequest("PUT", `/api/admin/feature-catalog/${id}`, { ...payload, confirmKey: form.confirmKey?.trim() || undefined });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed to ${isNew ? "create" : "update"} feature`);
      return body;
    },
    onSuccess: () => {
      toast({ title: isNew ? "Feature added to the catalog" : "Feature updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast({ title: `Couldn't ${isNew ? "create" : "update"} this feature`, description: err.message, variant: "destructive" }),
  });

  // What still blocks saving, shown beside the button instead of failing on the server.
  const metered = form.tierType === "paid_metered_limit";
  // A built-in unlimited tier stays unlimited; only the price can be edited.
  const unlimitedLocked = metered && !isNew && existing?.tierType === "paid_metered_limit" && existing.tierCapacity == null;
  const missing: string[] = [];
  if (isNew && !form.key.trim()) missing.push("a key");
  if (!form.name.trim()) missing.push("a name");
  if (form.tierType === "paid_metered_limit") {
    if (!form.limitType) missing.push("what is limited");
    if (form.freeLimit === "") missing.push("a free limit");
    if (!unlimitedLocked) {
      if (form.tierCapacity === "") missing.push("a new limit");
      else if (form.freeLimit !== "" && Number(form.tierCapacity) <= Number(form.freeLimit)) missing.push("a new limit above the free limit");
    }
  }
  if (form.tierType === "bundle_child" && !form.parentFeatureId) missing.push("a parent bundle");
  const disableBlocked = !isNew && !form.isActive && !!existing?.isActive && !disableAllowed(form.key, form.confirmKey ?? "");
  const canSave = missing.length === 0 && !disableBlocked && !saveMutation.isPending;

  const tier = TIERS.find((t) => t.value === form.tierType)!;
  const limit = LIMIT_TYPES.find((l) => l.value === form.limitType);
  const parent = bundles.find((b) => b.id === form.parentFeatureId);

  return (
    <div className="space-y-6 font-sans">
      <div>
        <Link href={LIST_PATH} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Feature Catalog
        </Link>
        <h1 className="text-[26px] font-bold tracking-tight mt-2">{isNew ? "Add a feature" : `Edit ${existing?.name ?? "feature"}`}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isNew ? "It becomes purchasable the moment it's active." : "Pricing and activation changes apply immediately, no deploy needed."}
        </p>
      </div>

      {!isNew && isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !isNew && (error || !existing) ? (
        <p className="text-sm text-muted-foreground">Feature not found.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
                <CardDescription>What the feature is called and where it is listed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Name</Label>
                    <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Staff performance tracking" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Key</Label>
                    <Input value={form.key} disabled={!isNew} onChange={(e) => patch({ key: e.target.value })} placeholder="staff_performance_tracking" className="font-mono text-xs" />
                    {!isNew && <p className="text-[11px] text-muted-foreground">The key is permanent. Every gate refers to it.</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} className="min-h-[72px]" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={form.category} onValueChange={(v) => patch({ category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">How it's sold</CardTitle>
                <CardDescription>The tier decides what else this form asks for.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div role="radiogroup" aria-label="Tier" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {TIERS.map((t) => {
                    const selected = form.tierType === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => patch({ tierType: t.value })}
                        className={`text-left rounded-xl border p-3 transition-colors ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"}`}
                      >
                        <t.icon className={`h-4 w-4 mb-2 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                        <p className="text-sm font-semibold">{t.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.blurb}</p>
                      </button>
                    );
                  })}
                </div>

                {form.tierType === "paid_metered_limit" && (
                  <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-border/80 bg-muted/20 p-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">What is limited</Label>
                      <Select value={form.limitType} onValueChange={(v) => patch({ limitType: v })}>
                        <SelectTrigger><SelectValue placeholder="Choose one" /></SelectTrigger>
                        <SelectContent>{LIMIT_TYPES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Free limit</Label>
                      <Input type="number" min={0} value={form.freeLimit} onChange={(e) => patch({ freeLimit: e.target.value })} placeholder="e.g. 2" />
                    </div>
                    <p className="text-[11px] text-muted-foreground sm:col-span-2">
                      Add one feature per step (for example free 30, then 100, then 500). Buying a bigger step replaces the smaller one. The app only enforces a limit type it already has a check for.
                    </p>
                  </div>
                )}

                {form.tierType === "bundle_child" && (
                  <div className="space-y-1.5 rounded-xl border border-border/80 bg-muted/20 p-4">
                    <Label className="text-xs">Parent bundle</Label>
                    <Select value={form.parentFeatureId} onValueChange={(v) => patch({ parentFeatureId: v })}>
                      <SelectTrigger><SelectValue placeholder={bundles.length ? "Choose a bundle" : "No bundles yet"} /></SelectTrigger>
                      <SelectContent>{bundles.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">Anyone who buys the parent gets this feature too.</p>
                  </div>
                )}

                {hasPrice(form.tierType) && (
                  <div className={`grid gap-4 ${metered ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Price / month (₦)</Label>
                      <Input type="number" min={0} value={form.priceMonthly} onChange={(e) => patch({ priceMonthly: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Price / year (₦)</Label>
                      <Input type="number" min={0} value={form.priceAnnual} onChange={(e) => patch({ priceAnnual: e.target.value })} />
                    </div>
                    {metered && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">New limit</Label>
                        {unlimitedLocked ? (
                          <Input value="Unlimited (built-in)" disabled />
                        ) : (
                          <Input
                            type="number"
                            min={1}
                            value={form.tierCapacity}
                            onChange={(e) => patch({ tierCapacity: e.target.value })}
                            placeholder={form.freeLimit !== "" ? `More than ${form.freeLimit}` : "Above the free limit"}
                          />
                        )}
                        <p className="text-[11px] text-muted-foreground">The total a business can have once it buys this.</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Access</CardTitle>
                <CardDescription>Where the feature shows up for a business's roles.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Label className="text-xs">Settings &gt; Roles module</Label>
                <Select value={form.permissionModule} onValueChange={(v) => patch({ permissionModule: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {PERMISSION_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Where this feature is listed on the role form. Custom roles need this module to use its admin-gated pages and routes.</p>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="font-semibold">{form.name.trim() || "Untitled feature"}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{form.key.trim() || "key"}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{tier.label}</Badge>
                  <Badge variant="outline">{CATEGORY_LABELS[form.category]}</Badge>
                </div>
                <dl className="space-y-1.5 text-xs">
                  {hasPrice(form.tierType) && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">Price</dt><dd className="tabular-nums">{money(form.priceMonthly)} / mo · {money(form.priceAnnual)} / yr</dd></div>
                  )}
                  {form.tierType === "paid_metered_limit" && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">Free up to</dt><dd>{form.freeLimit !== "" ? `${form.freeLimit} ${limit?.unit ?? ""}` : "—"}</dd></div>
                  )}
                  {form.tierType === "paid_metered_limit" && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">With add-on</dt><dd>{unlimitedLocked ? "Unlimited" : form.tierCapacity !== "" ? `up to ${form.tierCapacity}` : "—"}</dd></div>
                  )}
                  {form.tierType === "bundle_child" && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">Granted by</dt><dd>{parent?.name ?? "—"}</dd></div>
                  )}
                </dl>
                <div className="flex items-center justify-between border-t border-border/60 pt-3">
                  <Label className="text-xs">{form.isActive ? "Active (purchasable)" : "Inactive"}</Label>
                  <Switch checked={form.isActive} onCheckedChange={(v) => patch({ isActive: v })} />
                </div>
                {!isNew && !form.isActive && existing?.isActive && (
                  <DisableImpactNote featureKey={form.key} typed={form.confirmKey ?? ""} onTyped={(v) => patch({ confirmKey: v })} />
                )}
              </CardContent>
            </Card>

            <div className="space-y-2">
              {missing.length > 0 && <p className="text-xs text-muted-foreground">Still needs {missing.join(", ")}.</p>}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => navigate(LIST_PATH)}>Cancel</Button>
                <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={!canSave}>
                  {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isNew ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
