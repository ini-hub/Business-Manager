import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, Plus, Banknote, Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useLocation } from "wouter";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { ExportToolbar } from "@/components/export-toolbar";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { useAuth } from "@/hooks/useAuth";

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
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [recoverTarget, setRecoverTarget] = useState<any | null>(null);
  const [recoverReason, setRecoverReason] = useState("");

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: advances = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/payroll/advances", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/advances?storeId=${currentStore?.id}`);
      return res.json();
    },
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
      // deduction on record — collect that reason per row instead of
      // reducing every failure to an opaque "failed" count.
      const failureReasons: string[] = [];
      const result = await runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("DELETE", `/api/payroll/advances/${id}`, undefined, { "X-Batch-Id": batchId });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          failureReasons.push(body?.error || "delete failed");
          throw new Error(body?.error || "delete failed");
        }
        return "deleted" as const;
      });
      return { ...result, failureReasons };
    },
    onSuccess: ({ counts, failureReasons }) => {
      refetch();
      setSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} advance${deleted !== 1 ? "s" : ""} deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, description: failureReasons[0], variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
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
          {staffList.find(s => s.id === a.staffId)?.name || a.staffId}
        </EntityLink>
      ),
    },
    {
      key: "staffNumber",
      header: "Staff #",
      render: (a: any) => <span className="text-muted-foreground">{staffList.find(s => s.id === a.staffId)?.staffNumber || "—"}</span>,
    },
    {
      key: "staffMobile",
      header: "Phone",
      render: (a: any) => <span className="text-muted-foreground">{staffList.find(s => s.id === a.staffId)?.mobileNumber || "—"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      render: (a: any) => <span className="font-mono font-semibold">{fmt(Number(a.amount))}</span>,
    },
    {
      key: "date",
      header: "Date",
      render: (a: any) => <span className="text-muted-foreground">{format(parseISO(a.date), "MMM d, yyyy")}</span>,
    },
    {
      key: "notes",
      header: "Notes",
      render: (a: any) => <span className="text-xs text-muted-foreground">{a.notes || "—"}</span>,
    },
    {
      key: "status",
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
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Reserved — {format(parseISO(a.reservedPeriod.startDate), "MMM d")}–{format(parseISO(a.reservedPeriod.endDate), "MMM d, yyyy")} payroll ({a.reservedPeriod.status === "paid" ? "paid" : "not yet paid"})
                </p>
                {isOwner && a.reservedPeriod.status !== "paid" && (
                  <Button variant="ghost" size="sm" className="h-4 px-1 text-[10px] text-muted-foreground hover:text-foreground"
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
    {
      key: "actions",
      header: "",
      render: (a: any) => (
        <div className="flex items-center gap-1">
          {a.status === "pending" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-700 hover:text-emerald-700"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate(a.id)}>
                <Check className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => { setRejectTarget(a); setRejectReason(""); }}>
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
          {a.status === "approved" && !a.isRecovered && (() => {
            const reserved = a.reservedPeriod && a.recoveryStatus !== "recovered";
            return (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                disabled={reserved}
                title={reserved ? "Already proposed on an open payroll period — it'll be recovered automatically when that period is paid, or release the reservation first." : undefined}
                onClick={() => { setRecoverTarget(a); setRecoverReason(""); }}>
                Recover outside payroll
              </Button>
            );
          })()}
          {/* manualRecoveryReason is only ever set by the manual override —
              a payroll-settled recovery never sets it, so this is exactly
              the distinction that matters for what's undoable here. */}
          {a.isRecovered && a.manualRecoveryReason && isOwner && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={!a.canRestoreManualRecovery || restoreManualRecoveryMutation.isPending}
              title={a.canRestoreManualRecovery ? undefined : (a.restoreManualRecoveryBlockedReason ?? undefined)}
              onClick={() => restoreManualRecoveryMutation.mutate(a.id)}>
              Undo recovery
            </Button>
          )}
          {!a.isRecovered && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate(a.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Advances"
        description={`Pending recoverable: ${fmt(totalPending)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocation("/payroll")}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back to Payroll
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
              <Plus className="mr-2 h-4 w-4" />
              Record Advance
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

      <Card>
        <CardHeader><CardTitle className="text-base">All Advances</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <BulkSelectionActionBar
            count={selectedIds.length}
            unitLabel="advance"
            onClear={() => setSelectedIds([])}
            actions={[
              {
                key: "delete",
                label: "Delete Selected",
                pendingLabel: "Deleting…",
                icon: <Trash2 className="h-3.5 w-3.5" />,
                tone: "destructive",
                pending: bulkDeleteMutation.isPending,
                onClick: () => bulkDeleteMutation.mutate(selectedIds as string[]),
              },
            ]}
          />
          <DataTable
            data={enrichedAdvances}
            columns={columns}
            searchable
            searchKeys={["staffName", "staffNumber", "staffMobile", "notes"]}
            searchPlaceholder="Search by staff, staff #, phone, or notes..."
            emptyMessage="No salary advances recorded."
            multiselect
            selectedIds={selectedIds}
            // Recovered advances have no manual delete path (mirrors the per-row action
            // column, which only shows a delete button for non-recovered advances).
            onSelectedIdsChange={(ids) => setSelectedIds(ids.filter((id) => !recoveredIds.has(String(id))))}
            onVisibleDataChange={setVisibleAdvanceRows}
            urlKey="advances"
          />
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
