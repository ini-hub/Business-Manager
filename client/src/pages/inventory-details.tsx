import { useState, useEffect } from "react";
import { buildSlug } from "@/lib/slug";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Package, RefreshCw, Calendar, User, FileText, Coins, TrendingUp, Clock,
  Edit, Infinity, Info, AlertTriangle, Plus, Trash2, Layers, Wrench, BarChart2,
  ShoppingBag, Tag, DollarSign
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { inventoryApi } from "@/services/InventoryApiService";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { insertInventorySchema, type Inventory, type RestockEvent, type Staff, type User as UserType, type InsertInventory } from "@shared/schema";
import { cn } from "@/lib/utils";

const inventoryEditFormSchema = insertInventorySchema.refine(
  (data) => data.costPrice > 0,
  { message: "Cost price must be greater than zero.", path: ["costPrice"] }
).refine(data => {
  if (data.commissionSplitOverride) {
    const businessShare = data.commissionSplitBusinessShare ?? 0;
    const staffShare = data.commissionSplitStaffShare ?? 0;
    return businessShare + staffShare === 100;
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

  const { data: inventory, isLoading: itemLoading } = useQuery<any>({
    queryKey: ["inventory-detail", inventoryId],
    queryFn: async () => {
      const prodRes = await fetch(`/api/products/${inventoryId}`);
      if (prodRes.ok) {
        const prod = await prodRes.json();
        return { isProductGroup: true, ...prod };
      }
      const invRes = await fetch(`/api/inventory/${inventoryId}`);
      if (invRes.ok) {
        const inv = await invRes.json();
        return { isProductGroup: false, ...inv };
      }
      throw new Error("Item not found");
    },
    enabled: !!inventoryId,
  });

  const isSimpleProduct = inventory?.isProductGroup && inventory?.variants && inventory?.variants.length === 1;
  const primaryVariant = isSimpleProduct ? inventory.variants[0] : (!inventory?.isProductGroup ? inventory : null);
  const activeVariantId = primaryVariant?.id;

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

  // --- COMPOSITE / BUNDLES ---
  const { data: bundleComponents = [], isLoading: bundleLoading } = useQuery<any[]>({
    queryKey: ["bundle-components", activeVariantId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${activeVariantId}/bundle-components`);
      if (!res.ok) throw new Error("Failed to fetch bundle components");
      return res.json();
    },
    enabled: !!activeVariantId && !!primaryVariant?.isBundle,
  });

  const { data: storeInventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateBundleMutation = useMutation({
    mutationFn: async (components: { componentInventoryId: string; quantity: number }[]) => {
      return apiRequest("POST", `/api/inventory/${activeVariantId}/bundle-components`, { components });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundle-components", activeVariantId] });
      toast({ title: "Bundle components updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update bundle components", description: error.message, variant: "destructive" });
    },
  });

  // --- VARIANTS ---
  const [isVariantDialogOpen, setIsVariantDialogOpen] = useState(false);
  const [newVariantData, setNewVariantData] = useState({
    name: "", costPrice: 0, sellingPrice: 0, quantity: 0, size: "", color: "",
  });
  const [customAttrs, setCustomAttrs] = useState<{ key: string; value: string }[]>([]);
  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");

  useEffect(() => {
    if (!isVariantDialogOpen || !inventory) return;
    const parts = [];
    if (newVariantData.size) parts.push(newVariantData.size);
    if (newVariantData.color) parts.push(newVariantData.color);
    customAttrs.forEach(attr => { if (attr.value) parts.push(attr.value); });
    const attrsStr = parts.join(" / ");
    const generatedName = attrsStr ? `${inventory.name} - ${attrsStr}` : inventory.name;
    setNewVariantData(prev => ({ ...prev, name: generatedName }));
  }, [newVariantData.size, newVariantData.color, customAttrs, isVariantDialogOpen, inventory?.name]);

  const variants = inventory?.variants || [];

  const createVariantMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/products/${inventoryId}/variants`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", currentStore?.id] });
      toast({ title: "Variant created successfully" });
      setIsVariantDialogOpen(false);
      setNewVariantData({ name: "", costPrice: 0, sellingPrice: 0, quantity: 0, size: "", color: "" });
      setCustomAttrs([]);
      setAttrKey(""); setAttrValue("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create variant", description: error.message, variant: "destructive" });
    },
  });

  // --- FIFO EXPIRY BATCHES ---
  const [newBatchData, setNewBatchData] = useState({ batchNumber: "", expiryDate: "", quantity: 1 });

  const { data: batches = [], isLoading: batchesLoading } = useQuery<any[]>({
    queryKey: ["inventory-batches", activeVariantId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${activeVariantId}/batches`);
      if (!res.ok) throw new Error("Failed to fetch batches");
      return res.json();
    },
    enabled: !!activeVariantId && primaryVariant?.type === "product" && !primaryVariant?.isBundle,
  });

  const createBatchMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/inventory/${activeVariantId}/batches`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-batches", activeVariantId] });
      toast({ title: "Batch cohort added successfully" });
      setNewBatchData({ batchNumber: "", expiryDate: "", quantity: 1 });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create batch", description: error.message, variant: "destructive" });
    },
  });

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

  const updateMutation = useMutation({
    mutationFn: (data: InsertInventory) =>
      apiRequest("PATCH", `/api/inventory/${inventoryId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", inventoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      toast({ title: "Item updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Update Item", description: getUserFriendlyError(error, "updating this item"), variant: "destructive" });
    },
  });

  const openEditDialog = () => setLocation(`/inventory/${inventoryId}/edit`);

  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && currentStore.id !== "all",
  });

  const globalLowStockThreshold = settingsData?.lowStockThreshold ?? 5;
  // Use per-item reorderPoint when set, otherwise fall back to store global threshold
  const itemReorderPoint = primaryVariant?.reorderPoint ?? inventory?.reorderPoint;
  const lowStockThreshold = itemReorderPoint != null ? itemReorderPoint : globalLowStockThreshold;
  const [period, setPeriod] = useState<"30" | "90" | "365" | "all">("all");

  let startDate: string | undefined = undefined;
  if (period !== "all") {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(period));
    startDate = d.toISOString().split("T")[0];
  }
  const endDate = new Date().toISOString().split("T")[0];

  const { data: sustainingCostsData, isLoading: sustainingCostsLoading } = useQuery({
    queryKey: ["sustaining-costs", activeVariantId, period],
    queryFn: async () => {
      const url = `/api/inventory/${activeVariantId}/sustaining-costs?` + new URLSearchParams({
        ...(startDate ? { startDate } : {}), endDate,
      });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sustaining costs");
      return res.json();
    },
    enabled: !!activeVariantId,
  });

  const { data: restockHistory = [], isLoading: historyLoading } = useQuery<RestockEventWithStaff[]>({
    queryKey: ["inventory-restock-history", activeVariantId],
    queryFn: () => inventoryApi.getRestockHistory(activeVariantId!),
    enabled: !!activeVariantId,
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
      toast({ title: "Couldn't Update Stock", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const formatDate = (date: string | Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(date));
  };

  const openRestockDialog = () => setLocation(`/inventory/${activeVariantId}/restock`);

  const getStockStatus = (item: any) => {
    if (item.type === "service") return { label: "Service", variant: "secondary" as const, color: "" };
    const qty = item.isProductGroup ? totalQuantity : (item.quantity || 0);
    if (qty === 0) return { label: "Out of Stock", variant: "destructive" as const, color: "" };
    if (qty <= lowStockThreshold) return { label: "Low Stock", variant: "secondary" as const, color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" };
    return { label: "In Stock", variant: "secondary" as const, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" };
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

  const restockColumns = [
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
      render: (event: RestockEventWithStaff) => {
        const unit = primaryVariant?.unit || inventory?.unit;
        const qty = parseFloat(Number(event.quantityAdded).toFixed(2));
        return (
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="font-medium text-green-600 dark:text-green-400">
              +{qty}{unit ? ` ${unit}` : ""}
            </span>
          </div>
        );
      },
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
                ⚠️ {formatCurrency(prevEvent.unitCost)} → {formatCurrency(event.unitCost)} ({percentChange > 0 ? "+" : ""}{percentChange.toFixed(0)}%)
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
        <Badge variant="outline" className="capitalize">{getCostStrategyLabel(event.costStrategy)}</Badge>
      ),
    },
    {
      key: "newSellingPrice",
      header: "Price Update",
      render: (event: RestockEventWithStaff) => (
        event.newSellingPrice
          ? <span className="font-mono text-sm">{formatCurrency(event.newSellingPrice)}</span>
          : <span className="text-muted-foreground text-sm">No change</span>
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
        event.notes
          ? <div className="flex items-center gap-1 max-w-[200px]">
              <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-sm truncate" title={event.notes}>{event.notes}</span>
            </div>
          : <span className="text-muted-foreground text-sm">—</span>
      ),
    },
  ];

  if (!match) return null;

  if (itemLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/inventory")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Inventory
        </Button>
        <Card className="overflow-hidden">
          <div className="bg-muted/30 border-b px-6 py-5">
            <div className="flex items-start gap-4">
              <Skeleton className="h-14 w-14 rounded-xl" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-5 w-36" />
              </div>
            </div>
          </div>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-28" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/inventory")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Inventory
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-semibold text-muted-foreground">Item not found</p>
            <p className="text-sm text-muted-foreground mt-1">This inventory item may have been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const variantsList = inventory?.variants || [];
  const minCost = variantsList.length > 0 ? Math.min(...variantsList.map((v: any) => v.costPrice)) : 0;
  const maxCost = variantsList.length > 0 ? Math.max(...variantsList.map((v: any) => v.costPrice)) : 0;
  const minSelling = variantsList.length > 0 ? Math.min(...variantsList.map((v: any) => v.sellingPrice)) : 0;
  const maxSelling = variantsList.length > 0 ? Math.max(...variantsList.map((v: any) => v.sellingPrice)) : 0;

  const costPrice = inventory.isProductGroup
    ? (isSimpleProduct ? (primaryVariant?.costPrice ?? 0) : 0)
    : (inventory.costPrice ?? 0);
  const sellingPrice = inventory.isProductGroup
    ? (isSimpleProduct ? (primaryVariant?.sellingPrice ?? 0) : 0)
    : (inventory.sellingPrice ?? 0);
  const profit = sellingPrice - costPrice;
  const profitMargin = costPrice > 0 ? (profit / sellingPrice) * 100 : 0;

  const totalQuantity = inventory.isProductGroup
    ? variantsList.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0)
    : (inventory.quantity || 0);

  const totalCostValue = inventory.isProductGroup
    ? variantsList.reduce((sum: number, v: any) => sum + ((v.costPrice || 0) * (v.quantity || 0)), 0)
    : (costPrice * totalQuantity);
  const totalSellingValue = inventory.isProductGroup
    ? variantsList.reduce((sum: number, v: any) => sum + ((v.sellingPrice || 0) * (v.quantity || 0)), 0)
    : (sellingPrice * totalQuantity);
  const totalPotentialProfit = totalSellingValue - totalCostValue;

  const stockStatus = getStockStatus(inventory);
  const isService = inventory.type === "service";
  const isBundle = primaryVariant?.isBundle;

  return (
    <div className="space-y-5">
      {/* Top navigation row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" onClick={() => setLocation("/inventory")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory
        </Button>
        <div className="flex items-center gap-2">
          {inventory.type === "product" && !!activeVariantId && (
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

      {/* Product Hero Card */}
      <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-border/60">
        <div className="bg-gradient-to-br from-muted/40 via-background to-primary/5 border-b px-6 py-5">
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-3 rounded-xl border shadow-sm shrink-0",
              isService
                ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                : isBundle
                  ? "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800"
                  : "bg-primary/5 border-primary/20"
            )}>
              {isService
                ? <Wrench className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                : isBundle
                  ? <Layers className="h-7 w-7 text-purple-600 dark:text-purple-400" />
                  : <Package className="h-7 w-7 text-primary" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold leading-tight" data-testid="text-item-name">
                  {inventory.name}
                </h1>
                {inventory.productId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary hover:underline h-auto py-0.5 px-1.5"
                    onClick={() => setLocation(`/inventory/${inventory.productId}`)}
                  >
                    View Group
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className={`capitalize font-medium ${
                  isService ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
                  : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"}`}>
                  {isService ? "Service" : isBundle ? "Bundle" : "Product"}
                </Badge>
                <Badge
                  variant={stockStatus.variant}
                  className={cn("font-medium", stockStatus.color)}
                >
                  {stockStatus.label}
                </Badge>
                {inventory.isProductGroup && !isSimpleProduct && (
                  <Badge variant="secondary" className="text-xs">
                    {variantsList.length} variants
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Key Metrics Strip */}
        <CardContent className="p-0">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 border-b-0">
            {/* Cost Price */}
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Tag className="h-3 w-3" />
                Cost Price
              </p>
              <p className="font-mono font-semibold text-base" data-testid="text-cost-price">
                {inventory.isProductGroup && !isSimpleProduct
                  ? (minCost === maxCost ? formatCurrency(minCost) : `${formatCurrency(minCost)} – ${formatCurrency(maxCost)}`)
                  : formatCurrency(costPrice)
                }
              </p>
            </div>

            {/* Selling Price */}
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <ShoppingBag className="h-3 w-3" />
                Selling Price
              </p>
              <p className="font-mono font-semibold text-base" data-testid="text-selling-price">
                {inventory.isProductGroup && !isSimpleProduct
                  ? (minSelling === maxSelling ? formatCurrency(minSelling) : `${formatCurrency(minSelling)} – ${formatCurrency(maxSelling)}`)
                  : formatCurrency(sellingPrice)
                }
              </p>
            </div>

            {/* Profit */}
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="h-3 w-3" />
                Profit / Unit
              </p>
              {inventory.isProductGroup && !isSimpleProduct
                ? <p className="text-sm text-muted-foreground">See variants matrix</p>
                : (
                  <div>
                    <p
                      className={cn("font-mono font-semibold text-base", profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}
                      data-testid="text-profit"
                    >
                      {formatCurrency(profit)}
                    </p>
                    {costPrice > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{profitMargin.toFixed(1)}% margin</p>
                    )}
                  </div>
                )
              }
            </div>

            {/* Stock */}
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Package className="h-3 w-3" />
                Stock
              </p>
              {isService
                ? (
                  <p className="font-semibold text-base flex items-center gap-1" data-testid="text-quantity">
                    <Infinity className="h-4 w-4 text-blue-500" />
                    <span className="text-blue-600 dark:text-blue-400">Unlimited</span>
                  </p>
                )
                : (
                  <div>
                    <p
                      className={cn(
                        "font-mono font-semibold text-base",
                        totalQuantity === 0 ? "text-red-600 dark:text-red-400"
                          : totalQuantity <= lowStockThreshold ? "text-amber-600 dark:text-amber-400"
                          : ""
                      )}
                      data-testid="text-quantity"
                    >
                      {parseFloat(Number(totalQuantity).toFixed(4))}{inventory.unit ? ` ${inventory.unit}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{inventory.unit ? `${inventory.unit} in stock` : "units in stock"}</p>
                  </div>
                )
              }
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full space-y-5">
        <PolymorphicTabsList
          tabs={[
            { value: "overview", label: "Overview" },
            ...(inventory.type === "product" && !!activeVariantId ? [{ value: "restock-history", label: "Restock History" }] : []),
            ...(!!activeVariantId ? [{ value: "sustaining-costs", label: "Profitability" }] : []),
            ...(isBundle && !!activeVariantId ? [{ value: "bundle-components", label: "Bundle Components" }] : []),
            ...(inventory.isProductGroup ? [{ value: "variants", label: "Variants" }] : []),
            ...(inventory.type === "product" && !isBundle && !!activeVariantId ? [{ value: "expiry-batches", label: "Expiry Batches" }] : []),
          ]}
          variant="default"
        />

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4 mt-0">
          {isService ? (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Service Item</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                      Services have unlimited availability and don't require stock tracking. Every sale of this service earns {formatCurrency(profit)} in profit.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Stock Value Summary */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 px-0.5">Stock Value</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl border bg-muted/20 space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Tag className="h-3 w-3" /> At Cost
                    </p>
                    <p className="font-mono font-semibold text-lg">{formatCurrency(totalCostValue)}</p>
                    <p className="text-xs text-muted-foreground">{parseFloat(Number(totalQuantity).toFixed(4))}{inventory.unit ? ` ${inventory.unit}` : " units"} × cost</p>
                  </div>
                  <div className="p-4 rounded-xl border bg-muted/20 space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <ShoppingBag className="h-3 w-3" /> At Selling Price
                    </p>
                    <p className="font-mono font-semibold text-lg">{formatCurrency(totalSellingValue)}</p>
                    <p className="text-xs text-muted-foreground">{parseFloat(Number(totalQuantity).toFixed(4))}{inventory.unit ? ` ${inventory.unit}` : " units"} × price</p>
                  </div>
                  <div className="p-4 rounded-xl border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 space-y-1">
                    <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
                      <TrendingUp className="h-3 w-3" /> Potential Profit
                    </p>
                    <p className={cn("font-mono font-semibold text-lg", totalPotentialProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                      {formatCurrency(totalPotentialProfit)}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-500">if all stock is sold</p>
                  </div>
                </div>
              </div>

              {/* Low stock warning */}
              {totalQuantity > 0 && totalQuantity <= lowStockThreshold && (
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-amber-800 dark:text-amber-300">
                    <strong>Low stock:</strong> Only {parseFloat(Number(totalQuantity).toFixed(4))}{inventory.unit ? ` ${inventory.unit}` : ` unit${totalQuantity !== 1 ? "s" : ""}`} remaining. Consider restocking soon.
                  </AlertDescription>
                </Alert>
              )}
              {totalQuantity === 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Out of stock.</strong> This item is currently unavailable for sale. Restock to continue selling.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </TabsContent>

        {/* RESTOCK HISTORY TAB */}
        <TabsContent value="restock-history" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Restock History
              </CardTitle>
              <CardDescription>Timeline of all stock additions and adjustments</CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="space-y-3 py-4">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : restockHistory.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/40 mb-3">
                    <RefreshCw className="h-5 w-5 text-muted-foreground/60" />
                  </div>
                  <p className="font-medium text-muted-foreground">No restock events yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Add stock to start building your restock history.</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={openRestockDialog}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Add Stock
                  </Button>
                </div>
              ) : (
                <DataTable columns={restockColumns} data={restockHistory} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SUSTAINING COSTS TAB */}
        <TabsContent value="sustaining-costs" className="space-y-4 mt-0">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Profitability & Sustaining Costs
                </CardTitle>
                <CardDescription>True profit after linked sustaining costs and COGS</CardDescription>
              </div>
              <Select value={period} onValueChange={(val: any) => setPeriod(val)}>
                <SelectTrigger className="w-[160px]">
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
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-5 gap-3">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Profit breakdown */}
                  <div className="grid gap-3 sm:grid-cols-5">
                    {[
                      { label: "Revenue", value: sustainingCostsData?.totalRevenue ?? 0, color: "text-green-700 dark:text-green-400" },
                      { label: "COGS", value: sustainingCostsData?.totalCogs ?? 0, color: "text-muted-foreground" },
                      { label: "Gross Profit", value: sustainingCostsData?.grossProfit ?? 0, sub: `${(sustainingCostsData?.grossProfitMargin ?? 0).toFixed(1)}% margin`, color: "" },
                      { label: "Sustaining Costs", value: sustainingCostsData?.totalSustainingCosts ?? 0, prefix: "−", color: "text-red-600 dark:text-red-400" },
                    ].map((item) => (
                      <div key={item.label} className="p-4 bg-muted/30 rounded-lg border space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                        <p className={cn("text-base font-bold font-mono", item.color)}>
                          {item.prefix ?? ""}{formatCurrency(item.value)}
                        </p>
                        {item.sub && <p className="text-[10px] text-muted-foreground">{item.sub}</p>}
                      </div>
                    ))}

                    {/* Net Profit highlighted */}
                    <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-1.5">
                      <p className="text-xs font-medium text-primary">Net Profit</p>
                      <p className={cn(
                        "text-base font-bold font-mono",
                        (sustainingCostsData?.netProfit ?? 0) > 0 ? "text-green-600" :
                          (sustainingCostsData?.netProfit ?? 0) < 0 ? "text-red-600" : "text-muted-foreground"
                      )}>
                        {formatCurrency(sustainingCostsData?.netProfit ?? 0)}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">
                          {(sustainingCostsData?.netProfitMargin ?? 0).toFixed(1)}% margin
                        </span>
                        {sustainingCostsData?.status === "profit" && (
                          <Badge className="bg-green-100 hover:bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-[10px] px-1.5 py-0">
                            In Profit
                          </Badge>
                        )}
                        {sustainingCostsData?.status === "breakeven" && (
                          <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] px-1.5 py-0">
                            Break Even
                          </Badge>
                        )}
                        {sustainingCostsData?.status === "loss" && (
                          <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-[10px] px-1.5 py-0">
                            In Loss
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expenses list */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Linked Sustaining Expenses</h3>
                    {(!sustainingCostsData?.expenses || sustainingCostsData.expenses.length === 0) ? (
                      <div className="py-10 text-center border rounded-lg bg-muted/10">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted/40 mb-2">
                          <FileText className="h-4 w-4 text-muted-foreground/60" />
                        </div>
                        <p className="text-sm text-muted-foreground">No sustaining costs linked in this period</p>
                      </div>
                    ) : (
                      <DataTable
                        columns={[
                          { key: "date", header: "Date", render: (e: any) => formatDate(e.date) },
                          { key: "title", header: "Description" },
                          {
                            key: "category", header: "Category",
                            render: (e: any) => <Badge variant="outline">{e.category?.name || "Uncategorized"}</Badge>,
                          },
                          {
                            key: "amount", header: "Amount",
                            render: (e: any) => <span className="font-mono font-medium">{formatCurrency(e.amount)}</span>,
                          },
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

        {/* BUNDLE COMPONENTS TAB */}
        <TabsContent value="bundle-components" className="space-y-4 mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                Bundle Components
              </CardTitle>
              <CardDescription>
                Selling this bundle auto-deducts stock from each component item.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {bundleLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2 space-y-3">
                    <h3 className="text-sm font-semibold">Active Components</h3>
                    {bundleComponents.length === 0 ? (
                      <div className="py-10 text-center border border-dashed rounded-lg bg-muted/10">
                        <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No components yet. Add products using the panel.</p>
                      </div>
                    ) : (
                      <DataTable
                        columns={[
                          {
                            key: "componentName", header: "Component",
                            render: (row: any) => <span className="font-medium">{row.component?.name || "Unknown"}</span>
                          },
                          {
                            key: "type", header: "Type",
                            render: (row: any) => <Badge variant="outline" className="capitalize">{row.component?.type}</Badge>
                          },
                          {
                            key: "quantity", header: "Qty / Bundle",
                            render: (row: any) => <span className="font-mono">{row.quantity}</span>
                          },
                          {
                            key: "stock", header: "Available",
                            render: (row: any) => <span className="font-mono text-muted-foreground">{row.component?.quantity ?? 0}</span>
                          },
                          {
                            key: "actions", header: "",
                            render: (row: any) => (
                              <Button
                                variant="ghost" size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                onClick={() => {
                                  const updated = bundleComponents
                                    .filter(c => c.componentInventoryId !== row.componentInventoryId)
                                    .map(c => ({ componentInventoryId: c.componentInventoryId, quantity: c.quantity }));
                                  updateBundleMutation.mutate(updated);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )
                          },
                        ]}
                        data={bundleComponents}
                      />
                    )}
                  </div>

                  <Card className="bg-muted/10 border-dashed">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Add Component</CardTitle>
                      <CardDescription className="text-xs">Link a product from stock</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Product</Label>
                        <Select onValueChange={(val) => { (window as any).selectedBundleComponentId = val; }}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose product..." />
                          </SelectTrigger>
                          <SelectContent>
                            {storeInventory
                              .filter((item: any) => item.type === "product" && item.id !== inventoryId && !item.isBundle)
                              .map((item: any) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name} ({item.quantity} in stock)
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Qty per Bundle</Label>
                        <Input type="number" min="1" defaultValue="1" id="bundle-qty-input" />
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => {
                          const componentId = (window as any).selectedBundleComponentId;
                          const qtyInput = document.getElementById("bundle-qty-input") as HTMLInputElement;
                          const qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
                          if (!componentId) {
                            toast({ title: "Please select a component product", variant: "destructive" });
                            return;
                          }
                          if (bundleComponents.some((c: any) => c.componentInventoryId === componentId)) {
                            toast({ title: "Already a component of this bundle", variant: "destructive" });
                            return;
                          }
                          updateBundleMutation.mutate([
                            ...bundleComponents.map(c => ({ componentInventoryId: c.componentInventoryId, quantity: c.quantity })),
                            { componentInventoryId: componentId, quantity: qty },
                          ]);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add to Bundle
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* VARIANTS TAB */}
        <TabsContent value="variants" className="space-y-4 mt-0">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4 text-primary" />
                  Product Variants
                </CardTitle>
                <CardDescription>
                  Size, color, and other dimensions grouped under this product.
                </CardDescription>
              </div>
              <Button onClick={() => setLocation(`/inventory/${inventoryId}/variants/new`)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Variant
              </Button>
            </CardHeader>
            <CardContent>
              {variants.length === 0 ? (
                <div className="py-14 text-center border border-dashed rounded-lg bg-muted/10">
                  <Layers className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="font-semibold text-muted-foreground">No variants yet</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    Create size, color, or other options to track stock separately.
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation(`/inventory/${inventoryId}/variants/new`)}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Create First Variant
                  </Button>
                </div>
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "name", header: "Variant",
                      render: (row: any) => <span className="font-medium">{row.name}</span>
                    },
                    {
                      key: "dimensions", header: "Attributes",
                      render: (row: any) => {
                        const dims = row.variantDimensions || {};
                        const entries = Object.entries(dims).filter(([_, val]) => !!val);
                        if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
                        return (
                          <div className="flex gap-1 flex-wrap">
                            {entries.map(([key, value]) => (
                              <Badge key={key} variant="secondary" className="text-[10px] font-semibold px-2 py-0.5 capitalize">
                                <span className="opacity-60 mr-1">{key}:</span>{String(value)}
                              </Badge>
                            ))}
                          </div>
                        );
                      }
                    },
                    {
                      key: "costPrice", header: "Cost",
                      render: (row: any) => <span className="font-mono text-sm">{formatCurrency(row.costPrice)}</span>
                    },
                    {
                      key: "sellingPrice", header: "Price",
                      render: (row: any) => <span className="font-mono text-sm">{formatCurrency(row.sellingPrice)}</span>
                    },
                    {
                      key: "quantity", header: "Stock",
                      render: (row: any) => (
                        <span className={cn("font-mono font-medium", row.quantity === 0 && "text-destructive")}>
                          {row.quantity}
                        </span>
                      )
                    },
                    {
                      key: "action", header: "",
                      render: (row: any) => (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setLocation(`/inventory/${buildSlug(row.name, row.id)}`)}>
                            Details
                          </Button>
                          {row.type === "product" && (
                            <Button variant="outline" size="sm" onClick={() => setLocation(`/inventory/${buildSlug(row.name, row.id)}/restock`)}>
                              Restock
                            </Button>
                          )}
                        </div>
                      )
                    },
                  ]}
                  data={variants}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FIFO EXPIRY BATCHES TAB */}
        <TabsContent value="expiry-batches" className="space-y-4 mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4 text-primary" />
                FIFO Expiry Cohorts
              </CardTitle>
              <CardDescription>
                Track stock by expiry date. Sales deduct from the oldest batch first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {batchesLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2 space-y-3">
                    <h3 className="text-sm font-semibold">Active Batches</h3>
                    {batches.length === 0 ? (
                      <div className="py-10 text-center border rounded-lg bg-muted/10">
                        <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No batches logged yet. Add the first cohort.</p>
                      </div>
                    ) : (
                      <DataTable
                        columns={[
                          {
                            key: "batchNumber", header: "Batch #",
                            render: (row: any) => <span className="font-mono font-medium">{row.batchNumber}</span>
                          },
                          {
                            key: "expiryDate", header: "Expiry Date",
                            render: (row: any) => <span>{new Date(row.expiryDate).toLocaleDateString()}</span>
                          },
                          {
                            key: "quantity", header: "Qty Remaining",
                            render: (row: any) => <span className="font-mono font-bold">{row.quantity}</span>
                          },
                          {
                            key: "status", header: "Status",
                            render: (row: any) => {
                              const now = new Date();
                              const expiry = new Date(row.expiryDate);
                              const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                              if (diffDays <= 0) return <Badge variant="destructive">Expired</Badge>;
                              if (diffDays <= 30) return (
                                <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                  {diffDays}d left
                                </Badge>
                              );
                              return <Badge className="bg-green-100 hover:bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Active</Badge>;
                            }
                          },
                        ]}
                        data={batches}
                      />
                    )}
                  </div>

                  <Card className="bg-muted/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Add Batch</CardTitle>
                      <CardDescription className="text-xs">Log a new expiry cohort</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="batch-number">Batch Number</Label>
                        <Input
                          id="batch-number"
                          placeholder="e.g. BAT-2026-001"
                          value={newBatchData.batchNumber}
                          onChange={(e) => setNewBatchData(prev => ({ ...prev, batchNumber: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="batch-expiry">Expiry Date</Label>
                        <Input
                          id="batch-expiry" type="date"
                          value={newBatchData.expiryDate}
                          onChange={(e) => setNewBatchData(prev => ({ ...prev, expiryDate: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="batch-qty">
                          Starting Quantity{primaryVariant?.unit ? ` (${primaryVariant.unit})` : ""}
                        </Label>
                        <Input
                          id="batch-qty" type="number"
                          min={primaryVariant?.allowFractional ? "0.01" : "1"}
                          step={primaryVariant?.allowFractional ? "0.01" : "1"}
                          value={newBatchData.quantity}
                          onChange={(e) => setNewBatchData(prev => ({
                            ...prev,
                            quantity: primaryVariant?.allowFractional
                              ? parseFloat(e.target.value) || 0
                              : parseInt(e.target.value) || 1,
                          }))}
                        />
                      </div>
                      <Button
                        className="w-full"
                        disabled={createBatchMutation.isPending || !newBatchData.batchNumber || !newBatchData.expiryDate}
                        onClick={() => createBatchMutation.mutate({
                          batchNumber: newBatchData.batchNumber,
                          expiryDate: newBatchData.expiryDate,
                          quantity: newBatchData.quantity,
                        })}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Log Batch
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
