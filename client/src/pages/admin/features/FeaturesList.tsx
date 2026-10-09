import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, MoreHorizontal, Plus, Search, SlidersHorizontal } from "lucide-react";
import { FEATURE_SECTION_LABELS } from "@shared/features";
import { apiRequest } from "@/lib/queryClient";
import { useUrlState } from "@/hooks/use-url-state";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/loader";
import { StatTile } from "@/components/admin/StatTile";
import { StatusBadge, TIER_TONE, type BadgeTone } from "@/components/admin/StatusBadge";
import { GateRulesDialog } from "../GateRulesDialog";
import { SunsetDialog } from "./FeatureDialogs";
import { FeatureDetail } from "./FeatureDetail";
import {
  TIER_LABEL, TIER_TYPES, filterRows, isPriced, priceLabel, tileCounts, toFeatureRows,
  type FeatureRow, type TileKey,
} from "./featureRow";

const STATE_LABEL: Record<FeatureRow["state"], string> = { live: "Live", needs_review: "Needs review", inactive: "Inactive" };
const STATE_TONE: Record<FeatureRow["state"], BadgeTone> = { live: "green", needs_review: "amber", inactive: "neutral" };

const TILES: { key: TileKey; label: string; hint?: string }[] = [
  { key: "all", label: "Total", hint: "Whole catalogue" },
  { key: "live", label: "Live" },
  { key: "needs_review", label: "Needs review", hint: "Hidden until published" },
  { key: "inactive", label: "Inactive" },
  { key: "scoped", label: "Scoped rollout", hint: "Limited to listed orgs" },
  { key: "gate_pending", label: "Gate pending", hint: "Gating not confirmed" },
];

const sectionLabel = (s: string | null) =>
  !s || s === "other" ? "Other" : (FEATURE_SECTION_LABELS as Record<string, string>)[s] ?? s;

function RolloutBadge({ row }: { row: FeatureRow }) {
  if (row.rollout === "scoped") return <StatusBadge tone="blue">Scoped {row.scopedCount} org{row.scopedCount === 1 ? "" : "s"}</StatusBadge>;
  return <StatusBadge tone={row.rollout === "on" ? "green" : "neutral"}>{row.rollout === "on" ? "On" : "Off"}</StatusBadge>;
}

function StateBadge({ row }: { row: FeatureRow }) {
  return <StatusBadge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</StatusBadge>;
}

function TierBadge({ row }: { row: FeatureRow }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusBadge tone={TIER_TONE[row.tier] ?? "neutral"}>{TIER_LABEL[row.tier] ?? row.tier}</StatusBadge>
      {row.freeLimit != null && <span className="text-[11px] text-muted-foreground">{row.freeLimit} free</span>}
    </span>
  );
}

export default function FeaturesList() {
  const { admin } = useAdminAuth();
  const [, navigate] = useLocation();
  const isSuperAdmin = admin?.role === "super_admin";
  const isMobile = useIsMobile();
  const [onDetail, detailParams] = useRoute("/super-admin/features/:key");
  const selectedKey = onDetail && detailParams?.key ? decodeURIComponent(detailParams.key) : null;

  const [q, setQ] = useUrlState<string>("q", "");
  const [tile, setTile] = useUrlState<TileKey>("tile", "all");
  const [section, setSection] = useUrlState<string>("section", "all");
  const [tier, setTier] = useUrlState<string>("tier", "all");
  const [rollout, setRollout] = useUrlState<string>("rollout", "all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [sunsetting, setSunsetting] = useState<FeatureRow | null>(null);
  const [gating, setGating] = useState<FeatureRow | null>(null);

  const catalog = useQuery({
    queryKey: ["/api/admin/feature-catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-catalog")).json(),
  });
  const flags = useQuery({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/feature-flags")).json(),
  });

  const rows = useMemo(
    () => toFeatureRows(catalog.data?.features ?? [], flags.data?.flags ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    [catalog.data, flags.data],
  );
  const counts = useMemo(() => tileCounts(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, { q, tile, section, tier, rollout }), [rows, q, tile, section, tier, rollout]);
  const sections = useMemo(() => Array.from(new Set(rows.map((r) => r.section ?? "other"))), [rows]);

  const activeFilterCount = [section, tier, rollout].filter((v) => v !== "all").length + (tile !== "all" ? 1 : 0);
  const filtering = q.trim() !== "" || activeFilterCount > 0;
  const clear = () => { setQ(""); setTile("all"); setSection("all"); setTier("all"); setRollout("all"); };

  // The list's filters live in the query string; keep them while a feature is open and when it closes.
  const listQuery = () => {
    const p = new URLSearchParams(window.location.search);
    p.delete("tab");
    const qs = p.toString();
    return qs ? `?${qs}` : "";
  };
  const open = (r: FeatureRow, tab?: string) => {
    const p = new URLSearchParams(window.location.search);
    if (tab) p.set("tab", tab); else p.delete("tab");
    const qs = p.toString();
    navigate(`/super-admin/features/${encodeURIComponent(r.key)}${qs ? `?${qs}` : ""}`);
  };
  const closeDetail = () => navigate(`/super-admin/features${listQuery()}`);

  const renderActions = (r: FeatureRow) => (
    <div className="flex items-center gap-1.5 justify-end">
      {r.state === "needs_review" && isSuperAdmin ? (
        <Button size="sm" className="h-9 px-3 rounded-xl bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70" onClick={() => navigate("/super-admin/features/review")} data-testid={`button-review-${r.key}`}>
          Review
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-9 px-3 rounded-xl" onClick={() => open(r)} data-testid={`button-open-${r.key}`}>Open</Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-9 w-9 p-0 rounded-xl" aria-label={`More actions for ${r.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => open(r)}>{isSuperAdmin ? "Open details" : "View details"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open(r, "rollout")}>Rollout</DropdownMenuItem>
          {isSuperAdmin && isPriced(r.tier) && <DropdownMenuItem onSelect={() => setGating(r)}>Gate rules</DropdownMenuItem>}
          {isSuperAdmin && isPriced(r.tier) && r.state === "live" && <DropdownMenuItem onSelect={() => setSunsetting(r)}>Schedule sunset</DropdownMenuItem>}
          {r.state === "needs_review" && <DropdownMenuItem onSelect={() => navigate("/super-admin/features/review")}>Review and publish</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const filterSelects = (
    <>
      <Select value={section} onValueChange={setSection}>
        <SelectTrigger className="w-full lg:w-40 bg-background border-border rounded-xl" aria-label="Filter by section"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sections</SelectItem>
          {sections.map((s) => <SelectItem key={s} value={s}>{sectionLabel(s)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={tier} onValueChange={setTier}>
        <SelectTrigger className="w-full lg:w-36 bg-background border-border rounded-xl" aria-label="Filter by tier"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All tiers</SelectItem>
          {TIER_TYPES.map((t) => <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={rollout} onValueChange={setRollout}>
        <SelectTrigger className="w-full lg:w-36 bg-background border-border rounded-xl" aria-label="Filter by rollout"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any rollout</SelectItem>
          <SelectItem value="on">On</SelectItem>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="scoped">Scoped</SelectItem>
        </SelectContent>
      </Select>
    </>
  );

  const isLoading = catalog.isLoading || flags.isLoading;
  const error = catalog.error || flags.error;

  if (selectedKey && isMobile) {
    return (
      <div className="space-y-4 font-sans">
        <button type="button" onClick={closeDetail} className="inline-flex items-center gap-1 text-sm font-semibold text-primary min-h-11">
          <ChevronLeft className="h-4 w-4" /> Features
        </button>
        <FeatureDetail featureKey={selectedKey} />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Features</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every feature businesses can use: its price, whether it is sold, and who sees it. Name, tier and structure come from the code and sync on each release.
          </p>
        </div>
        {isSuperAdmin && (
          <Button className="w-full sm:w-auto rounded-xl" onClick={() => navigate("/super-admin/feature-catalog/new")}>
            <Plus className="mr-2 h-4 w-4" /> Add feature
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner className="h-8 w-8 animate-spin text-primary" /></div>
      ) : error ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="flex-1">Couldn't load the features.</span>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { catalog.refetch(); flags.refetch(); }}>Retry</Button>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in duration-300">
          {counts.needs_review > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3" data-testid="pending-review-banner">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-sm text-amber-900 dark:text-amber-200 flex-1">
                <strong>{counts.needs_review} feature{counts.needs_review === 1 ? " needs" : "s need"} review.</strong> A release added {counts.needs_review === 1 ? "it" : "them"}; businesses can't see {counts.needs_review === 1 ? "it" : "them"} until you price and publish.
              </p>
              <Button size="sm" variant="outline" className="rounded-xl h-9" onClick={() => navigate("/super-admin/features/review")}>Review now</Button>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {TILES.map((t) => (
              <StatTile
                key={t.key}
                label={t.label}
                value={counts[t.key]}
                hint={t.hint}
                pressed={tile === t.key}
                onToggle={() => setTile(tile === t.key ? "all" : t.key)}
                testId={`tile-${t.key}`}
              />
            ))}
          </div>

          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1 lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9 bg-background border-border rounded-xl" placeholder="Search name, key or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search features" />
            </div>
            <div className="hidden lg:flex gap-2">{filterSelects}</div>
            <Button variant="outline" className="lg:hidden rounded-xl h-10" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="h-4 w-4 mr-2" /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </Button>
            {filtering && <Button variant="ghost" size="sm" className="hidden lg:inline-flex rounded-xl" onClick={clear}>Clear</Button>}
          </div>

          {visible.length === 0 ? (
            <div className="text-center py-16 bg-card/20 border border-border/80 rounded-2xl">
              <h3 className="text-sm font-bold text-foreground">No features match</h3>
              <p className="text-xs text-muted-foreground mt-1">Try a different search or clear the filters.</p>
              {filtering && <Button variant="outline" size="sm" className="mt-4 rounded-xl" onClick={clear}>Clear filters</Button>}
            </div>
          ) : (
            <>
              {/* Table: tablet and up */}
              <div className="hidden md:block rounded-2xl border border-border/80 bg-card/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-background/40 text-muted-foreground uppercase text-[11px] tracking-wider">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-bold">Feature</th>
                        <th scope="col" className="px-4 py-3 font-bold hidden xl:table-cell">Section</th>
                        <th scope="col" className="px-4 py-3 font-bold">Tier</th>
                        <th scope="col" className="px-4 py-3 font-bold">Price</th>
                        <th scope="col" className="px-4 py-3 font-bold">State</th>
                        <th scope="col" className="px-4 py-3 font-bold">Rollout</th>
                        <th scope="col" className="px-4 py-3 font-bold hidden xl:table-cell">Gate</th>
                        <th scope="col" className="px-4 py-3 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visible.map((r) => (
                        <tr key={r.id} className="hover:bg-card/30" data-testid={`feature-row-${r.key}`}>
                          <td className="px-4 py-3 max-w-[260px]">
                            <p className="font-semibold text-foreground truncate" title={r.name}>{r.name}</p>
                            <code className="text-[11px] font-mono text-muted-foreground block truncate" title={r.key}>{r.key}</code>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">{sectionLabel(r.section)}</td>
                          <td className="px-4 py-3"><TierBadge row={r} /></td>
                          <td className="px-4 py-3 font-semibold text-foreground tabular-nums whitespace-nowrap">{priceLabel(r)}</td>
                          <td className="px-4 py-3"><StateBadge row={r} /></td>
                          <td className="px-4 py-3"><RolloutBadge row={r} /></td>
                          <td className="px-4 py-3 hidden xl:table-cell">
                            {r.gatePending ? <span className="text-amber-700 dark:text-amber-400 font-semibold text-xs">Pending</span> : <span className="text-muted-foreground text-xs">OK</span>}
                          </td>
                          <td className="px-4 py-3">{renderActions(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">Showing {visible.length} of {rows.length} features</p>
              </div>

              {/* Cards: phones */}
              <ul className="md:hidden space-y-3">
                {visible.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-border/80 bg-card/40 p-4 space-y-3" data-testid={`feature-card-${r.key}`}>
                    <div>
                      <p className="font-semibold text-foreground break-words">{r.name}</p>
                      <code className="text-[11px] font-mono text-muted-foreground break-all">{r.key}</code>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge tone={TIER_TONE[r.tier] ?? "neutral"}>{TIER_LABEL[r.tier] ?? r.tier}</StatusBadge>
                      <StateBadge row={r} />
                      <RolloutBadge row={r} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground tabular-nums">{priceLabel(r)}</p>
                      {renderActions(r)}
                    </div>
                  </li>
                ))}
                <li className="text-xs text-muted-foreground text-center">Showing {visible.length} of {rows.length} features</li>
              </ul>
            </>
          )}
        </div>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
          <div className="space-y-3 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">State</p>
            <div className="flex flex-wrap gap-2">
              {TILES.map((t) => (
                <Button key={t.key} size="sm" variant={tile === t.key ? "default" : "outline"} className="rounded-full h-9" aria-pressed={tile === t.key} onClick={() => setTile(t.key)}>
                  {t.key === "all" ? "Any state" : t.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground pt-2">Section, tier and rollout</p>
            <div className="grid gap-2">{filterSelects}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="rounded-xl h-11" onClick={clear}>Clear</Button>
            <Button className="rounded-xl h-11" onClick={() => setFiltersOpen(false)}>Show results</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedKey && !isMobile} onOpenChange={(o) => !o && closeDetail()}>
        <SheetContent side="right" className="w-full sm:max-w-[640px] overflow-y-auto px-4 sm:px-6 pb-0">
          <SheetHeader className="sr-only"><SheetTitle>Feature details</SheetTitle></SheetHeader>
          {selectedKey && !isMobile && <div className="pt-6"><FeatureDetail featureKey={selectedKey} /></div>}
        </SheetContent>
      </Sheet>

      {sunsetting && <SunsetDialog feature={sunsetting} onClose={() => setSunsetting(null)} />}
      {gating && <GateRulesDialog feature={gating} onClose={() => setGating(null)} />}
    </div>
  );
}
