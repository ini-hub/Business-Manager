import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { CheckCircle2, Clock, Landmark } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

type AccountRow = { paymentAccountId: string | null; label: string; detail: string | null; expected: number; confirmed: number; pending: number; legCount: number };
type PendingLeg = { id: string; receiptNumber: string; checkoutId: string | null; method: string; amount: number; accountLabel: string | null; reference: string | null; senderName: string | null; createdAt: string };
type Report = { accounts: AccountRow[]; pendingLegs: PendingLeg[] };

/** Transfer and payment-link money by receiving account: what should be there, what is confirmed, what is still unchecked. */
export default function PaymentAccountsReportPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const [from, setFrom] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);
  const storeId = currentStore && currentStore.id !== "all" ? currentStore.id : undefined;

  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ["/api/reports/payment-accounts", storeId, from, to],
    enabled: !!storeId,
    queryFn: async () => (await apiRequest("GET", `/api/reports/payment-accounts?storeId=${storeId}&startDate=${from}&endDate=${to}`)).json(),
  });

  const confirm = useMutation({
    mutationFn: async (legIds: string[]) => (await apiRequest("POST", "/api/sales/payment-legs/confirm", { storeId, legIds })).json(),
    onSuccess: (r: { confirmed: number }) => {
      toast({ title: `${r.confirmed} payment${r.confirmed === 1 ? "" : "s"} confirmed` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/reports/payment-accounts"] });
    },
    onError: (e: any) => toast({ title: "Couldn't confirm payments", description: e?.message, variant: "destructive" }),
  });

  const { data: unmatched = [] } = useQuery<{ id: string; amount: number; narration: string | null; postedAt: string; accountLabel: string }[]>({
    queryKey: ["/api/sales/bank-connections/unmatched", storeId],
    enabled: !!storeId,
    queryFn: async () => (await apiRequest("GET", `/api/sales/bank-connections/unmatched?storeId=${storeId}`)).json(),
  });

  const pending = data?.pendingLegs ?? [];
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Payment accounts" description="Where transfer money went, and what still needs checking against the bank." compact />
      {!storeId ? (
        <p className="text-sm text-muted-foreground">Select a single store to see its payment accounts.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="pa-from">From</Label><Input id="pa-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pa-to">To</Label><Input id="pa-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          </div>

          {isError && <p className="text-sm text-destructive">Couldn't load the report. Try again.</p>}
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {data && data.accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No transfers in this period.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data?.accounts.map((a) => (
              <Card key={a.paymentAccountId ?? a.label} data-testid={`card-account-${a.paymentAccountId ?? "unassigned"}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Landmark className="h-4 w-4" aria-hidden="true" />{a.label}</CardTitle>
                  {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Expected</span><span className="font-mono font-semibold">{fmt(a.expected)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />Confirmed</span><span className="font-mono">{fmt(a.confirmed)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3 text-amber-600" aria-hidden="true" />Pending</span><span className={`font-mono ${a.pending > 0 ? "text-amber-600 font-semibold" : ""}`}>{fmt(a.pending)}</span></div>
                </CardContent>
              </Card>
            ))}
          </div>

          {pending.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">Waiting to be confirmed ({pending.length})</CardTitle>
                <Button size="sm" disabled={selected.size === 0 || confirm.isPending} onClick={() => confirm.mutate(Array.from(selected))} data-testid="button-confirm-selected">
                  Confirm {selected.size > 0 ? selected.size : ""} selected
                </Button>
              </CardHeader>
              <CardContent className="divide-y">
                {pending.map((l) => (
                  <label key={l.id} className="flex items-center gap-3 py-2 cursor-pointer text-sm">
                    <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`Select receipt ${l.receiptNumber}`} />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{l.receiptNumber}</span>
                      <span className="text-muted-foreground"> · {l.accountLabel ?? (l.method === "flutterwave" ? "Payment link" : "Unassigned")} · {format(new Date(l.createdAt), "d MMM, h:mma")}</span>
                      {(l.senderName || l.reference) && <span className="block text-xs text-muted-foreground truncate">{[l.senderName, l.reference].filter(Boolean).join(" · ")}</span>}
                    </span>
                    {l.method === "flutterwave" && <Badge variant="outline" className="text-[11px]">Link</Badge>}
                    <span className="font-mono">{fmt(l.amount)}</span>
                    {l.checkoutId && <Link href={`/transactions/${l.checkoutId}`} className="text-xs underline" onClick={(e) => e.stopPropagation()}>View</Link>}
                  </label>
                ))}
              </CardContent>
            </Card>
          )}

          {unmatched.length > 0 && (
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-sm">Bank credits with no matching sale ({unmatched.length})</CardTitle>
                <p className="text-xs text-muted-foreground">Money that reached a linked account but wasn't tied to a transfer. Match it to a waiting payment above, or check it isn't an unrecorded sale.</p>
              </CardHeader>
              <CardContent className="divide-y">
                {unmatched.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{c.accountLabel}</span>
                      <span className="text-muted-foreground"> · {format(new Date(c.postedAt), "d MMM, h:mma")}</span>
                      {c.narration && <span className="block text-xs text-muted-foreground truncate">{c.narration}</span>}
                    </span>
                    <span className="font-mono">{fmt(c.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
