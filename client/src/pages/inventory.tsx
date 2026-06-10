import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import type { Product, StockAudit, StockAuditItem, Staff, Settings, Inventory } from "@shared/schema";

type ProductWithVariants = Product & { variants?: Inventory[]; stockStatus?: string; margin?: number; storeName?: string; costPrice?: number; sellingPrice?: number; quantity?: number; sku?: string; barcode?: string; unit?: string; reorderPoint?: number };
type AuditPerson = { name?: string; email?: string };
type AuditDetail = StockAudit & { items: StockAuditItem[]; conductedBy?: AuditPerson; approvedBy?: AuditPerson };
import { Plus, Edit, Trash2, Package, Wrench, Coins, Hash, Boxes, AlertTriangle, AlertCircle, ShoppingCart, RefreshCw, Infinity, BarChart3, ClipboardList, CheckCircle2, FileText, X, ArchiveX, Archive, RotateCcw, CheckSquare } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkOperations } from "@/components/bulk-operations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMultiStoreQuery } from "@/hooks/useMultiStoreQuery";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import { buildSlug } from "@/lib/slug";

type FilterType = "all" | "product" | "service" | "low-stock" | "audits" | "archived";

export default function InventoryPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteBlockedBySales, setDeleteBlockedBySales] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ProductWithVariants | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [isAuditFormOpen, setIsAuditFormOpen] = useState(false);
  const [isAuditDetailOpen, setIsAuditDetailOpen] = useState(false);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{ archived: string[]; deleted: string[]; failed: string[] } | null>(null);
  const [conductedByStaffId, setConductedByStaffId] = useState("");
  const [auditNotes, setAuditNotes] = useState("");
  const [auditItems, setAuditItems] = useState<{
    inventoryId: string;
    name: string;
    systemQuantity: number;
    physicalQuantity: number;
    reason: string;
  }[]>([]);
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

  const { data: inventoryList = [], isLoading } = useMultiStoreQuery<ProductWithVariants>(
    "/api/products",
    { merge: "dedup-by-id", staleTime: STALE_TIMES.reference }
  );

  const { data: archivedList = [], isLoading: isLoadingArchived } = useMultiStoreQuery<ProductWithVariants>(
    "/api/products/archived",
    { enabled: filterType === "archived", staleTime: STALE_TIMES.reference }
  );

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && currentStore.id !== "all",
    staleTime: STALE_TIMES.reference,
  });

  const { data: auditsRaw = [], isLoading: isLoadingAudits } = useMultiStoreQuery<StockAudit>(
    "/api/stock-audits",
    { enabled: filterType === "audits" }
  );
  const auditsList = [...auditsRaw].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const { data: staffList = [] } = useMultiStoreQuery<Staff>("/api/staff", { staleTime: STALE_TIMES.reference });

  const { data: auditDetail, isLoading: isLoadingAuditDetail } = useQuery<AuditDetail>({
    queryKey: ["/api/stock-audits", selectedAuditId],
    queryFn: async () => {
      const res = await fetch(`/api/stock-audits/${selectedAuditId}`);
      if (!res.ok) throw new Error("Failed to fetch audit details");
      return res.json();
    },
    enabled: !!selectedAuditId,
  });

  const createAuditMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/stock-audits", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Stock audit submitted successfully." });
      setIsAuditFormOpen(false);
      setAuditNotes("");
      setConductedByStaffId("");
      setAuditItems([]);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create stock audit",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    },
  });

  const approveAuditMutation = useMutation({
    mutationFn: (auditId: string) => apiRequest("POST", `/api/stock-audits/${auditId}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits", selectedAuditId] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Stock audit approved. Inventory quantities updated." });
      setIsAuditDetailOpen(false);
      setSelectedAuditId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not approve stock audit",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    },
  });

  const lowStockThreshold = settingsData?.lowStockThreshold ?? 5;

  const filteredInventory = useMemo(() => {
    switch (filterType) {
      case "all":
        return inventoryList;
      case "product":
        return inventoryList.filter((item) => item.type === "product");
      case "service":
        return inventoryList.filter((item) => item.type === "service");
      case "low-stock":
        return inventoryList.filter(
          (item) => item.type === "product" && item.variants?.some((v: any) => v.quantity <= lowStockThreshold)
        );
      default:
        return inventoryList;
    }
  }, [inventoryList, filterType, lowStockThreshold]);

  const lowStockCount = useMemo(() => {
    return inventoryList.filter(
      (item) => item.type === "product" && item.variants?.some((v: any) => v.quantity <= lowStockThreshold)
    ).length;
  }, [inventoryList, lowStockThreshold]);

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
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => apiRequest("POST", `/api/inventory/${id}/archive`))
      );
      const archived = ids.filter((_, i) => results[i].status === "fulfilled");
      const failed = ids.filter((_, i) => results[i].status === "rejected");
      return { archived, failed };
    },
    onSuccess: ({ archived, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedIds([]);
      if (failed.length === 0) {
        toast({ title: `${archived.length} item${archived.length !== 1 ? "s" : ""} archived` });
      } else {
        toast({
          title: `${archived.length} archived, ${failed.length} failed`,
          variant: "destructive",
        });
      }
    },
    onError: () => toast({ title: "Bulk archive failed", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const deleted: string[] = [];
      const archived: string[] = [];
      const failed: string[] = [];
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await apiRequest("DELETE", `/api/inventory/${id}`);
            if (res.ok) {
              deleted.push(id);
            } else {
              const body = await res.json().catch(() => ({}));
              const msg: string = body?.error ?? "";
              if (res.status === 400 && (msg.includes("sales") || msg.includes("history"))) {
                // Has sales history — archive instead
                const archiveRes = await apiRequest("POST", `/api/inventory/${id}/archive`);
                if (archiveRes.ok) archived.push(id);
                else failed.push(id);
              } else {
                failed.push(id);
              }
            }
          } catch {
            failed.push(id);
          }
        })
      );
      return { deleted, archived, failed };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedIds([]);
      setBulkDeleteResult(result);
      setIsBulkDeleteOpen(false);
      const total = result.deleted.length + result.archived.length;
      const parts: string[] = [];
      if (result.deleted.length) parts.push(`${result.deleted.length} deleted`);
      if (result.archived.length) parts.push(`${result.archived.length} archived (had sales history)`);
      if (result.failed.length) parts.push(`${result.failed.length} failed`);
      toast({
        title: total > 0 ? `Done — ${parts.join(", ")}` : "Nothing could be removed",
        variant: result.failed.length > 0 && total === 0 ? "destructive" : "default",
      });
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
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
  const projectedGrossMargin = totalRetailValue > 0 ? ((totalRetailValue - totalCostValue) / totalRetailValue) * 100 : 0;

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
    setLocation(`/inventory/${buildSlug(item.name, item.id)}`);
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
      render: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
            {item.type === "product" ? (
              <Package className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Wrench className="h-4 w-4 text-muted-foreground" />
            )}
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
      render: (item: any) => (
        <Badge variant="outline" className={`capitalize ${
          item.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
          : item.type === "product" ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"
          : ""}`}>
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
        const displayQty = parseFloat(Number(totalStock).toFixed(4));
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
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (item: any) => (
        <div className="flex items-center gap-1">
          {item.type === "product" && item.variants && item.variants.length === 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                const variant = item.variants[0];
                setLocation(`/inventory/${buildSlug(item.name, variant.id)}/restock`);
              }}
              data-testid={`button-restock-${item.id}`}
              title="Restock"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(item);
            }}
            data-testid={`button-edit-${item.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedItem(item);
              setDeleteBlockedBySales(!!item.hasSales);
              setIsDeleteOpen(true);
            }}
            data-testid={`button-delete-${item.id}`}
            title={item.hasSales ? "Archive item" : "Delete item"}
          >
            {item.hasSales
              ? <Archive className="h-4 w-4 text-amber-500" />
              : <Trash2 className="h-4 w-4 text-destructive" />
            }
          </Button>
        </div>
      ),
    },
  ];

  const exportColumns = [
    { key: "name", header: "Item Name" },
    { key: "type", header: "Type" },
    { key: "costPrice", header: "Cost Price" },
    { key: "sellingPrice", header: "Selling Price" },
    { key: "quantity", header: "Stock" },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage your products and services" />
        <StoreRequiredAlert title="Store Required for Inventory" />
      </div>
    );
  }

  const totalAuditsCount = auditsList.length;
  const draftAuditsCount = auditsList.filter((a: any) => a.status === "draft").length;
  const latestAuditDateStr = auditsList.length > 0 
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(auditsList[0].createdAt))
    : "No audits yet";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Inventory"
        description={`Managing inventory for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            {filterType === "audits" ? (
              <Button onClick={() => setLocation("/inventory/audits/new")} data-testid="button-new-audit">
                <Plus className="mr-2 h-4 w-4" />
                New Stock Audit
              </Button>
            ) : (
              <>
                <BulkOperations
                  entityType="inventory"
                  data={filteredInventory as unknown as Record<string, unknown>[]}
                  columns={exportColumns}
                  isLoading={isLoading}
                  storeId={currentStore.id}
                  pdfTitle="Inventory Report"
                  showImportOption={user?.role !== "staff"}
                />
                <Button onClick={openCreateForm} data-testid="button-add-item">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {filterType === "audits" ? (
          <>
            <MetricCard
              title="Total Audits Conducted"
              value={String(totalAuditsCount)}
              icon={<ClipboardList className="h-4 w-4" />}
              description="Historical stock counts performed"
              isLoading={isLoadingAudits}
            />
            <MetricCard
              title="Pending Approvals"
              value={String(draftAuditsCount)}
              icon={<AlertCircle className="h-4 w-4 text-amber-500" />}
              description="Audits requiring manager approval"
              isLoading={isLoadingAudits}
            />
            <MetricCard
              title="Latest Audit Performed"
              value={latestAuditDateStr}
              icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
              description="Most recent physical check date"
              isLoading={isLoadingAudits}
            />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Cost Value"
              value={formatCurrency(totalCostValue)}
              icon={<Package className="h-4 w-4" />}
              description="Total value of products in stock"
              isLoading={isLoading}
            />
            <MetricCard
              title="Total Retail Value"
              value={formatCurrency(totalRetailValue)}
              icon={<Coins className="h-4 w-4" />}
              description="Expected revenue if all sold"
              isLoading={isLoading}
            />
            <MetricCard
              title="Projected Gross Margin"
              value={`${projectedGrossMargin.toFixed(1)}%`}
              icon={<BarChart3 className="h-4 w-4" />}
              description="Based on current stock value"
              isLoading={isLoading}
            />
          </>
        )}
      </div>

      {lowStockCount > 0 && filterType !== "audits" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Low Stock Alert
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {lowStockCount} item{lowStockCount !== 1 ? "s" : ""} {lowStockCount !== 1 ? "are" : "is"} running low on stock (below {lowStockThreshold} units)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterType("low-stock")}
            className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
            data-testid="button-view-low-stock"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            View Items
          </Button>
        </div>
      )}

      <Tabs defaultValue="all" value={filterType} onValueChange={(v) => { setFilterType(v as FilterType); setSelectedIds([]); }} className="w-full space-y-6">
        <PolymorphicTabsList 
          variant="default"
          tabs={[
            { value: "all", label: `All (${inventoryList.length})`, testId: "tab-all" },
            { value: "product", label: `Products (${inventoryList.filter((i) => i.type === "product").length})`, testId: "tab-products" },
            { value: "service", label: `Services (${inventoryList.filter((i) => i.type === "service").length})`, testId: "tab-services" },
            { 
              value: "low-stock", 
              label: `Low Stock (${lowStockCount})`, 
              icon: <AlertCircle className="mr-1 h-3 w-3" />,
              testId: "tab-low-stock",
              className: lowStockCount > 0 ? "text-amber-600 dark:text-amber-400" : "" 
            },
            {
              value: "audits",
              label: "Stock Audits",
              icon: <ClipboardList className="mr-1 h-3 w-3" />,
              testId: "tab-audits",
            },
            {
              value: "archived",
              label: `Archived${archivedList.length > 0 ? ` (${archivedList.length})` : ""}`,
              icon: <Archive className="mr-1 h-3 w-3" />,
              testId: "tab-archived",
              className: archivedList.length > 0 ? "text-muted-foreground" : "",
            }
          ]}
        />
      </Tabs>

      {filterType === "audits" ? (
        (() => {
          const auditColumns = [
            ...(currentStore?.id === "all" ? [{
              key: "storeName",
              header: "Store",
              render: (audit: any) => (
                <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
                  {audit.storeName || "Global"}
                </Badge>
              ),
            }] : []),
            {
              key: "id",
              header: "Audit ID",
              render: (audit: any) => (
                <span className="font-mono text-xs font-semibold">
                  {audit.id.substring(0, 8).toUpperCase()}
                </span>
              ),
            },
            {
              key: "createdAt",
              header: "Date Conducted",
              render: (audit: any) => (
                <span className="text-sm">
                  {new Intl.DateTimeFormat("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(audit.createdAt))}
                </span>
              ),
            },
            {
              key: "conductedBy",
              header: "Conducted By",
              render: (audit: any) => {
                const conductor = staffList.find((s) => s.id === audit.conductedByStaffId);
                return (
                  <span className="text-sm font-medium">
                    {conductor ? conductor.name : "System / Admin"}
                  </span>
                );
              },
            },
            {
              key: "status",
              header: "Status",
              render: (audit: any) => (
                <Badge
                  variant="secondary"
                  className={
                    audit.status === "approved"
                      ? "bg-green-500/10 text-green-500 hover:bg-green-500/25 animate-pulse"
                      : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/25"
                  }
                >
                  {audit.status.toUpperCase()}
                </Badge>
              ),
            },
            {
              key: "notes",
              header: "General Notes",
              render: (audit: any) => (
                <span className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                  {audit.notes || "—"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (audit: any) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedAuditId(audit.id);
                    setIsAuditDetailOpen(true);
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  View Details
                </Button>
              ),
            },
          ];

          return (
            <DataTable
              data={auditsList}
              columns={auditColumns}
              searchable
              searchPlaceholder="Search audits by notes..."
              searchKeys={["notes"]}
              isLoading={isLoadingAudits}
              emptyMessage="No stock audits recorded. Initiate one using the button above."
              onRowClick={(audit) => {
                setSelectedAuditId(audit.id);
                setIsAuditDetailOpen(true);
              }}
            />
          );
        })()
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
                        {item.type === "product" ? <Package className="h-4 w-4 text-muted-foreground" /> : <Wrench className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <span className="font-medium line-through text-muted-foreground">{item.name}</span>
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "Type",
                  render: (item: any) => (
                    <Badge variant="outline" className={`capitalize ${item.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30" : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"}`}>
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
            />
          )}
        </div>
      ) : (
        (() => {
          const tableData = filteredInventory.map((item) => {
            const totalStock = item.type === "service" ? 0 : (item.variants?.reduce((sum: number, v: any) => sum + v.quantity, 0) ?? 0);
            const stockStatus = item.type === "service" 
              ? "In Stock" 
              : (totalStock === 0 ? "Out of Stock" : (item.variants?.some((v: any) => v.quantity <= lowStockThreshold) ? "Low Stock" : "In Stock"));
            
            const marginPct = item.variants && item.variants.length > 0
              ? item.variants.reduce((acc: number, v: any) => {
                  const mVal = v.sellingPrice - v.costPrice;
                  const mPct = v.sellingPrice > 0 ? (mVal / v.sellingPrice) * 100 : 0;
                  return acc + mPct;
                }, 0) / item.variants.length
              : 0;

            return {
              ...item,
              stockStatus,
              margin: Math.round(marginPct)
            };
          });

          const filterConfigs = [
            { 
              key: "type", 
              label: "Type", 
              type: "select" as const,
              valueMapper: (val: any) => String(val).charAt(0).toUpperCase() + String(val).slice(1)
            },
            { key: "stockStatus", label: "Stock Status", type: "select" as const },
            { key: "margin", label: "Margin %", type: "range" as const }
          ];

          return (
            <>
              {/* Bulk action bar */}
              {selectedIds.length > 0 && user?.role !== "staff" && (
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckSquare className="h-4 w-4 text-primary" />
                    <span>{selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""} selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedIds([])}
                      className="h-7 text-xs"
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                      disabled={bulkArchiveMutation.isPending}
                      onClick={() => bulkArchiveMutation.mutate(selectedIds as string[])}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      {bulkArchiveMutation.isPending ? "Archiving…" : "Archive Selected"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => setIsBulkDeleteOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Selected
                    </Button>
                  </div>
                </div>
              )}
            <DataTable
              data={tableData}
              columns={columns}
              searchable
              searchPlaceholder="Search inventory..."
              searchKeys={["name"]}
              isLoading={isLoading}
              emptyMessage="Track wholesale product stocks, services catalog, and split commission margins."
              onRowClick={navigateToDetails}
              multiselect={user?.role !== "staff"}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              filterConfigs={filterConfigs}
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
            </>
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

      {/* Bulk delete confirmation */}
      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete {selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription className="pt-1">
              Items with no sales history will be permanently deleted.
              Items that have sales records will be <strong>archived</strong> instead to preserve your reports.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(selectedIds as string[])}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Processing…" : `Delete / Archive ${selectedIds.length} item${selectedIds.length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Audit Details Dialog */}
      <Dialog open={isAuditDetailOpen} onOpenChange={setIsAuditDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 glassmorphic-dark border-muted/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <FileText className="h-5 w-5 text-indigo-400" />
              Stock Audit Details
            </DialogTitle>
            <DialogDescription>
              Detailed logs and physical variances for this stock audit.
            </DialogDescription>
          </DialogHeader>

          {isLoadingAuditDetail ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
          ) : auditDetail ? (
            <>
              <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
                <div className="grid grid-cols-2 gap-4 rounded-lg border border-muted/30 bg-muted/5 p-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Status</span>
                    <Badge
                      variant="secondary"
                      className={
                        auditDetail.status === "approved"
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/25"
                          : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/25"
                      }
                    >
                      {auditDetail.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Date Conducted</span>
                    <span className="font-medium text-foreground">
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(auditDetail.createdAt))}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Conducted By</span>
                    <span className="font-medium text-foreground">
                      {auditDetail.conductedBy
                        ? auditDetail.conductedBy.name
                        : "System / Admin"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">Approved By</span>
                    <span className="font-medium text-foreground">
                      {auditDetail.approvedBy
                        ? auditDetail.approvedBy.name || auditDetail.approvedBy.email
                        : auditDetail.status === "approved"
                        ? "Admin / Manager"
                        : "Pending Approval"}
                    </span>
                  </div>
                  {auditDetail.notes && (
                    <div className="col-span-2 space-y-1 pt-1.5 border-t border-muted/20">
                      <span className="text-xs text-muted-foreground block">Notes</span>
                      <p className="text-xs text-muted-foreground italic bg-muted/10 p-2 rounded border border-muted/20">
                        {auditDetail.notes}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Audited Items & Drifts</h4>
                  <div className="border border-muted/30 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-muted/10 border-b border-muted/30 text-muted-foreground font-semibold">
                          <th className="p-3">Product Name</th>
                          <th className="p-3 text-right">System Qty</th>
                          <th className="p-3 text-right">Physical Qty</th>
                          <th className="p-3 text-right">Variance</th>
                          <th className="p-3">Drift Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-muted/20">
                        {auditDetail.items.map((item: any) => {
                          const variance = item.physicalQuantity - item.systemQuantity;
                          return (
                            <tr key={item.id} className="hover:bg-muted/5">
                              <td className="p-3 font-medium text-foreground">{item.inventory?.name || "Unknown Product"}</td>
                              <td className="p-3 text-right font-mono text-muted-foreground">{item.systemQuantity}</td>
                              <td className="p-3 text-right font-mono text-foreground">{item.physicalQuantity}</td>
                              <td
                                className={`p-3 text-right font-mono font-bold ${
                                  variance > 0 ? "text-green-500" : variance < 0 ? "text-red-500" : "text-muted-foreground"
                                }`}
                              >
                                {variance > 0 ? `+${variance}` : variance}
                              </td>
                              <td className="p-3 text-muted-foreground italic">{item.reason || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-muted/30 pt-4">
                <Button variant="outline" onClick={() => setIsAuditDetailOpen(false)}>
                  Close
                </Button>
                {auditDetail.status === "draft" && (user?.role === "owner" || user?.role === "manager") && (
                  <Button
                    onClick={() => approveAuditMutation.mutate(auditDetail.id)}
                    disabled={approveAuditMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {approveAuditMutation.isPending ? "Approving..." : "Approve & Resolve Drifts"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">Could not load details.</div>
          )}
        </DialogContent>
      </Dialog>

      <SpeedDialFAB
        actions={
          filterType === "audits"
            ? [
                {
                  label: "New Audit",
                  icon: <ClipboardList className="h-5 w-5" />,
                  onClick: () => setLocation("/inventory/audits/new"),
                  testId: "fab-new-audit",
                },
              ]
            : [
                {
                  label: "Add Item",
                  icon: <Package className="h-5 w-5" />,
                  onClick: openCreateForm,
                  testId: "fab-add-item",
                },
                {
                  label: "New Audit",
                  icon: <ClipboardList className="h-5 w-5" />,
                  onClick: () => setLocation("/inventory/audits/new"),
                  testId: "fab-new-audit",
                },
              ]
        }
      />
    </div>
  );
}
