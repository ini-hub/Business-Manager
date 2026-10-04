import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ShieldCheck, Eye, AlertCircle, CheckCircle2, XCircle, EyeOff, ListChecks, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { AuditLogFiltersSheet, AuditLogSortSheet } from "@/components/audit-log-filter-sheets";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import {
  type AuditLogFilterState,
  type AuditLogSortState,
  EMPTY_AUDIT_LOG_FILTERS,
  auditLogSortLabel,
  auditMatchesFilters,
  auditMatchesSearch,
  auditUserLabel,
  buildAuditLogFilterChips,
  clearAuditLogFilterChip,
  countActiveAuditLogFilters,
  formatAuditText as formatAction,
  formatAuditText as formatResource,
  isFailed,
  sortAuditLogs,
} from "@/lib/audit-log-filters";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

function actionBadgeStyle(action: string) {
  if (action.includes("DELETE") || action.includes("VOID") || action.includes("ARCHIVE") || action.includes("REJECT")) {
    return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  }
  if (action.includes("CREATE") || action.includes("OPEN") || action.includes("REGISTER") || action.includes("RESTORE")) {
    return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800";
  }
  if (action.includes("UPDATE") || action.includes("APPROVE") || action.includes("MARK_PAID") || action.includes("RECOVER") || action.includes("TRANSFER")) {
    return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  }
  return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
}


export default function AuditLogsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.role === "owner";
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AuditLogFilterState>(EMPTY_AUDIT_LOG_FILTERS);
  const [sort, setSort] = useState<AuditLogSortState | null>(null);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [visibleLogs, setVisibleLogs] = useState<any[]>([]);

  // The date range is the only server-side scope; everything else narrows the loaded entries.
  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (filters.dateFrom) p.startDate = filters.dateFrom;
    if (filters.dateTo) p.endDate = filters.dateTo;
    return p;
  }, [filters.dateFrom, filters.dateTo]);

  const bulkRedactMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/audit-logs/${id}/redact`, {});
        if (!res.ok) throw new Error("redact failed");
        return "redacted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/audit-logs"] });
      setSelectedIds([]);
      const redacted = counts.redacted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${redacted} log ${redacted !== 1 ? "entries" : "entry"} redacted` }
          : { title: `${redacted} redacted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk redact failed", variant: "destructive" }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/audit-logs", queryParams],
    queryFn: async () => {
      const params = new URLSearchParams(queryParams);
      const res = await apiRequest("GET", `/api/audit-logs?${params}`);
      return res.json();
    },
  });

  const allLogs: any[] = data?.logs || [];
  const searched = useMemo(() => allLogs.filter((l) => auditMatchesSearch(l, search)), [allLogs, search]);
  const logs = useMemo(
    () => sortAuditLogs(searched.filter((l) => auditMatchesFilters(l, filters)), sort),
    [searched, filters, sort],
  );
  const resourceOptions = useMemo(() => Array.from(new Set(allLogs.map((l) => l.resource as string))).sort(), [allLogs]);
  const userOptions = useMemo(() => Array.from(new Set(allLogs.map((l) => auditUserLabel(l)))).sort(), [allLogs]);

  const failedCount = allLogs.filter(isFailed).length;
  const redactedCount = allLogs.filter((l) => l.redactedAt).length;

  const logCardAvatar = (log: any) => (
    <Avatar className="h-10 w-10">
      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
        {getCustomerInitials(auditUserLabel(log))}
      </AvatarFallback>
    </Avatar>
  );

  const columns = [
    {
      key: "userName",
      header: "User",
      priority: 1 as const,
      render: (log: any) => (
        <div className="flex flex-col">
          <span className="font-medium leading-tight">{log.userName || "—"}</span>
          {log.userEmail && <span className="text-xs text-muted-foreground">{log.userEmail}</span>}
        </div>
      ),
      cardRender: (log: any) => <span className="truncate">{auditUserLabel(log)}</span>,
    },
    {
      key: "action",
      header: "Action",
      priority: 1 as const,
      render: (log: any) => (
        <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-wide ${actionBadgeStyle(log.action)}`}>
          {formatAction(log.action)}
        </Badge>
      ),
      cardRender: (log: any) => <span className="truncate text-xs font-semibold uppercase">{formatAction(log.action)}</span>,
    },
    {
      key: "timestamp",
      header: "Time",
      priority: 2 as const,
      render: (log: any) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">{new Date(log.timestamp).toLocaleString()}</span>
      ),
      cardRender: (log: any) => <span>{new Date(log.timestamp).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>,
    },
    {
      key: "status",
      header: "Status",
      priority: 2 as const,
      render: (log: any) =>
        !isFailed(log) ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Success
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
            <XCircle className="h-3.5 w-3.5" />
            Failed
          </span>
        ),
    },
    {
      key: "resource",
      header: "Resource",
      priority: 3 as const,
      render: (log: any) => (
        <div className="text-xs text-muted-foreground">
          <span className="capitalize">{formatResource(log.resource)}</span>
          {log.resourceId && (
            <span className="block font-mono text-[10px] opacity-60 truncate max-w-[120px]">{log.resourceId}</span>
          )}
        </div>
      ),
      cardRender: (log: any) => <span className="capitalize truncate">{formatResource(log.resource)}</span>,
    },
    {
      key: "details",
      header: "Details",
      render: (log: any) =>
        log.redactedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground italic">
            <EyeOff className="h-3.5 w-3.5" />
            Redacted
          </span>
        ) : log.details || log.errorMessage ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            View
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        ),
    },
  ];

  const exportColumns = [
    { key: "timestamp", header: "Time" },
    { key: "userName", header: "User" },
    { key: "userEmail", header: "Email" },
    { key: "action", header: "Action" },
    { key: "resource", header: "Resource" },
    { key: "resourceId", header: "Resource ID" },
    { key: "status", header: "Status" },
    { key: "ip", header: "IP Address" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Log"
        description="A full audit trail of every change made in your business."
        compact
        actions={
          <ExportToolbar
            data={allLogs as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            filename={`activity-log_${new Date().toISOString().slice(0, 10)}`}
            title="Activity Log"
            disabled={allLogs.length === 0}
            visibleData={visibleLogs as unknown as Record<string, unknown>[]}
          />
        }
      />

      <MetricRow
        metrics={[
          { title: "Entries", value: allLogs.length, icon: <ListChecks className="h-4 w-4" />, isLoading },
          { title: "Failed", value: failedCount, icon: <XCircle className="h-4 w-4" />, isLoading },
          { title: "Active users", value: new Set(allLogs.map((l) => auditUserLabel(l))).size, icon: <Users className="h-4 w-4" />, isLoading },
          { title: "Redacted", value: redactedCount, icon: <EyeOff className="h-4 w-4" />, isLoading },
        ]}
      />

      {error ? (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          Failed to load audit logs. Please try again.
        </div>
      ) : (
        <div className="space-y-3">
          {isOwner && (
            <BulkSelectionActionBar
              count={selectedIds.length}
              unitLabel="entry"
              onClear={() => setSelectedIds([])}
              actions={[
                {
                  key: "redact",
                  label: "Redact Selected",
                  pendingLabel: "Redacting…",
                  icon: <EyeOff className="h-3.5 w-3.5" />,
                  tone: "destructive",
                  pending: bulkRedactMutation.isPending,
                  onClick: () => bulkRedactMutation.mutate(selectedIds as string[]),
                },
              ]}
            />
          )}

          <ListControls
            testIdPrefix="audit-log"
            placeholder="Search user, action or resource ID"
            search={search}
            onSearchChange={setSearch}
            filterCount={countActiveAuditLogFilters(filters)}
            filters={(trigger) => (
              <AuditLogFiltersSheet
                filters={filters}
                onApply={(next) => { setFilters(next); setSelectedIds([]); }}
                resources={resourceOptions}
                users={userOptions}
                resultCountFor={(draft) => searched.filter((l) => auditMatchesFilters(l, draft)).length}
                trigger={trigger}
              />
            )}
            sortLabel={auditLogSortLabel(sort).replace(/^Sort: /, "")}
            sort={(trigger) => <AuditLogSortSheet sort={sort} onChange={setSort} trigger={trigger} />}
            chips={buildAuditLogFilterChips(filters)}
            onRemoveChip={(key) => setFilters((f) => clearAuditLogFilterChip(f, key as Parameters<typeof clearAuditLogFilterChip>[1]))}
            hasSort={sort !== null}
            onClearAll={() => { setFilters(EMPTY_AUDIT_LOG_FILTERS); setSort(null); }}
            visibleCount={logs.length}
            noun="entry"
          />

          <DataTable
            data={logs}
            columns={columns}
            hideToolbar
            isLoading={isLoading}
            emptyTitle="No matching entries"
            emptyMessage="Try adjusting your filters."
            emptyIcon={<ShieldCheck className="h-6 w-6" />}
            onRowClick={(log: any) => setSelectedLog(log)}
            onVisibleDataChange={setVisibleLogs}
            urlKey="log"
            showCardChevron
            cardLayout="compact-grid"
            cardAvatar={logCardAvatar}
            multiselect={isOwner}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
          />
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Log Entry Detail
            </DialogTitle>
            <DialogDescription>
              {selectedLog && new Date(selectedLog.timestamp).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg border text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">User</p>
                  <p className="font-medium">{selectedLog.userName || "—"}</p>
                  {selectedLog.userEmail && <p className="text-muted-foreground">{selectedLog.userEmail}</p>}
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Action</p>
                  <p className="font-medium uppercase">{formatAction(selectedLog.action)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Resource</p>
                  <p className="font-medium capitalize">{formatResource(selectedLog.resource)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">IP Address</p>
                  <p className="font-mono">{selectedLog.ip || "—"}</p>
                </div>
                {selectedLog.channel && (
                  <div>
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Origin</p>
                    <p className="font-medium capitalize">
                      {selectedLog.channel}
                      {selectedLog.userAgent && <span className="block text-muted-foreground text-[10px] font-normal truncate">{selectedLog.userAgent}</span>}
                    </p>
                  </div>
                )}
                {selectedLog.batchId && (
                  <div>
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Batch</p>
                    <p className="font-mono text-[10px] break-all">{selectedLog.batchId}</p>
                  </div>
                )}
                {selectedLog.resourceId && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Resource ID</p>
                    <p className="font-mono break-all">{selectedLog.resourceId}</p>
                  </div>
                )}
                {selectedLog.errorMessage && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Error</p>
                    <p className="text-red-600 dark:text-red-400">{selectedLog.errorMessage}</p>
                  </div>
                )}
              </div>

              {Array.isArray(selectedLog.changedFields) && selectedLog.changedFields.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">
                    What changed ({selectedLog.changedFields.length} field{selectedLog.changedFields.length !== 1 ? "s" : ""})
                  </p>
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="text-left font-semibold px-2 py-1.5">Field</th>
                          <th className="text-left font-semibold px-2 py-1.5">Before</th>
                          <th className="text-left font-semibold px-2 py-1.5">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLog.changedFields.map((field: string) => (
                          <tr key={field} className="border-t">
                            <td className="px-2 py-1.5 font-mono text-muted-foreground">{field}</td>
                            <td className="px-2 py-1.5 font-mono text-red-600 dark:text-red-400 break-all">
                              {JSON.stringify(selectedLog.previousValues?.[field] ?? null)}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-emerald-600 dark:text-emerald-400 break-all">
                              {JSON.stringify(selectedLog.newValues?.[field] ?? null)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!selectedLog.changedFields?.length && selectedLog.newValues && !selectedLog.previousValues && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">Created with</p>
                  <pre className="bg-muted p-3 rounded-lg overflow-auto max-h-56 font-mono text-xs leading-relaxed">
                    {JSON.stringify(selectedLog.newValues, null, 2)}
                  </pre>
                </div>
              )}

              {!selectedLog.changedFields?.length && selectedLog.previousValues && !selectedLog.newValues && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">Record at time of removal</p>
                  <pre className="bg-muted p-3 rounded-lg overflow-auto max-h-56 font-mono text-xs leading-relaxed">
                    {JSON.stringify(selectedLog.previousValues, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.details && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">Payload</p>
                  <pre className="bg-muted p-3 rounded-lg overflow-auto max-h-56 font-mono text-xs leading-relaxed">
                    {JSON.stringify(
                      typeof selectedLog.details === "string"
                        ? JSON.parse(selectedLog.details)
                        : selectedLog.details,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}

              {selectedLog.resourceId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setSearch(selectedLog.resourceId);
                    setFilters(EMPTY_AUDIT_LOG_FILTERS);
                    setSelectedLog(null);
                  }}
                >
                  View full history for this record
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
