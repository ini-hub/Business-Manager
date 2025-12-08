import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Package, Wrench, Coins, Hash, Boxes, AlertTriangle, AlertCircle, ShoppingCart, RefreshCw, Infinity } from "lucide-react";
import { z } from "zod";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { FormDescription } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Link, useLocation } from "wouter";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";

type FilterType = "all" | "product" | "service" | "low-stock";

const LOW_STOCK_THRESHOLD = 5;

export default function InventoryPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Inventory | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [restockData, setRestockData] = useState({
    quantity: 1,
    unitCost: 0,
    costStrategy: "keep" as "keep" | "last" | "weighted" | "override",
    newSellingPrice: undefined as number | undefined,
    updateSellingPrice: false,
    notes: "",
  });

  const { data: inventoryList = [], isLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

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
          (item) => item.type === "product" && item.quantity <= LOW_STOCK_THRESHOLD
        );
      default:
        return inventoryList;
    }
  }, [inventoryList, filterType]);

  const lowStockCount = useMemo(() => {
    return inventoryList.filter(
      (item) => item.type === "product" && item.quantity <= LOW_STOCK_THRESHOLD
    ).length;
  }, [inventoryList]);

  const form = useForm<InsertInventory>({
    resolver: zodResolver(insertInventorySchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 0,
    },
  });

  const watchType = form.watch("type");

  const createMutation = useMutation({
    mutationFn: (data: InsertInventory) => apiRequest("POST", "/api/inventory", { ...data, storeId: currentStore?.id }),
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
      closeForm();
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
      storeId: currentStore?.id || "",
      name: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 0,
    });
    setSelectedItem(null);
    setIsFormOpen(true);
  };

  const openEditForm = (item: Inventory) => {
    form.reset({
      storeId: item.storeId,
      name: item.name,
      type: item.type as "product" | "service",
      costPrice: item.costPrice,
      sellingPrice: item.sellingPrice,
      quantity: item.quantity,
    });
    setSelectedItem(item);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedItem(null);
    form.reset();
  };

  const navigateToDetails = (item: Inventory) => {
    setLocation(`/inventory/${item.id}`);
  };

  const onSubmit = (data: InsertInventory) => {
    if (selectedItem) {
      updateMutation.mutate(data);
    } else {
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
    if (item.quantity <= LOW_STOCK_THRESHOLD) {
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">Low Stock</Badge>;
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">In Stock</Badge>;
  };

  const columns = [
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
        <span className="font-mono text-sm">{formatCurrency(item.costPrice)}</span>
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
              <Infinity className="h-3 w-3" /> Unlimited
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
        const margin = ((item.sellingPrice - item.costPrice) / item.sellingPrice) * 100;
        return (
          <span className="font-mono text-sm text-muted-foreground">
            {margin.toFixed(1)}%
          </span>
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

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage your products and services" />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to manage inventory.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description={`Managing inventory for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            <BulkOperations
              entityType="inventory"
              data={inventoryList as unknown as Record<string, unknown>[]}
              columns={[
                { key: "name", header: "Name" },
                { key: "type", header: "Type" },
                { key: "costPrice", header: "Cost Price" },
                { key: "sellingPrice", header: "Selling Price" },
                { key: "quantity", header: "Quantity" },
              ]}
              isLoading={isLoading}
              storeId={currentStore.id}
            />
            <Button onClick={openCreateForm} data-testid="button-add-item">
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        }
      />

      {lowStockCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Low Stock Alert
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {lowStockCount} item{lowStockCount !== 1 ? "s" : ""} {lowStockCount !== 1 ? "are" : "is"} running low on stock (below {LOW_STOCK_THRESHOLD} units)
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

      <Tabs value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            All ({inventoryList.length})
          </TabsTrigger>
          <TabsTrigger value="product" data-testid="tab-products">
            Products ({inventoryList.filter((i) => i.type === "product").length})
          </TabsTrigger>
          <TabsTrigger value="service" data-testid="tab-services">
            Services ({inventoryList.filter((i) => i.type === "service").length})
          </TabsTrigger>
          <TabsTrigger 
            value="low-stock" 
            data-testid="tab-low-stock"
            className={lowStockCount > 0 ? "text-amber-600 dark:text-amber-400" : ""}
          >
            <AlertCircle className="mr-1 h-3 w-3" />
            Low Stock ({lowStockCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        data={filteredInventory}
        columns={columns}
        searchable
        searchPlaceholder="Search inventory..."
        searchKeys={["name"]}
        isLoading={isLoading}
        emptyMessage="No items found. Add your first item to get started."
        onRowClick={navigateToDetails}
      />

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
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
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
    </div>
  );
}
