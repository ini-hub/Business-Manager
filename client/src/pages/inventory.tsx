import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Package, Wrench, Coins, Hash, Boxes, AlertTriangle, AlertCircle, ShoppingCart, RefreshCw, Infinity, BarChart3, ClipboardList, CheckCircle2, FileText, X } from "lucide-react";
import { z } from "zod";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { FormDescription } from "@/components/ui/form";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertInventorySchema, type Inventory, type InsertInventory } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";

type FilterType = "all" | "product" | "service" | "low-stock" | "audits";

const inventoryFormSchema = insertInventorySchema.refine(
  (data) => data.costPrice > 0,
  {
    message: "Cost price must be greater than zero.",
    path: ["costPrice"],
  }
).refine(
  (data) => data.type === 'service' || (data.quantity !== undefined && data.quantity !== null && data.quantity >= 1),
  {
    message: "Products must have a quantity of at least 1.",
    path: ["quantity"],
  }
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

export default function InventoryPage() {
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [shouldRedirectBack, setShouldRedirectBack] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [duplicateItem, setDuplicateItem] = useState<Inventory | null>(null);
  const [duplicatePayload, setDuplicatePayload] = useState<InsertInventory | null>(null);
  const [selectedItem, setSelectedItem] = useState<Inventory | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [isAuditFormOpen, setIsAuditFormOpen] = useState(false);
  const [isAuditDetailOpen, setIsAuditDetailOpen] = useState(false);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
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

  const { data: inventoryList = [], isLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/inventory?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Inventory[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, Inventory & { storeName?: string }>();
        for (const list of responses) {
          for (const item of list) {
            const key = item.id;
            const existing = mergedMap.get(key);
            if (existing) {
              if (item.storeName && !existing.storeName?.includes(item.storeName)) {
                existing.storeName = `${existing.storeName}, ${item.storeName}`;
              }
            } else {
              mergedMap.set(key, { ...item });
            }
          }
        }
        return Array.from(mergedMap.values());
      }
      const res = await fetch(`/api/inventory?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch inventory");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && currentStore.id !== "all",
  });

  const { data: auditsList = [], isLoading: isLoadingAudits } = useQuery<any[]>({
    queryKey: ["/api/stock-audits", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/stock-audits?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      const res = await fetch(`/api/stock-audits?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch stock audits");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? (stores.length > 0 && filterType === "audits") : (!!currentStore?.id && filterType === "audits"),
  });

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/staff?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await fetch(`/api/staff?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch staff");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const { data: auditDetail, isLoading: isLoadingAuditDetail } = useQuery<any>({
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
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
          (item) => item.type === "product" && item.quantity <= lowStockThreshold
        );
      default:
        return inventoryList;
    }
  }, [inventoryList, filterType, lowStockThreshold]);

  const lowStockCount = useMemo(() => {
    return inventoryList.filter(
      (item) => item.type === "product" && item.quantity <= lowStockThreshold
    ).length;
  }, [inventoryList, lowStockThreshold]);

  const form = useForm<InsertInventory>({
    resolver: zodResolver(inventoryFormSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 1,
      commissionSplitOverride: false,
      commissionSplitBusinessShare: 80,
      commissionSplitStaffShare: 20,
    },
  });

  const watchType = form.watch("type");
  const watchCostPrice = form.watch("costPrice");
  const watchSellingPrice = form.watch("sellingPrice");
  const hasZeroMargin = watchCostPrice > 0 && watchCostPrice === watchSellingPrice;

  const createMutation = useMutation({
    mutationFn: (data: InsertInventory) => apiRequest("POST", "/api/inventory", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item created successfully" });
      closeForm();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Add Item", 
        description: getUserFriendlyError(error, "adding this item"), 
        variant: "destructive" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertInventory) =>
      apiRequest("PATCH", `/api/inventory/${selectedItem?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item updated successfully" });
      const itemId = selectedItem?.id;
      closeForm();
      if (shouldRedirectBack && itemId) {
        setLocation(`/inventory/${itemId}`);
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Update Item", 
        description: getUserFriendlyError(error, "updating this item"), 
        variant: "destructive" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/inventory/${selectedItem?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Item deleted successfully" });
      setIsDeleteOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      const errorMessage = error.message?.toLowerCase().includes("transaction") || 
                          error.message?.toLowerCase().includes("order") ||
                          error.message?.toLowerCase().includes("constraint")
        ? "Inventory is connected to a transaction. Contact support if the problem persists."
        : getUserFriendlyError(error);
      toast({ 
        title: "Couldn't Delete Item", 
        description: errorMessage, 
        variant: "destructive" 
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
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
    form.reset({
      storeId: currentStore?.id === "all" ? "" : (currentStore?.id || ""),
      name: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 1,
    });
    setSelectedItem(null);
    setIsFormOpen(true);
  };

  const totalCostValue = filteredInventory.reduce((acc, item) => item.type === "product" ? acc + (item.costPrice * item.quantity) : acc, 0);
  const totalRetailValue = filteredInventory.reduce((acc, item) => item.type === "product" ? acc + (item.sellingPrice * item.quantity) : acc, 0);
  const projectedGrossMargin = totalRetailValue > 0 ? ((totalRetailValue - totalCostValue) / totalRetailValue) * 100 : 0;

  const openEditForm = (item: Inventory) => {
    form.reset({
      storeId: item.storeId,
      name: item.name,
      type: item.type as "product" | "service",
      costPrice: item.costPrice,
      sellingPrice: item.sellingPrice,
      quantity: item.quantity,
      commissionSplitOverride: (item as any).commissionSplitOverride ?? false,
      commissionSplitBusinessShare: (item as any).commissionSplitBusinessShare ?? 80,
      commissionSplitStaffShare: (item as any).commissionSplitStaffShare ?? 20,
    });
    setSelectedItem(item);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedItem(null);
    setShouldRedirectBack(false);
    form.reset();
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && inventoryList.length > 0) {
      const item = inventoryList.find((i) => i.id === editId);
      if (item) {
        setShouldRedirectBack(true);
        openEditForm(item);
        // Clear query parameter from the URL
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [inventoryList]);

  const navigateToDetails = (item: Inventory) => {
    setLocation(`/inventory/${item.id}`);
  };

  const onSubmit = (data: InsertInventory) => {
    if (data.sellingPrice < data.costPrice) {
      form.setError("sellingPrice", { type: "manual", message: "Selling price cannot be less than cost price." });
      return;
    }

    if (selectedItem) {
      updateMutation.mutate(data);
    } else {
      const existing = inventoryList.find(
        (item) => item.name.toLowerCase().trim() === data.name.toLowerCase().trim()
      );
      if (existing) {
        setDuplicateItem(existing);
        setDuplicatePayload(data);
        setIsDuplicateOpen(true);
        return;
      }
      createMutation.mutate(data);
    }
  };

  const getStockBadge = (item: Inventory) => {
    if (item.type === "service") {
      return <Badge variant="secondary">Service</Badge>;
    }
    if (item.quantity === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    }
    if (item.quantity <= lowStockThreshold) {
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
      render: (item: Inventory) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
            {item.type === "product" ? (
              <Package className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Wrench className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <span className="font-medium">{item.name}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (item: Inventory) => (
        <Badge variant="outline" className="capitalize">
          {item.type}
        </Badge>
      ),
    },
    {
      key: "costPrice",
      header: "Cost",
      render: (item: Inventory) => (
        <span className={`font-mono text-sm ${item.costPrice === 0 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`}>
          {item.costPrice === 0 ? "Unset (₦0)" : formatCurrency(item.costPrice)}
        </span>
      ),
    },
    {
      key: "sellingPrice",
      header: "Selling Price",
      render: (item: Inventory) => (
        <span className="font-mono text-sm font-medium">{formatCurrency(item.sellingPrice)}</span>
      ),
    },
    {
      key: "quantity",
      header: "Stock",
      render: (item: Inventory) => (
        <div className="flex items-center gap-2">
          {item.type === "product" ? (
            <>
              <Boxes className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{item.quantity}</span>
            </>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Infinity className="h-3 w-3" /> N/A
            </span>
          )}
          {getStockBadge(item)}
        </div>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      render: (item: Inventory) => {
        const marginVal = item.sellingPrice - item.costPrice;
        const marginPct = item.sellingPrice > 0 ? (marginVal / item.sellingPrice) * 100 : 0;
        return (
          <div className="flex flex-col">
            <span className="font-mono text-sm font-medium">{formatCurrency(marginVal)}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {marginPct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (item: Inventory) => (
        <div className="flex items-center gap-1">
          {item.type === "product" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedItem(item);
                setRestockData({ 
                  quantity: 1, 
                  unitCost: item.costPrice, 
                  costStrategy: "keep",
                  newSellingPrice: item.sellingPrice,
                  reason: "Restock",
                  receiptUrl: "",
                  updateSellingPrice: false,
                  notes: "",
                });
                setIsRestockOpen(true);
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
              setIsDeleteOpen(true);
            }}
            data-testid={`button-delete-${item.id}`}
          >
            <Trash2 className="h-4 w-4" />
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
              <Button onClick={() => setIsAuditFormOpen(true)} data-testid="button-new-audit">
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

      <Tabs defaultValue="all" value={filterType} onValueChange={(v) => setFilterType(v as FilterType)} className="w-full space-y-6">
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
      ) : (
        (() => {
          const tableData = filteredInventory.map((item) => {
            const margin = item.sellingPrice > 0 
              ? Math.round(((item.sellingPrice - item.costPrice) / item.sellingPrice) * 100) 
              : 0;
            const stockStatus = item.type === "service" 
              ? "In Stock" 
              : (item.quantity === 0 ? "Out of Stock" : (item.quantity <= lowStockThreshold ? "Low Stock" : "In Stock"));
            return {
              ...item,
              stockStatus,
              margin
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
            <DataTable
              data={tableData}
              columns={columns}
              searchable
              searchPlaceholder="Search inventory..."
              searchKeys={["name"]}
              isLoading={isLoading}
              emptyMessage="No items found. Add your first item to get started."
              onRowClick={navigateToDetails}
              filterConfigs={filterConfigs}
            />
          );
        })()
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedItem ? "Edit Item" : "Add New Item"}
            </DialogTitle>
            <DialogDescription>
              {selectedItem
                ? "Update the inventory item details below."
                : "Fill in the details to add a new inventory item."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {currentStore?.id === "all" && !selectedItem && (
                <FormField
                  control={form.control}
                  name="storeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Store Location</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-store">
                            <SelectValue placeholder="Select a branch..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {stores.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
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
                          min="1"
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
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending || watchSellingPrice < watchCostPrice}
                  data-testid="button-submit"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : selectedItem
                    ? "Update Item"
                    : "Add Item"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isRestockOpen} onOpenChange={setIsRestockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Restock "{selectedItem?.name}"
            </DialogTitle>
            <DialogDescription>
              Add more stock to this item. Current stock: {selectedItem?.quantity ?? 0}
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
                    Keep existing cost ({formatCurrency(selectedItem?.costPrice ?? 0)})
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
              {restockData.costStrategy === "weighted" && selectedItem && restockData.unitCost > 0 && (
                <p className="text-xs text-muted-foreground ml-6">
                  New cost: {formatCurrency(
                    ((selectedItem.quantity * selectedItem.costPrice) + (restockData.quantity * restockData.unitCost)) / 
                    (selectedItem.quantity + restockData.quantity)
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
                  placeholder={`Current: ${formatCurrency(selectedItem?.sellingPrice ?? 0)}`}
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

      <Dialog open={isDuplicateOpen} onOpenChange={setIsDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Duplicate Item Name
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p className="text-sm font-medium text-foreground">
                An item named "{duplicateItem?.name}" already exists in your inventory.
              </p>
              <div className="rounded-lg bg-muted p-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Type:</span>
                  <span className="font-semibold capitalize text-foreground">{duplicateItem?.type}</span>
                </div>
                {duplicateItem?.type === "product" && (
                  <div className="flex justify-between">
                    <span>Current Stock:</span>
                    <span className="font-semibold text-foreground">{duplicateItem?.quantity} units</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Selling Price:</span>
                  <span className="font-semibold text-foreground">{formatCurrency(duplicateItem?.sellingPrice || 0)}</span>
                </div>
              </div>
              <p className="text-xs">
                Would you like to restock this existing item, or would you prefer to close this and rename your new item?
              </p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setIsDuplicateOpen(false)}
            >
              Cancel
            </Button>
            {duplicateItem?.type === "product" && (
              <Button
                variant="outline"
                className="border-amber-200 hover:bg-amber-50 dark:border-amber-900 dark:hover:bg-amber-950"
                onClick={() => {
                  setIsDuplicateOpen(false);
                  setIsFormOpen(false); // Close the Add Item dialog
                  setSelectedItem(duplicateItem);
                  setRestockData({
                    quantity: duplicatePayload?.quantity || 1,
                    unitCost: duplicateItem.costPrice,
                    costStrategy: "keep",
                    newSellingPrice: duplicateItem.sellingPrice,
                    updateSellingPrice: false,
                    reason: "Restock",
                    receiptUrl: "",
                    notes: `Autoredirected restock from duplicate add`,
                  });
                  setIsRestockOpen(true);
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Restock Existing
              </Button>
            )}
            <Button
              onClick={() => {
                setIsDuplicateOpen(false);
                toast({
                  title: "Rename Your Item",
                  description: "Please update the item name to create a new record.",
                });
              }}
            >
              Rename Name
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Stock Audit Dialog */}
      <Dialog open={isAuditFormOpen} onOpenChange={setIsAuditFormOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 glassmorphic-dark border-muted/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <ClipboardList className="h-5 w-5 text-indigo-400" />
              New Physical Stock Audit
            </DialogTitle>
            <DialogDescription>
              Record a physical count of products in stock to reconcile with system-tracked stock.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="conductedBy">Conducted By</Label>
                <Select value={conductedByStaffId} onValueChange={setConductedByStaffId}>
                  <SelectTrigger id="conductedBy">
                    <SelectValue placeholder="Select staff..." />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="auditNotes">General Notes</Label>
                <Input
                  id="auditNotes"
                  placeholder="e.g. Monthly stock take"
                  value={auditNotes}
                  onChange={(e) => setAuditNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t border-muted/30 pt-4 space-y-3">
              <Label>Select Products to Audit</Label>
              <Select
                value=""
                onValueChange={(val) => {
                  const item = inventoryList.find((i) => i.id === val);
                  if (item && !auditItems.some((ai) => ai.inventoryId === item.id)) {
                    setAuditItems((prev) => [
                      ...prev,
                      {
                        inventoryId: item.id,
                        name: item.name,
                        systemQuantity: item.quantity,
                        physicalQuantity: item.quantity,
                        reason: "Miscount",
                      },
                    ]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Add product to audit..." />
                </SelectTrigger>
                <SelectContent>
                  {inventoryList
                    .filter((i) => i.type === "product" && !auditItems.some((ai) => ai.inventoryId === i.id))
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} (Current Stock: {i.quantity})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {auditItems.length > 0 ? (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {auditItems.map((ai, index) => {
                    const variance = ai.physicalQuantity - ai.systemQuantity;
                    return (
                      <div
                        key={ai.inventoryId}
                        className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/10 border-muted/30 animate-in fade-in slide-in-from-top-2 duration-200"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{ai.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setAuditItems((prev) => prev.filter((item) => item.inventoryId !== ai.inventoryId));
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <span className="text-[10px] text-muted-foreground block mb-1">System Qty</span>
                            <Input
                              type="number"
                              readOnly
                              value={ai.systemQuantity}
                              className="h-8 font-mono text-xs bg-muted/30 border-muted/30"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block mb-1">Physical Qty</span>
                            <Input
                              type="number"
                              value={ai.physicalQuantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setAuditItems((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, physicalQuantity: val } : item
                                  )
                                );
                              }}
                              className="h-8 font-mono text-xs"
                              min="0"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block mb-1">Variance</span>
                            <div
                              className={`h-8 flex items-center justify-center rounded-md border text-xs font-mono font-bold ${
                                variance > 0
                                  ? "bg-green-500/10 border-green-500/30 text-green-500"
                                  : variance < 0
                                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                                  : "bg-muted border-border text-muted-foreground"
                              }`}
                            >
                              {variance > 0 ? `+${variance}` : variance}
                            </div>
                          </div>
                        </div>
                        <div className="mt-1">
                          <span className="text-[10px] text-muted-foreground block mb-1">Reason for Drift</span>
                          <Select
                            value={ai.reason}
                            onValueChange={(val) => {
                              setAuditItems((prev) =>
                                prev.map((item, idx) => (idx === index ? { ...item, reason: val } : item))
                              );
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Reason" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Theft">Theft/Pilferage</SelectItem>
                              <SelectItem value="Damage">Damage/Spillage</SelectItem>
                              <SelectItem value="Miscount">Regular Miscount</SelectItem>
                              <SelectItem value="DataEntry">Data Entry Error</SelectItem>
                              <SelectItem value="Other">Other Reason</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg border-muted/30">
                  No products added to audit yet. Add one above.
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-muted/30 pt-4">
            <Button variant="outline" onClick={() => setIsAuditFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!conductedByStaffId) {
                  toast({ title: "Validation Error", description: "Please select who conducted the audit.", variant: "destructive" });
                  return;
                }
                if (auditItems.length === 0) {
                  toast({ title: "Validation Error", description: "Please add at least one product to audit.", variant: "destructive" });
                  return;
                }
                createAuditMutation.mutate({
                  storeId: currentStore.id,
                  conductedByStaffId,
                  notes: auditNotes,
                  items: auditItems,
                });
              }}
              disabled={createAuditMutation.isPending || auditItems.length === 0}
            >
              {createAuditMutation.isPending ? "Submitting..." : "Submit Audit Draft"}
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
    </div>
  );
}
