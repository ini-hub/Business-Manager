import { format } from "date-fns";
import { Link } from "wouter";
import { Minus, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appendReturnTo } from "@/lib/return-to";

/**
 * The deductions panel. In manager/owner context (`readOnly={false}`) it also
 * renders the add-deduction form and the per-row waive/restore/write-off/skip
 * controls, driven by mutation props from the caller. A staff member sees the
 * exact same list — including a waived line struck through, so a reversed
 * deduction stays visible instead of disappearing — with no admin
 * affordances at all.
 */
export function PayrollDeductionsList({
  deductions, periodStatus, isOwner, totalDeductions, fmtCur, location, search,
  readOnly = false,
  showAddDeduction, setShowAddDeduction, dedType, setDedType, dedLabel, setDedLabel,
  dedAmount, setDedAmount, addDeductionMutation,
  deleteDeductionMutation, restoreDeductionMutation, setDebtToWriteOff, setDebtToRestore,
}: {
  deductions: any[];
  periodStatus: string | undefined;
  isOwner: boolean;
  totalDeductions: number;
  fmtCur: (v: number) => string;
  location?: string;
  search?: string;
  readOnly?: boolean;
  showAddDeduction?: boolean;
  setShowAddDeduction?: (v: boolean | ((prev: boolean) => boolean)) => void;
  dedType?: string;
  setDedType?: (v: string) => void;
  dedLabel?: string;
  setDedLabel?: (v: string) => void;
  dedAmount?: string;
  setDedAmount?: (v: string) => void;
  addDeductionMutation?: { mutate: () => void; isPending: boolean };
  deleteDeductionMutation?: { mutate: (id: string) => void };
  restoreDeductionMutation?: { mutate: (id: string) => void };
  setDebtToWriteOff?: (d: any) => void;
  setDebtToRestore?: (d: any) => void;
}) {
  const activeDeductions = deductions.filter((d: any) => !d.isWaived);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Minus className="h-4 w-4 text-destructive" />
            Deductions{activeDeductions.length > 0 ? ` (${activeDeductions.length})` : ""}
          </CardTitle>
          {!readOnly && periodStatus !== "paid" && (
            <Button variant="outline" size="sm" onClick={() => setShowAddDeduction?.(v => !v)}>
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!readOnly && showAddDeduction && (
          <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={dedType} onValueChange={setDedType}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="advance_recovery">Advance Recovery</SelectItem>
                    <SelectItem value="tax">Tax</SelectItem>
                    <SelectItem value="penalty">Penalty</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input className="h-8 text-xs" type="number" min="0" step="0.01" value={dedAmount} onChange={e => setDedAmount?.(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Label (shown on payslip)</Label>
              <Input className="h-8 text-xs" value={dedLabel} onChange={e => setDedLabel?.(e.target.value)} placeholder="e.g. March advance recovery" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowAddDeduction?.(false)}>Cancel</Button>
              <Button size="sm" disabled={!dedLabel || !dedAmount || addDeductionMutation?.isPending}
                onClick={() => addDeductionMutation?.mutate()}>
                Add Deduction
              </Button>
            </div>
          </div>
        )}
        {deductions.length === 0 && !showAddDeduction && (
          <p className="text-xs text-muted-foreground py-2 text-center">No deductions for this period.</p>
        )}
        {deductions.map((d: any) => {
          const isStaffCredit = d.type === "staff_credit";
          // System-proposed only — a manager's own free-text "Advance
          // Recovery" line (no salaryAdvanceId) behaves like any other
          // manual deduction: plain badge, plain delete.
          const isAdvanceRecovery = d.type === "advance_recovery" && !!d.salaryAdvanceId;
          // Waived AND forgiven: the Borrow Book entry behind this line was
          // written off, so undoing it has to restore the debt, not just the
          // deduction.
          const isWrittenOff = d.creditEntry?.status === "written_off";
          // What the debt still carries beyond what this period recovers —
          // the cue that recovery was capped by available pay.
          const remainder = isStaffCredit && d.creditEntry && !d.repaymentId
            ? Number(d.creditEntry.outstandingBalance) - Number(d.amount)
            : 0;
          // Same idea for an advance: outstandingBalance already reflects
          // post-settle state once settledAt is set, so only subtract this
          // line's own amount while the proposal is still open (it hasn't
          // been applied to the balance yet).
          const advanceRemainder = isAdvanceRecovery && d.salaryAdvance
            ? Math.max(0, Number(d.salaryAdvance.outstandingBalance) - (d.settledAt ? 0 : Number(d.amount)))
            : 0;
          const label = (
            <span className={`font-medium ${d.isWaived ? "line-through" : ""}`}>{d.label}</span>
          );
          return (
            <div key={d.id} className={`flex items-center justify-between text-sm border rounded-lg px-3 py-2 ${d.isWaived ? "bg-muted/30 opacity-60" : "bg-muted/10"}`}>
              <div className="min-w-0">
                {/* The label already reads "Staff credit — Checkout Receipt
                    #1042", so it IS the receipt reference: make it the link
                    rather than repeating the number in a separate chip. */}
                {d.transactionId && !readOnly ? (
                  <Link href={appendReturnTo(`/transactions/${d.transactionId}`, location ?? "", search ?? "")}>
                    <span className={`font-medium text-primary cursor-pointer hover:underline ${d.isWaived ? "line-through" : ""}`}>
                      {d.label}
                    </span>
                  </Link>
                ) : label}
                {/* Staff-credit and advance-recovery labels already begin
                    "Staff credit — " / "Advance recovery — ", so the type
                    badge would only say it twice. Other types carry free
                    text and still need it. */}
                {!isStaffCredit && !isAdvanceRecovery && (
                  <Badge variant="outline" className="ml-2 text-[10px] h-4">{d.type.replace(/_/g, " ")}</Badge>
                )}
                {d.isWaived && (
                  <Badge variant="outline" className="ml-1 text-[10px] h-4 text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300">waived</Badge>
                )}
                {isStaffCredit && !d.isWaived && remainder > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Capped at available pay — {fmtCur(remainder)} stays owing and carries to the next period.
                  </p>
                )}
                {isAdvanceRecovery && !d.isWaived && advanceRemainder > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Capped at available pay — {fmtCur(advanceRemainder)} of this advance stays outstanding and carries to the next period.
                  </p>
                )}
                {d.repayment && (
                  <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
                    Recovered from payroll on {format(new Date(d.repayment.createdAt), "MMM d, yyyy")} — the debt is settled in the Borrow Book.
                  </p>
                )}
                {isAdvanceRecovery && d.settledAt && (
                  <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
                    Recovered from payroll on {format(new Date(d.settledAt), "MMM d, yyyy")}
                    {advanceRemainder > 0
                      ? ` — ${fmtCur(advanceRemainder)} of the advance is still outstanding.`
                      : " — the advance is fully recovered."}
                  </p>
                )}
                {isStaffCredit && d.isWaived && !d.repayment && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Excluded from this payroll. The debt stays open in the Borrow Book.
                  </p>
                )}
                {isAdvanceRecovery && d.isWaived && !d.settledAt && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Excluded from this payroll. The advance stays open and will be proposed again next period.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-mono text-sm font-semibold ${d.isWaived ? "text-muted-foreground line-through" : "text-destructive"}`}>
                  -{fmtCur(Number(d.amount))}
                </span>
                {!readOnly && periodStatus !== "paid" && (
                  d.isWaived ? (
                    // A waived line whose debt was also written off needs the
                    // debt back before the deduction means anything, so it
                    // gets the restore that reverses both. Owner-only, since
                    // only an owner could have written it off.
                    isWrittenOff ? (
                      isOwner && (
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          disabled={!d.creditEntry?.canRestore && !!d.creditEntry?.restoreBlockedReason}
                          title={d.creditEntry?.restoreBlockedReason ?? undefined}
                          onClick={() => setDebtToRestore?.(d)}>
                          Restore debt
                        </Button>
                      )
                    ) : (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => restoreDeductionMutation?.mutate(d.id)}>
                        Restore
                      </Button>
                    )
                  ) : isStaffCredit ? (
                    <>
                      {/* Two different decisions, deliberately not one button:
                          skipping defers the debt to the next period, waiving
                          forgives it outright. Only an owner can forgive. */}
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => deleteDeductionMutation?.mutate(d.id)}>
                        Skip this period
                      </Button>
                      {isOwner && (
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                          onClick={() => setDebtToWriteOff?.(d)}>
                          Waive
                        </Button>
                      )}
                    </>
                  ) : isAdvanceRecovery ? (
                    // No forgive option here — there's no write-off concept
                    // for a salary advance the way there is for shop credit.
                    // Skipping just defers it to the next period, same as
                    // waiving does for staff credit's "skip" half.
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => deleteDeductionMutation?.mutate(d.id)}>
                      Skip this period
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteDeductionMutation?.mutate(d.id)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
        {totalDeductions > 0 && (
          <div className="flex justify-between text-sm font-semibold border-t pt-2">
            <span>Total Deductions</span>
            <span className="font-mono text-destructive">-{fmtCur(totalDeductions)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
