import { useState, useEffect } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { appendReturnTo, useReturnTo } from "@/lib/return-to";
import { format, parseISO } from "date-fns";
import {
  DollarSign,
  Calculator,
  CheckCircle2,
  Lock,
  ChevronLeft,
  ChevronRight,
  Download,
  Users,
  Trash2,
  Banknote,
  BarChart3,
  AlertTriangle,
  Check,
  MoreHorizontal,
  Minus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { explainCommission, commissionHeadline } from "@shared/commission-explainer";
import type { PayrollPeriod, PayrollEntryWithPay } from "@shared/schema";

const STATUS_CONFIG = {
  pending:  { label: "Open",  variant: "secondary" as const, color: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950 border-amber-200" },
  approved: { label: "Approved", variant: "default" as const,   color: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-950 border-blue-200" },
  paid:     { label: "Paid",     variant: "default" as const,   color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200" },
};

export default function PayrollPeriodPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const userRole = user?.role || "staff";
  const isOwner = userRole === "owner";

  const [, params] = useRoute("/payroll/:periodId");
  const selectedPeriodId = params?.periodId ?? "";
  const { backHref } = useReturnTo("/payroll");
  const [periodToDelete, setPeriodToDelete] = useState<string | null>(null);

  const [entriesPage, setEntriesPage] = useUrlState("entriesPage", 1, Number);
  const [staffSearch, setStaffSearch] = useState("");

  const storeCurrency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrencyUtil(v, storeCurrency);

  const { data: selectedPeriod, isLoading: periodLoading, isError: periodError } = useQuery<PayrollPeriod>({
    queryKey: ["/api/payroll/periods", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}`);
      return res.json();
    },
    enabled: !!selectedPeriodId && !!currentStore?.id && currentStore?.id !== "all",
    retry: false,
  });

  // Reset entries pagination when selectedPeriodId changes
  useEffect(() => {
    setEntriesPage(1);
    setStaffSearch("");
  }, [selectedPeriodId]);

  const { data: unrecordedDays = [] } = useQuery<{ staffId: string; staffName: string; unrecordedDates: string[] }[]>({
    queryKey: ["/api/payroll/periods/unrecorded", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}/unrecorded`);
      return res.json();
    },
    enabled: !!selectedPeriodId && !!selectedPeriod && selectedPeriod.status !== "paid",
  });

  // Store-scoped, not period-scoped - who's excluded depends on current
  // staff/contract state, not a period's date range (see
  // PayrollService.getExcludedStaffForStore).
  const { data: excludedStaff = [] } = useQuery<{ staffId: string; name: string; reason: "pending_signature" | "declined" | "invite_pending" }[]>({
    queryKey: ["/api/payroll/excluded-staff", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/excluded-staff?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: entriesRaw = [], isLoading: entriesLoading } = useQuery<PayrollEntryWithPay[]>({
    queryKey: ["/api/payroll/periods/entries", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}/entries`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedPeriodId,
  });
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];

  const calculateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${id}/calculate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods/entries", selectedPeriodId] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      toast({ title: "Payroll calculated successfully" });
    },
    onError: (err: Error) => toast({ title: err.message || "Could not calculate payroll", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      toast({ title: "Payroll period approved" });
    },
    onError: () => toast({ title: "Could not approve payroll", variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      toast({ title: "Payroll marked as paid and locked" });
    },
    onError: (err: any) => {
      const errorMessage = err.message || "Could not mark as paid";
      toast({ 
        title: "Action Prevented", 
        description: errorMessage, 
        variant: "destructive" 
      });
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/payroll/periods/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      setLocation("/payroll");
      toast({ title: "Payroll period deleted" });
    },
    onError: (err: Error) => toast({ title: err.message || "Could not delete payroll", variant: "destructive" }),
  });

  // The cash actually payable, not the sum of gross earnings. Floored per
  // person by the server, so one staff member's surplus never covers another's
  // shortfall.
  const totalGross = entries.reduce((sum, e) => sum + (e.grossPay ?? e.netPay ?? 0), 0);
  const totalDeductions = entries.reduce((sum, e) => sum + (e.deductionsTotal ?? 0), 0);
  // Why a commission figure is what it is — above all, why it is zero. Prefers
  // the explanation snapshotted when the period was calculated, and derives one
  // for entries that predate the snapshot.
  const commissionNoteFor = (entry: PayrollEntryWithPay) => {
    const details = (entry.calculationDetails ?? {}) as Record<string, any>;
    const explanation = details.commissionExplanation
      ?? explainCommission({ ...details, grossCommission: entry.grossCommission });
    return commissionHeadline(explanation, fmt);
  };

  // The notes contain commas; every other cell here is a number or a staff name.
  const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const grandTotal = entries.reduce((sum, e) => sum + (e.takeHomePay ?? e.netPay ?? 0), 0);

  const exportCSV = (sourceEntries: PayrollEntryWithPay[] = entries) => {
    if (!sourceEntries.length || !selectedPeriod) return;
    const scopedTotal = sourceEntries.reduce((sum, e) => sum + (e.takeHomePay ?? e.netPay ?? 0), 0);
    const rows = [
      ["Staff", "Active Days", "Passive Days", "Total Transport", "Gross Commission", "Commission Note", "Gross Pay", "Deductions", "Net Pay"],
      ...sourceEntries.map(e => [
        e.staff.name,
        e.activeDays || 0,
        e.passiveDays || 0,
        (e.totalTransport || 0).toFixed(2),
        (e.grossCommission || 0).toFixed(2),
        csvCell(commissionNoteFor(e)),
        (e.grossPay ?? e.netPay ?? 0).toFixed(2),
        (e.deductionsTotal ?? 0).toFixed(2),
        (e.takeHomePay ?? e.netPay ?? 0).toFixed(2),
      ]),
      ["TOTAL", "", "", "", "", "", "", "", scopedTotal.toFixed(2)],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${selectedPeriod.startDate}-${selectedPeriod.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Payroll" description="Manage staff payroll and commissions" />
        <StoreRequiredAlert title="Store Required for Payroll" />
      </div>
    );
  }

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <PageHeader title="Payroll" description="Manage staff payroll and commissions" />
        <ConsolidatedFallbackAlert pageTitle="Staff Payroll" />
      </div>
    );
  }

  const periodLabel = (p: PayrollPeriod) =>
    p.periodType === "monthly"
      ? format(parseISO(p.startDate), "MMMM yyyy")
      : `${format(parseISO(p.startDate), "MMM d")} – ${format(parseISO(p.endDate), "MMM d, yyyy")}`;
  const periodRange = (p: PayrollPeriod) =>
    `${format(parseISO(p.startDate), "d")} to ${format(parseISO(p.endDate), "d MMMM yyyy")}`;

  const unrecordedStaffIds = new Set(unrecordedDays.map(u => u.staffId));
  const hasUnrecorded = unrecordedDays.length > 0 && !!selectedPeriod && selectedPeriod.status !== "paid";
  const needle = staffSearch.trim().toLowerCase();
  const shownEntries = needle
    ? entries.filter(e => e.staff.name.toLowerCase().includes(needle) || (e.staff.staffNumber ?? "").toLowerCase().includes(needle))
    : entries;
  const stepIndex = selectedPeriod ? ({ pending: 0, approved: 1, paid: 2 } as const)[selectedPeriod.status as "pending" | "approved" | "paid"] ?? 0 : 0;
  const isEstimate = selectedPeriod?.status === "pending";
  const detailHref = (staffId: string) => appendReturnTo(`/payroll/${selectedPeriodId}/staff/${staffId}`, location, search);

  const canApprove = !!selectedPeriod && selectedPeriod.status === "pending" && entries.length > 0;
  const canMarkPaid = !!selectedPeriod && selectedPeriod.status === "approved" && isOwner;
  const canRecalculate = !!selectedPeriod && selectedPeriod.status !== "paid";
  const primaryLabel = canApprove
    ? (approveMutation.isPending ? "Approving…" : "Approve payroll")
    : canMarkPaid ? (markPaidMutation.isPending ? "Locking…" : "Mark as paid") : null;
  const runPrimary = () => {
    if (!selectedPeriod) return;
    if (canApprove) approveMutation.mutate(selectedPeriod.id);
    else if (canMarkPaid) markPaidMutation.mutate(selectedPeriod.id);
  };
  const primaryPending = approveMutation.isPending || markPaidMutation.isPending;

  const STEPS = [
    { title: "Open", sub: "Figures can change" },
    { title: "Approved", sub: "Locked for edits" },
    { title: "Paid", sub: "Staff paid, locked" },
  ];

  const periodMenu = selectedPeriod && (entries.length > 0 || (selectedPeriod.status !== "paid" && isOwner)) && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entries.length > 0 && (
          <DropdownMenuItem onClick={() => exportCSV()}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </DropdownMenuItem>
        )}
        {entries.length > 0 && needle && shownEntries.length !== entries.length && (
          <DropdownMenuItem onClick={() => exportCSV(shownEntries)}>
            <Download className="mr-2 h-4 w-4" /> Export current view ({shownEntries.length})
          </DropdownMenuItem>
        )}
        {selectedPeriod.status !== "paid" && isOwner && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setPeriodToDelete(selectedPeriod.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete period
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const stat = (label: string, value: string, sub: string, Icon: typeof Users) => (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <PageHeader
        title={selectedPeriod ? `${periodLabel(selectedPeriod)} payroll` : "Payroll period"}
        description={selectedPeriod ? `${selectedPeriod.periodType} · ${periodRange(selectedPeriod)}` : undefined}
        compact
        actions={
          <Button variant="outline" size="sm" onClick={() => setLocation(backHref)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            <span>All periods</span>
          </Button>
        }
      />

      <div className="space-y-4">
        {/* Delete Confirmation Modal */}
        <AlertDialog open={!!periodToDelete} onOpenChange={(open) => !open && setPeriodToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Payroll Period?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all calculated earnings and transport allowances for this cycle.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (periodToDelete) {
                    deleteMutation.mutate(periodToDelete);
                    setPeriodToDelete(null);
                  }
                }}
              >
                Delete Period
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Period detail */}
        <div className="min-w-0 space-y-4">
          {!selectedPeriod ? (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <DollarSign className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                {periodLoading ? (
                  <p className="text-sm text-muted-foreground">Loading payroll period…</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{periodError ? "This payroll period could not be found." : "Payroll period unavailable."}</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => setLocation("/payroll")}>Back to pay periods</Button>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header: title, status steps, actions (desktop) */}
              <div className="rounded-xl border bg-card p-4 md:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="hidden md:block">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl font-bold">{periodLabel(selectedPeriod)} payroll</h2>
                      <Badge variant="outline" className={`${STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].color} ${STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].bg} border`}>
                        {STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground capitalize">{selectedPeriod.periodType} · {periodRange(selectedPeriod)}</p>
                  </div>
                  <div className="hidden md:flex items-center gap-2">
                    {periodMenu}
                    {canRecalculate && (
                      <Button variant="outline" onClick={() => calculateMutation.mutate(selectedPeriod.id)} disabled={calculateMutation.isPending}>
                        <Calculator className="mr-2 h-4 w-4" />
                        {calculateMutation.isPending ? "Calculating…" : entries.length > 0 ? "Recalculate" : "Calculate"}
                      </Button>
                    )}
                    {primaryLabel && (
                      <Button variant={canMarkPaid ? "destructive" : "default"} onClick={runPrimary} disabled={primaryPending}>
                        {canMarkPaid ? <Lock className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        {primaryLabel}
                      </Button>
                    )}
                  </div>
                </div>

                <ol className="hidden md:flex items-center gap-3" aria-label="Payroll status">
                  {STEPS.map((s, i) => (
                    <li key={s.title} className="flex flex-1 items-center gap-2.5 last:flex-none">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i <= stepIndex ? "bg-primary text-primary-foreground" : "border text-muted-foreground"}`}>
                        {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="leading-tight">
                        <span className={`block text-sm font-semibold ${i > stepIndex ? "text-muted-foreground" : ""}`}>{s.title}</span>
                        <span className="block text-xs text-muted-foreground">{s.sub}</span>
                      </span>
                      {i < STEPS.length - 1 && <span className={`mx-2 h-px flex-1 ${i < stepIndex ? "bg-primary" : "bg-border"}`} />}
                    </li>
                  ))}
                </ol>

                {selectedPeriod.status === "paid" && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    <Lock className="h-4 w-4 shrink-0" />
                    This period is locked and cannot be edited. Records are kept for reference.
                  </div>
                )}

                {hasUnrecorded && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p>
                        <strong>{unrecordedDays.length} staff {unrecordedDays.length !== 1 ? "have" : "has"} days with no attendance recorded.</strong>{" "}
                        Unrecorded days count as absent and lower pay.
                      </p>
                      <p className="mt-0.5 text-xs opacity-90 md:hidden">Tap to mark attendance.</p>
                      <p className="mt-0.5 hidden text-xs opacity-90 md:block">Mark attendance, then recalculate before approving.</p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0 bg-background text-foreground">
                      <Link href="/staffs/attendance">Mark attendance</Link>
                    </Button>
                  </div>
                )}

                {excludedStaff.length > 0 && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p>
                      <strong>{excludedStaff.length} staff {excludedStaff.length !== 1 ? "haven't" : "hasn't"} finished onboarding</strong>{" "}
                      and {excludedStaff.length !== 1 ? "are" : "is"} left out of payroll until they accept their invitation{excludedStaff.some(s => s.reason !== "invite_pending") ? " and sign their contract" : ""}.{" "}
                      <span className="font-medium">{excludedStaff.map(s => s.name).join(", ")}</span>
                    </p>
                  </div>
                )}
              </div>

              {entriesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
                </div>
              ) : entries.length === 0 ? (
                <Card>
                  <CardContent className="pt-8 pb-8 text-center">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">No payroll data yet. Click "Calculate" to compute commissions.</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Totals: one dark card on phones, four cards from md up */}
                  <div className="md:hidden rounded-2xl bg-slate-900 p-4 text-white dark:bg-slate-800">
                    <p className="text-sm text-slate-300">Net pay{isEstimate ? " · Estimate until approved" : ""}</p>
                    <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">{fmt(grandTotal)}</p>
                    <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-sm">
                      <div><p className="text-xs text-slate-400">Gross</p><p className="font-semibold tabular-nums">{fmt(totalGross)}</p></div>
                      <div><p className="text-xs text-slate-400">Deductions</p><p className="font-semibold tabular-nums">{fmt(totalDeductions)}</p></div>
                      <div><p className="text-xs text-slate-400">Staff</p><p className="font-semibold tabular-nums">{entries.length}</p></div>
                    </div>
                  </div>
                  <div className="hidden md:grid grid-cols-2 xl:grid-cols-4 gap-4">
                    {stat("Net pay", fmt(grandTotal), isEstimate ? "Estimate until approved" : "Payable to staff", Banknote)}
                    {stat("Gross pay", fmt(totalGross), "Salary, transport and commission", BarChart3)}
                    {stat("Deductions", fmt(totalDeductions), `${entries.filter(e => (e.deductionsTotal ?? 0) > 0).length} staff affected`, Minus)}
                    {stat("Staff", String(entries.length), selectedPeriod.status === "paid" ? "Paid this period" : "On this pay period", Users)}
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={staffSearch}
                      onChange={e => setStaffSearch(e.target.value)}
                      placeholder="Search staff"
                      aria-label="Search staff"
                      className="h-11 bg-card pl-9 md:max-w-sm"
                    />
                  </div>

                  {/* Phones: staff list */}
                  <div className="md:hidden rounded-xl border bg-card divide-y overflow-hidden">
                    {shownEntries.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No staff match "{staffSearch}".</p>}
                    {shownEntries.map(entry => (
                      <Link key={entry.staffId} href={detailHref(entry.staffId)} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{entry.staff.name.charAt(0)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{entry.staff.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {entry.activeDays} active · {entry.passiveDays} passive
                            {hasUnrecorded && unrecordedStaffIds.has(entry.staffId) && <span className="text-amber-700 dark:text-amber-400"> · days unrecorded</span>}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-bold tabular-nums">{fmt(entry.takeHomePay ?? entry.netPay)}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {(entry.deductionsTotal ?? 0) > 0 ? `−${fmt(entry.deductionsTotal)}` : fmt(0)}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                    <p className="p-3 text-center text-xs text-muted-foreground">{shownEntries.length} of {entries.length} staff · gross {fmt(totalGross)}</p>
                  </div>

                  {/* md and up: staff breakdown table */}
                  <div className="hidden md:block rounded-xl border bg-card overflow-hidden">
                    <div className="border-b px-5 py-3.5">
                      <h3 className="font-semibold">Staff breakdown</h3>
                      <p className="text-xs text-muted-foreground">{shownEntries.length} of {entries.length} staff</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                            <th className="px-5 py-2.5 text-left">Staff</th>
                            <th className="px-3 py-2.5 text-left">Attendance</th>
                            <th className="px-3 py-2.5 text-right">Base salary</th>
                            <th className="px-3 py-2.5 text-right">Transport</th>
                            <th className="px-3 py-2.5 text-right">Commission</th>
                            <th className="px-3 py-2.5 text-right">Gross</th>
                            <th className="px-3 py-2.5 text-right">Deductions</th>
                            <th className="px-3 py-2.5 text-right">Net pay</th>
                            <th className="w-10 px-3 py-2.5"><span className="sr-only">Details</span></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {shownEntries.length === 0 && (
                            <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No staff match "{staffSearch}".</td></tr>
                          )}
                          {shownEntries.map(entry => (
                            <tr key={entry.staffId} className="cursor-pointer hover:bg-muted/40" onClick={() => setLocation(detailHref(entry.staffId))}>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{entry.staff.name.charAt(0)}</span>
                                  <div className="min-w-0">
                                    <p className="truncate font-medium">{entry.staff.name}</p>
                                    <p className="text-xs text-muted-foreground font-mono">{entry.staff.staffNumber}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                {entry.activeDays} active · {entry.passiveDays} passive
                                {hasUnrecorded && unrecordedStaffIds.has(entry.staffId) && (
                                  <p className="text-[11px] text-amber-700 dark:text-amber-400">Days unrecorded</p>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmt((entry as any).calculationDetails?.baseSalary ?? 0)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmt(entry.totalTransport)}</td>
                              <td className="px-3 py-3 text-right tabular-nums" title={commissionNoteFor(entry)}>{fmt(entry.grossCommission)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmt(entry.grossPay ?? entry.netPay)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {(entry.deductionsTotal ?? 0) > 0
                                  ? <span className="text-destructive">−{fmt(entry.deductionsTotal)}</span>
                                  : <span className="text-muted-foreground">{fmt(0)}</span>}
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className="font-bold tabular-nums text-primary">{fmt(entry.takeHomePay ?? entry.netPay)}</span>
                                {(entry.shortfall ?? 0) > 0 && <p className="text-[11px] text-destructive">{fmt(entry.shortfall)} carries forward</p>}
                              </td>
                              <td className="px-3 py-3">
                                <Link href={detailHref(entry.staffId)} onClick={e => e.stopPropagation()} aria-label={`Details for ${entry.staff.name}`}>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 font-semibold">
                            <td className="px-5 py-3" colSpan={5}>Total</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmt(totalGross)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{totalDeductions > 0 ? `−${fmt(totalDeductions)}` : fmt(0)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-primary">{fmt(grandTotal)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* Phones: sticky action bar */}
              {(canRecalculate || primaryLabel) && (
                <div className="md:hidden fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  {periodMenu}
                  {canRecalculate && (
                    <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Recalculate" onClick={() => calculateMutation.mutate(selectedPeriod.id)} disabled={calculateMutation.isPending}>
                      <RefreshCw className={`h-4 w-4 ${calculateMutation.isPending ? "animate-spin" : ""}`} />
                    </Button>
                  )}
                  {primaryLabel && (
                    <Button className="h-11 flex-1 text-base" variant={canMarkPaid ? "destructive" : "default"} onClick={runPrimary} disabled={primaryPending}>
                      {primaryLabel}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
