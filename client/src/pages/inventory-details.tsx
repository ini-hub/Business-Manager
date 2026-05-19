import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Package, RefreshCw, Calendar, User, FileText, Coins, TrendingUp, Clock, Edit, Infinity, Info, AlertCircle, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { insertInventorySchema, type Inventory, type RestockEvent, type Staff, type User as UserType, type InsertInventory } from "@shared/schema";

const LOW_STOCK_THRESHOLD = 5;

const inventoryEditFormSchema = insertInventorySchema.refine(
  (data) => data.costPrice > 0,
  {
    message: "Cost price must be greater than zero.",
    path: ["costPrice"],
  }
).refine(data => {
  if (data.commissionSplitOverride) {
    return data.commissionSplitBusinessShare + data.commissionSplitStaffShare === 100;
  }
  return true;
}, {
  message: "Override split percentages must sum to exactly 100%",
  path: ["commissionSplitStaffShare"]
});

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
    reason: "Restock" as "Restock" | "Return" | "Adjustment",
    receiptUrl: "",
  });
  const [isEditOpen, setIsEditOpen] = useState(false);

  const form = useForm<InsertInventory>({
    resolver: zodResolver(inventoryEditFormSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 0,
      commissionSplitOverride: false,
      commissionSplitBusinessShare: 80,
      commissionSplitStaffShare: 20,
    },
  });

  const watchType = form.watch("type");
  const watchCostPrice = form.watch("costPrice");
  const watchSellingPrice = form.watch("sellingPrice");
  const hasZeroMargin = watchCostPrice > 0 && watchCostPrice === watchSellingPrice;

  const updateMutation = useMutation({
    mutationFn: (data: InsertInventory) =>
      apiRequest("PATCH", `/api/inventory/${inventoryId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      toast({ title: "Item updated successfully" });
      setIsEditOpen(false);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Update Item", 
        description: getUserFriendlyError(error, "updating this item"), 
        variant: "destructive" 
      });
    },
  });

  const openEditDialog = () => {
    if (inventory) {
      form.reset({
        storeId: inventory.storeId,
        name: inventory.name,
        type: inventory.type as "product" | "service",
        costPrice: inventory.costPrice,
        sellingPrice: inventory.sellingPrice,
        quantity: inventory.quantity,
        commissionSplitOverride: (inventory as any).commissionSplitOverride ?? false,
        commissionSplitBusinessShare: (inventory as any).commissionSplitBusinessShare ?? 80,
        commissionSplitStaffShare: (inventory as any).commissionSplitStaffShare ?? 20,
      });
      setIsEditOpen(true);
    }
  };

  const onSubmit = (data: InsertInventory) => {
    if (data.sellingPrice < data.costPrice) {
      form.setError("sellingPrice", { type: "manual", message: "Selling price cannot be less than cost price." });
      return;
    }
    updateMutation.mutate(data);
  };

  const { data: inventory, isLoading: itemLoading } = useQuery<Inventory>({
    queryKey: ["inventory-detail", inventoryId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${inventoryId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch inventory item");
      return res.json();
    },
    enabled: !!inventoryId,
  });

  const [period, setPeriod] = useState<"30" | "90" | "365" | "all">("all");

  let startDate: string | undefined = undefined;
  if (period !== "all") {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(period));
    startDate = d.toISOString().split("T")[0];
  }
  const endDate = new Date().toISOString().split("T")[0];

  const { data: sustainingCostsData, isLoading: sustainingCostsLoading } = useQuery({
    queryKey: ["sustaining-costs", inventoryId, period],
    queryFn: async () => {
      const url = `/api/inventory/${inventoryId}/sustaining-costs?` + new URLSearchParams({
        ...(startDate ? { startDate } : {}),
        endDate,
      });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sustaining costs");
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
        reason: restockData.reason,
        receiptUrl: restockData.receiptUrl || undefined,
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
        reason: "Restock",
        receiptUrl: "",
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
      render: (event: RestockEventWithStaff) => {
        const sorted = [...restockHistory].sort((a, b) => new Date(b.restockedAt).getTime() - new Date(a.restockedAt).getTime());
        const eventIndex = sorted.findIndex(e => e.id === event.id);
        const prevEvent = eventIndex !== -1 ? sorted[eventIndex + 1] : undefined;
        const costChanged = prevEvent && prevEvent.unitCost !== event.unitCost;
        const percentChange = prevEvent && prevEvent.unitCost > 0
          ? ((event.unitCost - prevEvent.unitCost) / prevEvent.unitCost) * 100
          : 0;

        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-sm">{formatCurrency(event.unitCost)}</span>
            {costChanged && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 font-medium whitespace-nowrap">
                ⚠️ Unit cost changed from {formatCurrency(prevEvent.unitCost)} to {formatCurrency(event.unitCost)} ({percentChange > 0 ? "+" : ""}{percentChange.toFixed(0)}%)
              </span>
            )}
          </div>
        );
      },
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
          <Button variant="outline" onClick={openEditDialog} data-testid="button-edit">
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="restock-history">Restock History</TabsTrigger>
          <TabsTrigger value="sustaining-costs">Sustaining Costs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-0">
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
        </TabsContent>

        <TabsContent value="restock-history" className="mt-0">
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
              {inventory.type !== "product" ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Info className="h-8 w-8 mx-auto mb-2 opacity-50 text-blue-500" />
                  <p className="font-medium">Stock tracking does not apply to services.</p>
                  <p className="text-xs mt-1">Services have unlimited availability by default.</p>
                </div>
              ) : historyLoading ? (
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
        </TabsContent>

        <TabsContent value="sustaining-costs" className="space-y-6 mt-0">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  Sustaining Costs & Margin Analysis
                </CardTitle>
                <CardDescription>
                  Track true profit after linked sustaining costs and COGS
                </CardDescription>
              </div>
              <Select value={period} onValueChange={(val: any) => setPeriod(val)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                  <SelectItem value="365">Last Year</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {sustainingCostsLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading profitability data...</div>
              ) : (
                <div className="space-y-6">
                  {/* Aggregated profit block */}
                  <div className="grid gap-4 sm:grid-cols-5">
                    <div className="p-4 bg-muted/40 rounded-lg border">
                      <p className="text-xs font-medium text-muted-foreground">Revenue</p>
                      <p className="text-lg font-bold font-mono mt-1 text-green-700 dark:text-green-400">
                        {formatCurrency(sustainingCostsData?.totalRevenue ?? 0)}
                      </p>
                    </div>
                    <div className="p-4 bg-muted/40 rounded-lg border">
                      <p className="text-xs font-medium text-muted-foreground">COGS</p>
                      <p className="text-lg font-bold font-mono mt-1 text-muted-foreground">
                        {formatCurrency(sustainingCostsData?.totalCogs ?? 0)}
                      </p>
                    </div>
                    <div className="p-4 bg-muted/40 rounded-lg border">
                      <p className="text-xs font-medium text-muted-foreground">Gross Profit</p>
                      <p className="text-lg font-bold font-mono mt-1">
                        {formatCurrency(sustainingCostsData?.grossProfit ?? 0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Margin: {(sustainingCostsData?.grossProfitMargin ?? 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="p-4 bg-muted/40 rounded-lg border">
                      <p className="text-xs font-medium text-muted-foreground">Sustaining Costs</p>
                      <p className="text-lg font-bold font-mono mt-1 text-red-600 dark:text-red-400">
                        − {formatCurrency(sustainingCostsData?.totalSustainingCosts ?? 0)}
                      </p>
                    </div>
                    <div className="p-4 bg-primary/5 rounded-lg border border-primary/25 flex flex-col justify-between">
                      <div>
                        <p className="text-xs font-medium text-primary">Net Profit</p>
                        <p className={`text-lg font-bold font-mono mt-1 ${
                          (sustainingCostsData?.netProfit ?? 0) > 0 ? "text-green-600 animate-pulse" :
                          (sustainingCostsData?.netProfit ?? 0) < 0 ? "text-red-600" : "text-muted-foreground"
                        }`}>
                          {formatCurrency(sustainingCostsData?.netProfit ?? 0)}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">
                          Margin: {(sustainingCostsData?.netProfitMargin ?? 0).toFixed(1)}%
                        </span>
                        {sustainingCostsData?.status === "profit" && (
                          <Badge className="bg-green-100 hover:bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-[10px] font-bold px-1.5 py-0 whitespace-nowrap">
                            ✅ IN PROFIT
                          </Badge>
                        )}
                        {sustainingCostsData?.status === "breakeven" && (
                          <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] font-bold px-1.5 py-0 whitespace-nowrap">
                            ⚠️ BREAK EVEN
                          </Badge>
                        )}
                        {sustainingCostsData?.status === "loss" && (
                          <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-[10px] font-bold px-1.5 py-0 whitespace-nowrap">
                            ❌ IN LOSS
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sustaining expenses list */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Linked Sustaining Expenses</h3>
                    {(!sustainingCostsData?.expenses || sustainingCostsData.expenses.length === 0) ? (
                      <div className="py-8 text-center text-muted-foreground border rounded-lg bg-muted/10">
                        <Clock className="h-8 w-8 mx-auto mb-2 opacity-45" />
                        <p>No sustaining costs linked to this item in this period.</p>
                      </div>
                    ) : (
                      <DataTable
                        columns={[
                          {
                            key: "date",
                            header: "Date",
                            render: (e: any) => formatDate(e.date),
                          },
                          {
                            key: "title",
                            header: "Description",
                          },
                          {
                            key: "category",
                            header: "Category",
                            render: (e: any) => <Badge variant="outline">{e.category?.name || "Uncategorized"}</Badge>,
                          },
                          {
                            key: "amount",
                            header: "Amount",
                            render: (e: any) => <span className="font-mono font-medium">{formatCurrency(e.amount)}</span>,
                          }
                        ]}
                        data={sustainingCostsData.expenses}
                      />
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
              <Label htmlFor="restock-reason">Reason</Label>
              <Select
                value={restockData.reason}
                onValueChange={(value) => setRestockData(prev => ({ ...prev, reason: value as any }))}
              >
                <SelectTrigger id="restock-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Restock">Regular Restock</SelectItem>
                  <SelectItem value="Return">Customer Return</SelectItem>
                  <SelectItem value="Adjustment">Stock Adjustment/Correction</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="restock-receipt">Receipt/Invoice URL (optional)</Label>
              <Input
                id="restock-receipt"
                placeholder="https://example.com/receipt.pdf"
                value={restockData.receiptUrl}
                onChange={(e) => setRestockData(prev => ({ 
                  ...prev, 
                  receiptUrl: e.target.value 
                }))}
                data-testid="input-restock-receipt-url"
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

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit Item
            </DialogTitle>
            <DialogDescription>
              Update the inventory item details below.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Widget Pro" {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="product">Product</SelectItem>
                        <SelectItem value="service">Service</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="costPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Price ({currencyInfo?.symbol || "₦"})</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-cost"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellingPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Selling Price ({currencyInfo?.symbol || "₦"})</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-selling"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {watchType === "product" && (
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity in Stock</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          data-testid="input-quantity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {watchType === "service" && (
                <div className="border border-muted/80 p-3 rounded-lg bg-muted/10 space-y-3 animate-in fade-in duration-200">
                  <FormField
                    control={form.control}
                    name="commissionSplitOverride"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2 bg-background shadow-xs">
                        <div className="space-y-0.5">
                          <FormLabel className="text-xs font-semibold">Override Standard Split</FormLabel>
                          <FormDescription className="text-[10px]">
                            Customise business & staff commission split for this service
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-service-split-override"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {form.watch("commissionSplitOverride") && (
                    <div className="grid grid-cols-2 gap-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      <FormField
                        control={form.control}
                        name="commissionSplitBusinessShare"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[11px]">Business Share (%)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                placeholder="80"
                                data-testid="input-service-split-business"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="commissionSplitStaffShare"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[11px]">Staff Share (%)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                placeholder="20"
                                data-testid="input-service-split-staff"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
              )}
              {watchSellingPrice < watchCostPrice && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Selling price cannot be less than cost price.
                  </AlertDescription>
                </Alert>
              )}
              {hasZeroMargin && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 text-xs font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>This item has 0% margin. You will break even on every sale.</span>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending || watchSellingPrice < watchCostPrice}
                  data-testid="button-submit"
                >
                  {updateMutation.isPending ? "Saving..." : "Update Item"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
