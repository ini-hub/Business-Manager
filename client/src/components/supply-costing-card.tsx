import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Coins, Droplets, Gauge } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Props {
  inventoryId: string;
  costingMode: string;
  quantity: number;
  costPrice: number;
  unit?: string | null;
  formatCurrency: (n: number) => string;
  canEdit: boolean;
}

/**
 * How a supply's cost reaches the Profit & Loss.
 *
 * The choice matters because most consumables are shared across dozens of
 * transactions at a rate nobody has measured. "Charge on purchase" is the honest
 * default for those; metering is worth the effort only when the supply is
 * expensive enough to justify counting it.
 */
export function SupplyCostingCard({
  inventoryId, costingMode, quantity, costPrice, unit, formatCurrency, canEdit,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const onHandValue = quantity * costPrice;

  const { data: usedBy = [] } = useQuery<{ id: string; itemName: string }[]>({
    queryKey: ["supply-recipe-users", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}/consumables/used-by`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!inventoryId,
  });

  const { data: calibration } = useQuery<any>({
    queryKey: ["supply-calibration", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}/calibration`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!inventoryId && costingMode === "metered",
  });

  const applyCalibration = useMutation({
    mutationFn: () => apiRequest("POST", `/api/inventory/${inventoryId}/calibration/apply`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supply-calibration", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["consumables-recipe"] });
      toast({
        title: "Measured rates applied",
        description: "Future sales will use what the count actually showed.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't apply it", description: e.message, variant: "destructive" }),
  });

  const setMode = useMutation({
    mutationFn: async (mode: "expensed" | "metered") => {
      const res = await apiRequest("PATCH", `/api/inventory/${inventoryId}/costing-mode`, { costingMode: mode });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not change the costing mode.");
      return body;
    },
    onSuccess: (body: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["supply-recipe-users", inventoryId] });
      toast({ title: "Costing mode updated", description: body.message });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });

  const modes = [
    {
      key: "expensed" as const,
      icon: Coins,
      title: "Charge when I buy it",
      blurb: "The cost hits Direct Supplies the day you buy it. Stock is still tracked so you get low-stock alerts — it just isn't measured per service.",
      best: "Best when you don't know how far a bottle goes, and don't want to find out.",
    },
    {
      key: "metered" as const,
      icon: Gauge,
      title: "Charge as it gets used",
      blurb: "Buying it adds to stock without touching the P&L. Services draw the cost down through a recipe, and a stock count settles whatever the estimate got wrong.",
      best: "Worth it for expensive supplies where you want per-service profitability.",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-muted-foreground" />
          How this supply is costed
        </CardTitle>
        <CardDescription>
          Currently holding {quantity}{unit ? ` ${unit}` : ""} worth {formatCurrency(onHandValue)}.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {modes.map((m) => {
            const active = costingMode === m.key;
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                type="button"
                disabled={!canEdit || setMode.isPending || active}
                onClick={() => setMode.mutate(m.key)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-4 text-left transition-all",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : canEdit && "hover:border-muted-foreground/40 hover:bg-muted/20",
                  !canEdit && !active && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between">
                  <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                  {active && <Badge variant="secondary" className="text-[10px]">current</Badge>}
                </div>
                <div className="font-semibold text-sm">{m.title}</div>
                <div className="text-xs text-muted-foreground leading-snug">{m.blurb}</div>
                <div className="text-[11px] text-muted-foreground/80 italic leading-snug">{m.best}</div>
              </button>
            );
          })}
        </div>

        {canEdit && onHandValue > 0 && (
          <Alert>
            <AlertDescription className="text-xs">
              Switching adjusts for the {formatCurrency(onHandValue)} already on the shelf, so your
              running total doesn't jump. Moving to <strong>charge as it gets used</strong> credits
              that back and turns it into an asset; moving the other way charges it now. Either way
              the cost is only ever counted once.
            </AlertDescription>
          </Alert>
        )}

        {costingMode === "metered" && calibration?.canCalibrate && (
          <Alert>
            <Gauge className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p className="text-xs">
                Your last stock count says this supply is being used{" "}
                <strong>{calibration.factor >= 1
                  ? `${calibration.factor.toFixed(2)}× faster`
                  : `${(1 / calibration.factor).toFixed(2)}× slower`}</strong>{" "}
                than the recipes assume — {calibration.actualConsumed.toFixed(2)}{unit ? ` ${unit}` : ""} really
                went where they expected {calibration.theoretical.toFixed(2)}.
              </p>
              <ul className="text-xs space-y-0.5">
                {calibration.updates.map((u: any) => (
                  <li key={u.id} className="flex justify-between gap-3">
                    <span className="text-muted-foreground truncate">{u.itemName}</span>
                    <span className="font-mono shrink-0">
                      {u.from} → {u.to}{u.clamped ? " (floor)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {calibration.updates.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  All rates move by the same factor. One count tells you the overall level, not
                  which service is the heavy user — to separate them, count while running one
                  service type.
                </p>
              )}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => applyCalibration.mutate()} disabled={applyCalibration.isPending}>
                  Use the measured rates
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {costingMode === "metered" && calibration && !calibration.canCalibrate && calibration.reason && (
          <p className="text-xs text-muted-foreground">{calibration.reason}</p>
        )}

        {usedBy.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Metered by{" "}
            <span className="text-foreground font-medium">
              {usedBy.map((u) => u.itemName).join(", ")}
            </span>
            . Remove those recipe lines before switching back to charge-on-purchase, or the cost
            would be counted twice.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
