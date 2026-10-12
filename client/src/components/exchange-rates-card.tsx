import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/pages/settings/components/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/error-utils";
import { validateRateInput, roundRate } from "@shared/exchange-rates";

type Rate = {
  id: string;
  from: string;
  to: string;
  rate: number;
  effectiveFrom: string;
  source: string;
  note: string | null;
};
type RatesResponse = { currencies: string[]; rates: Rate[]; feed: { provider: string; available: boolean } };

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * Owner-entered exchange rates between the currencies a business's stores use. Shown only when the business
 * has stores in more than one currency; with one currency there is nothing to convert.
 */
export function ExchangeRatesCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { data } = useQuery<RatesResponse>({ queryKey: ["/api/exchange-rates"] });
  const currencies = data?.currencies ?? [];

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rateText, setRateText] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [alsoInverse, setAlsoInverse] = useState(true);

  const rate = rateText.trim() === "" ? NaN : Number(rateText);
  const problem = from && to && rateText.trim() !== ""
    ? validateRateInput({ from, to, rate, effectiveFrom })
    : null;
  const ready = !!from && !!to && rateText.trim() !== "" && !problem;

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/exchange-rates", { from, to, rate, effectiveFrom, alsoInverse }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exchange-rates"] });
      toast({ title: "Exchange rate saved" });
      setRateText("");
    },
    onError: (error: Error) => toast({ title: "Couldn't save that rate", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/exchange-rates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exchange-rates"] });
      toast({ title: "Rate removed" });
    },
    onError: (error: Error) => toast({ title: "Couldn't remove that rate", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  // Ordered pairs of the business's currencies that have no rate at all yet.
  const missing = useMemo(() => {
    const have = new Set((data?.rates ?? []).map((r) => `${r.from}>${r.to}`));
    const out: string[] = [];
    for (const a of currencies) for (const b of currencies) if (a !== b && !have.has(`${a}>${b}`)) out.push(`${a} → ${b}`);
    return out;
  }, [data, currencies]);

  if (currencies.length < 2) return null;
  const inverseNote = alsoInverse && ready ? `${to} → ${from} will be set to ${roundRate(1 / rate)}.` : null;

  return (
    <Card
      title="Exchange rates"
      hint="Used when staff work at a store that sells in a different currency. A rate applies from its date until a newer one is set, and each direction is its own rate."
    >
      <div className="space-y-4" data-testid="card-exchange-rates">
        {(data?.rates.length ?? 0) > 0 && (
          <ul className="divide-y rounded-md border">
            {data!.rates.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`rate-${r.id}`}>
                <span className="font-medium">{r.from} → {r.to}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="tabular-nums text-foreground">1 {r.from} = {r.rate} {r.to}</span>
                  <span>from {r.effectiveFrom}</span>
                  {r.source === "feed_accepted" && <Badge variant="secondary">From feed</Badge>}
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.from} to ${r.to} rate from ${r.effectiveFrom}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {missing.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-missing-rates">
            No rate yet for {missing.join(", ")}. Payroll that needs a missing rate stops until one is added.
          </p>
        )}

        {canEdit ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="rate-from">From</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger id="rate-from" data-testid="select-rate-from"><SelectValue placeholder="Currency" /></SelectTrigger>
                  <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rate-to">To</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger id="rate-to" data-testid="select-rate-to"><SelectValue placeholder="Currency" /></SelectTrigger>
                  <SelectContent>{currencies.filter((c) => c !== from).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rate-value">{from && to ? `1 ${from} =` : "Rate"}</Label>
                <Input
                  id="rate-value"
                  inputMode="decimal"
                  placeholder={to ? `Amount in ${to}` : "0.00"}
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  data-testid="input-rate-value"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rate-date">Applies from</Label>
                <Input id="rate-date" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="input-rate-date" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="rate-inverse" checked={alsoInverse} onCheckedChange={(v) => setAlsoInverse(v === true)} />
              <Label htmlFor="rate-inverse" className="text-sm font-normal">
                Also set the reverse direction{from && to ? ` (${to} → ${from})` : ""} as 1 ÷ this rate
              </Label>
            </div>
            {inverseNote && <p className="text-xs text-muted-foreground">{inverseNote} You can edit it separately.</p>}
            {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
            <Button disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="button-save-rate">
              {save.isPending ? "Saving…" : "Save rate"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only the owner can change exchange rates.</p>
        )}

        {!data?.feed.available && (
          <p className="text-xs text-muted-foreground">No live rate source is connected, so rates are entered by hand.</p>
        )}
      </div>
    </Card>
  );
}
