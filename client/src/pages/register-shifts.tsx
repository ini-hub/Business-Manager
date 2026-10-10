import { fetchAllPages } from "@/lib/paginated";
import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AlertCircle, Clock, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricRow } from "@/components/metric-row";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSimpleList } from "@/components/simple-list-controls";
import type { SimpleListConfig } from "@/lib/simple-list";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";

export default function RegisterShifts() {
  const { currentStore, stores, business } = useStore();
  const figuresMasked = !!(business as any)?.viewerMask?.figures;
  const storeCurrency = currentStore?.currency || "NGN";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: storeCurrency }).format(value);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);
  const formatDate = (date: string | Date) =>
    new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));

  // Query to fetch historical shift drawer sessions
  const { data: drawerSessions = [], isLoading: drawerLoading } = useQuery<any[]>({
    queryKey: ["/api/cash-register/sessions", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const list = await fetchAllPages<any>(`/api/cash-register/sessions?storeId=${s.id}`);
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
      }
      try {
        return await fetchAllPages<any>(`/api/cash-register/sessions?storeId=${currentStore?.id}`);
      } catch {
        return [];
      }
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });


  const drawerConfig = useMemo<SimpleListConfig<any>>(() => {
    const diffOf = (s: any) => Number(s.difference || 0);
    const storeNames = Array.from(new Set(drawerSessions.map((s: any) => s.storeName).filter(Boolean))) as string[];
    return {
      noun: "shift",
      placeholder: "Search shift remarks",
      searchText: (s) => `${s.notes ?? ""} ${s.storeName ?? ""}`,
      groups: [
        {
          key: "status",
          label: "Status",
          options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }],
          match: (s, v) => s.status === v,
        },
        {
          key: "result",
          label: "Reconciliation",
          options: [
            { value: "balanced", label: "Balanced" },
            { value: "surplus", label: "Surplus" },
            { value: "shortage", label: "Shortage" },
          ],
          match: (s, v) =>
            s.status === "closed" && (v === "balanced" ? diffOf(s) === 0 : v === "surplus" ? diffOf(s) > 0 : diffOf(s) < 0),
        },
        ...(storeNames.length > 1
          ? [{
              key: "store",
              label: "Store",
              options: storeNames.map((n) => ({ value: n, label: n })),
              match: (s: any, v: string) => s.storeName === v,
            }]
          : []),
      ],
      sorts: [
        { key: "newest", label: "Newest first", compare: (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime() },
        { key: "oldest", label: "Oldest first", compare: (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime() },
        { key: "shortage", label: "Largest shortage", compare: (a, b) => diffOf(a) - diffOf(b) },
        { key: "surplus", label: "Largest surplus", compare: (a, b) => diffOf(b) - diffOf(a) },
      ],
    };
  }, [drawerSessions]);
  const { visible: visibleDrawerSessions, controls: drawerControls } = useSimpleList(drawerSessions, drawerConfig, "shift");

  const closedSessions = useMemo(() => drawerSessions.filter((s: any) => s.status === "closed"), [drawerSessions]);
  const totalVariance = useMemo(() => closedSessions.reduce((sum: number, s: any) => sum + Number(s.difference || 0), 0), [closedSessions]);
  const activeSessionItem = useMemo(() => drawerSessions.find((s: any) => s.status === "open"), [drawerSessions]);

  const drawerColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (session: any) => (
        <Badge variant="outline" className="bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 font-medium uppercase shrink-0">
          {session.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "openedAt",
      header: "Shift Timing",
      render: (session: any) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">Opened: {formatDate(session.openedAt)}</span>
          </div>
          {session.status === "closed" && (
            <span className="text-[11px] text-muted-foreground pl-5 italic font-medium">
              Closed: {formatDate(session.closedAt)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "openingFloat",
      header: "Base Float",
      render: (session: any) => (
        <span className="font-mono text-xs font-semibold text-foreground">{figuresMasked ? "••••" : formatCurrency(Number(session.openingFloat))}</span>
      ),
    },
    {
      key: "expectedCash",
      header: "Expected Till",
      render: (session: any) => (
        <span className="font-mono text-xs font-semibold text-muted-foreground">{figuresMasked ? "••••" : formatCurrency(Number(session.expectedCash))}</span>
      ),
    },
    {
      key: "actualCash",
      header: "Counted Till",
      render: (session: any) => (
        <span className="font-mono text-xs font-bold text-foreground">
          {session.status === "open" ? (
            <Badge variant="outline" className="text-[11px] font-bold border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-0.5">
              ACTIVE
            </Badge>
          ) : (
            formatCurrency(Number(session.actualCash))
          )}
        </span>
      ),
    },
    {
      key: "difference",
      header: "Discrepancy (Drift)",
      render: (session: any) => {
        if (session.status === "open") {
          return (
            <Badge variant="outline" className="border-none font-bold text-[11px] uppercase bg-muted text-muted-foreground tracking-wider px-2 py-0.5">
              DRAWER OPEN
            </Badge>
          );
        }
        const diff = Number(session.difference || 0);
        return (
          <Badge
            variant="outline"
            className={`border-none font-bold text-[11px] uppercase tracking-wider px-3 py-0.5 ${
              diff === 0
                ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                : diff > 0
                ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400"
                : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400"
            }`}
          >
            {diff === 0
              ? "Balanced"
              : diff > 0
              ? `+${formatCurrency(diff)} (Surplus)`
              : `-${formatCurrency(Math.abs(diff))} (Shortage)`}
          </Badge>
        );
      },
    },
    {
      key: "notes",
      header: "Reconciliation Remarks",
      render: (session: any) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground truncate max-w-[180px] block font-medium">
              {session.notes || "No closing remarks logged."}
            </span>
          </TooltipTrigger>
          <TooltipContent>{session.notes || "No closing remarks logged."}</TooltipContent>
        </Tooltip>
      ),
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Register Shifts" description="Cash drawer sessions" compact />
        <StoreRequiredAlert title="Store Required for Register Shifts" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Register Shifts"
        description={`Cash drawer sessions for ${currentStore.name}`}
        compact
        actions={
          <Button variant="outline" asChild data-testid="button-back-to-transactions">
            <Link href="/transactions">
              <ArrowLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Transactions</span>
            </Link>
          </Button>
        }
      />
          <MetricRow
            metrics={[
              { title: "Shift Sessions Run", value: drawerSessions.length, icon: <Clock className="h-4 w-4" />, isLoading: drawerLoading },
              {
                title: "Accumulated Drawer Variance",
                value: formatCurrency(totalVariance),
                compactValue: formatCompact(totalVariance),
                icon: <Coins className="h-4 w-4" />,
                isLoading: drawerLoading,
              },
              {
                title: "Active Shift Session",
                value: activeSessionItem ? "SHIFT DRAW ACTIVE" : "ALL SHIFTS AUDITED",
                icon: <AlertCircle className="h-4 w-4" />,
                isLoading: drawerLoading,
              },
            ]}
          />

          <div className="space-y-3">
              {drawerControls}
              <DataTable
                data={visibleDrawerSessions}
                columns={drawerColumns}
                hideToolbar
                isLoading={drawerLoading}
                emptyMessage="No historical cash register sessions found for this branch."
                urlKey="drawer"
              />
          </div>
    </div>
  );
}
