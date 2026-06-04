import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as fmt } from "@/lib/currency-utils";

export default function InventoryRestockPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const currency = currentStore?.currency || "NGN";

  const { data: item, isLoading } = useQuery<any>({
    queryKey: ["inventory-detail", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  const [data, setData] = useState({
    quantity: 1,
    unitCost: 0,
    costStrategy: "keep" as "keep" | "last" | "weighted" | "override",
    updateSellingPrice: false,
    newSellingPrice: undefined as number | undefined,
    notes: "",
    reason: "Restock" as string,
    receiptUrl: "",
  });

  const set = (field: string, value: any) => setData((d) => ({ ...d, [field]: value }));

  const restockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inventory/${id}/restock`, {
        quantityAdded: data.quantity,
        unitCost: data.unitCost || item?.costPrice,
        costStrategy: data.costStrategy,
        newSellingPrice: data.updateSellingPrice ? data.newSellingPrice : undefined,
        notes: data.notes || undefined,
        reason: data.reason,
        receiptUrl: data.receiptUrl || undefined,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to restock");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Stock updated", description: `${data.quantity}${item?.unit ? " " + item.unit : " units"} added to "${item?.name}".` });
      setLocation(`/inventory/${id}`);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (!item) return <div className="py-12 text-center text-muted-foreground">Item not found.</div>;

  const weightedAvg =
    data.costStrategy === "weighted" && data.unitCost > 0
      ? ((item.quantity * item.costPrice) + (data.quantity * data.unitCost)) /
        (item.quantity + data.quantity)
      : null;

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title={`Restock "${item.name}"`}
        description={`Current stock: ${item.quantity}${item.unit ? ` ${item.unit}` : " units"}`}
        actions={
          <Button variant="outline" onClick={() => setLocation(`/inventory/${id}`)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rs-qty">
              Quantity to Add{item.unit ? ` (${item.unit})` : ""} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rs-qty"
              type="number"
              min={item.allowFractional ? "0.01" : "1"}
              step={item.allowFractional ? "0.01" : "1"}
              value={data.quantity}
              onChange={(e) => set("quantity", item.allowFractional ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 1))}
              autoFocus
              data-testid="input-restock-quantity"
            />
            {item.allowFractional && (
              <p className="text-xs text-muted-foreground">This item supports fractional quantities.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-reason">Reason</Label>
            <Select value={data.reason} onValueChange={(v) => set("reason", v)}>
              <SelectTrigger id="rs-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Restock">Regular Restock</SelectItem>
                <SelectItem value="Return">Customer Return</SelectItem>
                <SelectItem value="Adjustment">Stock Adjustment / Correction</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-unit-cost">Unit Cost for This Restock ({fmt(0, currency).replace("0", "").trim()})</Label>
            <Input
              id="rs-unit-cost"
              type="number"
              step="0.01"
              min="0"
              value={data.unitCost}
              onChange={(e) => set("unitCost", parseFloat(e.target.value) || 0)}
              data-testid="input-unit-cost"
            />
          </div>

          <div className="space-y-2">
            <Label>How to Update Item Cost Price</Label>
            <RadioGroup
              value={data.costStrategy}
              onValueChange={(v) => set("costStrategy", v)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="keep" id="keep" />
                <Label htmlFor="keep" className="font-normal">
                  Keep existing cost ({fmt(item.costPrice, currency)})
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="last" id="last" />
                <Label htmlFor="last" className="font-normal">
                  Use this restock's unit cost ({fmt(data.unitCost, currency)})
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="weighted" id="weighted" />
                <Label htmlFor="weighted" className="font-normal">
                  Weighted average
                  {weightedAvg !== null && (
                    <span className="ml-1 text-muted-foreground text-xs">
                      → {fmt(weightedAvg, currency)}
                    </span>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="update-selling"
                checked={data.updateSellingPrice}
                onCheckedChange={(c) => set("updateSellingPrice", !!c)}
              />
              <Label htmlFor="update-selling" className="font-normal">
                Update selling price
              </Label>
            </div>
            {data.updateSellingPrice && (
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={`Current: ${fmt(item.sellingPrice, currency)}`}
                value={data.newSellingPrice ?? ""}
                onChange={(e) => set("newSellingPrice", parseFloat(e.target.value) || undefined)}
                data-testid="input-new-selling-price"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-receipt">Receipt / Invoice URL (optional)</Label>
            <Input
              id="rs-receipt"
              placeholder="https://example.com/receipt.pdf"
              value={data.receiptUrl}
              onChange={(e) => set("receiptUrl", e.target.value)}
              data-testid="input-restock-receipt-url"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-notes">Notes (optional)</Label>
            <Input
              id="rs-notes"
              placeholder="e.g. Supplier batch #123"
              value={data.notes}
              onChange={(e) => set("notes", e.target.value)}
              data-testid="input-restock-notes"
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={() => setLocation(`/inventory/${id}`)}>
              Cancel
            </Button>
            <Button
              onClick={() => restockMutation.mutate()}
              disabled={restockMutation.isPending || data.quantity < 1}
              data-testid="button-confirm-restock"
            >
              {restockMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Updating…</>
              ) : (
                "Add Stock"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
