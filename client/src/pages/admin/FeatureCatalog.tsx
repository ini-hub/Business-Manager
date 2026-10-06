import { useMemo, useState } from "react";
import { useSessionSet } from "@/hooks/use-session-state";
import { useUrlState } from "@/hooks/use-url-state";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit2, Loader2, AlertCircle, Lock, Sunset, Search, ChevronRight, ChevronDown, Package } from "lucide-react";
import { FEATURE_SECTION_LABELS, getFeatureDef } from "@shared/features";
import { buildFeatureTree, filterFeatureTree, subtreeKeys, type TreeNode, type TreeInput } from "@shared/featureTree";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GateRulesDialog } from "./GateRulesDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const TIER_TYPES = ["free", "paid_flat", "paid_metered_limit", "bundle_parent", "bundle_child"] as const;
const TIER_LABEL: Record<string, string> = {
  free: "Free",
  paid_flat: "Paid",
  paid_metered_limit: "Capped add-on",
  bundle_parent: "Bundle",
  bundle_child: "In bundle",
};
const TIER_STYLE: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  paid_flat: "bg-primary/10 text-primary",
  paid_metered_limit: "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400",
  bundle_parent: "bg-primary/10 text-primary",
  bundle_child: "bg-muted text-muted-foreground",
};

type SortMode = "default" | "name" | "price_desc" | "price_asc";

interface CatalogItem extends TreeInput {
  row: any;
  name: string;
  description: string;
  tier: string;
  price: number;
  active: boolean;
}

const isPriced = (tier: string) => tier !== "free" && tier !== "bundle_child";

/**
 * The monetization catalog super admins price - a separate concern from
 * Feature Flags (a release kill-switch), see shared/schema/entitlements.ts.
 * This is the surface that satisfies FAC-1: create, price, categorize, and
 * activate/deactivate any feature without a code deploy.
 */
export default function FeatureCatalog() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isSuperAdmin = admin?.role === "super_admin";

  const [sunsetting, setSunsetting] = useState<any>(null);
  const [sunsetDate, setSunsetDate] = useState("");
  const [gating, setGating] = useState<any>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
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

  const features = (data?.features ?? []) as any[];

  const [search, setSearch] = useUrlState<string>("q", "");
  const [tierFilter, setTierFilter] = useUrlState<string>("tier", "all");
  const [activeFilter, setActiveFilter] = useUrlState<string>("active", "all");
  const [sort, setSort] = useUrlState<SortMode>("sort", "default");
  const [collapsed, setCollapsed] = useSessionSet("admin:feature-catalog:collapsed");

  const tree = useMemo(() => {
    const keyById = new Map(features.map((r) => [r.id, r.key as string]));
    const items: CatalogItem[] = features.map((r) => {
      const def = getFeatureDef(r.key);
      return {
        key: r.key,
        section: r.section ?? def?.section ?? null,
        groupParent: (r.groupParentFeatureId ? keyById.get(r.groupParentFeatureId) : null) ?? def?.groupParent ?? null,
        sortOrder: r.sortOrder ?? def?.sortOrder ?? 9999,
        row: r,
        name: r.name,
        description: r.description ?? "",
        tier: r.tierType,
        price: Number(r.priceMonthly ?? 0),
        active: !!r.isActive,
      };
    });
    if (sort !== "default") {
      // Re-rank siblings by the chosen sort; the tree builder orders by sortOrder.
      const cmp: Record<Exclude<SortMode, "default">, (a: CatalogItem, b: CatalogItem) => number> = {
        name: (a, b) => a.name.localeCompare(b.name),
        price_desc: (a, b) => b.price - a.price || a.name.localeCompare(b.name),
        price_asc: (a, b) => a.price - b.price || a.name.localeCompare(b.name),
      };
      [...items].sort(cmp[sort]).forEach((it, i) => { it.sortOrder = i; });
    }
    return buildFeatureTree(items);
  }, [features, sort]);

  const filtering = search.trim() !== "" || tierFilter !== "all" || activeFilter !== "all";
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!filtering) return tree;
    return filterFeatureTree(tree, (i) =>
      (tierFilter === "all" || i.tier === tierFilter) &&
      (activeFilter === "all" || (activeFilter === "active") === i.active) &&
      (!q || i.key.includes(q) || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
    );
  }, [tree, search, tierFilter, activeFilter, filtering]);

  const parentKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (n: TreeNode<CatalogItem>) => {
      if (n.children.length) keys.push(n.item.key);
      n.children.forEach(walk);
    };
    tree.forEach((s) => s.roots.forEach(walk));
    return keys;
  }, [tree]);

  const stats = useMemo(() => ({
    total: features.length,
    active: features.filter((f) => f.isActive).length,
    free: features.filter((f) => f.tierType === "free").length,
    paid: features.filter((f) => isPriced(f.tierType)).length,
    bundles: features.filter((f) => f.tierType === "bundle_parent").length,
  }), [features]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderNode = (node: TreeNode<CatalogItem>, depth: number): JSX.Element => {
    const { item } = node;
    const f = item.row;
    const hasChildren = node.children.length > 0;
    const open = filtering || !collapsed.has(item.key);
    return (
      <div key={item.key}>
        <div
          className={`group flex items-center gap-2 py-2 pr-2 rounded-lg hover:bg-muted/50 ${item.active ? "" : "opacity-60"}`}
          style={{ paddingLeft: depth * 20 + 8 }}
          data-testid={`catalog-row-${item.key}`}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(item.key)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="shrink-0 w-4 flex justify-center"><span className="h-1.5 w-1.5 rounded-full bg-border" /></span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {item.tier === "bundle_parent" && <Package className="h-3.5 w-3.5 text-primary shrink-0" />}
              <span className={`text-sm text-foreground truncate ${hasChildren ? "font-bold" : "font-medium"}`}>{item.name}</span>
              <code className="text-[11px] font-mono text-muted-foreground">{item.key}</code>
              {hasChildren && <span className="text-[11px] text-muted-foreground">({subtreeKeys(node).length - 1})</span>}
              {!item.active && <Badge variant="outline" className="border-none bg-muted text-muted-foreground text-[10px]">Inactive</Badge>}
            </div>
            {item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isPriced(item.tier) && (
              <span className="hidden sm:inline text-xs font-semibold tabular-nums text-foreground">
                {f.currency} {item.price.toLocaleString()}<span className="text-muted-foreground font-normal">/mo</span>
              </span>
            )}
            {f.freeLimit != null && <Badge variant="secondary" className="hidden md:inline-flex text-[11px]">{f.freeLimit} free</Badge>}
            <Badge variant="outline" className={`border-none text-[11px] font-semibold ${TIER_STYLE[item.tier] ?? TIER_STYLE.free}`}>
              {TIER_LABEL[item.tier] ?? item.tier}
            </Badge>
          </div>
          {isSuperAdmin && (
            <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => navigate(`/super-admin/feature-catalog/${f.id}`)} aria-label={`Edit ${item.key}`}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              {isPriced(item.tier) && (
                <>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setGating(f)} aria-label={`Gate rules for ${item.key}`}>
                    <Lock className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setSunsetting(f)} aria-label={`Sunset ${item.key}`}>
                    <Sunset className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {hasChildren && open && (
          <div className="ml-[15px] border-l border-border/60">{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Feature Catalog</h1>
          <p className="text-muted-foreground text-sm mt-1">Price, categorize, and activate every purchasable feature businesses can add to their plan.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => navigate("/super-admin/feature-catalog/new")}>
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
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {([
              ["Features", stats.total],
              ["Active", stats.active],
              ["Free", stats.free],
              ["Paid", stats.paid],
              ["Bundles", stats.bundles],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border/80 bg-card/40 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1 lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 bg-background border-border rounded-xl"
                placeholder="Search by name, key or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search features"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-40 bg-background border-border rounded-xl" aria-label="Filter by tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  {TIER_TYPES.map((t) => <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-36 bg-background border-border rounded-xl" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                <SelectTrigger className="w-44 bg-background border-border rounded-xl" aria-label="Sort features">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Product order</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="price_desc">Price high to low</SelectItem>
                  <SelectItem value="price_asc">Price low to high</SelectItem>
                </SelectContent>
              </Select>
              {filtering && (
                <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => { setSearch(""); setTierFilter("all"); setActiveFilter("all"); }}>
                  Clear
                </Button>
              )}
            </div>
            <div className="flex gap-2 lg:ml-auto">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setCollapsed(new Set())}>Expand all</Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setCollapsed(new Set(parentKeys))}>Collapse all</Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No features match.</p>
          ) : (
            visible.map((section) => {
              const sectionKey = `section:${section.section}`;
              const open = filtering || !collapsed.has(sectionKey);
              return (
                <section key={section.section} className="rounded-2xl border border-border/80 bg-card/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggle(sectionKey)}
                    className="w-full flex items-center gap-2 px-4 py-3 bg-background/40 border-b border-border/40 text-left"
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
                      {section.section === "other" ? "Other" : FEATURE_SECTION_LABELS[section.section]}
                    </h2>
                    <span className="text-xs text-muted-foreground">{section.count} features</span>
                  </button>
                  {open && <div className="p-2">{section.roots.map((r) => renderNode(r, 0))}</div>}
                </section>
              );
            })
          )}
        </div>
      )}

      {gating && <GateRulesDialog feature={gating} onClose={() => setGating(null)} />}
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
