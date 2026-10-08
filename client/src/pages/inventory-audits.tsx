import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ClipboardList, AlertTriangle, AlertCircle, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import type { StockAudit, StockAuditItem, Staff } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { ListControls } from "@/components/list-controls";
import { AuditFiltersSheet, AuditSortSheet } from "@/components/stock-audit-filter-sheets";
import {
  type AuditFilterState,
  type AuditSortState,
  EMPTY_AUDIT_FILTERS,
  auditMatchesFilters,
  auditMatchesSearch,
  auditSortLabel,
  buildAuditFilterChips,
  clearAuditFilterChip,
  countActiveAuditFilters,
  sortAudits,
} from "@/lib/stock-audit-filters";
import { PageHeader } from "@/components/page-header";
import { MetricRow } from "@/components/metric-row";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useToast } from "@/hooks/use-toast";
import { useMultiStoreQuery } from "@/hooks/useMultiStoreQuery";
import { apiRequest, queryClient, STALE_TIMES } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { fetchAllStaff } from "@/lib/staff-api";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";

type AuditPerson = { name?: string; email?: string };
type AuditDetail = StockAudit & { items: StockAuditItem[]; conductedBy?: AuditPerson; approvedBy?: AuditPerson };

export default function InventoryAuditsPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isAuditDetailOpen, setIsAuditDetailOpen] = useState(false);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [auditSearchTerm, setAuditSearchTerm] = useState("");
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>(EMPTY_AUDIT_FILTERS);
  const [auditSort, setAuditSort] = useState<AuditSortState | null>(null);

  const { data: auditsRaw = [], isLoading: isLoadingAudits } = useMultiStoreQuery<StockAudit>(
    "/api/stock-audits",
    { enabled: !!currentStore, fetchList: (storeId) => fetchAllPages<StockAudit>(`/api/stock-audits?storeId=${storeId}`) }
  );
  const auditsList = [...auditsRaw].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const { data: staffList = [] } = useMultiStoreQuery<Staff>("/api/staff", { staleTime: STALE_TIMES.reference, fetchList: fetchAllStaff<Staff> });

  const { data: auditDetail, isLoading: isLoadingAuditDetail } = useQuery<AuditDetail>({
    queryKey: ["/api/stock-audits", selectedAuditId],
    queryFn: async () => {
      const res = await fetch(`/api/stock-audits/${selectedAuditId}`);
      if (!res.ok) throw new Error("Failed to fetch audit details");
      return res.json();
    },
    enabled: !!selectedAuditId,
  });

  const { data: variancePreview } = useQuery<{ total: number; lines: { name: string; variance: number; cost: number }[] }>({
    queryKey: ["stock-audit-variance", selectedAuditId],
    queryFn: async () => {
      const res = await fetch(`/api/stock-audits/${selectedAuditId}/variance-preview`);
      if (!res.ok) return { total: 0, lines: [] };
      return res.json();
    },
    enabled: !!selectedAuditId && isAuditDetailOpen,
  });

  const approveAuditMutation = useMutation({
    mutationFn: (auditId: string) => apiRequest("POST", `/api/stock-audits/${auditId}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits", selectedAuditId] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Stock audit approved. Inventory quantities updated." });
      setIsAuditDetailOpen(false);
      setSelectedAuditId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not approve stock audit",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, currentStore?.currency || "NGN");

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Stock Audit" description="Count stock and resolve differences" />
        <StoreRequiredAlert title="Store Required for Stock Audit" />
      </div>
    );
  }

  const totalAuditsCount = auditsList.length;
  const draftAuditsCount = auditsList.filter((a: any) => a.status === "draft").length;
  const latestAuditDateStr = auditsList.length > 0
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(auditsList[0].createdAt))
    : "No audits yet";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Stock Audit"
        description={`Physical counts for ${currentStore.name}`}
        compact
        actions={
          <div className="flex items-center gap-2">
            <BackButton label="Inventory" href="/inventory" data-testid="button-back-inventory" />
            <AddButton label="New Stock Audit" gate="inventory_audit" onClick={() => setLocation("/inventory/audits/new")} data-testid="button-new-audit" />
          </div>
        }
      />

      <MetricRow
        metrics={[
          { title: "Total Audits Conducted", value: String(totalAuditsCount), icon: <ClipboardList className="h-4 w-4" />, description: "Historical stock counts performed", isLoading: isLoadingAudits },
          { title: "Pending Approvals", value: String(draftAuditsCount), icon: <AlertCircle className="h-4 w-4 text-amber-500" />, description: "Audits requiring manager approval", isLoading: isLoadingAudits },
          { title: "Latest Audit Performed", value: latestAuditDateStr, icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, description: "Most recent physical check date", isLoading: isLoadingAudits },
        ]}
      />

      {(() => {
        const auditColumns = [
          ...(currentStore?.id === "all" ? [{
            key: "storeName",
            header: "Store",
            render: (audit: any) => (
              <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium uppercase shrink-0">
                {audit.storeName || "Global"}
              </Badge>
            ),
          }] : []),
          {
            key: "id",
            header: "Audit ID",
            render: (audit: any) => (
              <span className="font-mono text-xs font-semibold">
                {audit.id.substring(0, 8).toUpperCase()}
              </span>
            ),
          },
          {
            key: "createdAt",
            header: "Date Conducted",
            render: (audit: any) => (
              <span className="text-sm">
                {new Intl.DateTimeFormat("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(audit.createdAt))}
              </span>
            ),
          },
          {
            key: "conductedBy",
            header: "Conducted By",
            render: (audit: any) => {
              return <span className="text-sm font-medium">{audit.conductorName}</span>;
            },
          },
          {
            key: "status",
            header: "Status",
            render: (audit: any) => (
              <Badge
                variant="secondary"
                className={
                  audit.status === "approved"
                    ? "bg-green-500/10 text-green-500 hover:bg-green-500/25 animate-pulse"
                    : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/25"
                }
              >
                {audit.status.toUpperCase()}
              </Badge>
            ),
          },
          {
            key: "notes",
            header: "General Notes",
            render: (audit: any) => (
              <span className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                {audit.notes || "—"}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            render: (audit: any) => (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAuditId(audit.id);
                  setIsAuditDetailOpen(true);
                }}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                View Details
              </Button>
            ),
          },
        ];

        const auditRows = auditsList.map((a) => ({
          ...a,
          conductorName: staffList.find((s) => s.id === a.conductedByStaffId)?.name ?? "System / Admin",
        }));
        const conductors = Array.from(new Set(auditRows.map((a) => a.conductorName))).sort();
        const searchedAudits = auditRows.filter((a) => auditMatchesSearch(a, auditSearchTerm));
        const visibleAudits = sortAudits(searchedAudits.filter((a) => auditMatchesFilters(a, auditFilters)), auditSort);

        return (
          <div className="space-y-3">
            <ListControls
              testIdPrefix="audit"
              placeholder="Search audit ID, notes or conductor"
              search={auditSearchTerm}
              onSearchChange={setAuditSearchTerm}
              filterCount={countActiveAuditFilters(auditFilters)}
              filters={(trigger) => (
                <AuditFiltersSheet
                  filters={auditFilters}
                  onApply={setAuditFilters}
                  resultCountFor={(draft) => searchedAudits.filter((a) => auditMatchesFilters(a, draft)).length}
                  conductors={conductors}
                  trigger={trigger}
                />
              )}
              sortLabel={auditSortLabel(auditSort).replace(/^Sort: /, "")}
              sort={(trigger) => <AuditSortSheet sort={auditSort} onChange={setAuditSort} trigger={trigger} />}
              chips={buildAuditFilterChips(auditFilters)}
              onRemoveChip={(key) => setAuditFilters((f) => clearAuditFilterChip(f, key as keyof AuditFilterState))}
              hasSort={auditSort !== null}
              onClearAll={() => { setAuditFilters(EMPTY_AUDIT_FILTERS); setAuditSort(null); }}
              visibleCount={visibleAudits.length}
              noun="audit"
            />

            <DataTable
              data={visibleAudits}
              columns={auditColumns}
              hideToolbar
              isLoading={isLoadingAudits}
              emptyMessage="No stock audits recorded. Initiate one using the button above."
              onRowClick={(audit) => {
                setSelectedAuditId(audit.id);
                setIsAuditDetailOpen(true);
              }}
              urlKey="audits"
            />
          </div>
        );
      })()}

      {/* Audit Details Dialog */}
      <Dialog open={isAuditDetailOpen} onOpenChange={setIsAuditDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 glassmorphic-dark border-muted/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <FileText className="h-5 w-5 text-primary" />
              Stock Audit Details
            </DialogTitle>
            <DialogDescription>
              Detailed logs and physical variances for this stock audit.
            </DialogDescription>
          </DialogHeader>

          {isLoadingAuditDetail ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : auditDetail ? (
            <>
              <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
                <div className="grid grid-cols-2 gap-4 rounded-lg border border-muted/30 bg-muted/5 p-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Status</span>
                    <Badge
                      variant="secondary"
                      className={
                        auditDetail.status === "approved"
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/25"
                          : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/25"
                      }
                    >
                      {auditDetail.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Date Conducted</span>
                    <span className="font-medium text-foreground">
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(auditDetail.createdAt))}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Conducted By</span>
                    <span className="font-medium text-foreground">
                      {auditDetail.conductedBy
                        ? auditDetail.conductedBy.name
                        : "System / Admin"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Approved By</span>
                    <span className="font-medium text-foreground">
                      {auditDetail.approvedBy
                        ? auditDetail.approvedBy.name || auditDetail.approvedBy.email
                        : auditDetail.status === "approved"
                        ? "Admin / Manager"
                        : "Pending Approval"}
                    </span>
                  </div>
                  {auditDetail.notes && (
                    <div className="col-span-2 space-y-1 pt-2 border-t border-muted/20">
                      <span className="text-xs text-muted-foreground block">Notes</span>
                      <p className="text-xs text-muted-foreground italic bg-muted/10 p-2 rounded border border-muted/20">
                        {auditDetail.notes}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Audited Items & Drifts</h4>
                  <div className="border border-muted/30 rounded-lg overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-muted/10 border-b border-muted/30 text-muted-foreground font-semibold">
                          <th className="p-3">Product Name</th>
                          <th className="p-3 text-right">System Qty</th>
                          <th className="p-3 text-right">Physical Qty</th>
                          <th className="p-3 text-right">Variance</th>
                          <th className="p-3">Drift Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-muted/20">
                        {auditDetail.items.map((item: any) => {
                          const variance = item.physicalQuantity - item.systemQuantity;
                          return (
                            <tr key={item.id} className="hover:bg-muted/5">
                              <td className="p-3 font-medium text-foreground">{item.inventory?.name || "Unknown Product"}</td>
                              <td className="p-3 text-right font-mono text-muted-foreground">{item.systemQuantity}</td>
                              <td className="p-3 text-right font-mono text-foreground">{item.physicalQuantity}</td>
                              <td
                                className={`p-3 text-right font-mono font-bold ${
                                  variance > 0 ? "text-green-500" : variance < 0 ? "text-red-500" : "text-muted-foreground"
                                }`}
                              >
                                {variance > 0 ? `+${variance}` : variance}
                              </td>
                              <td className="p-3 text-muted-foreground italic">{item.reason || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Approving a count settles metered supplies against what was really
                  on the shelf, so it moves money. Say how much BEFORE they commit. */}
              {auditDetail.status === "draft" && !!variancePreview && variancePreview.total !== 0 && (
                <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/10">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-xs space-y-2">
                    <p>
                      Approving this count will{" "}
                      {variancePreview.total > 0 ? "charge" : "credit back"}{" "}
                      <strong>{formatCurrency(Math.abs(variancePreview.total))}</strong>{" "}
                      {variancePreview.total > 0 ? "to" : "from"} Direct Supplies — the difference between
                      what your recipes assumed and what is actually on the shelf.
                    </p>
                    <ul className="space-y-0.5">
                      {variancePreview.lines.map((l: any, i: number) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="text-muted-foreground truncate">{l.name}</span>
                          <span className="font-mono shrink-0">{formatCurrency(l.cost)}</span>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 border-t border-muted/30 pt-4">
                <Button variant="outline" onClick={() => setIsAuditDetailOpen(false)}>
                  Close
                </Button>
                {auditDetail.status === "draft" && (user?.role === "owner" || user?.role === "manager") && (
                  <Button
                    onClick={() => approveAuditMutation.mutate(auditDetail.id)}
                    disabled={approveAuditMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {approveAuditMutation.isPending ? "Approving..." : "Approve & Resolve Drifts"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">Could not load details.</div>
          )}
        </DialogContent>
      </Dialog>

      <SpeedDialFAB
        actions={[
          {
            label: "New Audit",
            icon: <ClipboardList className="h-5 w-5" />,
            onClick: () => setLocation("/inventory/audits/new"),
            testId: "fab-new-audit",
          },
        ]}
      />
    </div>
  );
}
