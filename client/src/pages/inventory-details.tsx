import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Package, RefreshCw, Calendar, User, FileText, Coins, TrendingUp, Clock, Edit, Infinity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Inventory, RestockEvent, Staff, User as UserType } from "@shared/schema";

const LOW_STOCK_THRESHOLD = 5;

type RestockEventWithStaff = RestockEvent & {
  staff?: Staff | null;
  user?: UserType | null;
};

export default function InventoryDetails() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/inventory/:id");
  const { currentStore } = useStore();
  const { toast } = useToast();
  const inventoryId = params?.id;
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [restockData, setRestockData] = useState({
    quantity: 1,
    unitCost: 0,
    costStrategy: "keep" as "keep" | "last" | "weighted" | "override",
    newSellingPrice: undefined as number | undefined,
    updateSellingPrice: false,
    notes: "",
  });

  const { data: inventory, isLoading: itemLoading } = useQuery<Inventory>({
    queryKey: ["inventory-detail", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch inventory item");
      return res.json();
    },
    enabled: !!inventoryId,
  });

  const { data: restockHistory = [], isLoading: historyLoading } = useQuery<RestockEventWithStaff[]>({
    queryKey: ["inventory-restock-history", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}/restock-history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch restock history");
      return res.json();
    },
    enabled: !!inventoryId,
  });

  const restockMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/inventory/${inventoryId}/restock`, {
        quantityAdded: restockData.quantity,
        unitCost: restockData.unitCost,
        costStrategy: restockData.costStrategy,
        newSellingPrice: restockData.updateSellingPrice ? restockData.newSellingPrice : undefined,
        notes: restockData.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-restock-history", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      toast({ title: "Stock updated successfully" });
      setIsRestockOpen(false);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Update Stock", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const storeCurrency = currentStore?.currency || "NGN";
  const currencyInfo = getCurrencyByCode(storeCurrency);

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const formatDate = (date: string | Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const openRestockDialog = () => {
    if (inventory) {
      setRestockData({
        quantity: 1,
        unitCost: inventory.costPrice,
        costStrategy: "keep",
        newSellingPrice: inventory.sellingPrice,
        updateSellingPrice: false,
        notes: "",
      });
      setIsRestockOpen(true);
    }
  };

  const getStockBadge = (item: Inventory) => {
    if (item.type === "service") {
      return <Badge variant="secondary">Service</Badge>;
    }
    if (item.quantity === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    }
    if (item.quantity <= LOW_STOCK_THRESHOLD) {
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">Low Stock</Badge>;
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">In Stock</Badge>;
  };

  const getCostStrategyLabel = (strategy: string) => {
    switch (strategy) {
      case "keep": return "Kept existing";
      case "last": return "Last purchase";
      case "weighted": return "Weighted avg";
      case "override": return "Override";
      default: return strategy;
    }
  };

  const columns = [
    {
      key: "restockedAt",
      header: "Date",
      render: (event: RestockEventWithStaff) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{formatDate(event.restockedAt)}</span>
        </div>
      ),
    },
    {
      key: "quantityAdded",
      header: "Qty Added",
      render: (event: RestockEventWithStaff) => (
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span className="font-medium text-green-600 dark:text-green-400">+{event.quantityAdded}</span>
        </div>
      ),
    },
    {
      key: "unitCost",
      header: "Unit Cost",
      render: (event: RestockEventWithStaff) => (
        <div className="font-mono text-sm">
          {formatCurrency(event.unitCost)}
        </div>
      ),
    },
    {
      key: "costStrategy",
      header: "Cost Strategy",
      render: (event: RestockEventWithStaff) => (
        <Badge variant="outline" className="capitalize">
          {getCostStrategyLabel(event.costStrategy)}
        </Badge>
      ),
    },
    {
      key: "newSellingPrice",
      header: "Price Update",
      render: (event: RestockEventWithStaff) => (
        event.newSellingPrice ? (
          <span className="font-mono text-sm">{formatCurrency(event.newSellingPrice)}</span>
        ) : (
          <span className="text-muted-foreground text-sm">No change</span>
        )
      ),
    },
    {
      key: "staff",
      header: "By",
      render: (event: RestockEventWithStaff) => {
        const displayName = event.staff?.name || event.user?.email?.split('@')[0] || "Unknown";
        return (
          <div className="flex items-center gap-2">
            <User className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{displayName}</span>
          </div>
        );
      },
    },
    {
      key: "notes",
      header: "Notes",
      render: (event: RestockEventWithStaff) => (
        event.notes ? (
          <div className="flex items-center gap-1 max-w-[200px]">
            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-sm truncate" title={event.notes}>{event.notes}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
    },
  ];

  if (!match) {
    return null;
  }

  if (itemLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/inventory")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading item details...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/inventory")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Item not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const costPrice = inventory.costPrice ?? 0;
  const sellingPrice = inventory.sellingPrice ?? 0;
  const profit = sellingPrice - costPrice;
  const profitMargin = costPrice > 0 ? (profit / costPrice) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/inventory")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory
        </Button>
        <div className="flex gap-2">
          {inventory.type === "product" && (
            <Button onClick={openRestockDialog} data-testid="button-restock">
              <RefreshCw className="h-4 w-4 mr-2" />
              Restock
            </Button>
          )}
          <Button variant="outline" onClick={() => setLocation(`/inventory?edit=${inventoryId}`)} data-testid="button-edit">
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl" data-testid="text-item-name">{inventory.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="capitalize">{inventory.type}</Badge>
                    {getStockBadge(inventory)}
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Coins className="h-3 w-3" />
                  Cost Price
                </p>
                <p className="font-mono font-medium text-lg" data-testid="text-cost-price">
                  {formatCurrency(inventory.costPrice ?? 0)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Coins className="h-3 w-3" />
                  Selling Price
                </p>
                <p className="font-mono font-medium text-lg" data-testid="text-selling-price">
                  {formatCurrency(inventory.sellingPrice ?? 0)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Profit/Unit
                </p>
                <p className={`font-mono font-medium text-lg ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="text-profit">
                  {formatCurrency(profit)} ({profitMargin.toFixed(1)}%)
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Stock
                </p>
                {inventory.type === "product" ? (
                  <p className="font-mono font-medium text-lg" data-testid="text-quantity">
                    {inventory.quantity}
                  </p>
                ) : (
                  <p className="font-medium text-lg flex items-center gap-1" data-testid="text-quantity">
                    <Infinity className="h-4 w-4" /> Unlimited
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inventory.type === "product" ? (
              <>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">At Cost</p>
                  <p className="font-mono font-medium text-lg">
                    {formatCurrency(costPrice * inventory.quantity)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">At Selling Price</p>
                  <p className="font-mono font-medium text-lg">
                    {formatCurrency(sellingPrice * inventory.quantity)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Potential Profit</p>
                  <p className="font-mono font-medium text-lg text-green-600 dark:text-green-400">
                    {formatCurrency(profit * inventory.quantity)}
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Per Service</p>
                <p className="font-mono font-medium text-lg text-green-600 dark:text-green-400">
                  {formatCurrency(profit)} profit
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {inventory.type === "product" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Restock History
            </CardTitle>
            <CardDescription>
              Timeline of stock additions for this item
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading history...</div>
            ) : restockHistory.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No restock events recorded yet</p>
                <p className="text-xs mt-1">Add stock to see the history here</p>
              </div>
            ) : (
              <DataTable columns={columns} data={restockHistory} />
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={isRestockOpen} onOpenChange={setIsRestockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Restock "{inventory.name}"
            </DialogTitle>
            <DialogDescription>
              Add more stock to this item. Current stock: {inventory.quantity}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="restock-quantity">Quantity to Add</Label>
              <Input
                id="restock-quantity"
                type="number"
                min="1"
                value={restockData.quantity}
                onChange={(e) => setRestockData(prev => ({ 
                  ...prev, 
                  quantity: parseInt(e.target.value) || 1 
                }))}
                data-testid="input-restock-quantity"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-cost">Unit Cost for This Restock ({currencyInfo?.symbol || "₦"})</Label>
              <Input
                id="unit-cost"
                type="number"
                step="0.01"
                min="0"
                value={restockData.unitCost}
                onChange={(e) => setRestockData(prev => ({ 
                  ...prev, 
                  unitCost: parseFloat(e.target.value) || 0 
                }))}
                data-testid="input-unit-cost"
              />
            </div>

            <div className="space-y-2">
              <Label>How to Update Item Cost Price</Label>
              <RadioGroup
                value={restockData.costStrategy}
                onValueChange={(value) => setRestockData(prev => ({ 
                  ...prev, 
                  costStrategy: value as "keep" | "last" | "weighted" | "override" 
                }))}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="keep" id="keep" />
                  <Label htmlFor="keep" className="font-normal">
                    Keep existing cost ({formatCurrency(inventory.costPrice)})
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="last" id="last" />
                  <Label htmlFor="last" className="font-normal">
                    Use this restock's unit cost ({formatCurrency(restockData.unitCost)})
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="weighted" id="weighted" />
                  <Label htmlFor="weighted" className="font-normal">
                    Weighted average
                  </Label>
                </div>
              </RadioGroup>
              {restockData.costStrategy === "weighted" && restockData.unitCost > 0 && (
                <p className="text-xs text-muted-foreground ml-6">
                  New cost: {formatCurrency(
                    ((inventory.quantity * inventory.costPrice) + (restockData.quantity * restockData.unitCost)) / 
                    (inventory.quantity + restockData.quantity)
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="update-selling-price"
                  checked={restockData.updateSellingPrice}
                  onChange={(e) => setRestockData(prev => ({ 
                    ...prev, 
                    updateSellingPrice: e.target.checked 
                  }))}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="update-selling-price" className="font-normal">
                  Update selling price
                </Label>
              </div>
              {restockData.updateSellingPrice && (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={`Current: ${formatCurrency(inventory.sellingPrice)}`}
                  value={restockData.newSellingPrice ?? ""}
                  onChange={(e) => setRestockData(prev => ({ 
                    ...prev, 
                    newSellingPrice: parseFloat(e.target.value) || undefined 
                  }))}
                  data-testid="input-new-selling-price"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="restock-notes">Notes (optional)</Label>
              <Input
                id="restock-notes"
                placeholder="e.g., Supplier batch #123"
                value={restockData.notes}
                onChange={(e) => setRestockData(prev => ({ 
                  ...prev, 
                  notes: e.target.value 
                }))}
                data-testid="input-restock-notes"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsRestockOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => restockMutation.mutate()}
              disabled={restockMutation.isPending || restockData.quantity < 1}
              data-testid="button-confirm-restock"
            >
              {restockMutation.isPending ? "Updating..." : "Add Stock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
