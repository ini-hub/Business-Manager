import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  DollarSign,
  Calendar,
  Calculator,
  CheckCircle2,
  Lock,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Download,
  Users,
  Trash2,
  Banknote,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import type { PayrollPeriod, PayrollEntryWithStaff, PayrollPeriodType } from "@shared/schema";

const STATUS_CONFIG = {
  pending:  { label: "Pending",  variant: "secondary" as const, color: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950 border-amber-200" },
  approved: { label: "Approved", variant: "default" as const,   color: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-950 border-blue-200" },
  paid:     { label: "Paid",     variant: "default" as const,   color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200" },
};

export default function PayrollPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const userRole = user?.role || "staff";
  const isOwner = userRole === "owner";

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedPeriodId, setSelectedPeriodIdRaw] = useState<string | null>(
    () => sessionStorage.getItem("payroll_selected_period")
  );

  // Wrap setter to also persist to sessionStorage
  const setSelectedPeriodId = (id: string | null) => {
    setSelectedPeriodIdRaw(id);
    if (id) sessionStorage.setItem("payroll_selected_period", id);
    else sessionStorage.removeItem("payroll_selected_period");
  };
  const [periodType, setPeriodType] = useState<PayrollPeriodType>("monthly");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return format(d, "yyyy-MM-dd");
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return format(last, "yyyy-MM-dd");
  });
  const [periodToDelete, setPeriodToDelete] = useState<string | null>(null);

  const [periodsPage, setPeriodsPage] = useState(1);
  const [entriesPage, setEntriesPage] = useState(1);

  const storeCurrency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrencyUtil(v, storeCurrency);

  const { data: periodsRaw = [], isLoading: periodsLoading } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods?storeId=${currentStore?.id}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });
  const periods = Array.isArray(periodsRaw) ? periodsRaw : [];

  // Reset periods pagination when currentStore or periods change
  useEffect(() => {
    setPeriodsPage(1);
  }, [currentStore?.id, periods.length]);

  // Reset entries pagination when selectedPeriodId changes
  useEffect(() => {
    setEntriesPage(1);
  }, [selectedPeriodId]);

  // Auto-select the most recent period if none is selected or persisted selection no longer exists
  useEffect(() => {
    if (periods.length === 0) return;
    const exists = selectedPeriodId && periods.some(p => p.id === selectedPeriodId);
    if (!exists) {
      setSelectedPeriodId(periods[0].id);
    }
  }, [periods]);

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  // Unrecorded attendance days for selected period
  // Coverage gap detection — service transactions not covered by any payroll period
  const { data: coverageGaps = [] } = useQuery<{ staff_id: string; staff_name: string; earliest_date: string; latest_date: string; service_count: number; uncovered_revenue: number }[]>({
    queryKey: ["/api/payroll/coverage-gaps", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/coverage-gaps?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: unrecordedDays = [] } = useQuery<{ staffId: string; staffName: string; unrecordedDates: string[] }[]>({
    queryKey: ["/api/payroll/periods/unrecorded", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}/unrecorded`);
      return res.json();
    },
    enabled: !!selectedPeriodId && !!selectedPeriod && selectedPeriod.status !== "paid",
  });

  const { data: entriesRaw = [], isLoading: entriesLoading } = useQuery<PayrollEntryWithStaff[]>({
    queryKey: ["/api/payroll/periods/entries", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}/entries`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedPeriodId,
  });
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/periods", {
        storeId: currentStore?.id,
        periodType,
        startDate,
        endDate,
      });
      return res.json();
    },
    onSuccess: (period: PayrollPeriod) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods", currentStore?.id] });
      setShowCreateDialog(false);
      setSelectedPeriodId(period.id);
      toast({ title: "Payroll period created" });
    },
    onError: (err: Error) => toast({ title: "Could not create payroll period", description: err.message, variant: "destructive" }),
  });

  const calculateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${id}/calculate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods/entries", selectedPeriodId] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods", currentStore?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods", currentStore?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods", currentStore?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods", currentStore?.id] });
      if (selectedPeriodId) setSelectedPeriodId(null);
      toast({ title: "Payroll period deleted" });
    },
    onError: (err: Error) => toast({ title: err.message || "Could not delete payroll", variant: "destructive" }),
  });

  const grandTotal = entries.reduce((sum, e) => sum + (e.netPay || 0), 0);

  const exportCSV = () => {
    if (!entries.length || !selectedPeriod) return;
    const rows = [
      ["Staff", "Active Days", "Passive Days", "Total Transport", "Gross Commission", "Net Pay"],
      ...entries.map(e => [
        e.staff.name,
        e.activeDays || 0,
        e.passiveDays || 0,
        (e.totalTransport || 0).toFixed(2),
        (e.grossCommission || 0).toFixed(2),
        (e.netPay || 0).toFixed(2),
      ]),
      ["TOTAL", "", "", "", "", grandTotal.toFixed(2)],
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={`Hybrid payroll for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setLocation("/payroll/advances")}>
              <Banknote className="mr-2 h-4 w-4" />
              Advances
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/payroll/report")}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Report
            </Button>
            <Button onClick={() => setLocation("/payroll/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Period
            </Button>
          </div>
        }
      />

      {/* Coverage gap warning */}
      {coverageGaps.length > 0 && (() => {
        const earliest = coverageGaps.reduce((min, g) => g.earliest_date < min ? g.earliest_date : min, coverageGaps[0].earliest_date);
        const latest   = coverageGaps.reduce((max, g) => g.latest_date   > max ? g.latest_date   : max, coverageGaps[0].latest_date);
        const totalServices = coverageGaps.reduce((s, g) => s + Number(g.service_count), 0);
        const staffNames = [...new Set(coverageGaps.map(g => g.staff_name).filter(Boolean))].join(", ");
        return (
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              <span className="font-semibold">{totalServices} service transaction{totalServices !== 1 ? "s" : ""} ({earliest} – {latest}) are not covered by any payroll period</span>
              {staffNames && <span className="text-amber-700 dark:text-amber-400"> · Staff affected: {staffNames}</span>}
              <span className="block mt-1 text-xs">Create payroll periods for those dates to include this revenue in staff earnings. If the business was on a break, no action is needed.</span>
            </AlertDescription>
          </Alert>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Period list */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Payroll Periods</h3>
          {periodsLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : periods.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No payroll periods yet.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setLocation("/payroll/new")}>
                  Create first period
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {periods.slice((periodsPage - 1) * 5, periodsPage * 5).map(p => {
                const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG];
                const isSelected = selectedPeriodId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${isSelected ? "border-primary bg-primary/5 shadow-sm" : "hover:border-muted-foreground/30 hover:bg-muted/30"}`}
                    onClick={() => setSelectedPeriodId(p.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium capitalize">{p.periodType}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(parseISO(p.startDate), "MMM d")} – {format(parseISO(p.endDate), "MMM d, yyyy")}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-xs ${cfg.color} ${cfg.bg} border`}>
                        {cfg.label}
                      </Badge>
                    </div>
                    {p.status !== "paid" && isOwner && (
                      <div className="flex justify-end mt-2 pt-2 border-t border-dashed">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPeriodToDelete(p.id);
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}

              {periods.length > 5 && (
                <div className="flex items-center justify-between pt-2 border-t border-dashed mt-2 bg-background/50 p-2 rounded-lg border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs bg-background"
                    onClick={() => setPeriodsPage(prev => Math.max(1, prev - 1))}
                    disabled={periodsPage === 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                    Prev
                  </Button>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Page {periodsPage} of {Math.ceil(periods.length / 5)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs bg-background"
                    onClick={() => setPeriodsPage(prev => Math.min(Math.ceil(periods.length / 5), prev + 1))}
                    disabled={periodsPage >= Math.ceil(periods.length / 5)}
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

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
        <div className="lg:col-span-2 space-y-4">
          {!selectedPeriod ? (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <DollarSign className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">Select a payroll period to view details</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Period header + actions */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="text-base capitalize">
                        {selectedPeriod.periodType} Payroll
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {format(parseISO(selectedPeriod.startDate), "MMMM d")} – {format(parseISO(selectedPeriod.endDate), "MMMM d, yyyy")}
                      </p>
                    </div>
                    <Badge variant="outline" className={`${STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].color} ${STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].bg} border`}>
                      {STATUS_CONFIG[selectedPeriod.status as keyof typeof STATUS_CONFIG].label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardFooter className="gap-2 flex-wrap">
                  {selectedPeriod.status !== "paid" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => calculateMutation.mutate(selectedPeriod.id)}
                      disabled={calculateMutation.isPending}
                    >
                      <Calculator className="mr-2 h-4 w-4" />
                      {calculateMutation.isPending ? "Calculating…" : entries.length > 0 ? "Recalculate" : "Calculate"}
                    </Button>
                  )}
                  {selectedPeriod.status === "pending" && entries.length > 0 && (
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(selectedPeriod.id)}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {approveMutation.isPending ? "Approving…" : "Approve"}
                    </Button>
                  )}
                  {selectedPeriod.status === "approved" && isOwner && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => markPaidMutation.mutate(selectedPeriod.id)}
                      disabled={markPaidMutation.isPending}
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      {markPaidMutation.isPending ? "Locking…" : "Mark as Paid"}
                    </Button>
                  )}
                  {entries.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={exportCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </Button>
                  )}
                </CardFooter>
              </Card>

              {selectedPeriod.status === "paid" && (
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertDescription>
                    This payroll period is locked and cannot be edited. Records are preserved for historical reference.
                  </AlertDescription>
                </Alert>
              )}

              {/* Unrecorded attendance warning */}
              {unrecordedDays.length > 0 && selectedPeriod.status !== "paid" && (
                <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-amber-800 dark:text-amber-300">
                    <strong>{unrecordedDays.length} staff member{unrecordedDays.length !== 1 ? "s have" : " has"} unrecorded attendance days</strong> in this period.
                    Unrecorded days default to absent and will reduce pay.{" "}
                    <Link href="/staff/attendance" className="underline font-medium">Mark attendance →</Link>
                  </AlertDescription>
                </Alert>
              )}

              {/* Stale calculation warning */}
              {entries.length > 0 && selectedPeriod.status === "pending" && (
                <Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
                  <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertDescription className="text-blue-800 dark:text-blue-300">
                    If attendance or staff settings have changed since last calculation, click <strong>Recalculate</strong> to refresh figures before approving.
                  </AlertDescription>
                </Alert>
              )}

              {/* Per-staff breakdown */}
              {entriesLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : entries.length === 0 ? (
                <Card>
                  <CardContent className="pt-8 pb-8 text-center">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">No payroll data yet. Click "Calculate" to compute commissions.</p>
                  </CardContent>
                </Card>
              ) : (() => {
                  const columns = [
                    {
                      key: "staffName",
                      header: "Staff",
                      render: (entry: PayrollEntryWithStaff) => (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {entry.staff.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{entry.staff.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{entry.staff.staffNumber}</p>
                          </div>
                        </div>
                      )
                    },
                    {
                      key: "daysSummary",
                      header: "Active/Passive",
                      render: (entry: PayrollEntryWithStaff) => (
                        <div className="text-center text-xs font-semibold">
                          <span className="text-emerald-600 dark:text-emerald-400" title="Active Days">{entry.activeDays}A</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-amber-600 dark:text-amber-400" title="Passive Days">{entry.passiveDays}P</span>
                        </div>
                      )
                    },
                    {
                      key: "totalTransport",
                      header: "Transport",
                      render: (entry: PayrollEntryWithStaff) => <span className="font-mono text-sm">{fmt(entry.totalTransport)}</span>
                    },
                    {
                      key: "grossCommission",
                      header: "Commission",
                      render: (entry: PayrollEntryWithStaff) => <span className="font-mono text-sm">{fmt(entry.grossCommission)}</span>
                    },
                    {
                      key: "netPay",
                      header: "Net Pay",
                      render: (entry: PayrollEntryWithStaff) => <span className="font-mono font-bold text-sm text-primary">{fmt(entry.netPay)}</span>
                    },
                    {
                      key: "actions",
                      header: "",
                      render: (entry: PayrollEntryWithStaff) => (
                        <Link href={`/payroll/${selectedPeriodId}/staff/${entry.staffId}`}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-semibold text-primary">
                            Details
                          </Button>
                        </Link>
                      )
                    }
                  ];

                  const tableData = entries.map((e) => ({
                    ...e,
                    staffName: e.staff.name,
                    netPay: e.netPay || 0
                  }));

                  const filterConfigs = [
                    { key: "staffName", label: "Staff", type: "select" as const },
                    { key: "netPay", label: "Amount", type: "range" as const, currencySymbol: storeCurrency === "USD" ? "$" : "₦" }
                  ];

                  return (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Staff Hybrid Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DataTable
                          data={tableData}
                          columns={columns}
                          searchable
                          searchPlaceholder="Search staff name..."
                          searchKeys={["staffName"]}
                          isLoading={entriesLoading}
                          emptyMessage="No staff computed for this period."
                          filterConfigs={filterConfigs}
                          pageSize={5}
                        />
                      </CardContent>
                      <Separator />
                      <CardFooter className="justify-between pt-4">
                        <span className="font-semibold text-sm">Grand Total</span>
                        <span className="text-xl font-bold font-mono text-primary">{fmt(grandTotal)}</span>
                      </CardFooter>
                    </Card>
                  );
                })()}
            </>
          )}
        </div>
      </div>

      {isOwner && (
        <SpeedDialFAB
          actions={[
            {
              label: "New Period",
              icon: <DollarSign className="h-5 w-5" />,
              onClick: () => setLocation("/payroll/new"),
              testId: "fab-new-period",
            },
          ]}
        />
      )}
    </div>
  );
}
