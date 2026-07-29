import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Droplets, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RecipeRow {
  id: string;
  supplyInventoryId: string;
  supplyName: string;
  supplyUnit: string | null;
  supplyCostPrice: number;
  supplyQuantity: number;
  quantityPerUnit: number;
  costPerUnit: number;
  isActive: boolean;
}

interface RecipeResponse {
  inventoryId: string;
  itemName: string;
  fixedCostPrice: number;
  recipe: RecipeRow[];
  consumableCostPerUnit: number;
  fixedCostWarning: string | null;
}

interface Props {
  inventoryId: string;
  storeId: string;
  formatCurrency: (n: number) => string;
  canEdit: boolean;
}

/**
 * Recipe editor: which back-bar supplies this service burns per unit sold.
 *
 * Editing here changes nothing financially on its own. The recipe is expanded at
 * checkout into order_consumables, which is what charges the cost — and charges it
 * exactly once, because buying the supply capitalised into stock rather than
 * hitting the P&L.
 */
export function ConsumablesRecipeCard({ inventoryId, storeId, formatCurrency, canEdit }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [supplyId, setSupplyId] = useState("");
  const [qty, setQty] = useState("");

  const { data, isLoading } = useQuery<RecipeResponse>({
    queryKey: ["consumables-recipe", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}/consumables`);
      if (!res.ok) throw new Error("Failed to load recipe");
      return res.json();
    },
    enabled: !!inventoryId,
  });

  // Supplies only — /api/products hides them unless asked, so opt in here.
  const { data: supplyGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/products", storeId, "supplies"],
    queryFn: async () => {
      const res = await fetch(`/api/products?storeId=${storeId}&include=supplies`);
      if (!res.ok) return [];
      const list = await res.json();
      return list.filter((p: any) => p.type === "supply");
    },
    enabled: !!storeId,
  });

  const supplyVariants = supplyGroups.flatMap((g: any) =>
    (g.variants?.length ? g.variants : [g]).map((v: any) => ({
      id: v.id,
      name: v.name ?? g.name,
      unit: v.unit,
      costPrice: Number(v.costPrice ?? 0),
    })),
  ).filter((v: any) => !!v.id);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["consumables-recipe", inventoryId] });
    queryClient.invalidateQueries({ queryKey: ["sustaining-costs", inventoryId] });
  };

  const upsert = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/inventory/${inventoryId}/consumables`, {
        supplyInventoryId: supplyId,
        quantityPerUnit: Number(qty),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save the recipe line.");
      return body;
    },
    onSuccess: (body: any) => {
      setSupplyId("");
      setQty("");
      invalidate();
      toast({ title: "Recipe updated" });
      if (body.warning) {
        toast({ title: "Check the fixed cost", description: body.warning, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (lineId: string) => apiRequest("DELETE", `/api/inventory/${inventoryId}/consumables/${lineId}`),
    onSuccess: () => { invalidate(); toast({ title: "Recipe line removed" }); },
  });

  const zeroFixedCost = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/inventory/${inventoryId}`, { costPrice: 0 }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Fixed cost cleared", description: "This service is now costed entirely from its recipe." });
    },
    onError: (e: Error) => toast({ title: "Couldn't clear it", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading recipe…</CardContent></Card>;
  }

  const alreadyLinked = new Set(data.recipe.map((r) => r.supplyInventoryId));
  const available = supplyVariants.filter((v: any) => !alreadyLinked.has(v.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-muted-foreground" />
          Consumables Recipe
        </CardTitle>
        <CardDescription>
          The back-bar supplies this service uses up each time it is delivered. Buying a supply
          adds to stock without touching your P&amp;L — the cost is charged here, once, when the
          service is sold.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.fixedCostWarning && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{data.fixedCostWarning}</span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => zeroFixedCost.mutate()}
                  disabled={zeroFixedCost.isPending}
                >
                  Set fixed cost to 0
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {data.recipe.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No supplies linked yet. Until one is, this service costs only its fixed cost price.
          </p>
        ) : (
          <div className="rounded-md border divide-y">
            {data.recipe.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.supplyName}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.quantityPerUnit}{r.supplyUnit ? ` ${r.supplyUnit}` : ""} per service
                    {" · "}{formatCurrency(r.supplyCostPrice)} per {r.supplyUnit || "unit"}
                    {r.supplyQuantity <= 0 && (
                      <Badge variant="destructive" className="ml-2 text-[10px]">out of stock</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono">{formatCurrency(r.costPerUnit)}</span>
                  {canEdit && (
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between p-3 text-sm font-medium bg-muted/30">
              <span>Consumable cost per service</span>
              <span className="font-mono">{formatCurrency(data.consumableCostPerUnit)}</span>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label>Supply</Label>
              <Select value={supplyId} onValueChange={setSupplyId}>
                <SelectTrigger><SelectValue placeholder="Pick a supply…" /></SelectTrigger>
                <SelectContent>
                  {available.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      No supplies left to add. Create one from Inventory → New item → Supply.
                    </div>
                  ) : available.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.unit ? ` (${v.unit})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-40 space-y-1.5">
              <Label>Qty per service</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 30"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <Button
              onClick={() => upsert.mutate()}
              disabled={!supplyId || !(Number(qty) >= 0.01) || upsert.isPending}
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Measure supplies in the smallest unit you buy them in (ml, g, each). Amounts below 0.01
          are rejected because stock is tracked to two decimal places.
        </p>
      </CardContent>
    </Card>
  );
}
