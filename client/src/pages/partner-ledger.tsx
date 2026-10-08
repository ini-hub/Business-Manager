import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";

interface Ledger {
  totals: { owedToMe: number; iOwe: number };
  partners: { partnerOrgId: string; name: string; balance: number; openCount: number }[];
  obligations: {
    id: string; transferId: string; kind: string; role: "creditor" | "debtor"; partnerName: string;
    amountDue: number; amountSettled: number; remaining: number; status: string; dueDate: string | null;
  }[];
}

export default function PartnerLedgerPage() {
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const money = (n: number) => formatCurrency(n, currentStore?.currency || "NGN");

  const { data } = useQuery<Ledger>({
    queryKey: ["/api/partner-ledger"],
    queryFn: async () => (await apiRequest("GET", "/api/partner-ledger")).json(),
  });
  const open = (data?.obligations ?? []).filter((o) => o.status === "open");

  return (
    <div className="space-y-6">
      <PageHeader compact title="Partner ledger" description="What your partner businesses owe you, and what you owe them." />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Owed to you</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-owed-to-me">{money(data?.totals.owedToMe ?? 0)}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">You owe</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-i-owe">{money(data?.totals.iOwe ?? 0)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">By partner</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(data?.partners.length ?? 0) === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nothing owed either way.</p>}
          {data?.partners.map((p) => (
            <div key={p.partnerOrgId} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className={p.balance > 0 ? "text-green-600" : p.balance < 0 ? "text-destructive" : "text-muted-foreground"}>
                {p.balance > 0 ? `Owes you ${money(p.balance)}` : p.balance < 0 ? `You owe ${money(-p.balance)}` : "Even"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Open balances</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {open.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No open balances.</p>}
          {open.map((o) => (
            <button key={o.id} type="button" onClick={() => setLocation(`/partners/transfers/${o.transferId}`)}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left text-sm hover:bg-muted/50">
              <div>
                <div className="font-medium">{o.partnerName}</div>
                <div className="text-xs text-muted-foreground">
                  {o.kind === "money" ? "Money" : "Goods"} · {o.role === "creditor" ? "they owe you" : "you owe them"}
                  {o.dueDate ? ` · due ${new Date(o.dueDate).toLocaleDateString()}` : ""}
                </div>
              </div>
              <Badge variant="secondary">{money(o.remaining)}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
