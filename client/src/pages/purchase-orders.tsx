import { useState } from "react";
import { useLocation } from "wouter";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Truck, CheckSquare, Clock, AlertTriangle, Printer, Trash, RefreshCw, UserCheck, Inbox, Coins } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type BulkAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
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
  const [, setLocation] = useLocation();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [activeTab, setActiveTab] = useUrlState<string>("tab", "list");
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

  // No toast/selection-clear here — driven via BulkAction.onExecute now, and
  // BulkActionsBar reports the outcome itself; a toast here too would double up.
  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/purchase-orders/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
  });

  const bulkDeletePOMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/purchase-orders/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
  });

  const poBulkActions: BulkAction<POWithVendor>[] = [
    {
      id: "cancel",
      label: "Cancel",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      // Not truly undoable (no "un-cancel" endpoint) — "safe" rather than "reversible"
      // so the bar doesn't offer an Undo it can't back up. Only cancellable-state
      // orders are valid; the server rejects the rest, counted here as failures
      // (same no-precheck behavior the old bar had).
      kind: "safe",
      onExecute: async (selection) => {
        const { counts } = await bulkCancelMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.cancelled ?? 0, failed: counts.failed ?? 0 };
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash className="h-3.5 w-3.5" />,
      kind: "destructive",
      destructiveDescription: "This can't be undone.",
      onExecute: async (selection) => {
        const { counts } = await bulkDeletePOMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.deleted ?? 0, failed: counts.failed ?? 0 };
      },
    },
  ];

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

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
  const outstandingPayable = vendorBills
    .filter(b => b.status !== "paid")
    .reduce((sum, b) => sum + (Number(b.amount) - Number(b.amountPaid || 0)), 0);
  const paidLiabilities = vendorBills
    .filter(b => b.status === "paid" || b.status === "partially_paid")
    .reduce((sum, b) => sum + Number(b.amountPaid || 0), 0);

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
        compact
        title="Purchase Orders (PO)"
        description="procure stock from external suppliers, track shipments, and automatically reconcile pricing cost bases."
        actions={
          activeTab === "list" && (
            <>
              <div className="lg:hidden">
                <BulkOperations
                  entityConfig={PURCHASE_ORDER_BULK_CONFIG}
                  data={purchaseOrders as unknown as Record<string, unknown>[]}
                  columns={poExportColumns}
                  isLoading={isLoadingPOs}
                  storeId={currentStore.id}
                  pdfTitle="Purchase Orders Report"
                  onExportPDF={handlePOReportExport}
                  showImportOption={isManagerOrOwner}
                  compact
                />
              </div>
              <div className="hidden lg:block">
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
              </div>
            </>
          )
        }
      />

      <MetricGrid>
        {activeTab === "bills" ? (
          <>
            <MetricCard
              title="Accounts Payable (Outstanding)"
              value={formatCurrency(outstandingPayable)}
              compactValue={formatCompact(outstandingPayable)}
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              isLoading={isLoadingBills}
            />
            <MetricCard
              title="Paid Liabilities (This Month)"
              value={formatCurrency(paidLiabilities)}
              compactValue={formatCompact(paidLiabilities)}
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
              compactValue={formatCompact(totalPOVal)}
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
      </MetricGrid>


      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PolymorphicTabsList
          tabs={[
            { value: "list", label: "Transit Registry", icon: <FileText className="h-4 w-4" /> },
            { value: "bills", label: "Vendor Bills & Payables", icon: <Coins className="h-4 w-4" /> },
          ]}
          variant="default"
          className="mb-4"
        />

        <TabsContent value="list" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Procurement Transit Tracker</CardTitle>
              <CardDescription>Monitor outstanding purchase orders, arrival dates, and supply logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                bulkActions={isManagerOrOwner ? poBulkActions : undefined}
                entityNoun={{ singular: "purchase order", plural: "purchase orders" }}
                urlKey="orders"
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
                urlKey="bills"
              />
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

                <div className="overflow-x-auto my-6">
                <table className="w-full min-w-[640px] text-left text-sm border-collapse">
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
                </div>

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


      {activeTab === "list" && (
        <SpeedDialFAB
          actions={[
            {
              label: "New PO",
              icon: <FileText className="h-5 w-5" />,
              onClick: () => setLocation("/purchase-orders/new"),
              testId: "fab-new-po",
            },
          ]}
        />
      )}
    </div>
  );
}

