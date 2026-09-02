import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { needsExplanation } from "@shared/commission-explainer";
import type { CommissionBreakdown, CommissionReconciliation } from "@shared/schema";

const ROLE_CONFIG = {
  lead:        { label: "Lead",      color: "text-primary bg-primary/10 border-primary/20" },
  assistant_1: { label: "Asst. #1",  color: "text-blue-700 bg-blue-50 dark:bg-blue-950 border-blue-200" },
  assistant_2: { label: "Asst. #2",  color: "text-purple-700 bg-purple-50 dark:bg-purple-950 border-purple-200" },
};

/**
 * The collapsible per-checkout commission drill-down and its reconciliation
 * footer — how the individual revenue-share rows above become the gross
 * commission figure actually paid.
 */
export function PayrollTransactionBreakdown({
  breakdown, isLoading, reconciliation, commissionNote, showTransactions, onToggle, fmtCur,
}: {
  breakdown: CommissionBreakdown[];
  isLoading: boolean;
  reconciliation: CommissionReconciliation | null;
  commissionNote: string;
  showTransactions: boolean;
  onToggle: () => void;
  fmtCur: (v: number) => string;
}) {
  const totalRevenueShare = breakdown.reduce((sum, b) => sum + b.revenueShare, 0);

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer select-none hover:bg-muted/10 transition-colors rounded-t-lg" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Service Revenue Share by Transaction ({breakdown.length})
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
            {showTransactions ? (
              <>Hide Details <ChevronUp className="h-3 w-3" /></>
            ) : (
              <>Show Details <ChevronDown className="h-3 w-3" /></>
            )}
          </Button>
        </div>
      </CardHeader>
      {showTransactions && (
        <>
          <Separator />
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : breakdown.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No service commissions found for this staff member in this period.</p>
            ) : (
              <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="min-w-[800px]">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium py-2 border-b">
                    <div className="col-span-2">Date</div>
                    <div className="col-span-1 text-center">Receipt</div>
                    <div className="col-span-3">Service</div>
                    <div className="col-span-3 text-center">Role</div>
                    <div className="col-span-1 text-right">Price</div>
                    <div className="col-span-1 text-right">Share</div>
                    <div className="col-span-1 text-right">Revenue Share</div>
                  </div>

                  {/* Rows */}
                  {breakdown.map((b, i) => {
                    const roleCfg = ROLE_CONFIG[b.role];
                    return (
                      <div
                        key={`${b.checkoutId}-${i}`}
                        className="grid grid-cols-12 gap-2 py-2.5 border-b last:border-0 text-sm hover:bg-muted/20 rounded-md px-1 transition-colors"
                      >
                        <div className="col-span-2 text-xs text-muted-foreground self-center">
                          {format(parseISO(b.transactionDate), "MMM d")}
                        </div>
                        <div className="col-span-1 text-xs font-mono text-muted-foreground self-center truncate">
                          {b.receiptNumber.split("-").slice(-1)[0]}
                        </div>
                        <div className="col-span-3 font-medium self-center truncate text-xs" title={b.inventoryName}>
                          {b.inventoryName}
                        </div>
                        <div className="col-span-3 text-center self-center">
                          <Badge variant="outline" className={`text-xs ${roleCfg.color} border`}>
                            {roleCfg.label}
                          </Badge>
                        </div>
                        <div className="col-span-1 text-right font-mono text-xs self-center">{fmtCur(b.serviceAmount)}</div>
                        <div className="col-span-1 text-right text-xs text-muted-foreground self-center">{(b.share * 100).toFixed(0)}%</div>
                        <div className="col-span-1 text-right font-semibold font-mono text-xs self-center">{fmtCur(b.revenueShare)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
          {breakdown.length > 0 && (
            <>
              <Separator />
              {/* How these rows become the commission that was actually paid. */}
              <CardFooter className="flex-col items-stretch gap-1.5 pt-4 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Total revenue share ({breakdown.length} service{breakdown.length === 1 ? "" : "s"})</span>
                  <span className="font-mono">{fmtCur(totalRevenueShare)}</span>
                </div>
                {reconciliation ? (
                  <>
                    {reconciliation.attendanceDeduction > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Less transport already paid</span>
                        <span className="font-mono">-{fmtCur(reconciliation.attendanceDeduction)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5">
                      <span>
                        Commissionable revenue
                        {reconciliation.commissionableRevenue < 0 && " (floored at zero)"}
                      </span>
                      <span className="font-mono">{fmtCur(Math.max(0, reconciliation.commissionableRevenue))}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1.5 font-semibold">
                      <span>Gross commission @ {+(reconciliation.commissionRate * 100).toFixed(2)}% · {reconciliation.formulaName}</span>
                      <span className="text-lg font-bold font-mono text-primary">{fmtCur(reconciliation.grossCommission)}</span>
                    </div>
                    {needsExplanation(reconciliation.explanation) && (
                      <p className="text-xs text-muted-foreground pt-0.5">{commissionNote}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground pt-1">
                    This period has not been calculated yet, so there is no commission to reconcile against.
                  </p>
                )}
              </CardFooter>
            </>
          )}
        </>
      )}
    </Card>
  );
}
