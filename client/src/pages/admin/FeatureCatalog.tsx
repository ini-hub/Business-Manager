import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tag, Plus, Edit2, Loader2, AlertCircle, Lock, Sunset } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
const TIER_TYPES = ["free", "paid_flat", "paid_metered_limit", "bundle_parent", "bundle_child"] as const;

/**
 * The monetization catalog super admins price - a separate concern from
 * Feature Flags (a release kill-switch), see shared/schema/entitlements.ts.
 * This is the surface that satisfies FAC-1: create, price, categorize, and
 * activate/deactivate any feature without a code deploy.
 */
export default function FeatureCatalog() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();
  const isSuperAdmin = admin?.role === "super_admin";

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [sunsetting, setSunsetting] = useState<any>(null);
  const [sunsetDate, setSunsetDate] = useState("");

  const [form, setForm] = useState({
    key: "",
    name: "",
    description: "",
    category: "staff_mgmt" as string,
    tierType: "paid_flat" as string,
    priceMonthly: "",
    priceAnnual: "",
    freeLimit: "",
    isActive: true,
  });

  const resetForm = () =>
    setForm({ key: "", name: "", description: "", category: "staff_mgmt", tierType: "paid_flat", priceMonthly: "", priceAnnual: "", freeLimit: "", isActive: true });

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/admin/feature-catalog", payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create feature");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Feature added to the catalog" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
      setShowCreate(false);
      resetForm();
    },
    onError: (err: Error) => toast({ title: "Couldn't create this feature", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const res = await apiRequest("PUT", `/api/admin/feature-catalog/${id}`, patch);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update feature");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Feature updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
      setEditing(null);
    },
    onError: (err: Error) => toast({ title: "Couldn't update this feature", description: err.message, variant: "destructive" }),
  });

  const sunsetMutation = useMutation({
    mutationFn: async ({ id, paywallEffectiveAt }: { id: string; paywallEffectiveAt: string }) => {
      const res = await apiRequest("POST", `/api/admin/feature-catalog/${id}/schedule-sunset`, { paywallEffectiveAt });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to schedule this transition");
      return body;
    },
    onSuccess: (body) => {
      toast({ title: "Sunset scheduled", description: `${body.affectedOrgs} business${body.affectedOrgs === 1 ? "" : "es"} notified on a staged 30/7/1-day schedule.` });
      setSunsetting(null);
      setSunsetDate("");
    },
    onError: (err: Error) => toast({ title: "Couldn't schedule this transition", description: err.message, variant: "destructive" }),
  });

  const openEdit = (f: any) => {
    setEditing(f);
    setForm({
      key: f.key,
      name: f.name,
      description: f.description || "",
      category: f.category,
      tierType: f.tierType,
      priceMonthly: f.priceMonthly != null ? String(f.priceMonthly) : "",
      priceAnnual: f.priceAnnual != null ? String(f.priceAnnual) : "",
      freeLimit: f.freeLimit != null ? String(f.freeLimit) : "",
      isActive: f.isActive,
    });
  };

  const buildPayload = () => ({
    key: form.key.trim().toLowerCase().replace(/\s+/g, "_"),
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    category: form.category,
    tierType: form.tierType,
    priceMonthly: form.priceMonthly ? Number(form.priceMonthly) : null,
    priceAnnual: form.priceAnnual ? Number(form.priceAnnual) : null,
    freeLimit: form.freeLimit ? Number(form.freeLimit) : null,
    isActive: form.isActive,
  });

  const features = (data?.features ?? []) as any[];
  const byCategory = features.reduce<Record<string, any[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Feature Catalog</h1>
          <p className="text-muted-foreground text-sm mt-1">Price, categorize, and activate every purchasable feature businesses can add to their plan.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Feature
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" /> <span>Couldn't load the feature catalog.</span>
        </div>
      ) : (
        <div className="space-y-8">
          {CATEGORIES.filter((c) => byCategory[c]?.length).map((category) => (
            <div key={category}>
              <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">{CATEGORY_LABELS[category]}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {byCategory[category].map((f) => (
                  <Card key={f.id} className={!f.isActive ? "opacity-60" : undefined}>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                        <CardTitle className="text-sm font-mono truncate">{f.key}</CardTitle>
                      </div>
                      {!f.isActive && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <p className="font-medium text-sm">{f.name}</p>
                      {f.description && <p className="text-muted-foreground">{f.description}</p>}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline">{f.tierType}</Badge>
                        {f.tierType !== "free" && f.tierType !== "bundle_child" && (
                          <Badge variant="secondary">
                            {f.currency} {Number(f.priceMonthly ?? 0).toLocaleString()}/mo
                          </Badge>
                        )}
                        {f.freeLimit != null && <Badge variant="secondary">{f.freeLimit} free</Badge>}
                      </div>
                      {isSuperAdmin && (
                        <div className="flex gap-1.5 mt-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
                            <Edit2 className="mr-1.5 h-3 w-3" /> Edit
                          </Button>
                          {f.tierType !== "free" && f.tierType !== "bundle_child" && (
                            <Button size="sm" variant="outline" onClick={() => setSunsetting(f)}>
                              <Sunset className="mr-1.5 h-3 w-3" /> Sunset
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a feature</DialogTitle>
            <DialogDescription>It becomes purchasable the moment it's active.</DialogDescription>
          </DialogHeader>
          <FeatureForm form={form} setForm={setForm} keyEditable />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(buildPayload())} disabled={createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit feature</DialogTitle>
            <DialogDescription>Pricing and activation changes apply immediately, no deploy needed.</DialogDescription>
          </DialogHeader>
          <FeatureForm form={form} setForm={setForm} keyEditable={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && editMutation.mutate({ id: editing.id, patch: buildPayload() })} disabled={editMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Schedule sunset dialog - §2.7 of the pay-per-feature plan */}
      <Dialog open={!!sunsetting} onOpenChange={(open) => !open && setSunsetting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule "{sunsetting?.name}" to become paid</DialogTitle>
            <DialogDescription>
              Every business currently using this for free gets staged reminders (30, 7, and 1 day out, plus the day of) before it moves behind the paywall. Nothing changes until the date arrives, and paying at any point during the notice period keeps it active without interruption.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 my-2">
            <Label className="text-xs">Paywall effective date (minimum 30 days out)</Label>
            <Input type="date" value={sunsetDate} onChange={(e) => setSunsetDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSunsetting(null)}>Cancel</Button>
            <Button
              onClick={() => sunsetting && sunsetDate && sunsetMutation.mutate({ id: sunsetting.id, paywallEffectiveAt: sunsetDate })}
              disabled={!sunsetDate || sunsetMutation.isPending}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeatureForm({ form, setForm, keyEditable }: { form: any; setForm: (f: any) => void; keyEditable: boolean }) {
  return (
    <div className="space-y-3 my-2">
      <div className="space-y-1">
        <Label className="text-xs">Key</Label>
        <Input value={form.key} disabled={!keyEditable} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. staff_performance_tracking" className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[60px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tier type</Label>
          <Select value={form.tierType} onValueChange={(v) => setForm({ ...form, tierType: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {(form.tierType === "paid_flat" || form.tierType === "paid_metered_limit" || form.tierType === "bundle_parent") && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Price / month</Label>
            <Input type="number" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Price / year</Label>
            <Input type="number" value={form.priceAnnual} onChange={(e) => setForm({ ...form, priceAnnual: e.target.value })} />
          </div>
        </div>
      )}
      {form.tierType === "paid_metered_limit" && (
        <div className="space-y-1">
          <Label className="text-xs">Free limit</Label>
          <Input type="number" value={form.freeLimit} onChange={(e) => setForm({ ...form, freeLimit: e.target.value })} />
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <Label className="text-xs">Active (purchasable now)</Label>
        <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
      </div>
    </div>
  );
}
