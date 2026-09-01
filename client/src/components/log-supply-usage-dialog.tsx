import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle, Droplet } from "lucide-react";

interface LogSupplyUsageDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  storeId: string;
  serviceName: string;
}

/**
 * Logs that a back-bar supply was used delivering an already-sold service —
 * off the automatic recipe, for a one-off or a top-up beyond what the recipe
 * predicted. This is NOT a sale: it writes straight to the consumption
 * ledger and never touches the checkout/addendum cart-item path, which
 * rejects supplies outright because that path exists to price a sale.
 */
export function LogSupplyUsageDialog({ open, onOpenChange, orderId, storeId, serviceName }: LogSupplyUsageDialogProps) {
  const { toast } = useToast();
  const [supplyId, setSupplyId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSupplyId("");
      setQuantity("1");
      setError("");
    }
  }, [open]);

  const { data: supplies = [] } = useQuery({
    queryKey: ["/api/inventory", storeId, "supplies-metered"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${storeId}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items ?? []);
      // Only a metered supply can release cost per use — an expensed one was
      // already charged in full on purchase, so logging usage against it
      // would count the same cost twice.
      return items.filter((item: any) => item.type === "supply" && item.costingMode === "metered");
    },
    enabled: open && !!storeId,
  });

  const selectedSupply = supplies.find((s: any) => s.id === supplyId);

  const logMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/consumables`, {
        supplyInventoryId: supplyId,
        quantityUsed: Number(quantity),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log supply usage.");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({
        title: "Usage logged",
        description: `${quantity} × ${selectedSupply?.name} charged to ${serviceName}'s cost.`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = () => {
    setError("");
    if (!supplyId) return setError("Pick a supply.");
    const qty = Number(quantity);
    if (!(qty >= 0.0001)) return setError("Enter an amount of at least 0.0001.");
    logMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Droplet className="h-4 w-4" />
            Log Supply Used
          </DialogTitle>
          <DialogDescription className="text-xs">
            Record a back-bar supply used delivering <span className="font-medium text-foreground">{serviceName}</span>,
            beyond what its recipe already accounts for. This charges the cost to this service — it does not sell
            the supply or change the receipt total.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Supply</Label>
            <Select value={supplyId} onValueChange={setSupplyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a supply..." />
              </SelectTrigger>
              <SelectContent>
                {supplies.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.unit ? ` (${s.unit})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {supplies.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No metered supplies available. A supply must be switched to "metered" costing before usage can be logged against it.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supply-usage-qty" className="text-sm">Quantity used</Label>
            <Input
              id="supply-usage-qty"
              type="number"
              min="0.0001"
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={logMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={logMutation.isPending || !supplyId}>
            {logMutation.isPending ? "Logging..." : "Log Usage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
