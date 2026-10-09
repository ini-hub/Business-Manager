import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Copy } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useUrlState } from "@/hooks/use-url-state";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/loader";
import { StatusBadge, TIER_TONE } from "@/components/admin/StatusBadge";
import { OverviewTab } from "./OverviewTab";
import { PricingTab } from "./PricingTab";
import { RolloutTab } from "./RolloutTab";
import { GateRulesTab } from "./GateRulesTab";
import { DependenciesTab } from "./DependenciesTab";
import { AccessTab } from "./AccessTab";
import { HistoryTab } from "./HistoryTab";
import { TIER_LABEL, rolloutOf } from "./featureRow";
import type { FeatureDetailData } from "./detailTypes";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "pricing", label: "Pricing & sales" },
  { value: "rollout", label: "Rollout" },
  { value: "gate", label: "Gate rules" },
  { value: "dependencies", label: "Dependencies" },
  { value: "access", label: "Access" },
  { value: "history", label: "History" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export function FeatureDetail({ featureKey }: { featureKey: string }) {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  // The server lets finance admins grant and revoke a feature for a business, but not edit the feature.
  const canGrant = admin?.role === "super_admin" || admin?.role === "finance_admin";
  const [tab, setTab] = useUrlState<TabValue>("tab", "overview");
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<FeatureDetailData>({
    queryKey: ["/api/admin/feature-catalog", featureKey],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/feature-catalog/${encodeURIComponent(featureKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load this feature");
      return json;
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !data) {
    return (
      <div className="m-4 p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3" role="alert">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="flex-1">{(error as Error | null)?.message ?? "Couldn't load this feature."}</span>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const { feature, flag, scopedOrgs } = data;
  const rollout = rolloutOf(flag?.status);
  const pending = feature.reviewStatus === "pending_review";
  const copy = async () => {
    try { await navigator.clipboard.writeText(feature.key); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be blocked */ }
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground tracking-tight break-words">{feature.name}</h2>
        <div className="flex items-center gap-1.5">
          <code className="text-sm font-mono text-muted-foreground break-all">{feature.key}</code>
          <button type="button" onClick={copy} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={copied ? "Copied" : "Copy key"}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone={TIER_TONE[feature.tierType] ?? "neutral"}>{TIER_LABEL[feature.tierType] ?? feature.tierType}</StatusBadge>
          <StatusBadge tone={pending ? "amber" : feature.isActive ? "green" : "neutral"}>{pending ? "Needs review" : feature.isActive ? "Live" : "Inactive"}</StatusBadge>
          <StatusBadge tone={rollout === "on" ? "green" : rollout === "scoped" ? "blue" : "neutral"}>
            Rollout: {rollout === "scoped" ? `Scoped ${scopedOrgs.length} org${scopedOrgs.length === 1 ? "" : "s"}` : rollout === "on" ? "On" : "Off"}
          </StatusBadge>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="bg-muted border border-border rounded-2xl p-1 gap-1 w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="rounded-xl text-xs font-bold min-h-9 data-[state=active]:bg-background">{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4"><OverviewTab data={data} canEdit={canEdit} /></TabsContent>
        <TabsContent value="pricing" className="mt-4"><PricingTab data={data} canEdit={canEdit} /></TabsContent>
        <TabsContent value="rollout" className="mt-4"><RolloutTab data={data} canEdit={canEdit} /></TabsContent>
        <TabsContent value="gate" className="mt-4"><GateRulesTab data={data} canEdit={canEdit} /></TabsContent>
        <TabsContent value="dependencies" className="mt-4"><DependenciesTab data={data} canEdit={canEdit} /></TabsContent>
        <TabsContent value="access" className="mt-4"><AccessTab data={data} canGrant={canGrant} /></TabsContent>
        <TabsContent value="history" className="mt-4"><HistoryTab data={data} /></TabsContent>
      </Tabs>
    </div>
  );
}
