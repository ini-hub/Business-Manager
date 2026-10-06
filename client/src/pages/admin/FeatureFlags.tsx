import { useMemo, useState } from "react";
import { useSessionSet } from "@/hooks/use-session-state";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ToggleLeft, Edit2,
  Trash2, Loader2,
  AlertCircle, ChevronRight, ChevronDown, Search
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FEATURE_SECTION_LABELS, getFeatureDef } from "@shared/features";
import { DisableImpactNote, disableAllowed } from "./DisableImpactNote";
import { buildFeatureTree, filterFeatureTree, subtreeKeys, type SectionNode, type TreeNode, type TreeInput } from "@shared/featureTree";

interface FlagItem extends TreeInput {
  flag: any;
  name: string;
  description: string;
  tier: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  on: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400",
  off: "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400",
  scoped: "bg-primary/10 text-primary",
  by_plan: "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400",
};

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  paid_flat: "Paid",
  paid_metered_limit: "Capped add-on",
  bundle_parent: "Bundle",
  bundle_child: "In bundle",
};

export default function FeatureFlags() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<any>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("off");
  const [scopedOrgIdsStr, setScopedOrgIdsStr] = useState("");
  const [subscriptionTier, setSubscriptionTier] = useState("none");
  const [confirmKey, setConfirmKey] = useState("");

  const [search, setSearch] = useUrlState<string>("q", "");
  const [statusFilter, setStatusFilter] = useUrlState<string>("status", "all");
  const [collapsed, setCollapsed] = useSessionSet("admin:feature-flags:collapsed");

  // The catalog supplies section / nesting / tier. Its absence only costs the tree its
  // database-side values: the code registry fills in anything it does not return.
  const { data: catalog } = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/feature-catalog");
      return res.json();
    },
  });

  // Query feature flags
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/feature-flags");
      return res.json();
    },
  });

  // Edit Mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, flag }: { id: string; flag: any }) => {
      const res = await apiRequest("PUT", `/api/admin/feature-flags/${id}`, flag);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Feature Flag Updated",
        description: "The flag attributes have been rewritten successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      setShowEditDialog(false);
      setSelectedFlag(null);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Update Failed",
        description: err?.message || "Failed to update flag.",
        variant: "destructive",
      });
    },
  });

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/feature-flags/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Feature Flag Purged",
        description: "The feature flag has been permanently deleted from routing schemas.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
    },
    onError: (err: any) => {
      toast({
        title: "Purge Failed",
        description: err?.message || "Failed to delete flag.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setStatus("off");
    setScopedOrgIdsStr("");
    setSubscriptionTier("none");
    setConfirmKey("");
  };

  const handleOpenEdit = (flag: any) => {
    setSelectedFlag(flag);
    setName(flag.name);
    setDescription(flag.description);
    setStatus(flag.status);
    setScopedOrgIdsStr(flag.scopedOrgIds ? JSON.stringify(flag.scopedOrgIds) : "");
    setSubscriptionTier(flag.subscriptionTier || "none");
    setConfirmKey("");
    setShowEditDialog(true);
  };

  // "off" and "scoped" both switch the feature off for businesses outside the list.
  const turnsOff = !!selectedFlag && (status === "off" || status === "scoped") && selectedFlag.status !== "off" && selectedFlag.status !== "scoped";

  const handleEditSubmit = () => {
    if (!selectedFlag) return;

    let scopedOrgIds = null;
    if (status === "scoped" && scopedOrgIdsStr) {
      try {
        scopedOrgIds = JSON.parse(scopedOrgIdsStr);
        if (!Array.isArray(scopedOrgIds)) throw new Error();
      } catch (e) {
        toast({
          title: "JSON parsing error",
          description: "Scoped Organization IDs must be a valid JSON array of strings.",
          variant: "destructive",
        });
        return;
      }
    }

    editMutation.mutate({
      id: selectedFlag.id,
      flag: {
        description,
        status,
        scopedOrgIds,
        subscriptionTier: subscriptionTier === "none" ? null : subscriptionTier,
        confirmKey: confirmKey.trim() || undefined,
      },
    });
  };

  const isSuperAdmin = admin?.role === "super_admin";

  const tree = useMemo(() => {
    const rows: any[] = catalog?.features ?? [];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const keyById = new Map(rows.map((r) => [r.id, r.key as string]));
    const items: FlagItem[] = (data?.flags ?? []).map((flag: any) => {
      const row = byKey.get(flag.name);
      const def = getFeatureDef(flag.name);
      return {
        key: flag.name,
        section: row?.section ?? def?.section ?? null,
        groupParent: (row?.groupParentFeatureId ? keyById.get(row.groupParentFeatureId) : null) ?? def?.groupParent ?? null,
        sortOrder: row?.sortOrder ?? def?.sortOrder ?? 9999,
        flag,
        name: row?.name ?? def?.name ?? flag.name,
        description: flag.description ?? row?.description ?? "",
        tier: row?.tierType ?? def?.tier ?? null,
      };
    });
    return buildFeatureTree(items);
  }, [data, catalog]);

  const searching = search.trim() !== "" || statusFilter !== "all";
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && statusFilter === "all") return tree;
    return filterFeatureTree(tree, (i) =>
      (statusFilter === "all" || i.flag.status === statusFilter) &&
      (!q || i.key.includes(q) || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
    );
  }, [tree, search, statusFilter]);

  const allParentKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (n: TreeNode<FlagItem>) => {
      if (n.children.length) keys.push(n.item.key);
      n.children.forEach(walk);
    };
    tree.forEach((s) => s.roots.forEach(walk));
    return keys;
  }, [tree]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderNode = (node: TreeNode<FlagItem>, depth: number): JSX.Element => {
    const { item } = node;
    const { flag } = item;
    const hasChildren = node.children.length > 0;
    const open = searching || !collapsed.has(item.key);
    return (
      <div key={item.key}>
        <div
          className="group flex items-center gap-2 py-1.5 pr-2 rounded-lg hover:bg-muted/50"
          style={{ paddingLeft: depth * 20 + 8 }}
          data-testid={`flag-row-${item.key}`}
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
              <span className={`text-sm text-foreground truncate ${hasChildren ? "font-bold" : "font-medium"}`}>{item.name}</span>
              <code className="text-[11px] font-mono text-muted-foreground">{item.key}</code>
              {hasChildren && <span className="text-[11px] text-muted-foreground">({subtreeKeys(node).length - 1})</span>}
            </div>
            {flag.status === "scoped" && flag.scopedOrgIds && (
              <code className="block text-[11px] font-mono text-primary truncate">{JSON.stringify(flag.scopedOrgIds)}</code>
            )}
            {flag.status === "by_plan" && flag.subscriptionTier && (
              <span className="text-[11px] text-muted-foreground">Plan: {flag.subscriptionTier}</span>
            )}
          </div>
          {item.tier && (
            <Badge variant="outline" className={`hidden sm:inline-flex shrink-0 border-none text-[11px] font-semibold ${item.tier === "free" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
              {TIER_LABEL[item.tier] ?? item.tier}
            </Badge>
          )}
          <Badge variant="outline" className={`shrink-0 border-none text-[11px] font-bold uppercase ${STATUS_BADGE[flag.status] ?? STATUS_BADGE.off}`}>
            {flag.status}
          </Badge>
          {isSuperAdmin && (
            <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-border text-muted-foreground hover:text-foreground" onClick={() => handleOpenEdit(flag)} aria-label={`Edit ${item.key}`}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-border text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40" onClick={() => deleteMutation.mutate(flag.id)} aria-label={`Delete ${item.key}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        {hasChildren && open && (
          <div className="ml-[15px] border-l border-border/60">{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  const sectionStatus = (section: SectionNode<FlagItem>) => {
    const counts: Record<string, number> = {};
    const walk = (n: TreeNode<FlagItem>) => {
      counts[n.item.flag.status] = (counts[n.item.flag.status] ?? 0) + 1;
      n.children.forEach(walk);
    };
    section.roots.forEach(walk);
    return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ");
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Feature Flags</h1>
          <p className="text-muted-foreground text-sm mt-1">Each feature owns one flag, shown here in its place in the product tree. Set a flag to off to switch that feature off for every business, trial and paid. Flags are created with their feature; add a feature in the Feature Catalog.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error || !data?.flags ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Error compiling platform feature flags list.</span>
        </div>
      ) : data.flags.length === 0 ? (
        <div className="text-center py-16 bg-card/20 border border-border/80 rounded-2xl">
          <ToggleLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground text-base">No Feature Flags Declared</h3>
          <p className="text-xs text-muted-foreground mt-1">Run the feature sync to create a flag for every feature in the registry.</p>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 bg-background border-border rounded-xl"
                placeholder="Search by name, key or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search feature flags"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-40 bg-background border-border rounded-xl" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="scoped">Scoped</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setCollapsed(new Set())}>Expand all</Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setCollapsed(new Set(allParentKeys))}>Collapse all</Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No flags match.</p>
          ) : (
            visible.map((section) => {
              const sectionKey = `section:${section.section}`;
              const open = searching || !collapsed.has(sectionKey);
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
                    <span className="text-xs text-muted-foreground">{section.count} flags</span>
                    <span className="ml-auto text-[11px] text-muted-foreground hidden sm:block">{sectionStatus(section)}</span>
                  </button>
                  {open && <div className="p-2">{section.roots.map((r) => renderNode(r, 0))}</div>}
                </section>
              );
            })
          )}
        </div>
      )}

      {/* Feature Flag Modification Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-card border border-border text-muted-foreground max-w-md rounded-2xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-foreground">Modify Feature Flag</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Overwrite flag parameters. Router changes take effect globally within 15 seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Flag Key (Immutable)</Label>
              <Input
                className="bg-background/60 border-border text-muted-foreground rounded-xl font-mono text-xs"
                value={name}
                disabled
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Description</Label>
              <Textarea
                className="bg-background border-border text-foreground rounded-xl min-h-[70px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Routing Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-muted-foreground">
                  <SelectItem value="off">Off: hidden everywhere, API refuses it</SelectItem>
                  <SelectItem value="on">On: visible; unpaid businesses see its price and are blocked</SelectItem>
                  <SelectItem value="scoped">Scoped: on only for the listed Organisation IDs, hidden for everyone else</SelectItem>
                  {status === "by_plan" && <SelectItem value="by_plan">By Plan (legacy, treated as On)</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {status === "scoped" && (
              <div className="space-y-1">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Scoped Organisation IDs (JSON Array)</Label>
                <Input
                  className="bg-background border-border text-foreground rounded-xl font-mono text-xs"
                  value={scopedOrgIdsStr}
                  onChange={(e) => setScopedOrgIdsStr(e.target.value)}
                />
              </div>
            )}

            {turnsOff && selectedFlag && <DisableImpactNote featureKey={selectedFlag.name} typed={confirmKey} onTyped={setConfirmKey} />}

            {status === "by_plan" && (
              <div className="space-y-1">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Minimum Subscription Plan</Label>
                <Select value={subscriptionTier} onValueChange={setSubscriptionTier}>
                  <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-muted-foreground">
                    <SelectItem value="none">Standard Free Tier</SelectItem>
                    <SelectItem value="pro">Pro Plan</SelectItem>
                    <SelectItem value="premium">Enterprise Premium Plan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-muted"
              onClick={() => setShowEditDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={handleEditSubmit}
              disabled={editMutation.isPending || (turnsOff && !!selectedFlag && !disableAllowed(selectedFlag.name, confirmKey))}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
