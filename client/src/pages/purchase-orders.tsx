import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, FileText, Truck, CheckSquare, Clock, AlertTriangle, Printer, PlusCircle, Trash, RefreshCw, UserCheck, Inbox, Coins } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { PURCHASE_ORDER_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";
import type { PurchaseOrder, PurchaseOrderItem, Inventory, Staff } from "@shared/schema";

type Vendor = { id: string; name: string; phoneNumber?: string; email?: string; companyName?: string };
type POWithVendor = PurchaseOrder & { vendor?: Vendor; vendorName?: string; poNumber: string };
type FullPO = PurchaseOrder & { 
  vendor: Vendor; 
  items: (PurchaseOrderItem & { inventory: Inventory })[] 
};

export default function PurchaseOrdersPage() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [activeTab, setActiveTab] = useState<string>("list");
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // Vendor Bills State
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);

  // Quick Add Vendor State
  const [isQuickVendorOpen, setIsQuickVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorContact, setNewVendorContact] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorNotes, setNewVendorNotes] = useState("");
  const [newVendorStoreId, setNewVendorStoreId] = useState("");

  const createVendorMutation = useMutation({
    mutationFn: async () => {
      if (!newVendorName.trim()) throw new Error("Vendor name is required.");
      const storeIdToUse = currentStore?.id === "all" ? newVendorStoreId : currentStore!.id;
      if (!storeIdToUse) throw new Error("Please select a store location.");

      await apiRequest("POST", "/api/vendors", {
        storeId: storeIdToUse,
        name: newVendorName.trim(),
        contactName: newVendorContact.trim() || undefined,
        email: newVendorEmail.trim() || undefined,
        phone: newVendorPhone.trim() || undefined,
        address: newVendorAddress.trim() || undefined,
        notes: newVendorNotes.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({ title: "Success", description: "Supplier / Vendor added successfully." });
      setIsQuickVendorOpen(false);
      // Reset form
      setNewVendorName("");
      setNewVendorContact("");
      setNewVendorEmail("");
      setNewVendorPhone("");
      setNewVendorAddress("");
      setNewVendorNotes("");
      setNewVendorStoreId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create vendor.", variant: "destructive" });
    },
  });


  // Fetch Vendor Bills
  const { data: vendorBills = [], isLoading: isLoadingBills } = useQuery<any[]>({
    queryKey: ["/api/vendors/bills", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/vendors/bills?storeId=${s.id}`);
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
      const res = await apiRequest("GET", `/api/vendors/bills?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBill) return;
      const parsedAmount = Number(payAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error("Please enter a valid positive payment amount.");
      
      const newPaid = Number(selectedBill.amountPaid || 0) + parsedAmount;
      const status = newPaid >= Number(selectedBill.amount) ? "paid" : "partially_paid";
      
      await apiRequest("PATCH", `/api/vendors/bills/${selectedBill.id}`, {
        amountPaid: newPaid,
        status,
        notes: payNotes || selectedBill.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills"] });
      toast({ title: "Success", description: "Supplier payment recorded, liability updated." });
      setIsPayDialogOpen(false);
      setSelectedBill(null);
      setPayAmount("");
      setPayNotes("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to record payment.", variant: "destructive" });
    },
  });

  // New PO form state
  const [vendorId, setVendorId] = useState<string>("");
  const [poNumber, setPoNumber] = useState<string>(`PO-${Date.now().toString().slice(-6)}`);
  const [expectedDelivery, setExpectedDelivery] = useState<string>("");
  const [items, setItems] = useState<{ inventoryId: string; quantity: number; unitCost: number }[]>([]);

  // Receive PO form state
  const [receiveStaffId, setReceiveStaffId] = useState<string>("");
  const [itemsToReceive, setItemsToReceive] = useState<{ inventoryId: string; quantity: number }[]>([]);

  // Fetch Purchase Orders
  const { data: purchaseOrders = [], isLoading: isLoadingPOs } = useQuery<POWithVendor[]>({
    queryKey: ["/api/purchase-orders", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/purchase-orders?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as POWithVendor[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      const res = await apiRequest("GET", `/api/purchase-orders?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Vendors
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/vendors?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Vendor[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/vendors?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Staff
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/staff?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Staff[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/staff?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Inventory items
  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
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
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Full PO Details
  const { data: fullPO, isLoading: isLoadingDetails } = useQuery<FullPO>({
    queryKey: ["/api/purchase-orders", selectedPOId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/purchase-orders/${selectedPOId}`);
      return res.json();
    },
    enabled: !!selectedPOId,
  });

  // Create PO mutation
  const createPOMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("At least one item is required.");
      if (!vendorId) throw new Error("Please select a vendor.");
      
      const submission = {
        storeId: currentStore!.id,
        vendorId,
        poNumber,
        expectedDelivery: expectedDelivery || null,
        items,
      };
      await apiRequest("POST", "/api/purchase-orders", submission);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Success", description: "Purchase Order drafted successfully." });
      setActiveTab("list");
      resetForm();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to draft Purchase Order.", variant: "destructive" });
    },
  });

  // Receive PO items mutation
  const receivePOMutation = useMutation({
    mutationFn: async () => {
      if (!receiveStaffId) throw new Error("Please select the receiving staff member.");
      const activeReceipts = itemsToReceive.filter(i => i.quantity > 0);
      if (activeReceipts.length === 0) throw new Error("Please specify quantities to receive.");

      await apiRequest("POST", `/api/purchase-orders/${selectedPOId}/receive`, {
        staffId: receiveStaffId,
        itemsToReceive: activeReceipts,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", selectedPOId] });
      toast({ title: "Fulfillment Success", description: "Procurement items received, inventory updated with weighted cost." });
      setIsReceiveOpen(false);
      setIsDetailsOpen(true);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/purchase-orders/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", selectedPOId] });
      toast({ title: "Success", description: "Purchase order status updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to update purchase order status.", variant: "destructive" });
    },
  });

  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/purchase-orders/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      setSelectedIds([]);
      const cancelled = counts.cancelled ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${cancelled} purchase order${cancelled !== 1 ? "s" : ""} cancelled` }
          : { title: `${cancelled} cancelled, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk cancel failed", variant: "destructive" }),
  });

  const bulkDeletePOMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/purchase-orders/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      setSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} purchase order${deleted !== 1 ? "s" : ""} deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const resetForm = () => {
    setVendorId("");
    setPoNumber(`PO-${Date.now().toString().slice(-6)}`);
    setExpectedDelivery("");
    setItems([]);
  };

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const addItemRow = () => {
    setItems([...items, { inventoryId: "", quantity: 1, unitCost: 0 }]);
  };

  const removeItemRow = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, field: string, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-populate cost if inventory item is selected
    if (field === "inventoryId") {
      const inv = inventoryItems.find(i => i.id === value);
      if (inv) {
        updated[index].unitCost = Number(inv.costPrice || 0);
      }
    }
    setItems(updated);
  };

  const poTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "draft") return <Badge variant="secondary" className="bg-slate-100 text-slate-800">Draft</Badge>;
    if (s === "ordered") return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Ordered</Badge>;
    if (s === "partially_received") return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Partially Received</Badge>;
    if (s === "received") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Received & Fulfilled</Badge>;
    if (s === "cancelled") return <Badge variant="secondary" className="bg-red-100 text-red-800">Cancelled</Badge>;
    return <Badge>{status}</Badge>;
  };

  const openReceiveFulfillment = () => {
    if (!fullPO) return;
    setItemsToReceive(
      fullPO.items.map(item => ({
        inventoryId: item.inventoryId,
        quantity: Math.max(0, item.quantity - (item.receivedQuantity || 0)), // default to remaining amount
      }))
    );
    // select first staff by default if available
    if (staffList.length > 0) {
      setReceiveStaffId(staffList[0].id);
    }
    setIsDetailsOpen(false);
    setIsReceiveOpen(true);
  };

  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (q: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {q.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "poNumber",
      header: "PO Code",
      render: (q: POWithVendor) => (
        <span className="font-mono text-sm font-semibold text-primary">{q.poNumber}</span>
      ),
    },
    {
      key: "vendor",
      header: "Supplier / VendorName",
      render: (q: POWithVendor) => (
        <span className="font-medium">{q.vendor?.name || "Unknown Vendor"}</span>
      ),
    },
    {
      key: "totalAmount",
      header: "Total Cost Value",
      render: (q: POWithVendor) => (
        <span className="font-mono font-medium">{formatCurrency(q.totalAmount)}</span>
      ),
    },
    {
      key: "expectedDelivery",
      header: "Expected Delivery",
      render: (q: POWithVendor) => (
        <span className="text-muted-foreground text-sm">
          {q.expectedDelivery ? new Date(q.expectedDelivery).toLocaleDateString() : "Immediate"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q: POWithVendor) => getStatusBadge(q.status),
    },
    {
      key: "actions",
      header: "Actions",
      render: (q: POWithVendor) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedPOId(q.id);
            setIsDetailsOpen(true);
          }}
        >
          Manage Order
        </Button>
      ),
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Purchase Orders" description="Procure supplies, restock inventory and balance cost matrixes." />
        <StoreRequiredAlert title="Store Required for Purchase Orders" />
      </div>
    );
  }

  // Procurement metrics
  const totalPOVal = purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);
  const orderedCount = purchaseOrders.filter(po => po.status === "ordered" || po.status === "partially_received").length;
  const fulfilledCount = purchaseOrders.filter(po => po.status === "received").length;

  const poExportColumns = [
    { key: "poNumber", header: "PO Code" },
    { key: "vendor.name", header: "Vendor" },
    { key: "totalAmount", header: "Total Cost" },
    { key: "status", header: "Status" },
    { key: "expectedDelivery", header: "Expected Delivery" },
    { key: "createdAt", header: "Created" },
  ];

  const handlePOReportExport = () => {
    return exportReportToPDF({
      filename: `purchase-orders-report_${new Date().toISOString().slice(0, 10)}`,
      title: "Purchase Orders Report",
      businessName: currentStore.name,
      storeName: currentStore.name,
      kpis: [
        { label: "Procurement Volume", value: formatCurrency(totalPOVal) },
        { label: "Orders In Transit", value: String(orderedCount) },
        { label: "Fulfilled Receipts", value: String(fulfilledCount) },
        { label: "Total Orders", value: String(purchaseOrders.length) },
      ],
      columns: [
        { key: "poNumber", header: "PO Code" },
        { key: "vendorName", header: "Vendor", format: (po: POWithVendor) => po.vendor?.name || "Unknown" },
        { key: "totalAmount", header: "Total Cost", align: "right" as const, format: (po: POWithVendor) => formatCurrency(po.totalAmount) },
        { key: "status", header: "Status" },
      ],
      rows: purchaseOrders,
      amountKey: "totalAmount",
      formatAmount: formatCurrency,
      statusKey: "status",
      unitLabel: "purchase orders",
    });
  };

  const poFilterConfigs: TableFilterConfig[] = [
    { key: "status", label: "Status", type: "select" },
    { key: "vendor.name", label: "Vendor", type: "select" },
    { key: "createdAt", label: "Order Date", type: "date-range" },
    { key: "totalAmount", label: "Amount", type: "range", currencySymbol: storeCurrency === "USD" ? "$" : "₦" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Purchase Orders (PO)"
        description="procure stock from external suppliers, track shipments, and automatically reconcile pricing cost bases."
        actions={
          activeTab === "list" && (
            <BulkOperations
              entityConfig={PURCHASE_ORDER_BULK_CONFIG}
              data={purchaseOrders as unknown as Record<string, unknown>[]}
              columns={poExportColumns}
              isLoading={isLoadingPOs}
              storeId={currentStore.id}
              pdfTitle="Purchase Orders Report"
              onExportPDF={handlePOReportExport}
              showImportOption={isManagerOrOwner}
            />
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activeTab === "bills" ? (
          <>
            <MetricCard
              title="Accounts Payable (Outstanding)"
              value={formatCurrency(
                vendorBills
                  .filter(b => b.status !== "paid")
                  .reduce((sum, b) => sum + (Number(b.amount) - Number(b.amountPaid || 0)), 0)
              )}
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              isLoading={isLoadingBills}
            />
            <MetricCard
              title="Paid Liabilities (This Month)"
              value={formatCurrency(
                vendorBills
                  .filter(b => b.status === "paid" || b.status === "partially_paid")
                  .reduce((sum, b) => sum + Number(b.amountPaid || 0), 0)
              )}
              icon={<CheckSquare className="h-4 w-4 text-emerald-500" />}
              isLoading={isLoadingBills}
            />
            <MetricCard
              title="Active Invoices"
              value={vendorBills.filter(b => b.status !== "paid").length}
              icon={<FileText className="h-4 w-4 text-blue-500" />}
              isLoading={isLoadingBills}
            />
          </>
        ) : (
          <>
            <MetricCard
              title="Procurement Volume"
              value={formatCurrency(totalPOVal)}
              icon={<Truck className="h-4 w-4 text-blue-500" />}
              isLoading={isLoadingPOs}
            />
            <MetricCard
              title="Orders In Transit"
              value={orderedCount}
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              isLoading={isLoadingPOs}
            />
            <MetricCard
              title="Fulfilled Receipts"
              value={fulfilledCount}
              icon={<CheckSquare className="h-4 w-4 text-emerald-500" />}
              isLoading={isLoadingPOs}
            />
          </>
        )}
      </div>


      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="list" className="gap-2">
            <FileText className="h-4 w-4" /> Transit Registry
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" /> Create Procurement Form
          </TabsTrigger>
          <TabsTrigger value="bills" className="gap-2">
            <Coins className="h-4 w-4" /> Vendor Bills & Payables
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Procurement Transit Tracker</CardTitle>
              <CardDescription>Monitor outstanding purchase orders, arrival dates, and supply logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isManagerOrOwner && (
                <BulkSelectionActionBar
                  count={selectedIds.length}
                  unitLabel="purchase order"
                  onClear={() => setSelectedIds([])}
                  actions={[
                    {
                      key: "cancel",
                      label: "Cancel Selected",
                      pendingLabel: "Cancelling…",
                      icon: <AlertTriangle className="h-3.5 w-3.5" />,
                      tone: "warning",
                      pending: bulkCancelMutation.isPending,
                      onClick: () => bulkCancelMutation.mutate(selectedIds as string[]),
                    },
                    {
                      key: "delete",
                      label: "Delete Selected",
                      pendingLabel: "Deleting…",
                      icon: <Trash className="h-3.5 w-3.5" />,
                      tone: "destructive",
                      pending: bulkDeletePOMutation.isPending,
                      onClick: () => bulkDeletePOMutation.mutate(selectedIds as string[]),
                    },
                  ]}
                />
              )}
              <DataTable
                data={purchaseOrders}
                columns={columns}
                searchable
                searchPlaceholder="Search PO references..."
                searchKeys={["poNumber"]}
                filterConfigs={poFilterConfigs}
                isLoading={isLoadingPOs}
                emptyMessage="No procurement transactions found. Initialize a new order."
                multiselect={isManagerOrOwner}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bills" className="space-y-6">

          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Accounts Payable Registry</CardTitle>
              <CardDescription>Verify supplier invoices, balance payments, and track upcoming due dates.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                data={vendorBills}
                columns={[
                  ...(currentStore?.id === "all" ? [{
                    key: "storeName",
                    header: "Store",
                    render: (b: any) => (
                      <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
                        {b.storeName || "Global"}
                      </Badge>
                    ),
                  }] : []),
                  {
                    key: "billDate",
                    header: "Invoice Date",
                    render: (b: any) => (
                      <span className="text-sm">{new Date(b.billDate).toLocaleDateString()}</span>
                    )
                  },
                  {
                    key: "vendor",
                    header: "Supplier / Vendor",
                    render: (b: any) => (
                      <span className="font-semibold text-primary">{b.vendor?.name || "Unknown Vendor"}</span>
                    )
                  },
                  {
                    key: "amount",
                    header: "Bill Total",
                    render: (b: any) => (
                      <span className="font-mono font-medium">{formatCurrency(b.amount)}</span>
                    )
                  },
                  {
                    key: "amountPaid",
                    header: "Amount Paid",
                    render: (b: any) => (
                      <span className="font-mono text-emerald-500">{formatCurrency(b.amountPaid || 0)}</span>
                    )
                  },
                  {
                    key: "balance",
                    header: "Outstanding Balance",
                    render: (b: any) => {
                      const balance = Number(b.amount) - Number(b.amountPaid || 0);
                      return (
                        <span className={`font-mono font-semibold ${balance > 0 ? "text-red-500 animate-pulse" : "text-emerald-500"}`}>
                          {formatCurrency(balance)}
                        </span>
                      );
                    }
                  },
                  {
                    key: "dueDate",
                    header: "Due Date",
                    render: (b: any) => {
                      if (!b.dueDate) return <span className="text-muted-foreground text-sm">N/A</span>;
                      const due = new Date(b.dueDate);
                      const isOverdue = due.getTime() < Date.now() && b.status !== "paid";
                      return (
                        <span className={`text-sm font-medium ${isOverdue ? "text-red-500 underline font-bold" : "text-muted-foreground"}`}>
                          {due.toLocaleDateString()}
                          {isOverdue && " (Overdue!)"}
                        </span>
                      );
                    }
                  },
                  {
                    key: "status",
                    header: "Payment Status",
                    render: (b: any) => {
                      const status = b.status.toLowerCase();
                      if (status === "paid") return <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">Fully Paid</Badge>;
                      if (status === "partially_paid") return <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">Partially Paid</Badge>;
                      return <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400">Unpaid Liability</Badge>;
                    }
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (b: any) => {
                      const balance = Number(b.amount) - Number(b.amountPaid || 0);
                      if (balance <= 0) return <Badge variant="outline" className="text-emerald-500 border-emerald-500/25">Settled</Badge>;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedBill(b);
                            setPayAmount(balance.toString());
                            setIsPayDialogOpen(true);
                          }}
                        >
                          Record Payment
                        </Button>
                      );
                    }
                  }
                ]}
                searchable
                searchPlaceholder="Search bills by vendor..."
                searchKeys={["vendor.name"]}
                isLoading={isLoadingBills}
                emptyMessage="No accounts payable invoices logged."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>New Purchase Order Form</CardTitle>
              <CardDescription>Issue procurement requests to vendors, establishing contract terms and cost bases.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="vendor">Target Supplier / Vendor</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 text-xs font-semibold text-primary flex items-center gap-1 underline hover:no-underline hover:bg-transparent"
                        onClick={() => setIsQuickVendorOpen(true)}
                      >
                        <Plus className="h-3 w-3" /> Quick Add
                      </Button>
                    </div>
                    <Select value={vendorId} onValueChange={setVendorId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name} ({v.companyName || "No Company"})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>


                  <div className="space-y-2">
                    <Label htmlFor="poNumber">PO Identification Number</Label>
                    <Input
                      id="poNumber"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="e.g. PO-1002"
                      className="font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="expectedDelivery">Expected Date of Arrival</Label>
                    <Input
                      id="expectedDelivery"
                      type="date"
                      value={expectedDelivery}
                      onChange={(e) => setExpectedDelivery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Required Items Grid</Label>
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="flex gap-4 items-center bg-muted/40 p-3 rounded-lg border">
                        <div className="flex-1 min-w-[200px]">
                          <Label className="text-xs text-muted-foreground">Select Product</Label>
                          <Select
                            value={item.inventoryId}
                            onValueChange={(val) => updateItemRow(index, "inventoryId", val)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose item" />
                            </SelectTrigger>
                            <SelectContent>
                              {inventoryItems.map((inv) => (
                                <SelectItem key={inv.id} value={inv.id}>
                                  {inv.name} - SKU: {inv.id.substring(0, 8).toUpperCase()} (In Stock: {inv.quantity})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="w-24">
                          <Label className="text-xs text-muted-foreground">
                            Order Qty{inventoryItems.find(i => i.id === item.inventoryId)?.unit ? ` (${inventoryItems.find(i => i.id === item.inventoryId)?.unit})` : ""}
                          </Label>
                          <Input
                            type="number"
                            min={inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional ? "0.01" : "1"}
                            step={inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional ? "0.01" : "1"}
                            value={item.quantity}
                            onChange={(e) => {
                              const isFrac = inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional;
                              updateItemRow(index, "quantity", isFrac ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 1);
                            }}
                          />
                        </div>

                        <div className="w-32">
                          <Label className="text-xs text-muted-foreground">Supplying Cost ({storeCurrency})</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => updateItemRow(index, "unitCost", Number(e.target.value))}
                          />
                        </div>

                        <div className="w-36 text-right">
                          <Label className="text-xs text-muted-foreground block">Cost Total</Label>
                          <span className="font-mono font-medium block mt-2">
                            {formatCurrency(item.quantity * item.unitCost)}
                          </span>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItemRow(index)}
                          className="text-red-500 hover:text-red-700 mt-5"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <Button variant="outline" onClick={addItemRow} className="w-full gap-2">
                      <PlusCircle className="h-4 w-4" /> Add Procurement Line
                    </Button>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-muted/20 p-4 rounded-lg border">
                  <div>
                    <span className="text-sm text-muted-foreground">Total Procurement Estimate</span>
                    <h2 className="text-2xl font-bold font-mono text-primary mt-1">{formatCurrency(poTotal)}</h2>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={resetForm}>Reset Form</Button>
                    <Button
                      onClick={() => createPOMutation.mutate()}
                      disabled={createPOMutation.isPending || items.length === 0}
                      className="px-6"
                    >
                      Authorize & Draft Purchase Order
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PO Details Modal */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl border border-border bg-background/90 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center w-full pr-6">
              <span>Purchase Order Details</span>
              <div className="flex gap-2">
                {fullPO && ["ordered", "partially_received"].includes(fullPO.status) && (
                  <Button variant="outline" size="sm" onClick={openReceiveFulfillment} className="bg-indigo-600 text-white hover:bg-indigo-700 gap-1">
                    <Inbox className="h-4 w-4" /> Fulfill & Receive Stock
                  </Button>
                )}
                {fullPO && fullPO.status === "draft" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-blue-500 hover:text-blue-700"
                    onClick={() => updateStatusMutation.mutate({ id: fullPO.id, status: "ordered" })}
                  >
                    Confirm & Ship Order
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="py-12 flex justify-center items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !fullPO ? (
            <p className="text-center text-muted-foreground py-8">Purchase Order not found.</p>
          ) : (
            <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-2">
              <div className="bg-card rounded-lg border p-6 space-y-4">
                <div className="flex justify-between items-start pb-4 border-b">
                  <div>
                    <h3 className="text-xl font-bold font-mono">{fullPO.poNumber}</h3>
                    <p className="text-xs text-muted-foreground mt-1">Vendor: {fullPO.vendor?.name}</p>
                    <p className="text-xs text-muted-foreground">Supplier Corporate ID: {fullPO.vendorId?.substring(0, 8).toUpperCase()}</p>
                  </div>
                  <div className="text-right">
                    {getStatusBadge(fullPO.status)}
                    <p className="text-xs text-muted-foreground mt-2">Placed: {new Date(fullPO.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Vendor Info</p>
                    <p className="font-bold">{fullPO.vendor?.companyName || fullPO.vendor?.name}</p>
                    <p className="text-xs">{fullPO.vendor?.phoneNumber || "No Phone Contact"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Expected Arrival</p>
                    <p className="font-bold">
                      {fullPO.expectedDelivery ? new Date(fullPO.expectedDelivery).toLocaleDateString() : "Immediate"}
                    </p>
                  </div>
                </div>

                <table className="w-full text-left text-sm border-collapse my-6">
                  <thead>
                    <tr className="border-b bg-muted/50 font-semibold text-muted-foreground">
                      <th className="py-2 px-3">Product Description</th>
                      <th className="py-2 px-3 text-right">Expected Qty</th>
                      <th className="py-2 px-3 text-right">Received Qty</th>
                      <th className="py-2 px-3 text-right">Procuring Rate</th>
                      <th className="py-2 px-3 text-right">Aggregated Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullPO.items.map((item, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="py-3 px-3">
                          <p className="font-medium">{item.inventory.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.inventory.id.substring(0, 8).toUpperCase()}</p>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{item.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono text-emerald-500 font-bold">
                          {item.receivedQuantity || 0}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{formatCurrency(item.unitCost)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold">{formatCurrency(item.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-between items-center pt-4 border-t">
                  <span className="text-sm text-muted-foreground">Aggregated PO cost:</span>
                  <span className="text-2xl font-bold font-mono text-primary">{formatCurrency(fullPO.totalAmount)}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Stock Fulfillment Modal */}
      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="max-w-2xl border border-border bg-background/95 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle>Procurement Fulfillment Intake</DialogTitle>
            <DialogDescription>Mark quantities received at branch loading bay. Automatically adjusts inventory levels and records liabilities.</DialogDescription>
          </DialogHeader>

          {fullPO && (
            <div className="space-y-6 pt-4">
              <div className="space-y-2">
                <Label htmlFor="receiveStaff">Receiving Staff / Registrar</Label>
                <Select value={receiveStaffId} onValueChange={setReceiveStaffId}>
                  <SelectTrigger id="receiveStaff">
                    <SelectValue placeholder="Choose register operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((st) => (
                      <SelectItem key={st.id} value={st.id}>{st.name} ({st.staffNumber})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <Label>Incoming Stock Checklist</Label>
                <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
                  {fullPO.items.map((item, idx) => {
                    const receivedNow = itemsToReceive.find(i => i.inventoryId === item.inventoryId)?.quantity || 0;
                    const maxAllowed = item.quantity - (item.receivedQuantity || 0);

                    return (
                      <div key={idx} className="flex justify-between items-center p-3 rounded-lg border bg-muted/30">
                        <div>
                          <p className="font-semibold text-sm">{item.inventory.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Expected: {item.quantity} | Already Received: {item.receivedQuantity || 0}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs text-muted-foreground">
                            Receive Now{inventoryItems.find(i => i.id === item.inventoryId)?.unit ? ` (${inventoryItems.find(i => i.id === item.inventoryId)?.unit})` : ""}:
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step={inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional ? "0.01" : "1"}
                            max={maxAllowed}
                            className="w-24 text-right"
                            value={receivedNow}
                            onChange={(e) => {
                              const isFrac = inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional;
                              const parsed = isFrac ? parseFloat(e.target.value) : parseInt(e.target.value);
                              const val = Math.min(maxAllowed, Math.max(0, parsed || 0));
                              setItemsToReceive(
                                itemsToReceive.map(itr =>
                                  itr.inventoryId === item.inventoryId ? { ...itr, quantity: val } : itr
                                )
                              );
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => {
                  setIsReceiveOpen(false);
                  setIsDetailsOpen(true);
                }}>Cancel</Button>
                <Button
                  onClick={() => receivePOMutation.mutate()}
                  disabled={receivePOMutation.isPending}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Confirm Intake & Restock
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Record Payment Dialog */}
      <Dialog open={isPayDialogOpen} onOpenChange={setIsPayDialogOpen}>
        <DialogContent className="max-w-md border border-border bg-background/95 backdrop-blur-lg text-foreground">
          <DialogHeader>
            <DialogTitle>Record Supplier Payment</DialogTitle>
            <DialogDescription>Log a partial or full cash disbursement against an outstanding vendor bill.</DialogDescription>
          </DialogHeader>

          {selectedBill && (
            <div className="space-y-4 pt-4">
              <div className="space-y-1 text-sm bg-muted/30 p-3 rounded border border-border/40">
                <p><strong>Supplier:</strong> {selectedBill.vendor?.name}</p>
                <p><strong>Invoice Date:</strong> {new Date(selectedBill.billDate).toLocaleDateString()}</p>
                <p><strong>Total Bill:</strong> {formatCurrency(selectedBill.amount)}</p>
                <p><strong>Already Settled:</strong> {formatCurrency(selectedBill.amountPaid || 0)}</p>
                <p className="text-red-500 font-semibold">
                  <strong>Remaining Balance:</strong> {formatCurrency(Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0))}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-amount">Payment Amount to Log ({storeCurrency})</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min="0.01"
                  max={Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0)}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="e.g. 5000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-notes">Transaction Reference / Notes</Label>
                <Input
                  id="pay-notes"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Bank Transfer Ref: 109283"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={() => setIsPayDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => recordPaymentMutation.mutate()}
                  disabled={recordPaymentMutation.isPending || !payAmount}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {recordPaymentMutation.isPending ? "Recording..." : "Confirm Disbursement"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Quick Add Vendor Dialog */}
      <Dialog open={isQuickVendorOpen} onOpenChange={setIsQuickVendorOpen}>
        <DialogContent className="max-w-md border border-border bg-background/95 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Plus className="h-5 w-5 text-primary" /> Quick Add Supplier
            </DialogTitle>
            <DialogDescription>
              Create a new supplier / vendor profile to authorize procurement orders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {currentStore?.id === "all" && (
              <div className="space-y-1.5">
                <Label htmlFor="vendor-store">Target Store Location</Label>
                <Select value={newVendorStoreId} onValueChange={setNewVendorStoreId}>
                  <SelectTrigger id="vendor-store">
                    <SelectValue placeholder="Choose a branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.filter(s => s.id !== "all").map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="vendor-name">Supplier Name</Label>
              <Input
                id="vendor-name"
                placeholder="e.g. Acme Supplies Ltd"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact">Contact Person / Organization / Company (Optional)</Label>
              <Input
                id="vendor-contact"
                placeholder="e.g. John Doe or Acme Ltd."
                value={newVendorContact}
                onChange={(e) => setNewVendorContact(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vendor-email">Email (Optional)</Label>
                <Input
                  id="vendor-email"
                  type="email"
                  placeholder="e.g. acme@example.com"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vendor-phone">Phone (Optional)</Label>
                <Input
                  id="vendor-phone"
                  placeholder="e.g. +234 80 1234 5678"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-address">Address (Optional)</Label>
              <Input
                id="vendor-address"
                placeholder="e.g. 12 Industrial Way, Lagos"
                value={newVendorAddress}
                onChange={(e) => setNewVendorAddress(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-notes">Notes (Optional)</Label>
              <Input
                id="vendor-notes"
                placeholder="Preferred categories, lead times, etc."
                value={newVendorNotes}
                onChange={(e) => setNewVendorNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsQuickVendorOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createVendorMutation.mutate()}
                disabled={createVendorMutation.isPending || !newVendorName.trim() || (currentStore?.id === "all" && !newVendorStoreId)}
                className="px-6"
              >
                {createVendorMutation.isPending ? "Adding..." : "Add Supplier"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {activeTab === "list" && (
        <SpeedDialFAB
          actions={[
            {
              label: "New PO",
              icon: <FileText className="h-5 w-5" />,
              onClick: () => setActiveTab("create"),
              testId: "fab-new-po",
            },
          ]}
        />
      )}
    </div>
  );
}

