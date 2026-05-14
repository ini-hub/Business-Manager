import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  DollarSign,
  Calendar,
  Calculator,
  CheckCircle2,
  Lock,
  Plus,
  ChevronRight,
  AlertCircle,
  Download,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
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
  const userRole = user?.role || "staff";
  const isOwner = userRole === "owner";

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
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

  const storeCurrency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrencyUtil(v, storeCurrency);

  const { data: periods = [], isLoading: periodsLoading } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<PayrollEntryWithStaff[]>({
    queryKey: ["/api/payroll/periods/entries", selectedPeriodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${selectedPeriodId}/entries`);
      return res.json();
    },
    enabled: !!selectedPeriodId,
  });

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

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
    onError: () => toast({ title: "Could not create payroll period", variant: "destructive" }),
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
    onError: () => toast({ title: "Could not mark as paid", variant: "destructive" }),
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
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Please <Link href="/settings/stores" className="underline font-medium">set up your store</Link> first.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={`Option 4 Hybrid payroll for ${currentStore.name}`}
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Period
          </Button>
        }
      />

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
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowCreateDialog(true)}>
                  Create first period
                </Button>
              </CardContent>
            </Card>
          ) : (
            periods.map(p => {
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
                </div>
              );
            })
          )}
        </div>

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
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Staff Option 4 Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {/* Table header */}
                      <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground font-medium py-2 border-b">
                        <div className="col-span-2">Staff</div>
                        <div className="text-center">Active/Passive</div>
                        <div className="text-right">Transport</div>
                        <div className="text-right">Commission</div>
                        <div className="text-right">Net Pay</div>
                        <div></div>
                      </div>

                      {entries.map(entry => (
                        <div key={entry.id} className="grid grid-cols-7 gap-2 py-3 border-b last:border-0 hover:bg-muted/20 rounded-lg px-1 transition-colors group">
                          <div className="col-span-2 flex items-center gap-2 min-w-0">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                              {entry.staff.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{entry.staff.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{entry.staff.staffNumber}</p>
                            </div>
                          </div>
                          <div className="text-center text-xs self-center">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold" title="Active Days">{entry.activeDays}A</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-amber-600 dark:text-amber-400 font-semibold" title="Passive Days">{entry.passiveDays}P</span>
                          </div>
                          <div className="text-right text-sm font-mono self-center">{fmt(entry.totalTransport)}</div>
                          <div className="text-right text-sm font-mono self-center">{fmt(entry.grossCommission)}</div>
                          <div className="text-right font-bold text-sm font-mono self-center text-primary">{fmt(entry.netPay)}</div>
                          <div className="self-center flex items-center justify-end">
                            <Link href={`/payroll/${selectedPeriodId}/staff/${entry.staffId}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                  <Separator />
                  <CardFooter className="justify-between pt-4">
                    <span className="font-semibold text-sm">Grand Total</span>
                    <span className="text-xl font-bold font-mono text-primary">{fmt(grandTotal)}</span>
                  </CardFooter>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create period dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Payroll Period</DialogTitle>
            <DialogDescription>Set the period type and date range for this payroll cycle.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Period Type</Label>
              <Select value={periodType} onValueChange={(v) => setPeriodType(v as PayrollPeriodType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !startDate || !endDate}>
                {createMutation.isPending ? "Creating…" : "Create Period"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
