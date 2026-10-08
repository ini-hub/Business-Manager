import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, Plus, Banknote, Check, Trash2, X, RotateCcw, Users, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { ListControls } from "@/components/list-controls";
import { MetricRow } from "@/components/metric-row";
import { AdvanceFiltersSheet, AdvanceSortSheet } from "@/components/advance-filter-sheets";
import {
  EMPTY_ADVANCE_FILTERS, advanceMatchesFilters, advanceMatchesSearch, advanceSortLabel,
  buildAdvanceFilterChips, clearAdvanceFilterChip, countActiveAdvanceFilters, sortAdvances,
  type AdvanceFilterState, type AdvanceSortState,
} from "@/lib/advance-filters";
import { DataTable, type RowAction, type BulkAction } from "@/components/data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency, getCurrencyByCode } from "@/lib/currency-utils";
import { useLocation } from "wouter";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { ExportToolbar } from "@/components/export-toolbar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { useAuth } from "@/hooks/useAuth";
import { fetchAllStaff } from "@/lib/staff-api";

const advanceCardAvatar = (a: { staffName?: string }) => (
  <Avatar className="h-10 w-10">
    <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
      {(a.staffName || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
    </AvatarFallback>
  </Avatar>
);

export default function PayrollAdvancesPage() {
  const { currentStore, business } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);

  const [showCreate, setShowCreate] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<AdvanceFilterState>(EMPTY_ADVANCE_FILTERS);
  const [sort, setSort] = useState<AdvanceSortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [recoverTarget, setRecoverTarget] = useState<any | null>(null);
  const [recoverReason, setRecoverReason] = useState("");

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: () => fetchAllStaff(currentStore!.id),
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: advances = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/payroll/advances", currentStore?.id],
    queryFn: () => fetchAllPages<any>(`/api/payroll/advances?storeId=${currentStore?.id}`),
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/advances", {
        storeId: currentStore?.id, staffId, amount: parseFloat(amount), date, notes: notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setShowCreate(false);
      setStaffId(""); setAmount(""); setDate(new Date().toISOString().split("T")[0]); setNotes("");
      toast({ title: "Salary advance recorded" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/payroll/advances/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Advance deleted" }); },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/payroll/advances/${id}/approve`),
    onSuccess: () => { refetch(); toast({ title: "Advance approved" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("POST", `/api/payroll/advances/${id}/reject`, { reason }),
    onSuccess: () => {
      refetch();
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Advance rejected" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Manual override only — an advance still open in payroll settles
  // automatically at mark-paid. This exists for the cases that path can't
  // reach: repaid in cash outside payroll, or written off entirely. The
  // server refuses it while a live payroll proposal exists for the advance.
  const recoverMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("POST", `/api/payroll/advances/${id}/recover`, { reason }),
    onSuccess: () => {
      refetch();
      setRecoverTarget(null);
      setRecoverReason("");
      toast({ title: "Advance marked recovered" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Owner-only escape hatch: an advance reserved to a payroll period that's
  // never marked paid or deleted stays locked away from every other open
  // period indefinitely, with no timeout of its own.
  const releaseMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/payroll/advances/${id}/release-reservation`),
    onSuccess: () => { refetch(); toast({ title: "Reservation released" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Undoes a mistaken manual recovery (POST /recover). Owner-only,
  // time-boxed to the current store-local month — see canRestoreManualRecovery.
  const restoreManualRecoveryMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/payroll/advances/${id}/restore-manual-recovery`),
    onSuccess: () => { refetch(); toast({ title: "Recovery undone — advance is open again" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // The server rejects deleting an advance that still has a payroll
      // deduction on record, so a failure here is a real per-row refusal.
      const { counts, byOutcome } = await runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("DELETE", `/api/payroll/advances/${id}`, undefined, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      });
      return { counts, failedIds: byOutcome.failed ?? [] };
    },
    onSuccess: () => { refetch(); setSelectedIds([]); },
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (currentStore.id === "all") return (
    <div className="space-y-6">
      <PageHeader title="Salary Advances" description="Select a specific store to manage advances" />
    </div>
  );

  const totalPending = advances.filter((a: any) => !a.isRecovered).reduce((s: number, a: any) => s + Number(a.amount), 0);
  const recoveredIds = new Set(advances.filter((a: any) => a.isRecovered).map((a: any) => a.id));

  const enrichedAdvances = advances.map((a: any) => {
    const staffMember = staffList.find((s) => s.id === a.staffId);
    return {
      ...a,
      staffName: staffMember?.name || a.staffId,
      staffNumber: staffMember?.staffNumber || "—",
      staffMobile: staffMember?.mobileNumber || "—",
    };
  });

  const currencySymbol = getCurrencyByCode(currency)?.symbol ?? "₦";
  const searchedAdvances = enrichedAdvances.filter((a: any) => advanceMatchesSearch(a, searchTerm));
  const tableAdvances = sortAdvances(searchedAdvances.filter((a: any) => advanceMatchesFilters(a, filters)), sort);
  const staffNames = Array.from(new Set(enrichedAdvances.map((a: any) => a.staffName as string))).sort();
  const awaitingApproval = advances.filter((a: any) => a.status === "pending").length;

  const exportColumns = [
    { key: "staffName", header: "Staff" },
    { key: "staffNumber", header: "Staff #" },
    { key: "staffMobile", header: "Phone" },
    { key: "amount", header: "Amount" },
    { key: "date", header: "Date" },
    { key: "notes", header: "Notes" },
    { key: "status", header: "Status" },
  ];

  type AdvanceReportRow = { staffName: string; staffNumber: string; staffMobile: string; amount: number; date: string; notes: string; status: string };
  const buildAdvancePdfRows = (rows: any[]): AdvanceReportRow[] => rows.map((a: any) => {
    const staffMember = staffList.find((s) => s.id === a.staffId);
    return {
      staffName: a.staffName ?? staffMember?.name ?? a.staffId,
      staffNumber: a.staffNumber ?? staffMember?.staffNumber ?? "—",
      staffMobile: a.staffMobile ?? staffMember?.mobileNumber ?? "—",
      amount: Number(a.amount),
      date: format(parseISO(a.date), "MMM d, yyyy"),
      notes: a.notes || "—",
      status: a.isRecovered ? "Recovered" : "Pending",
    };
  });

  const [visibleAdvanceRows, setVisibleAdvanceRows] = useState<any[]>([]);
  const pdfRows: AdvanceReportRow[] = buildAdvancePdfRows(enrichedAdvances);
  const visiblePdfRows: AdvanceReportRow[] = buildAdvancePdfRows(visibleAdvanceRows);

  const pdfReport = {
    businessName: business?.name ?? currentStore.name,
    storeName: currentStore.name,
    kpis: [
      { label: "Pending Recoverable", value: fmt(totalPending) },
      { label: "Total Advances", value: String(advances.length) },
      { label: "Recovered", value: String(advances.filter((a: any) => a.isRecovered).length) },
    ],
    columns: [
      { key: "staffName", header: "Staff" },
      { key: "staffNumber", header: "Staff #" },
      { key: "staffMobile", header: "Phone" },
      { key: "date", header: "Date" },
      { key: "notes", header: "Notes" },
      { key: "status", header: "Status" },
      { key: "amount", header: "Amount", align: "right" as const, format: (r: AdvanceReportRow) => fmt(r.amount) },
    ],
    rows: pdfRows,
    amountKey: "amount",
    formatAmount: fmt,
    unitLabel: "advances",
    statusKey: "status",
    getStatus: (r: AdvanceReportRow) => ({ label: r.status, tone: r.status === "Recovered" ? ("success" as const) : ("warning" as const) }),
  };

  const visiblePdfReport = {
    ...pdfReport,
    kpis: [
      { label: "Pending Recoverable", value: fmt(visibleAdvanceRows.filter((a: any) => !a.isRecovered).reduce((s: number, a: any) => s + Number(a.amount), 0)) },
      { label: "Total Advances", value: String(visibleAdvanceRows.length) },
      { label: "Recovered", value: String(visibleAdvanceRows.filter((a: any) => a.isRecovered).length) },
    ],
    rows: visiblePdfRows,
  };

  const columns = [
    {
      key: "staffName",
      header: "Staff",
      render: (a: any) => (
        <EntityLink href={`/staffs/${a.staffId}/edit`} className="font-medium">
          {a.staffName}
        </EntityLink>
      ),
    },
    {
      key: "staffNumber",
      priority: 3 as const,
      header: "Staff #",
      render: (a: any) => <span className="text-muted-foreground">{a.staffNumber}</span>,
    },
    {
      key: "staffMobile",
      priority: 2 as const,
      header: "Phone",
      render: (a: any) => <span className="text-muted-foreground">{a.staffMobile}</span>,
    },
    {
      key: "amount",
      priority: 1 as const,
      header: "Amount",
      render: (a: any) => <span className="font-mono font-semibold">{fmt(Number(a.amount))}</span>,
    },
    {
      key: "date",
      priority: 1 as const,
      header: "Date",
      render: (a: any) => <span className="text-muted-foreground">{format(parseISO(a.date), "MMM d, yyyy")}</span>,
    },
    {
      key: "notes",
      priority: 3 as const,
      header: "Notes",
      render: (a: any) => <span className="text-xs text-muted-foreground">{a.notes || "—"}</span>,
    },
    {
      key: "status",
      priority: 1 as const,
      header: "Status",
      render: (a: any) => {
        const statusBadge = (() => {
          if (a.isRecovered) return <Badge variant="outline" className="text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 gap-1"><Check className="h-3 w-3" /> Recovered</Badge>;
          // Too big for one payroll period: part of it was already collected,
          // the rest carries forward on this same advance and will be proposed
          // again automatically.
          if (a.recoveryStatus === "partial") return <Badge variant="outline" className="text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200">Partial — {fmt(Number(a.outstandingBalance))} left</Badge>;
          if (a.status === "rejected") return <Badge variant="outline" className="text-red-700 bg-red-50 dark:bg-red-950 border-red-200">Rejected</Badge>;
          if (a.status === "approved") return <Badge variant="outline" className="text-blue-700 bg-blue-50 dark:bg-blue-950 border-blue-200">Approved</Badge>;
          return <Badge variant="outline" className="text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200">Pending Approval</Badge>;
        })();

        // recoveredPeriodId doubles as a pre-settlement reservation — set the
        // moment a payroll period proposes this advance, released only once
        // that period pays it (or a manager force-releases it below). A
        // reserved-but-not-recovered advance is invisible to every other
        // open period until one of those happens, so surface it here.
        const reserved = a.reservedPeriod && a.recoveryStatus !== "recovered";
        return (
          <div className="space-y-1">
            {statusBadge}
            {reserved && (
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Reserved — {format(parseISO(a.reservedPeriod.startDate), "MMM d")}–{format(parseISO(a.reservedPeriod.endDate), "MMM d, yyyy")} payroll ({a.reservedPeriod.status === "paid" ? "paid" : "not yet paid"})
                </p>
                {isOwner && a.reservedPeriod.status !== "paid" && (
                  <Button variant="ghost" size="sm" className="h-4 px-1 text-[11px] text-muted-foreground hover:text-foreground"
                    disabled={releaseMutation.isPending}
                    onClick={() => releaseMutation.mutate(a.id)}>
                    Release
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const rowActions = (a: any): RowAction[] => {
    const reserved = a.reservedPeriod && a.recoveryStatus !== "recovered";
    const actions: RowAction[] = [];
    if (a.status === "pending") {
      actions.push(
        { label: "Approve", icon: <Check className="h-4 w-4" />, disabled: approveMutation.isPending, onClick: () => approveMutation.mutate(a.id), testId: `button-approve-${a.id}` },
        { label: "Reject", icon: <X className="h-4 w-4" />, onClick: () => { setRejectTarget(a); setRejectReason(""); }, testId: `button-reject-${a.id}` },
      );
    }
    if (a.status === "approved" && !a.isRecovered) {
      actions.push({
        // A reserved advance is already proposed on an open payroll period and
        // will be recovered when that period is paid — release it first.
        label: reserved ? "Recover outside payroll (reserved)" : "Recover outside payroll",
        icon: <Banknote className="h-4 w-4" />,
        disabled: !!reserved,
        onClick: () => { setRecoverTarget(a); setRecoverReason(""); },
        testId: `button-recover-${a.id}`,
      });
    }
    // manualRecoveryReason is only set by the manual override, which is exactly what's undoable.
    if (a.isRecovered && a.manualRecoveryReason && isOwner) {
      actions.push({
        label: "Undo recovery",
        icon: <RotateCcw className="h-4 w-4" />,
        disabled: !a.canRestoreManualRecovery || restoreManualRecoveryMutation.isPending,
        onClick: () => restoreManualRecoveryMutation.mutate(a.id),
        testId: `button-undo-recovery-${a.id}`,
      });
    }
    if (!a.isRecovered) {
      actions.push({ label: "Delete", icon: <Trash2 className="h-4 w-4" />, destructive: true, onClick: () => deleteMutation.mutate(a.id), testId: `button-delete-${a.id}` });
    }
    return actions;
  };

  // Recovered advances have no manual delete path, so they're ineligible here.
  const bulkActions: BulkAction<any>[] = [
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      kind: "destructive",
      destructiveDescription: "Advances that already have a payroll deduction on record can't be deleted and will be skipped.",
      precheck: (selection) => {
        const ineligibleCount = selection.items.filter((a: any) => recoveredIds.has(a.id)).length;
        return ineligibleCount > 0 ? { ineligibleCount, reason: "are already recovered and can't be deleted" } : null;
      },
      onExecute: async (selection) => {
        const ids = (selection.ids as string[]).filter((id) => !recoveredIds.has(id));
        const { counts, failedIds } = await bulkDeleteMutation.mutateAsync(ids);
        return { succeeded: counts.deleted ?? 0, failed: counts.failed ?? 0, failedIds };
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Advances"
        description={`Pending recoverable: ${fmt(totalPending)}`}
        compact
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocation("/payroll")}>
              <ChevronLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Back to Payroll</span>
            </Button>
            <ExportToolbar
              data={enrichedAdvances as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              filename={`salary-advances-${new Date().toISOString().slice(0, 10)}`}
              title="Salary Advances Report"
              pdfReport={pdfReport}
              visibleData={visibleAdvanceRows as unknown as Record<string, unknown>[]}
              visiblePdfReport={visiblePdfReport}
            />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Record Advance</span>
            </Button>
          </div>
        }
      />

      {totalPending > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="flex items-center gap-3 py-4">
            <Banknote className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">{fmt(totalPending)} outstanding</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {advances.filter((a: any) => !a.isRecovered).length} advance(s) not yet recovered. Approved advances are deducted automatically from the staff member's next payroll and marked recovered when that period is paid.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <MetricRow
        metrics={[
          { title: "Pending Recoverable", value: fmt(totalPending), icon: <Banknote className="h-4 w-4" /> },
          { title: "Total Advances", value: advances.length, icon: <Users className="h-4 w-4" /> },
          { title: "Awaiting Approval", value: awaitingApproval, icon: <Clock className="h-4 w-4" /> },
          { title: "Recovered", value: advances.filter((a: any) => a.isRecovered).length, icon: <CheckCircle2 className="h-4 w-4" /> },
        ]}
      />

      <div className="space-y-3">
        <ListControls
          testIdPrefix="advance"
          placeholder="Search staff, staff # or phone"
          search={searchTerm}
          onSearchChange={setSearchTerm}
          filterCount={countActiveAdvanceFilters(filters)}
          filters={(trigger) => (
            <AdvanceFiltersSheet
              filters={filters}
              onApply={(next) => { setFilters(next); setSelectedIds([]); }}
              currencySymbol={currencySymbol}
              staffNames={staffNames}
              resultCountFor={(draft) => searchedAdvances.filter((a: any) => advanceMatchesFilters(a, draft)).length}
              trigger={trigger}
            />
          )}
          sortLabel={advanceSortLabel(sort).replace(/^Sort: /, "")}
          sort={(trigger) => <AdvanceSortSheet sort={sort} onChange={setSort} trigger={trigger} />}
          chips={buildAdvanceFilterChips(filters, currencySymbol)}
          onRemoveChip={(key) => setFilters((f) => clearAdvanceFilterChip(f, key as Parameters<typeof clearAdvanceFilterChip>[1]))}
          hasSort={sort !== null}
          onClearAll={() => { setFilters(EMPTY_ADVANCE_FILTERS); setSort(null); }}
          visibleCount={tableAdvances.length}
          noun="advance"
        />
          <DataTable
            data={tableAdvances}
            columns={columns}
            hideToolbar
            emptyMessage="No salary advances recorded."
            multiselect
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            bulkActions={bulkActions}
            entityNoun={{ singular: "advance", plural: "advances" }}
            rowActions={rowActions}
            onRowClick={(a: any) => setLocation(`/staffs/${a.staffId}/edit`)}
            showCardChevron
            cardLayout="compact-grid"
            cardAvatar={advanceCardAvatar}
            emptyIcon={<Banknote className="h-6 w-6" />}
            emptyTitle="No Salary Advances"
            onVisibleDataChange={setVisibleAdvanceRows}
            urlKey="advances"
          />
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff Member</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.filter(s => !s.isArchived).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{[s.staffNumber, s.mobileNumber].filter(Boolean).length ? ` (${[s.staffNumber, s.mobileNumber].filter(Boolean).join(" · ")})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason or reference…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button disabled={!staffId || !amount || createMutation.isPending} onClick={() => createMutation.mutate()}>
                Record Advance
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={rejectMutation.isPending}
                onClick={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason })}
              >
                Reject Advance
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recoverTarget} onOpenChange={(open) => { if (!open) setRecoverTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Recover Advance Outside Payroll</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Only for an advance repaid in cash or written off entirely outside payroll — an advance still open in payroll is recovered automatically when that period is marked paid, and this is refused while that's still pending.
            </p>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={recoverReason} onChange={e => setRecoverReason(e.target.value)} placeholder="e.g. Repaid in cash at the counter" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRecoverTarget(null)}>Cancel</Button>
              <Button
                disabled={!recoverReason.trim() || recoverMutation.isPending}
                onClick={() => recoverTarget && recoverMutation.mutate({ id: recoverTarget.id, reason: recoverReason })}
              >
                Mark Recovered
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
