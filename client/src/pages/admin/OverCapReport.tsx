import { useUrlState } from "@/hooks/use-url-state";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loader";

const LIMITS = [
  { value: "staff_seats", label: "Staff seats" },
  { value: "customer_count", label: "Customers" },
  { value: "item_count", label: "Inventory items" },
  { value: "store_count", label: "Stores" },
];

interface Row {
  organisationId: string;
  name: string;
  status: string;
  used: number;
  limit: number;
  over: number;
  tiered: boolean;
  trial: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
}

/**
 * Businesses already past a cap, biggest overshoot first, with the owner to contact. They keep everything they
 * have; this is the list to work from when deciding who to approach about a plan. Read-only: nothing is sent.
 */
export default function OverCapReport() {
  const { toast } = useToast();
  const [limitType, setLimitType] = useUrlState<string>("limit", "staff_seats");
  const { data, isLoading, error } = useQuery<{ count: number; rows: Row[] }>({
    queryKey: [`/api/admin/over-cap-report?limitType=${limitType}`],
  });

  const copyEmails = async () => {
    const emails = (data?.rows ?? []).map((r) => r.ownerEmail).filter(Boolean).join(", ");
    try {
      await navigator.clipboard.writeText(emails);
      toast({ title: "Owner emails copied" });
    } catch {
      toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Over-cap businesses</h1>
          <p className="text-sm text-muted-foreground">Past their limit but keeping what they have. Unlimited plans are excluded.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={limitType} onValueChange={setLimitType}>
            <SelectTrigger className="w-44" aria-label="Limit"><SelectValue /></SelectTrigger>
            <SelectContent>{LIMITS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={copyEmails} disabled={!data?.rows.length}>
            <Copy className="mr-2 h-4 w-4" />Copy owner emails
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-10"><Spinner className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="p-6 text-sm text-destructive">Couldn't load the report.</p>
          ) : !data?.rows.length ? (
            <p className="p-6 text-sm text-muted-foreground">No business is over this limit.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Business</th>
                    <th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2 text-right">Used</th>
                    <th className="px-4 py-2 text-right">Limit</th>
                    <th className="px-4 py-2 text-right">Over by</th>
                    <th className="px-4 py-2">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.organisationId} className="border-b last:border-0" data-testid={`over-cap-row-${r.organisationId}`}>
                      <td className="px-4 py-2 font-medium">{r.name}{r.status !== "active" && <Badge variant="outline" className="ml-2 text-[10px]">{r.status}</Badge>}</td>
                      <td className="px-4 py-2">{r.ownerEmail ? <>{r.ownerName ?? "Owner"} <span className="text-muted-foreground">({r.ownerEmail})</span></> : <span className="text-muted-foreground">No owner email</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.used}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.limit}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.over}</td>
                      <td className="px-4 py-2">{r.trial ? "Free trial" : r.tiered ? "Paid pack (full)" : "Free tier"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
