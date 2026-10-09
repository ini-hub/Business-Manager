import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { AlertTriangle, Download, Receipt } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";

type Report = {
  sales: { lines: number; subtotal: number; tax: number; gross: number };
  returns: { count: number; total: number; tax: number; byMethod: { method: string; count: number; total: number }[] };
  netTax: number;
  bank: {
    linked: boolean;
    refundsWithoutDebit: { id: string; receiptNumber: string; amount: number; createdAt: string }[];
    pendingTransfers: { count: number; total: number };
    unmatchedCredits: { count: number; total: number };
  };
};

const METHOD_LABEL: Record<string, string> = { cash: "Cash", transfer: "Transfer", store_credit: "Store credit" };
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Tax collected against tax given back through returns for a period, with bank cross-checks for transfers. */
export default function TaxReturnsReportPage() {
  const { currentStore } = useStore();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);
  const storeId = currentStore && currentStore.id !== "all" ? currentStore.id : undefined;

  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ["/api/reports/tax-returns", storeId, from, to],
    enabled: !!storeId,
    queryFn: async () => (await apiRequest("GET", `/api/reports/tax-returns?storeId=${storeId}&startDate=${from}&endDate=${to}`)).json(),
  });

  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      ["Period", `${from} to ${to}`],
      ["Sales (excl. tax)", data.sales.subtotal],
      ["Tax collected", data.sales.tax],
      ["Gross sales", data.sales.gross],
      ["Refunds paid", data.returns.total],
      ["Tax refunded", data.returns.tax],
      ["Net tax payable", data.netTax],
      [],
      ["Refund method", "Count", "Amount"],
      ...data.returns.byMethod.map((m) => [METHOD_LABEL[m.method] ?? m.method, m.count, m.total]),
    ];
    if (data.bank.linked) {
      rows.push([], ["Transfer refunds with no bank debit"], ["Receipt", "Amount", "Date"],
        ...data.bank.refundsWithoutDebit.map((r) => [r.receiptNumber, r.amount, format(new Date(r.createdAt), "yyyy-MM-dd")]));
    }
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tax-returns-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const flags = data?.bank.linked
    ? data.bank.refundsWithoutDebit.length + (data.bank.pendingTransfers.count > 0 ? 1 : 0) + (data.bank.unmatchedCredits.count > 0 ? 1 : 0)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Tax & returns" description="Tax collected, tax given back through returns, and what is left to pay for the period." compact />
      {!storeId ? (
        <p className="text-sm text-muted-foreground">Select a single store to see its tax and returns.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="tr-from">From</Label><Input id="tr-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="tr-to">To</Label><Input id="tr-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data} data-testid="button-export-tax-returns">
              <Download className="h-4 w-4 mr-1" aria-hidden="true" /> Export CSV
            </Button>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {isError && <p className="text-sm text-destructive">Couldn't load the report.</p>}

          {data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Tax collected</CardTitle></CardHeader><CardContent className="font-mono text-lg">{fmt(data.sales.tax)}</CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Tax given back</CardTitle></CardHeader><CardContent className="font-mono text-lg">{fmt(data.returns.tax)}</CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Net tax payable</CardTitle></CardHeader><CardContent className="font-mono text-lg font-semibold">{fmt(data.netTax)}</CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Refunds paid</CardTitle></CardHeader><CardContent className="font-mono text-lg">{fmt(data.returns.total)}</CardContent></Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4" aria-hidden="true" />Refunds by payout method</CardTitle></CardHeader>
                <CardContent className="divide-y">
                  {data.returns.byMethod.length === 0 && <p className="text-sm text-muted-foreground">No returns in this period.</p>}
                  {data.returns.byMethod.map((m) => (
                    <div key={m.method} className="flex justify-between py-2 text-sm">
                      <span>{METHOD_LABEL[m.method] ?? m.method} <span className="text-muted-foreground">· {m.count}</span></span>
                      <span className="font-mono">{fmt(m.total)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Checked against the bank</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!data.bank.linked ? (
                    <p className="text-muted-foreground">Link a bank account in Settings to have transfer refunds and receipts checked against real bank movements.</p>
                  ) : flags === 0 ? (
                    <p className="text-muted-foreground">Nothing to flag: every transfer refund has a bank debit, and no transfers are waiting.</p>
                  ) : (
                    <>
                      {data.bank.refundsWithoutDebit.length > 0 && (
                        <div>
                          <p className="font-medium">Transfer refunds with no matching bank debit ({data.bank.refundsWithoutDebit.length})</p>
                          <div className="divide-y">
                            {data.bank.refundsWithoutDebit.map((r) => (
                              <div key={r.id} className="flex justify-between py-1.5">
                                <span>{r.receiptNumber} <span className="text-muted-foreground">· {format(new Date(r.createdAt), "d MMM")}</span></span>
                                <span className="font-mono">{fmt(r.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {data.bank.pendingTransfers.count > 0 && (
                        <p>{data.bank.pendingTransfers.count} transfer{data.bank.pendingTransfers.count === 1 ? "" : "s"} ({fmt(data.bank.pendingTransfers.total)}) recorded as sales but not yet seen at the bank. <Link href="/reports/payment-accounts" className="underline">Review</Link></p>
                      )}
                      {data.bank.unmatchedCredits.count > 0 && (
                        <p>{data.bank.unmatchedCredits.count} bank credit{data.bank.unmatchedCredits.count === 1 ? "" : "s"} ({fmt(data.bank.unmatchedCredits.total)}) with no matching sale, which may be unrecorded sales. <Link href="/reports/payment-accounts" className="underline">Review</Link></p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
