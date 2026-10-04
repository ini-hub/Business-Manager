import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import type { Product, Settings, Inventory } from "@shared/schema";

type ProductWithVariants = Product & { variants?: Inventory[]; stockStatus?: string; margin?: number; storeName?: string; costPrice?: number; sellingPrice?: number; quantity?: number; sku?: string; barcode?: string; unit?: string; reorderPoint?: number; hasSales?: boolean };
import { Plus, Edit, Trash2, Package, Wrench, Droplets, Coins, Hash, Boxes, AlertTriangle, AlertCircle, ShoppingCart, RefreshCw, Infinity, BarChart3, ClipboardList, CheckCircle2, FileText, X, ArchiveX, Archive, RotateCcw, Settings2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/metric-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { DataTable, type RowAction, type BulkAction, type BulkActionSelection } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkOperations } from "@/components/bulk-operations";
import { INVENTORY_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { InventoryExportDialog } from "@/components/inventory-export-dialog";
import {
  buildInventoryExportRows,
  DEFAULT_EXPORT_COLUMN_KEYS,
  INVENTORY_EXPORT_COLUMNS,
} from "@/lib/inventory-export";
import { exportReportToPDF, type ReportStatusTone } from "@/lib/export-utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMultiStoreQuery } from "@/hooks/useMultiStoreQuery";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation, useSearch } from "wouter";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact, getCurrencyByCode } from "@/lib/currency-utils";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { InventoryFiltersSheet, InventorySortSheet } from "@/components/inventory-filter-sheets";
import {
  EMPTY_INVENTORY_FILTERS,
  buildInventoryFilterChips,
  clearInventoryFilterChip,
  countActiveInventoryFilters,
  filtersFromLegacyView,
  inventoryMatchesFilters,
  inventoryMatchesSearch,
  inventorySortLabel,
  LOW_STOCK_FILTERS,
  sortInventory,
  urgentFirst,
  type InventoryFilterState,
  type InventorySortState,
} from "@/lib/inventory-filters";
import { buildSlug } from "@/lib/slug";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import {
  calculateProjectedGrossMargin,
  formatProjectedGrossMargin,
  isOutOfStock,
  isAtOrBelowReorderPoint,
  formatStockAlertCopy,
} from "@/lib/inventory-metrics";

// Type and low-stock used to be tabs; they are filters now. Old ?view= values still resolve (see filtersFromLegacyView).
type FilterType = "items" | "archived" | "drafts";
type Vendor = { id: string; name: string; phoneNumber?: string; email?: string; companyName?: string };

// Adjust stock / Update prices / Create PO all need to resolve one clear inventory
// (variant) row per selected product — multi-variant products are excluded from
// those 3 bulk actions rather than guessing which variant the action means.
function bulkEligibleVariant(item: ProductWithVariants): Inventory | undefined {
  return item.variants?.length === 1 ? item.variants[0] : undefined;
}

type BulkPriceMode = "set" | "increase-pct" | "decrease-pct" | "increase-amount" | "decrease-amount";

function computeBulkNewPrice(currentPrice: number, mode: BulkPriceMode, value: number): number {
  switch (mode) {
    case "set": return value;
    case "increase-pct": return currentPrice * (1 + value / 100);
    case "decrease-pct": return currentPrice * (1 - value / 100);
    case "increase-amount": return currentPrice + value;
    case "decrease-amount": return currentPrice - value;
  }
}

/** Icon and badge colour per inventory type, so the three stay consistent across
 *  the active list, the archived list and the item name cell. */
function itemTypeIcon(type: string) {
  if (type === "service") return <Wrench className="h-4 w-4 text-muted-foreground" />;
  if (type === "supply") return <Droplets className="h-4 w-4 text-muted-foreground" />;
  return <Package className="h-4 w-4 text-muted-foreground" />;
}

function itemTypeBadgeClass(type: string) {
  if (type === "service") return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30";
  if (type === "supply") return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30";
  return "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30";
}

export default function InventoryPage() {
  const { toast } = useToast();
  const { currentStore, business } = useStore();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteBlockedBySales, setDeleteBlockedBySales] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ProductWithVariants | null>(null);
  const [viewParam, setViewParam] = useUrlState<string>("view", "items");
  const filterType: FilterType = viewParam === "archived" || viewParam === "drafts" ? viewParam : "items";
  const setFilterType = (v: FilterType) => setViewParam(v);
  // Audits left this page; old ?view=audits bookmarks land on the standalone page.
  useEffect(() => {
    if (viewParam === "audits") setLocation("/inventory/audits", { replace: true });
  }, [viewParam, setLocation]);
  // Seeded once from a legacy deep link such as /inventory?view=low-stock.
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilterState>(() => filtersFromLegacyView(viewParam));
  const [inventorySearchTerm, setInventorySearchTerm] = useState("");
  const [inventorySort, setInventorySort] = useState<InventorySortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
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

  // Bulk action dialogs (Adjust stock / Change category / Update prices / Create PO) —
  // each snapshots the selection it was opened with, since the live selection clears
  // as soon as the dialog's mutation succeeds.
  const [bulkSelection, setBulkSelection] = useState<BulkActionSelection<ProductWithVariants> | null>(null);
  const [isBulkAdjustOpen, setIsBulkAdjustOpen] = useState(false);
  const [bulkAdjustQty, setBulkAdjustQty] = useState<number>(1);
  const [isBulkCategoryOpen, setIsBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
  const [bulkPriceMode, setBulkPriceMode] = useState<"set" | "increase-pct" | "decrease-pct" | "increase-amount" | "decrease-amount">("set");
  const [bulkPriceValue, setBulkPriceValue] = useState<number>(0);
  const [isBulkPOOpen, setIsBulkPOOpen] = useState(false);
  const [bulkPOVendorId, setBulkPOVendorId] = useState("");
  const [bulkPOQuantities, setBulkPOQuantities] = useState<Record<string, number>>({});

  // This is the stock management screen, so it opts into supplies — /api/products
  // hides them by default to keep them out of the POS and other sale surfaces.
  const { data: inventoryList = [], isLoading } = useMultiStoreQuery<ProductWithVariants>(
    "/api/products",
    { merge: "dedup-by-id", staleTime: STALE_TIMES.reference, params: { include: "supplies" } }
  );

  const { data: archivedList = [], isLoading: isLoadingArchived } = useMultiStoreQuery<ProductWithVariants>(
    "/api/products/archived",
    { enabled: filterType === "archived" || isExportDialogOpen, staleTime: STALE_TIMES.reference }
  );

  // Saved "New item" wizard sessions. Per-store (the endpoint takes one storeId), and
  // fetched eagerly so the tab can show a count.
  const draftsStoreId = currentStore?.id && currentStore.id !== "all" ? currentStore.id : null;
  const { data: draftsList = [], isLoading: isLoadingDrafts } = useQuery<any[]>({
    queryKey: ["/api/inventory-drafts", draftsStoreId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-drafts?storeId=${draftsStoreId}`);
      if (!res.ok) throw new Error("Failed to load drafts");
      return res.json();
    },
    enabled: !!draftsStoreId,
  });
  const discardDraft = async (id: string) => {
    const res = await apiRequest("DELETE", `/api/inventory-drafts/${id}`);
    if (!res.ok) {
      toast({ title: "Couldn't discard draft", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["/api/inventory-drafts"] });
    toast({ title: "Draft discarded" });
  };

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && currentStore.id !== "all",
    staleTime: STALE_TIMES.reference,
  });

  // Only fetched for the "Create purchase order" bulk action's vendor picker —
  // a PO belongs to exactly one store, so that action is hidden in the "all
  // stores" view rather than trying to resolve a cross-store vendor list.
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore.id !== "all",
    staleTime: STALE_TIMES.reference,
  });

  const lowStockThreshold = settingsData?.lowStockThreshold ?? 5;

  // The list the exports and totals work from; the Filters sheet narrows only what the table shows.
  const filteredInventory = inventoryList;

  const outOfStockCount = useMemo(() => {
    return inventoryList.filter(
      (item) => item.type !== "service" && item.variants?.some((v: any) => isOutOfStock(v))
    ).length;
  }, [inventoryList]);

  const lowStockOnlyCount = useMemo(() => {
    return inventoryList.filter(
      (item) => item.type !== "service" && item.variants?.some((v: any) => isAtOrBelowReorderPoint(v, lowStockThreshold) && !isOutOfStock(v))
    ).length;
  }, [inventoryList, lowStockThreshold]);

  const lowStockCount = outOfStockCount + lowStockOnlyCount;

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/inventory/${selectedItem?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item deleted successfully" });
      setIsDeleteOpen(false);
      setDeleteBlockedBySales(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      const msg = error.message ?? "";
      if (msg.includes("sales records") || msg.includes("existing sales") || msg.includes("history")) {
        setDeleteBlockedBySales(true);
      } else {
        toast({
          title: "Couldn't Delete Item",
          description: getUserFriendlyError(error, "deleting this item"),
          variant: "destructive",
        });
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/inventory/${selectedItem?.id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item archived", description: `"${selectedItem?.name}" has been archived and is no longer active.` });
      setIsDeleteOpen(false);
      setDeleteBlockedBySales(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Archive Item",
        description: getUserFriendlyError(error, "archiving this item"),
        variant: "destructive",
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (itemId: string) => apiRequest("POST", `/api/products/${itemId}/restore`),
    onSuccess: (_, itemId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item restored", description: "The item is now active in your inventory." });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Restore Item",
        description: getUserFriendlyError(error, "restoring this item"),
        variant: "destructive",
      });
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        await apiRequest("POST", `/api/inventory/${id}/archive`, undefined, { "X-Batch-Id": batchId });
        return "archived" as const;
      }),
    // No toast here — BulkActionsBar (see the inventoryBulkActions definitions below)
    // reports the outcome itself from the BulkActionResult this mutation returns, since
    // it's invoked via mutateAsync from a BulkAction.onExecute. A toast here too would
    // double up.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("DELETE", `/api/inventory/${id}`, undefined, { "X-Batch-Id": batchId });
        if (res.ok) return "deleted" as const;
        const body = await res.json().catch(() => ({}));
        const msg: string = body?.error ?? "";
        if (res.status === 400 && (msg.includes("sales") || msg.includes("history"))) {
          // Has sales history — archive instead
          const archiveRes = await apiRequest("POST", `/api/inventory/${id}/archive`, undefined, { "X-Batch-Id": batchId });
          if (archiveRes.ok) return "archived" as const;
        }
        throw new Error(msg || "delete failed");
      }),
    // Same as bulkArchiveMutation: no toast here, BulkActionsBar reports the outcome.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  // The 4 bulk actions below are opened via BulkAction.onOpen (a dialog collects input
  // first), not run immediately like Archive/Delete — so unlike bulkArchive/bulkDelete
  // above, each of these owns its own toast/invalidate/selection-clear instead of
  // letting BulkActionsBar report the outcome.
  const bulkAdjustStockMutation = useMutation({
    mutationFn: (items: ProductWithVariants[]) =>
      runBulkFanOut(items, async (item, batchId) => {
        const variant = bulkEligibleVariant(item);
        if (!variant) throw new Error("not eligible");
        await apiRequest("POST", `/api/inventory/${variant.id}/restock`, {
          quantityAdded: bulkAdjustQty,
          unitCost: variant.costPrice ?? 0,
          costStrategy: "keep",
          reason: "Adjustment",
        }, { "X-Batch-Id": batchId });
        return "adjusted" as const;
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      const succeeded = result.counts.adjusted ?? 0;
      const failed = result.counts.failed ?? 0;
      toast({
        title: failed > 0 ? `${succeeded} updated, ${failed} failed` : `${succeeded} item${succeeded === 1 ? "" : "s"} restocked`,
        variant: failed > 0 ? "destructive" : undefined,
      });
      setIsBulkAdjustOpen(false);
      setSelectedIds([]);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't adjust stock", description: getUserFriendlyError(error, "adjusting stock"), variant: "destructive" });
    },
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: (items: ProductWithVariants[]) =>
      runBulkFanOut(items, async (item, batchId) => {
        await apiRequest("PATCH", `/api/inventory/${item.id}`, { category: bulkCategoryValue || null }, { "X-Batch-Id": batchId });
        return "updated" as const;
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      const succeeded = result.counts.updated ?? 0;
      const failed = result.counts.failed ?? 0;
      toast({
        title: failed > 0 ? `${succeeded} updated, ${failed} failed` : `${succeeded} item${succeeded === 1 ? "" : "s"} updated`,
        variant: failed > 0 ? "destructive" : undefined,
      });
      setIsBulkCategoryOpen(false);
      setSelectedIds([]);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't update category", description: getUserFriendlyError(error, "updating category"), variant: "destructive" });
    },
  });

  const bulkPriceMutation = useMutation({
    mutationFn: (items: ProductWithVariants[]) =>
      runBulkFanOut(items, async (item, batchId) => {
        const variant = bulkEligibleVariant(item);
        if (!variant) throw new Error("not eligible");
        const newPrice = Math.round(computeBulkNewPrice(variant.sellingPrice ?? 0, bulkPriceMode, bulkPriceValue) * 100) / 100;
        await apiRequest("PATCH", `/api/inventory/${variant.id}`, { sellingPrice: newPrice }, { "X-Batch-Id": batchId });
        return "updated" as const;
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      const succeeded = result.counts.updated ?? 0;
      const failed = result.counts.failed ?? 0;
      toast({
        title: failed > 0 ? `${succeeded} updated, ${failed} failed` : `${succeeded} price${succeeded === 1 ? "" : "s"} updated`,
        variant: failed > 0 ? "destructive" : undefined,
      });
      setIsBulkPriceOpen(false);
      setSelectedIds([]);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't update prices", description: getUserFriendlyError(error, "updating prices"), variant: "destructive" });
    },
  });

  const bulkCreatePOMutation = useMutation({
    mutationFn: async (items: ProductWithVariants[]) => {
      const lineItems = items.map((item) => {
        const variant = bulkEligibleVariant(item)!;
        return {
          inventoryId: variant.id,
          quantity: bulkPOQuantities[item.id] ?? 1,
          unitCost: variant.costPrice ?? 0,
        };
      });
      const res = await apiRequest("POST", "/api/purchase-orders", {
        storeId: currentStore!.id,
        vendorId: bulkPOVendorId,
        items: lineItems,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create purchase order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Purchase order created" });
      setIsBulkPOOpen(false);
      setSelectedIds([]);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't create purchase order", description: getUserFriendlyError(error, "creating the purchase order"), variant: "destructive" });
    },
  });

  const restockMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) return;

      return apiRequest("POST", `/api/inventory/${selectedItem.id}/restock`, {
        quantityAdded: restockData.quantity,
        unitCost: restockData.unitCost || selectedItem.costPrice,
        costStrategy: restockData.costStrategy,
        newSellingPrice: restockData.updateSellingPrice ? restockData.newSellingPrice : undefined,
        notes: restockData.notes || undefined,
        reason: restockData.reason,
        receiptUrl: restockData.receiptUrl || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Stock updated successfully" });
      setIsRestockOpen(false);
      setSelectedItem(null);
      setRestockData({ 
        quantity: 1, 
        unitCost: 0, 
        costStrategy: "keep", 
        newSellingPrice: undefined,
        updateSellingPrice: false,
        notes: "",
        reason: "Restock",
        receiptUrl: "",
      });
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
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  const openCreateForm = () => {
    setLocation("/inventory/new");
  };

  const totalCostValue = filteredInventory.reduce((acc, item) => {
    if (item.type === "service") return acc;
    const cost = item.variants?.reduce((sum: number, v: any) => sum + (v.costPrice * v.quantity), 0) ?? 0;
    return acc + cost;
  }, 0);
  const totalRetailValue = filteredInventory.reduce((acc, item) => {
    if (item.type === "service") return acc;
    const retail = item.variants?.reduce((sum: number, v: any) => sum + (v.sellingPrice * v.quantity), 0) ?? 0;
    return acc + retail;
  }, 0);
  const projectedGrossMargin = calculateProjectedGrossMargin(totalCostValue, totalRetailValue);
  const projectedGrossMarginDisplay = formatProjectedGrossMargin(totalCostValue, totalRetailValue);

  const stockStatusTone = (status: string): ReportStatusTone => {
    if (status === "Out of Stock") return "critical";
    if (status === "Low Stock") return "warning";
    if (status === "In Stock") return "success";
    return "neutral";
  };

  // One row per item, aggregated across variants the same way the on-screen columns/getStockBadge
  // do — grouped by category so the PDF report can insert a subtotal after each category.
  // Pulled out as a plain function (not a hook) so it can be reused for both the full,
  // tab-scoped list and whatever subset is currently visible after search/filtering.
  const buildInventoryReportRows = (products: any[]) => {
    const rows = products.map((item: any) => {
      const isService = item.type === "service";
      const variants = item.variants ?? [];
      const totalQty = isService ? 0 : variants.reduce((s: number, v: any) => s + v.quantity, 0);
      const costs = variants.map((v: any) => v.costPrice);
      const prices = variants.map((v: any) => v.sellingPrice);
      const minCost = costs.length ? Math.min(...costs) : 0;
      const maxCost = costs.length ? Math.max(...costs) : 0;
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : 0;
      const stockValueRetail = isService ? 0 : variants.reduce((s: number, v: any) => s + v.sellingPrice * v.quantity, 0);
      const itemThreshold = variants[0]?.reorderPoint ?? item.reorderPoint;
      const threshold = itemThreshold != null ? itemThreshold : lowStockThreshold;
      const stockStatus = isService
        ? "Service"
        : totalQty === 0
        ? "Out of Stock"
        : totalQty <= threshold
        ? "Low Stock"
        : "In Stock";

      return {
        name: item.name as string,
        category: (item.category as string) || "Uncategorized",
        type: isService ? "Service" : "Product",
        costLabel: costs.length === 0 ? "—" : minCost === maxCost ? formatCurrency(minCost) : `${formatCurrency(minCost)}–${formatCurrency(maxCost)}`,
        priceLabel: prices.length === 0 ? "—" : minPrice === maxPrice ? formatCurrency(minPrice) : `${formatCurrency(minPrice)}–${formatCurrency(maxPrice)}`,
        quantityLabel: isService ? "—" : String(totalQty),
        stockStatus,
        stockValueRetail,
      };
    });
    return rows.sort((a, b) => a.category.localeCompare(b.category));
  };

  const inventoryReportRows = useMemo(
    () => buildInventoryReportRows(filteredInventory),
    [filteredInventory, lowStockThreshold, formatCurrency]
  );

  // Tracks the on-screen list's live search/filter result set (main tab only) so "Export
  // current view" can offer exactly what's currently shown, separate from the full export.
  const [visibleProducts, setVisibleProducts] = useState<ProductWithVariants[]>([]);
  const visibleInventoryReportRows = useMemo(
    () => buildInventoryReportRows(visibleProducts),
    [visibleProducts, lowStockThreshold, formatCurrency]
  );

  type InventoryReportRow = (typeof inventoryReportRows)[number];

  const inventoryPdfColumns: { key: string; header: string; align?: "left" | "right"; format?: (row: InventoryReportRow) => string }[] = [
    { key: "name", header: "Item" },
    { key: "category", header: "Category" },
    { key: "type", header: "Type" },
    { key: "costLabel", header: "Cost" },
    { key: "priceLabel", header: "Price" },
    { key: "quantityLabel", header: "Stock", align: "right" },
    { key: "stockStatus", header: "Status" },
    { key: "stockValueRetail", header: "Value", align: "right", format: (row) => formatCurrency(row.stockValueRetail) },
  ];

  const handleInventoryReportExport = (filtered = false) => {
    const rows = filtered ? visibleInventoryReportRows : inventoryReportRows;
    return exportReportToPDF({
      filename: `inventory-report_${(currentStore?.name ?? "store").replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}`,
      title: "Inventory Report",
      businessName: business?.name ?? currentStore?.name ?? "Business",
      storeName: currentStore?.name ?? "All Stores",
      kpis: [
        { label: "Cost Value", value: formatCurrency(totalCostValue) },
        { label: "Retail Value", value: formatCurrency(totalRetailValue) },
        { label: "Gross Margin", value: projectedGrossMarginDisplay },
        {
          label: "Low Stock Items",
          value: String(lowStockCount),
          sub: lowStockCount > 0 ? "Needs restock" : undefined,
          subTone: lowStockCount > 0 ? ("warning" as const) : undefined,
        },
      ],
      columns: inventoryPdfColumns,
      rows,
      amountKey: "stockValueRetail",
      formatAmount: formatCurrency,
      unitLabel: "items",
      groupBy: (row) => row.category,
      statusKey: "stockStatus",
      getStatus: (row) => ({ label: row.stockStatus, tone: stockStatusTone(row.stockStatus) }),
      orientation: "landscape",
    });
  };

  const openEditForm = (item: any) => setLocation(`/inventory/${buildSlug(item.name, item.id)}/edit`);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && inventoryList.length > 0) {
      const item = inventoryList.find((i) => i.id === editId);
      if (item) {
        openEditForm(item);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [inventoryList]);

  const navigateToDetails = (item: ProductWithVariants) => {
    setLocation(appendReturnTo(`/inventory/${buildSlug(item.name, item.id)}`, location, search));
  };

  const getStockBadge = (item: any) => {
    if (item.type === "service") {
      return <Badge variant="secondary">Service</Badge>;
    }
    const totalQty = item.type === "service" ? 0 : (item.variants?.reduce((sum: number, v: any) => sum + v.quantity, 0) ?? 0);
    // Use per-item reorderPoint when available, else global threshold
    const itemThreshold = item.variants?.[0]?.reorderPoint ?? item.reorderPoint;
    const threshold = itemThreshold != null ? itemThreshold : lowStockThreshold;
    if (totalQty === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    }
    if (totalQty <= threshold) {
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">Low Stock</Badge>;
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">In Stock</Badge>;
  };

  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (item: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {item.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "name",
      header: "Item Name",
      priority: 1 as const,
      cardRender: (item: any) => <span className="truncate">{item.name}</span>,
      render: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
            {itemTypeIcon(item.type)}
          </div>
          <div className="flex flex-col">
            <span className="font-medium">{item.name}</span>
            {item.type === "product" && item.variants && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {item.variants.length} variant{item.variants.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      priority: 2 as const,
      render: (item: any) => (
        <Badge variant="outline" className={`capitalize ${itemTypeBadgeClass(item.type)}`}>
          {item.type}
        </Badge>
      ),
    },
    {
      key: "costPrice",
      header: "Cost",
      render: (item: any) => {
        if (!item.variants || item.variants.length === 0) return <span className="font-mono text-sm">—</span>;
        const costs = item.variants.map((v: any) => v.costPrice);
        const min = Math.min(...costs);
        const max = Math.max(...costs);
        return (
          <span className="font-mono text-sm">
            {min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`}
          </span>
        );
      },
    },
    {
      key: "sellingPrice",
      header: "Selling Price",
      priority: 1 as const,
      render: (item: any) => {
        if (!item.variants || item.variants.length === 0) return <span className="font-mono text-sm">—</span>;
        const prices = item.variants.map((v: any) => v.sellingPrice);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return (
          <span className="font-mono text-sm font-medium font-outfit">
            {min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`}
          </span>
        );
      },
    },
    {
      key: "quantity",
      header: "Stock",
      priority: 2 as const,
      render: (item: any) => {
        if (item.type === "service") {
          return (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Infinity className="h-3 w-3" /> N/A
              </span>
              {getStockBadge(item)}
            </div>
          );
        }
        const totalStock = item.variants?.reduce((sum: number, v: any) => sum + v.quantity, 0) ?? 0;
        const unit = item.unit || item.variants?.[0]?.unit;
        // allowFractional is enforced at every input across the app (new-sale, quotes,
        // restock, audits, purchase orders — see client/src/lib/quantity-utils.ts), but
        // this summed display never checked it, so a countable item could still *show*
        // a fractional total (e.g. from a historical data issue or float drift summing
        // multiple variants) even though nothing lets you type one in today.
        const allowsFractional = item.variants?.every((v: any) => v.allowFractional) ?? false;
        const displayQty = allowsFractional ? parseFloat(Number(totalStock).toFixed(2)) : Math.round(totalStock);
        return (
          <div className="flex items-center gap-2">
            <Boxes className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono">{displayQty}{unit ? ` ${unit}` : ""}</span>
            {getStockBadge(item)}
          </div>
        );
      },
    },
    {
      key: "margin",
      header: "Margin",
      render: (item: any) => {
        if (!item.variants || item.variants.length === 0) return <span className="font-mono text-sm">—</span>;
        const margins = item.variants.map((v: any) => {
          const marginVal = v.sellingPrice - v.costPrice;
          const marginPct = v.sellingPrice > 0 ? (marginVal / v.sellingPrice) * 100 : 0;
          return { val: marginVal, pct: marginPct };
        });
        const minVal = Math.min(...margins.map((m: any) => m.val));
        const maxVal = Math.max(...margins.map((m: any) => m.val));
        const minPct = Math.min(...margins.map((m: any) => m.pct));
        const maxPct = Math.max(...margins.map((m: any) => m.pct));
        return (
          <div className="flex flex-col">
            <span className="font-mono text-sm font-medium">
              {minVal === maxVal ? formatCurrency(minVal) : `${formatCurrency(minVal)} - ${formatCurrency(maxVal)}`}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {minPct === maxPct ? `${minPct.toFixed(1)}%` : `${minPct.toFixed(1)}% - ${maxPct.toFixed(1)}%`}
            </span>
          </div>
        );
      },
    },
  ];

  const inventoryRowActions = (item: any): RowAction[] => {
    const actions: RowAction[] = [];
    if (item.type === "product" && item.variants && item.variants.length === 1) {
      actions.push({
        label: "Restock",
        icon: <RefreshCw className="h-4 w-4" />,
        onClick: () => setLocation(`/inventory/${buildSlug(item.name, item.variants[0].id)}/restock`),
        testId: `button-restock-${item.id}`,
      });
    }
    actions.push({
      label: "Edit",
      icon: <Edit className="h-4 w-4" />,
      onClick: () => openEditForm(item),
      testId: `button-edit-${item.id}`,
    });
    actions.push({
      label: item.hasSales ? "Archive item" : "Delete item",
      icon: item.hasSales
        ? <Archive className="h-4 w-4 text-amber-500" />
        : <Trash2 className="h-4 w-4" />,
      onClick: () => {
        setSelectedItem(item);
        setDeleteBlockedBySales(!!item.hasSales);
        setIsDeleteOpen(true);
      },
      destructive: !item.hasSales,
      testId: `button-delete-${item.id}`,
    });
    return actions;
  };

  const isMultiStoreView = currentStore?.id === "all";

  const quickExportColumns = INVENTORY_EXPORT_COLUMNS.filter(
    (col) => DEFAULT_EXPORT_COLUMN_KEYS.has(col.key) && !col.variantOnly && (!col.multiStoreOnly || isMultiStoreView)
  ).map((col) => ({ key: col.key, header: col.header }));

  const quickExportData = buildInventoryExportRows(filteredInventory, null, {
    granularity: "item",
    lowStockThreshold,
    formatCurrency,
    isMultiStoreView,
  });
  // Same shape as quickExportData, sourced from whatever's currently visible after search.
  const visibleQuickExportData = buildInventoryExportRows(visibleProducts, null, {
    granularity: "item",
    lowStockThreshold,
    formatCurrency,
    isMultiStoreView,
  });

  const itemsNarrowed = countActiveInventoryFilters(inventoryFilters) > 0 || inventorySearchTerm.trim() !== "";
  const currentViewProducts = filterType === "archived" ? archivedList : itemsNarrowed ? visibleProducts : filteredInventory;
  const currentViewLabel =
    filterType === "archived" ? "Archived"
    : inventoryFilters.stock.length > 0 && inventoryFilters.types.length === 0 ? "Low Stock"
    : inventoryFilters.types.length === 1 ? { product: "Products", service: "Services", supply: "Supplies" }[inventoryFilters.types[0]]
    : "All";

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage your products and services" />
        <StoreRequiredAlert title="Store Required for Inventory" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Inventory"
        description={`Managing inventory for ${currentStore.name}`}
        compact
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLocation("/inventory/audits")} aria-label="Stock Audit" data-testid="button-stock-audit">
              <ClipboardList className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Stock Audit</span>
            </Button>
            {(() => {
              const bulkOpsProps = {
                entityConfig: INVENTORY_BULK_CONFIG,
                data: quickExportData as unknown as Record<string, unknown>[],
                columns: quickExportColumns,
                isLoading,
                storeId: currentStore.id,
                pdfTitle: "Inventory Report",
                onExportPDF: () => handleInventoryReportExport(),
                onExportFilteredPDF: () => handleInventoryReportExport(true),
                visibleData: visibleQuickExportData as unknown as Record<string, unknown>[],
                showImportOption: user?.role !== "staff",
                extraExportActions: (
                  <DropdownMenuItem
                    onClick={() => setIsExportDialogOpen(true)}
                    data-testid="button-customize-export"
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Customize Export…
                  </DropdownMenuItem>
                ),
              };
              return (
                <>
                  <div className="lg:hidden">
                    <BulkOperations {...bulkOpsProps} compact />
                  </div>
                  <div className="hidden lg:block">
                    <BulkOperations {...bulkOpsProps} />
                  </div>
                </>
              );
            })()}
            <InventoryExportDialog
              open={isExportDialogOpen}
              onOpenChange={setIsExportDialogOpen}
              activeProducts={inventoryList}
              currentViewProducts={currentViewProducts}
              archivedProducts={archivedList}
              isLoadingArchived={isLoadingArchived}
              selectedIds={selectedIds}
              currentViewLabel={currentViewLabel}
              isMultiStoreView={isMultiStoreView}
              lowStockThreshold={lowStockThreshold}
              formatCurrency={formatCurrency}
              storeLabel={currentStore.name}
              businessName={business?.name ?? currentStore.name}
            />
            <Button onClick={openCreateForm} aria-label="Add Item" data-testid="button-add-item">
              <Plus className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Add Item</span>
            </Button>
          </div>
        }
      />

      <MetricRow
        metrics={[
          { title: "Total Cost Value", value: formatCurrency(totalCostValue), compactValue: formatCompact(totalCostValue), icon: <Package className="h-4 w-4" />, description: "Total value of products in stock", isLoading },
          { title: "Total Retail Value", value: formatCurrency(totalRetailValue), compactValue: formatCompact(totalRetailValue), icon: <Coins className="h-4 w-4" />, description: "Expected revenue if all sold", isLoading },
          { title: "Projected Gross Margin", value: projectedGrossMarginDisplay, icon: <BarChart3 className="h-4 w-4" />, description: "Based on current stock value", isLoading },
          {
            title: "Low Stock Items",
            value: String(lowStockCount),
            icon: <AlertTriangle className="h-4 w-4" />,
            description: lowStockCount > 0
              ? (outOfStockCount > 0 ? `${outOfStockCount} out of stock, ${lowStockOnlyCount} low` : formatStockAlertCopy(outOfStockCount, lowStockOnlyCount))
              : "All items above reorder level",
            tone: lowStockCount > 0 ? "amber" : "default",
            onClick: lowStockCount > 0 ? () => { setFilterType("items"); setInventoryFilters(LOW_STOCK_FILTERS); } : undefined,
            isLoading,
          },
        ]}
      />

      <Tabs value={filterType} onValueChange={(v) => { setFilterType(v as FilterType); setSelectedIds([]); }} className="w-full">
        <PolymorphicTabsList
          variant="bordered"
          tabs={[
            { value: "items", label: `Items ${inventoryList.length}`, testId: "tab-items" },
            {
              value: "drafts",
              label: `Drafts${draftsList.length > 0 ? ` ${draftsList.length}` : ""}`,
              icon: <FileText className="mr-1 h-3 w-3" />,
              testId: "tab-drafts",
              className: draftsList.length > 0 ? "text-primary" : "",
            },
            {
              value: "archived",
              label: `Archived${archivedList.length > 0 ? ` ${archivedList.length}` : ""}`,
              icon: <Archive className="mr-1 h-3 w-3" />,
              testId: "tab-archived",
              className: archivedList.length > 0 ? "text-muted-foreground" : "",
            },
          ]}
        />
      </Tabs>

      {filterType === "drafts" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/40 rounded-lg border border-dashed">
            <FileText className="h-4 w-4 shrink-0" />
            <span>Drafts are items you started but haven't added yet. They are not in stock and can't be sold until you finish them.</span>
          </div>
          {!draftsStoreId ? (
            <div className="py-12 text-center text-muted-foreground">Select a single store to see its drafts.</div>
          ) : isLoadingDrafts ? (
            <div className="py-12 text-center text-muted-foreground">Loading drafts…</div>
          ) : draftsList.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No drafts. Use “Save draft” while adding an item.</div>
          ) : (
            <div className="rounded-lg border divide-y">
              {draftsList.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.name || "Untitled item"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {d.type || "type not chosen"} · saved {new Date(d.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={() => setLocation(`/inventory/new?draft=${d.id}`)}>Continue</Button>
                    <Button size="sm" variant="ghost" onClick={() => discardDraft(d.id)}>Discard</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : filterType === "archived" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/40 rounded-lg border border-dashed">
            <Archive className="h-4 w-4 shrink-0" />
            <span>Archived items are hidden from active inventory and cannot be sold. Restore them to make them active again.</span>
          </div>
          {isLoadingArchived ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">Loading archived items…</div>
          ) : archivedList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Archive className="h-10 w-10 opacity-30" />
              <p className="text-sm">No archived items</p>
            </div>
          ) : (
            <DataTable
              data={archivedList}
              columns={[
                ...(currentStore?.id === "all" ? [{
                  key: "storeName",
                  header: "Store",
                  render: (item: any) => (
                    <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
                      {item.storeName || "Global"}
                    </Badge>
                  ),
                }] : []),
                {
                  key: "name",
                  header: "Item Name",
                  render: (item: any) => (
                    <div className="flex items-center gap-3 opacity-60">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                        {itemTypeIcon(item.type)}
                      </div>
                      <span className="font-medium line-through text-muted-foreground">{item.name}</span>
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "Type",
                  render: (item: any) => (
                    <Badge variant="outline" className={`capitalize ${itemTypeBadgeClass(item.type)}`}>
                      {item.type}
                    </Badge>
                  ),
                },
                {
                  key: "archivedAt",
                  header: "Archived",
                  render: (item: any) => (
                    <span className="text-sm text-muted-foreground">
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </span>
                  ),
                },
                {
                  key: "restore",
                  header: "",
                  render: (item: any) => (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                      disabled={restoreMutation.isPending}
                      onClick={() => restoreMutation.mutate(item.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </Button>
                  ),
                },
              ]}
              searchable
              searchPlaceholder="Search archived items…"
              urlKey="archived"
            />
          )}
        </div>
      ) : (
        (() => {
          let tableData = filteredInventory.map((item) => {
            const totalStock = item.type === "service" ? 0 : (item.variants?.reduce((sum: number, v: any) => sum + v.quantity, 0) ?? 0);
            const stockStatus = item.type === "service"
              ? "In Stock"
              : (totalStock === 0 ? "Out of Stock" : (item.variants?.some((v: any) => isAtOrBelowReorderPoint(v, lowStockThreshold)) ? "Low Stock" : "In Stock"));

            const marginPct = item.variants && item.variants.length > 0
              ? item.variants.reduce((acc: number, v: any) => {
                  const mVal = v.sellingPrice - v.costPrice;
                  const mPct = v.sellingPrice > 0 ? (mVal / v.sellingPrice) * 100 : 0;
                  return acc + mPct;
                }, 0) / item.variants.length
              : 0;

            return {
              ...item,
              totalStock,
              stockStatus,
              // Lowest variant price, so a single Price filter works for multi-variant items.
              price: item.variants && item.variants.length > 0 ? Math.min(...item.variants.map((v: any) => Number(v.sellingPrice) || 0)) : 0,
              margin: Math.round(marginPct)
            };
          });

          const symbol = currencyInfo?.symbol ?? "₦";
          const searchedItems = tableData.filter((i) => inventoryMatchesSearch(i, inventorySearchTerm));
          let visibleItems = sortInventory(searchedItems.filter((i) => inventoryMatchesFilters(i, inventoryFilters)), inventorySort);
          // Looking at low or out of stock with no sort chosen: the most urgent items lead the list.
          if (!inventorySort && inventoryFilters.stock.some((st) => st === "low" || st === "out")) {
            visibleItems = [...visibleItems].sort(urgentFirst);
          }
          const categoryOptions = Array.from(new Set(tableData.map((i) => i.category || "Uncategorized"))).sort();

          const inventoryBulkActions: BulkAction<ProductWithVariants>[] = [
            {
              id: "archive",
              label: "Archive",
              icon: <Archive className="h-3.5 w-3.5" />,
              kind: "reversible",
              onExecute: async (selection) => {
                const ids = selection.ids as string[];
                const { counts } = await bulkArchiveMutation.mutateAsync(ids);
                return { succeeded: counts.archived ?? 0, failed: counts.failed ?? 0 };
              },
              onUndo: async () => {
                // The archive mutation already invalidated queries with the new state;
                // restore each item that was actually archived by this action.
                const ids = selectedIds as string[];
                await Promise.allSettled(ids.map((id) => restoreMutation.mutateAsync(id)));
              },
            },
            {
              id: "delete",
              label: "Delete",
              icon: <Trash2 className="h-3.5 w-3.5" />,
              kind: "destructive",
              destructiveDescription:
                "Items with no sales history will be permanently deleted. Items that have sales records will be archived instead to preserve your reports.",
              precheck: (selection) => {
                const ineligibleCount = selection.items.filter((item) => !!item.hasSales).length;
                return ineligibleCount > 0
                  ? { ineligibleCount, reason: "have sales history and will be archived instead" }
                  : null;
              },
              onExecute: async (selection) => {
                const ids = selection.ids as string[];
                const { counts } = await bulkDeleteMutation.mutateAsync(ids);
                const deleted = counts.deleted ?? 0;
                const archived = counts.archived ?? 0;
                return { succeeded: deleted + archived, failed: counts.failed ?? 0 };
              },
            },
            {
              id: "adjust-stock",
              label: "Adjust stock",
              icon: <RefreshCw className="h-3.5 w-3.5" />,
              kind: "safe",
              onOpen: (selection) => {
                setBulkSelection(selection);
                setBulkAdjustQty(1);
                setIsBulkAdjustOpen(true);
              },
            },
            {
              id: "change-category",
              label: "Change category",
              icon: <Settings2 className="h-3.5 w-3.5" />,
              kind: "safe",
              onOpen: (selection) => {
                setBulkSelection(selection);
                setBulkCategoryValue("");
                setIsBulkCategoryOpen(true);
              },
            },
            {
              id: "update-prices",
              label: "Update prices",
              icon: <Coins className="h-3.5 w-3.5" />,
              kind: "safe",
              onOpen: (selection) => {
                setBulkSelection(selection);
                setBulkPriceMode("set");
                setBulkPriceValue(0);
                setIsBulkPriceOpen(true);
              },
            },
            {
              id: "create-po",
              label: "Create purchase order",
              icon: <ShoppingCart className="h-3.5 w-3.5" />,
              kind: "safe",
              hidden: isMultiStoreView,
              onOpen: (selection) => {
                setBulkSelection(selection);
                setBulkPOVendorId("");
                const eligible = selection.items.filter((item) => item.type !== "service" && bulkEligibleVariant(item));
                setBulkPOQuantities(Object.fromEntries(eligible.map((item) => [item.id, 1])));
                setIsBulkPOOpen(true);
              },
            },
          ];

          return (
            <div className="space-y-3">
            <ListControls
              testIdPrefix="inventory"
              placeholder="Search item or category"
              search={inventorySearchTerm}
              onSearchChange={setInventorySearchTerm}
              filterCount={countActiveInventoryFilters(inventoryFilters)}
              filters={(trigger) => (
                <InventoryFiltersSheet
                  filters={inventoryFilters}
                  onApply={(next) => { setInventoryFilters(next); setSelectedIds([]); }}
                  currencySymbol={symbol}
                  categories={categoryOptions}
                  resultCountFor={(draft) => searchedItems.filter((i) => inventoryMatchesFilters(i, draft)).length}
                  trigger={trigger}
                />
              )}
              sortLabel={inventorySortLabel(inventorySort).replace(/^Sort: /, "")}
              sort={(trigger) => <InventorySortSheet sort={inventorySort} onChange={setInventorySort} trigger={trigger} />}
              chips={buildInventoryFilterChips(inventoryFilters, symbol)}
              onRemoveChip={(key) => setInventoryFilters((f) => clearInventoryFilterChip(f, key as Parameters<typeof clearInventoryFilterChip>[1]))}
              hasSort={inventorySort !== null}
              onClearAll={() => { setInventoryFilters(EMPTY_INVENTORY_FILTERS); setInventorySort(null); }}
              visibleCount={visibleItems.length}
              noun="item"
            />
            <DataTable
              data={visibleItems}
              columns={columns}
              hideToolbar
              showCardChevron
              cardLayout="compact-grid"
              rowActions={inventoryRowActions}
              bulkActions={user?.role !== "staff" ? inventoryBulkActions : undefined}
              entityNoun={{ singular: "item", plural: "items" }}
              isLoading={isLoading}
              emptyMessage="Track wholesale product stocks, services catalog, and split commission margins."
              onRowClick={navigateToDetails}
              multiselect={user?.role !== "staff"}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              onVisibleDataChange={setVisibleProducts}
              urlKey="items"
              emptyIcon={<Package className="h-6 w-6" />}
              emptyTitle="No Inventory Items"
              emptyAction={
                user?.role !== "staff" && (
                  <Button onClick={openCreateForm} size="sm" className="h-8">
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Add Item
                  </Button>
                )
              }
            />
            </div>
          );
        })()
      )}



      {/* Delete / Archive dialog */}
      {deleteBlockedBySales ? (
        <Dialog open={isDeleteOpen} onOpenChange={(open) => { setIsDeleteOpen(open); if (!open) setDeleteBlockedBySales(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-amber-500" />
                Archive "{selectedItem?.name}"?
              </DialogTitle>
              <DialogDescription className="pt-1">
                This item has sales history, so it cannot be permanently deleted. Archiving will hide it from your active inventory and prevent new sales, while keeping all past records intact.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              >
                {archiveMutation.isPending ? "Archiving…" : "Archive Item"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setIsDeleteOpen(false); setDeleteBlockedBySales(false); }}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          title="Delete Item"
          description={`Are you sure you want to delete "${selectedItem?.name}"? This action cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => deleteMutation.mutate()}
          isDestructive
          isLoading={deleteMutation.isPending}
        />
      )}

      {/* Bulk: Adjust stock (add-only, single-variant items only) */}
      <Dialog open={isBulkAdjustOpen} onOpenChange={setIsBulkAdjustOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              Adds the same quantity to every eligible item's current stock.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            if (!bulkSelection) return null;
            const eligible = bulkSelection.items.filter((item) => bulkEligibleVariant(item));
            const ineligible = bulkSelection.items.length - eligible.length;
            return (
              <div className="space-y-4">
                {bulkSelection.mode === "all" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Only applies to the {bulkSelection.items.length} loaded item{bulkSelection.items.length === 1 ? "" : "s"} on this page, not the full "select all" set.
                  </p>
                )}
                {ineligible > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {ineligible} item{ineligible === 1 ? "" : "s"} with multiple variants will be skipped — adjust those from their own page.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-adjust-qty">Quantity to add</Label>
                  <Input
                    id="bulk-adjust-qty"
                    type="number"
                    min={0.01}
                    step="any"
                    value={bulkAdjustQty}
                    onChange={(e) => setBulkAdjustQty(Number(e.target.value))}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsBulkAdjustOpen(false)}>Cancel</Button>
                  <Button
                    disabled={eligible.length === 0 || bulkAdjustQty <= 0 || bulkAdjustStockMutation.isPending}
                    onClick={() => bulkAdjustStockMutation.mutate(eligible)}
                  >
                    {bulkAdjustStockMutation.isPending ? "Adjusting…" : `Adjust ${eligible.length} item${eligible.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Bulk: Change category */}
      <Dialog open={isBulkCategoryOpen} onOpenChange={setIsBulkCategoryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change category</DialogTitle>
            <DialogDescription>
              Sets the category for {bulkSelection?.items.length ?? 0} selected item{(bulkSelection?.items.length ?? 0) === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {bulkSelection?.mode === "all" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Only applies to the {bulkSelection.items.length} loaded item{bulkSelection.items.length === 1 ? "" : "s"} on this page, not the full "select all" set.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-category">Category</Label>
              <Input
                id="bulk-category"
                list="bulk-category-suggestions"
                placeholder="e.g. Beverages"
                value={bulkCategoryValue}
                onChange={(e) => setBulkCategoryValue(e.target.value)}
              />
              <datalist id="bulk-category-suggestions">
                {Array.from(new Set(inventoryList.map((i) => i.category).filter((c): c is string => !!c))).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsBulkCategoryOpen(false)}>Cancel</Button>
              <Button
                disabled={!bulkSelection?.items.length || bulkCategoryMutation.isPending}
                onClick={() => bulkSelection && bulkCategoryMutation.mutate(bulkSelection.items)}
              >
                {bulkCategoryMutation.isPending ? "Updating…" : "Update category"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk: Update prices (single-variant items only) */}
      <Dialog open={isBulkPriceOpen} onOpenChange={setIsBulkPriceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update prices</DialogTitle>
            <DialogDescription>Preview applies before you confirm.</DialogDescription>
          </DialogHeader>
          {(() => {
            if (!bulkSelection) return null;
            const eligible = bulkSelection.items.filter((item) => bulkEligibleVariant(item));
            const ineligible = bulkSelection.items.length - eligible.length;
            const preview = eligible.map((item) => {
              const variant = bulkEligibleVariant(item)!;
              const current = variant.sellingPrice ?? 0;
              const next = Math.round(computeBulkNewPrice(current, bulkPriceMode, bulkPriceValue) * 100) / 100;
              const belowCost = next < (variant.costPrice ?? 0);
              return { item, current, next, belowCost };
            });
            const anyBelowCost = preview.some((p) => p.belowCost);
            return (
              <div className="space-y-4">
                {bulkSelection.mode === "all" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Only applies to the {bulkSelection.items.length} loaded item{bulkSelection.items.length === 1 ? "" : "s"} on this page, not the full "select all" set.
                  </p>
                )}
                {ineligible > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {ineligible} item{ineligible === 1 ? "" : "s"} with multiple variants will be skipped.
                  </p>
                )}
                <RadioGroup value={bulkPriceMode} onValueChange={(v) => setBulkPriceMode(v as BulkPriceMode)} className="grid grid-cols-2 gap-2">
                  {([
                    ["set", "Set to"],
                    ["increase-pct", "Increase by %"],
                    ["decrease-pct", "Decrease by %"],
                    ["increase-amount", "Increase by amount"],
                    ["decrease-amount", "Decrease by amount"],
                  ] as [BulkPriceMode, string][]).map(([mode, label]) => (
                    <label key={mode} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={mode} />
                      {label}
                    </label>
                  ))}
                </RadioGroup>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-price-value">
                    {bulkPriceMode === "set" ? "New price" : bulkPriceMode.includes("pct") ? "Percent" : "Amount"}
                  </Label>
                  <Input
                    id="bulk-price-value"
                    type="number"
                    min={0}
                    step="any"
                    value={bulkPriceValue}
                    onChange={(e) => setBulkPriceValue(Number(e.target.value))}
                  />
                </div>
                {preview.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border text-xs divide-y">
                    {preview.map(({ item, current, next, belowCost }) => (
                      <div key={item.id} className="flex items-center justify-between px-2.5 py-1.5">
                        <span className="truncate mr-2">{item.name}</span>
                        <span className={cn("font-mono shrink-0", belowCost && "text-destructive font-semibold")}>
                          {formatCurrency(current)} → {formatCurrency(next)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {anyBelowCost && (
                  <p className="text-xs text-destructive font-medium">
                    Some new prices would fall below cost. Adjust the amount before applying.
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsBulkPriceOpen(false)}>Cancel</Button>
                  <Button
                    disabled={eligible.length === 0 || anyBelowCost || bulkPriceMutation.isPending}
                    onClick={() => bulkPriceMutation.mutate(eligible)}
                  >
                    {bulkPriceMutation.isPending ? "Updating…" : `Update ${eligible.length} price${eligible.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Bulk: Create purchase order (single-variant, non-service items only) */}
      <Dialog open={isBulkPOOpen} onOpenChange={setIsBulkPOOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create purchase order</DialogTitle>
            <DialogDescription>Groups the eligible items into one PO for a single vendor.</DialogDescription>
          </DialogHeader>
          {(() => {
            if (!bulkSelection) return null;
            const eligible = bulkSelection.items.filter((item) => item.type !== "service" && bulkEligibleVariant(item));
            const ineligible = bulkSelection.items.length - eligible.length;
            return (
              <div className="space-y-4">
                {bulkSelection.mode === "all" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Only applies to the {bulkSelection.items.length} loaded item{bulkSelection.items.length === 1 ? "" : "s"} on this page, not the full "select all" set.
                  </p>
                )}
                {ineligible > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {ineligible} service{ineligible === 1 ? "" : "s"}/multi-variant item{ineligible === 1 ? "" : "s"} will be skipped.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-po-vendor">Vendor</Label>
                  <Select value={bulkPOVendorId} onValueChange={setBulkPOVendorId}>
                    <SelectTrigger id="bulk-po-vendor">
                      <SelectValue placeholder="Select a vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {eligible.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                    {eligible.map((item) => {
                      const variant = bulkEligibleVariant(item)!;
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                          <span className="truncate flex-1">{item.name}</span>
                          <span className="text-muted-foreground shrink-0">{formatCurrency(variant.costPrice ?? 0)} ea</span>
                          <Input
                            type="number"
                            min={1}
                            step="any"
                            className="h-7 w-16 shrink-0"
                            value={bulkPOQuantities[item.id] ?? 1}
                            onChange={(e) =>
                              setBulkPOQuantities((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsBulkPOOpen(false)}>Cancel</Button>
                  <Button
                    disabled={eligible.length === 0 || !bulkPOVendorId || bulkCreatePOMutation.isPending}
                    onClick={() => bulkCreatePOMutation.mutate(eligible)}
                  >
                    {bulkCreatePOMutation.isPending ? "Creating…" : "Create purchase order"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <SpeedDialFAB
        actions={[
          {
            label: "Add Item",
            icon: <Package className="h-5 w-5" />,
            onClick: openCreateForm,
            testId: "fab-add-item",
          },
          {
            label: "Stock Audit",
            icon: <ClipboardList className="h-5 w-5" />,
            onClick: () => setLocation("/inventory/audits"),
            testId: "fab-stock-audit",
          },
        ]}
      />
    </div>
  );
}
