import { useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, Check, X, Banknote, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { SectionLoader } from "@/components/ui/loader";
import { AdvanceStatusBadge } from "@/components/advance-status-badge";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";

interface AdvanceRecovery {
  id: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  periodStatus: string;
  amount: number;
  settledAt: string | null;
  isWaived: boolean;
}

interface AdvanceDetail {
  id: string;
  storeId: string;
  staffId: string;
  staffName: string | null;
  amount: number;
  outstandingBalance: number;
  date: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  recoveryStatus: string;
  isRecovered: boolean;
  approvedAt: string | null;
  rejectionReason: string | null;
  manualRecoveryReason: string | null;
  manualRecoveredAt: string | null;
  createdAt: string;
  reservedPeriod: { id: string; startDate: string; endDate: string; status: string } | null;
  canRestoreManualRecovery: boolean;
  restoreManualRecoveryBlockedReason: string | null;
  recoveries: AdvanceRecovery[];
}

const fmtDate = (d: string) => format(parseISO(d), "MMM d, yyyy");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

export default function PayrollAdvanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const queryClient = useQueryClient();
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverReason, setRecoverReason] = useState("");

  const queryKey = ["/api/payroll/advances", "detail", id];
  const { data: adv, isLoading } = useQuery<AdvanceDetail>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", `/api/payroll/advances/${id}`)).json(),
    enabled: !!id,
  });

  const done = (title: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/payroll/advances"] });
    toast({ title });
  };
  const fail = (e: Error) => toast({ title: e.message, variant: "destructive" });

  const approveMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/payroll/advances/${id}/approve`),
    onSuccess: () => done("Advance approved"),
    onError: fail,
  });
  const rejectMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/payroll/advances/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => { setRejectOpen(false); setRejectReason(""); done("Advance rejected"); },
    onError: fail,
  });
  const recoverMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/payroll/advances/${id}/recover`, { reason: recoverReason }),
    onSuccess: () => { setRecoverOpen(false); setRecoverReason(""); done("Advance marked recovered"); },
    onError: fail,
  });
  const restoreMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/payroll/advances/${id}/restore-manual-recovery`),
    onSuccess: () => done("Recovery undone — advance is open again"),
    onError: fail,
  });
  const releaseMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/payroll/advances/${id}/release-reservation`),
    onSuccess: () => done("Reservation released"),
    onError: fail,
  });
  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/payroll/advances/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/advances"] });
      toast({ title: "Advance deleted" });
      setLocation("/payroll/advances");
    },
    onError: fail,
  });

  const back = (
    <Button variant="outline" onClick={() => setLocation("/payroll/advances")}>
      <ChevronLeft className="h-4 w-4 lg:mr-2" />
      <span className="hidden lg:inline">Back to Advances</span>
    </Button>
  );

  if (isLoading) return <SectionLoader label="Loading advance" />;
  if (!adv) {
    return (
      <div className="space-y-4">
        <PageHeader title="Advance not found" compact actions={back} />
        <p className="text-sm text-muted-foreground">This advance doesn't exist or you don't have access to it.</p>
      </div>
    );
  }

  const reserved = !!adv.reservedPeriod && adv.recoveryStatus !== "recovered";
  const recovered = adv.amount - adv.outstandingBalance;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Salary Advance — ${adv.staffName ?? "Staff"}`}
        description={`${fmt(adv.amount)} on ${fmtDate(adv.date)}`}
        compact
        actions={
          <div className="flex flex-wrap gap-2">
            {back}
            {adv.status === "pending" && (
              <>
                <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="button-approve-advance">
                  <Check className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Approve</span>
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)} data-testid="button-reject-advance">
                  <X className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Reject</span>
                </Button>
              </>
            )}
            {adv.status === "approved" && !adv.isRecovered && (
              <Button variant="outline" disabled={reserved} onClick={() => setRecoverOpen(true)} data-testid="button-recover-advance">
                <Banknote className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">{reserved ? "Recover outside payroll (reserved)" : "Recover outside payroll"}</span>
              </Button>
            )}
            {adv.isRecovered && adv.manualRecoveryReason && isOwner && (
              <Button variant="outline" disabled={!adv.canRestoreManualRecovery || restoreMutation.isPending} onClick={() => restoreMutation.mutate()}
                title={adv.restoreManualRecoveryBlockedReason ?? undefined}>
                <RotateCcw className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Undo recovery</span>
              </Button>
            )}
            {!adv.isRecovered && (
              <Button variant="outline" className="text-destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                <Trash2 className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Delete</span>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Advance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Staff">
            <Link href={`/staffs/${adv.staffId}/edit`} className="text-primary hover:underline">{adv.staffName ?? "—"}</Link>
          </Field>
          <Field label="Status"><AdvanceStatusBadge advance={adv} fmt={fmt} /></Field>
          <Field label="Amount">{fmt(adv.amount)}</Field>
          <Field label="Date">{fmtDate(adv.date)}</Field>
          <Field label="Recovered so far">{fmt(recovered)}</Field>
          <Field label="Outstanding">{fmt(adv.outstandingBalance)}</Field>
          <Field label="Recorded">{format(new Date(adv.createdAt), "MMM d, yyyy")}</Field>
          {adv.approvedAt && <Field label={adv.status === "rejected" ? "Rejected" : "Approved"}>{format(new Date(adv.approvedAt), "MMM d, yyyy")}</Field>}
          <div className="col-span-2 md:col-span-4"><Field label="Notes">{adv.notes || "—"}</Field></div>
          {adv.rejectionReason && <div className="col-span-2 md:col-span-4"><Field label="Rejection reason">{adv.rejectionReason}</Field></div>}
          {adv.manualRecoveryReason && (
            <div className="col-span-2 md:col-span-4">
              <Field label="Recovered outside payroll">
                {adv.manualRecoveryReason}
                {adv.manualRecoveredAt && <span className="text-muted-foreground"> · {format(new Date(adv.manualRecoveredAt), "MMM d, yyyy")}</span>}
              </Field>
            </div>
          )}
          {reserved && adv.reservedPeriod && (
            <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-2">
              <Field label="Reserved on payroll">
                <Link href={`/payroll/${adv.reservedPeriod.id}`} className="text-primary hover:underline">
                  {fmtDate(adv.reservedPeriod.startDate)} – {fmtDate(adv.reservedPeriod.endDate)}
                </Link>
                <span className="text-muted-foreground"> ({adv.reservedPeriod.status === "paid" ? "paid" : "not yet paid"})</span>
              </Field>
              {isOwner && adv.reservedPeriod.status !== "paid" && (
                <Button variant="ghost" size="sm" disabled={releaseMutation.isPending} onClick={() => releaseMutation.mutate()}>Release</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payroll recovery</CardTitle></CardHeader>
        <CardContent>
          {adv.recoveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {adv.status === "approved"
                ? "No payroll deduction yet. It is proposed automatically on the staff member's next payroll."
                : "Deductions appear here once the advance is approved and included in a payroll period."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payroll period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adv.recoveries.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/payroll/${r.periodId}/staff/${adv.staffId}`} className="text-primary hover:underline">
                        {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmt(Number(r.amount))}</TableCell>
                    <TableCell>
                      {r.settledAt
                        ? <Badge variant="outline" className="text-emerald-700 border-emerald-200">Recovered {format(new Date(r.settledAt), "MMM d, yyyy")}</Badge>
                        : r.isWaived
                          ? <Badge variant="outline">Excluded</Badge>
                          : <Badge variant="outline" className="text-amber-700 border-amber-200">Proposed — settles when paid</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button variant="destructive" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>Reject Advance</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={recoverOpen} onOpenChange={setRecoverOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Recover Advance Outside Payroll</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Only for an advance repaid in cash or written off entirely outside payroll. An advance on an open payroll period is recovered automatically when that period is paid.
            </p>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={recoverReason} onChange={(e) => setRecoverReason(e.target.value)} placeholder="e.g. Repaid in cash at the counter" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRecoverOpen(false)}>Cancel</Button>
              <Button disabled={!recoverReason.trim() || recoverMutation.isPending} onClick={() => recoverMutation.mutate()}>Mark Recovered</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
