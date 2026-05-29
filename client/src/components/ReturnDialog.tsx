import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Undo2, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";

interface ReturnItemState {
  orderId: string;
  inventoryId: string;
  name: string;
  type: string;
  unitPrice: number;
  maxQuantity: number;
  quantityToReturn: number;
  restock: boolean;
}

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkout: any; // Transaction/Checkout with relations
  onSuccess?: () => void;
}

export function ReturnDialog({ open, onOpenChange, checkout, onSuccess }: ReturnDialogProps) {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";

  const formatCurrency = (val: number) => formatCurrencyUtil(val, storeCurrency);

  // returnQtys tracks the user's current quantity selections by orderId.
  // This is separate from the derived item list so user inputs survive prop refreshes.
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [restockMap, setRestockMap] = useState<Record<string, boolean>>({});

  // Derive the available items reactively from the checkout prop.
  // When returnCheckoutObj rebuilds after a return (fresh returnedQuantity from server),
  // this memo recalculates maxQuantity so the dialog always reflects real remaining stock.
  const items = useMemo<ReturnItemState[]>(() => {
    if (!checkout || !checkout.orders) return [];
    return checkout.orders.map((o: any) => {
      const inv = o.inventory || {};
      const maxQty = Math.max(0, Number(o.quantity) - Number(o.returnedQuantity || 0));
      const defaultRestock = inv.type === "product";
      return {
        orderId: o.id,
        inventoryId: o.inventoryId,
        name: inv.name || "Unknown Item",
        type: inv.type || "product",
        unitPrice: Number(o.totalPrice) / Math.max(1, Number(o.quantity)),
        maxQuantity: maxQty,
        // Clamp stored qty against fresh maxQuantity to prevent over-returning
        quantityToReturn: Math.min(returnQtys[o.id] ?? 0, maxQty),
        restock: restockMap[o.id] ?? defaultRestock,
      };
    });
  }, [checkout, returnQtys, restockMap]);

  const [refundMethod, setRefundMethod] = useState<"cash" | "transfer" | "store_credit">("cash");
  const [reason, setReason] = useState<string>("");

  const updateItemQty = (orderId: string, qty: number, maxQty: number) => {
    setReturnQtys((prev) => ({ ...prev, [orderId]: Math.max(0, Math.min(qty, maxQty)) }));
  };

  const updateItemRestock = (orderId: string, restock: boolean) => {
    setRestockMap((prev) => ({ ...prev, [orderId]: restock }));
  };

  // Calculations
  const activeReturnsCount = items.reduce((sum, i) => sum + i.quantityToReturn, 0);
  const calculatedRefundAmount = items.reduce((sum, i) => sum + i.quantityToReturn * i.unitPrice, 0);

  const returnMutation = useMutation({
    mutationFn: async () => {
      const activeItems = items
        .filter((i) => i.quantityToReturn > 0)
        .map((i) => ({
          orderId: i.orderId,
          quantity: i.quantityToReturn,
          restock: i.restock,
        }));

      const payload = {
        storeId: currentStore?.id,
        checkoutId: checkout.id,
        items: activeItems,
        refundMethod,
        refundAmount: calculatedRefundAmount,
        reason: reason.trim(),
        staffId: checkout.staffId,
      };

      const res = await apiRequest("POST", "/api/sales/returns", payload);
      return res.json();
    },
    onSuccess: () => {
      // Invalidate the receipt details endpoint first so returnedQuantity is immediately stale
      // (the parent's handleReturnSuccess will also do this, but belt-and-suspenders is correct here)
      queryClient.invalidateQueries({ queryKey: [`/api/transactions/${checkout.id}/receipt`] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });

      toast({
        title: "Return processed successfully!",
        description: `Refunded ${formatCurrency(calculatedRefundAmount)} via ${refundMethod}.`,
      });

      onSuccess?.();
      onOpenChange(false);
      resetState();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't Process Return",
        description: err.message || "Something went wrong. Please check your inputs.",
        variant: "destructive",
      });
    },
  });

  const resetState = () => {
    setReturnQtys({});
    setRestockMap({});
    setRefundMethod("cash");
    setReason("");
  };

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      resetState();
    }
  };

  const isProfiledCustomer = !!checkout?.customerId;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto font-outfit">
        <DialogHeader className="pb-3 border-b border-muted/30">
          <DialogTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
            <Undo2 className="h-5 w-5 text-indigo-500" />
            Process POS Return
          </DialogTitle>
          <DialogDescription className="text-xs">
            Return items from Transaction receipt <strong className="font-mono text-foreground">{checkout?.receiptNumber}</strong>.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <Alert variant="destructive" className="my-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">No active items are eligible for returns in this transaction.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5 py-4">
            {/* Scrollable Items list */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Items to Return</h4>
              <ScrollArea className="h-[220px] rounded-lg border bg-card p-3 space-y-3">
                {items.map((item, idx) => {
                  const remaining = item.maxQuantity;
                  return (
                    <div key={item.orderId} className="flex flex-col gap-2 pb-3 mb-3 border-b last:border-0 last:pb-0 last:mb-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono">{formatCurrency(item.unitPrice)}</span>
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 capitalize font-medium">
                              {item.type}
                            </Badge>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Label className="text-xs text-muted-foreground">Return Qty:</Label>
                          <Input
                            type="number"
                            min="0"
                            max={remaining}
                            disabled={remaining === 0}
                            value={item.quantityToReturn}
                            onChange={(e) => updateItemQty(item.orderId, parseInt(e.target.value) || 0, item.maxQuantity)}
                            className="h-8 w-16 text-center text-xs font-semibold font-mono"
                          />
                          <span className="text-xs text-muted-foreground font-medium">/ {remaining} max</span>
                        </div>
                      </div>

                      {item.type === "product" && item.quantityToReturn > 0 && (
                        <div className="flex items-center justify-between bg-primary/5 rounded p-2 text-xs border border-primary/10 animate-fade-in">
                          <span className="text-muted-foreground font-medium flex items-center gap-1">
                            <RefreshCw className="h-3.5 w-3.5 text-primary" />
                            Restock item to shelf?
                          </span>
                          <Switch
                            checked={item.restock}
                            onCheckedChange={(checked) => updateItemRestock(item.orderId, checked)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </ScrollArea>
            </div>

            {/* Refund Configs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Refund Method</Label>
                <Select value={refundMethod} onValueChange={(val: any) => setRefundMethod(val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash" className="text-xs">Cash Payout</SelectItem>
                    <SelectItem value="transfer" className="text-xs">Bank Transfer</SelectItem>
                    <SelectItem value="store_credit" disabled={!isProfiledCustomer} className="text-xs">
                      Store Credit {!isProfiledCustomer && " (Requires Profiled Customer)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason for Return</Label>
                <Input
                  placeholder="e.g. Damaged, Dissatisfied, Size exchange"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Calculations Summary Panel */}
            <div className="border border-indigo-500/10 rounded-xl p-4 bg-indigo-500/5 space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Total items selected:</span>
                <span className="font-bold text-foreground font-mono">{activeReturnsCount} items</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-indigo-500/15">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">Estimated Refund Total</span>
                <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                  {formatCurrency(calculatedRefundAmount)}
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="pt-3 border-t border-muted/30">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} className="text-xs">
            <Ban className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button
            disabled={activeReturnsCount === 0 || !reason.trim() || returnMutation.isPending}
            onClick={() => returnMutation.mutate()}
            size="sm"
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {returnMutation.isPending ? "Processing..." : "Complete Return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
