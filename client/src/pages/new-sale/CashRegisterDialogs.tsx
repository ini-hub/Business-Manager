import type { UseMutationResult } from "@tanstack/react-query";
import { Banknote, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CashRegisterDialogsProps {
  // Open Register
  openRegisterDialogOpen: boolean;
  setOpenRegisterDialogOpen: (v: boolean) => void;
  openingFloat: number;
  setOpeningFloat: (v: number) => void;
  registerNotes: string;
  setRegisterNotes: (v: string) => void;
  openRegisterMutation: UseMutationResult<unknown, Error, { openingFloat: number; notes: string }>;

  // Cash Drop
  cashDropDialogOpen: boolean;
  setCashDropDialogOpen: (v: boolean) => void;
  cashDropAmount: string;
  setCashDropAmount: (v: string) => void;
  cashDropNotes: string;
  setCashDropNotes: (v: string) => void;
  recordCashDropMutation: UseMutationResult<unknown, Error, { amount: number; notes: string }>;
  activeSession: { expectedCash: number; openingFloat: number; openedAt: string; notes?: string } | null | undefined;

  // Close Register
  closeRegisterDialogOpen: boolean;
  setCloseRegisterDialogOpen: (v: boolean) => void;
  actualCashCount: string;
  setActualCashCount: (v: string) => void;
  closeRegisterNotes: string;
  setCloseRegisterNotes: (v: string) => void;
  closeRegisterMutation: UseMutationResult<unknown, Error, { actualCash: number; notes: string }>;

  // Close Summary
  showCloseSummary: boolean;
  setShowCloseSummary: (v: boolean) => void;
  closeSummaryData: { expectedCash: number; actualCash: number; difference: number; notes?: string } | null;
  setCloseSummaryData: (v: null) => void;
}

export function CashRegisterDialogs({
  openRegisterDialogOpen, setOpenRegisterDialogOpen, openingFloat, setOpeningFloat,
  registerNotes, setRegisterNotes, openRegisterMutation,
  cashDropDialogOpen, setCashDropDialogOpen, cashDropAmount, setCashDropAmount,
  cashDropNotes, setCashDropNotes, recordCashDropMutation, activeSession,
  closeRegisterDialogOpen, setCloseRegisterDialogOpen, actualCashCount, setActualCashCount,
  closeRegisterNotes, setCloseRegisterNotes, closeRegisterMutation,
  showCloseSummary, setShowCloseSummary, closeSummaryData, setCloseSummaryData,
}: CashRegisterDialogsProps) {
  return (
    <>
      {/* Open Register Dialog */}
      <Dialog open={openRegisterDialogOpen} onOpenChange={(open) => {
        if (!open) { setOpeningFloat(0); setRegisterNotes(""); }
        setOpenRegisterDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <Banknote className="h-5 w-5 text-emerald-500" />
              Open Register Drawer
            </DialogTitle>
            <DialogDescription className="text-xs">
              There is currently no active cash register session. You must open the drawer with an initial float to start checking out customers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Opening Float (₦)</Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={openingFloat === 0 ? "0" : openingFloat || ""}
                onChange={(e) => {
                  const valStr = e.target.value;
                  let cleanValStr = valStr;
                  if (/^0\d+/.test(valStr)) cleanValStr = valStr.replace(/^0+/, '');
                  const val = parseFloat(cleanValStr);
                  setOpeningFloat(isNaN(val) || val < 0 ? 0 : val);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes (Optional)</Label>
              <Textarea
                placeholder="Initial cash breakdown or details..."
                className="h-20 text-sm resize-none"
                value={registerNotes}
                onChange={(e) => setRegisterNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => {
              setOpenRegisterDialogOpen(false);
              setOpeningFloat(0);
              setRegisterNotes("");
            }}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={openRegisterMutation.isPending}
              onClick={() => openRegisterMutation.mutate({ openingFloat, notes: registerNotes })}
            >
              {openRegisterMutation.isPending ? "Opening..." : "Open Drawer Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cash Drop Dialog */}
      <Dialog open={cashDropDialogOpen} onOpenChange={(open) => {
        if (!open) { setCashDropAmount(""); setCashDropNotes(""); }
        setCashDropDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <Banknote className="h-5 w-5 text-amber-500" />
              Record Cash Drop (Safe Transfer)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Record a transfer of excess physical cash from the till drawer into the back-office secure safe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Amount to Drop (₦)</Label>
              <Input
                type="number"
                min="1"
                max={activeSession?.expectedCash || 9999999}
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={cashDropAmount}
                onChange={(e) => setCashDropAmount(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Max drop eligible: ₦{(activeSession?.expectedCash || 0).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Drawer Drop Notes</Label>
              <Textarea
                placeholder="e.g. ₦50k rush drop to safe by shift supervisor."
                className="text-xs resize-none h-20"
                value={cashDropNotes}
                onChange={(e) => setCashDropNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => {
              setCashDropAmount("");
              setCashDropNotes("");
              setCashDropDialogOpen(false);
            }}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={recordCashDropMutation.isPending || !cashDropAmount || Number(cashDropAmount) <= 0}
              onClick={() => recordCashDropMutation.mutate({ amount: Number(cashDropAmount), notes: cashDropNotes })}
            >
              {recordCashDropMutation.isPending ? "Recording Drop..." : "Confirm Drop to Safe"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Register Dialog */}
      <Dialog open={closeRegisterDialogOpen} onOpenChange={(open) => {
        if (!open) { setActualCashCount(""); setCloseRegisterNotes(""); }
        setCloseRegisterDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
              Close Drawer & Reconcile Shift
            </DialogTitle>
            <DialogDescription className="text-xs">
              Count the physical cash in the till and enter the total below to close this register session and generate a reconciliation report.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 bg-slate-950/60 border rounded-xl space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between items-center text-[10px]">
                <span>Shift Started At:</span>
                <span className="font-semibold text-white">
                  {activeSession?.openedAt ? new Date(activeSession.openedAt).toLocaleString() : ""}
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span>Opening Float:</span>
                <span className="font-mono text-white">₦{(activeSession?.openingFloat || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1.5 border-t">
                <span className="font-bold">Expected Till Balance:</span>
                <span className="font-mono font-bold text-emerald-400">
                  ₦{(activeSession?.expectedCash || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Counted Drawer Cash (₦) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={actualCashCount}
                onChange={(e) => setActualCashCount(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Count all physical notes/coins in the till. Do not subtract the starting float.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Closing Notes</Label>
              <Textarea
                placeholder="e.g. End of morning shift. Drawer checks out cleanly."
                className="text-xs resize-none h-20"
                value={closeRegisterNotes}
                onChange={(e) => setCloseRegisterNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => {
              setActualCashCount("");
              setCloseRegisterNotes("");
              setCloseRegisterDialogOpen(false);
            }}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
              disabled={closeRegisterMutation.isPending || !actualCashCount}
              onClick={() => closeRegisterMutation.mutate({ actualCash: Number(actualCashCount), notes: closeRegisterNotes })}
            >
              {closeRegisterMutation.isPending ? "Reconciling..." : "Reconcile & Close Drawer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reconciliation Summary Modal */}
      <Dialog open={showCloseSummary} onOpenChange={setShowCloseSummary}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg p-6">
          <DialogHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-lg font-extrabold text-white font-outfit">
              Shift Reconciled Successfully!
            </DialogTitle>
            <DialogDescription className="text-xs">
              The register session is now closed. Your shift metrics are saved to the platform's audit ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3.5 text-xs font-medium">
            <div className="grid grid-cols-2 gap-2.5 p-3.5 bg-slate-950/60 border rounded-2xl">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Expected till count</span>
                <span className="block font-mono text-sm text-slate-300">
                  ₦{(closeSummaryData?.expectedCash || 0).toLocaleString()}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Counted till count</span>
                <span className="block font-mono text-sm text-white">
                  ₦{(closeSummaryData?.actualCash || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center p-3 bg-slate-900 border rounded-xl">
              <span className="font-semibold text-slate-300">Shift Discrepancy (Drift)</span>
              <Badge
                variant="outline"
                className={cn(
                  "border-none font-bold text-xs uppercase px-2.5 py-1",
                  (closeSummaryData?.difference || 0) === 0
                    ? "bg-slate-800 text-slate-300"
                    : (closeSummaryData?.difference || 0) > 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                )}
              >
                {(closeSummaryData?.difference || 0) === 0
                  ? "Balanced"
                  : (closeSummaryData?.difference || 0) > 0
                  ? `+₦${(closeSummaryData?.difference || 0).toLocaleString()} (Surplus)`
                  : `-₦${Math.abs(closeSummaryData?.difference || 0).toLocaleString()} (Shortage)`
                }
              </Badge>
            </div>

            <div className="space-y-1 text-[11px] text-slate-400 pt-1">
              <span className="font-bold text-slate-500 block uppercase text-[10px]">Reconciliation Notes:</span>
              <span className="italic block p-2.5 bg-slate-950/40 rounded-xl">
                "{closeSummaryData?.notes || "No shift notes provided."}"
              </span>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Button
              type="button"
              className="w-full py-5 text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl"
              onClick={() => {
                setShowCloseSummary(false);
                setCloseSummaryData(null);
              }}
            >
              Done / Sync Complete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
