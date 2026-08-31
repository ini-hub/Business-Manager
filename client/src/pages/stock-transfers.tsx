import { useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, ArrowLeftRight, CheckCircle, XCircle, Clock, Trash2, ArrowUpRight, ArrowDownLeft, PlusCircle, Trash, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { STOCK_TRANSFER_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";
import type { StockTransfer, StockTransferItem, Inventory, Store } from "@shared/schema";

type TransferWithStores = StockTransfer & { fromStore: Store; toStore: Store };
type FullTransfer = StockTransfer & { 
  fromStore: Store; 
  toStore: Store; 
  items: (StockTransferItem & { inventory: Inventory })[] 
};

export default function StockTransfersPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useUrlState<string>("tab", "list");
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // New transfer form state
  const [toStoreId, setToStoreId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<{ inventoryId: string; quantity: number | "" }[]>([]);

  // Fetch Transfers
  const { data: transfers = [], isLoading: isLoadingTransfers } = useQuery<TransferWithStores[]>({
    queryKey: ["/api/stock-transfers", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stock-transfers?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Fetch Stores (for destination selection)
  const { data: stores = [] } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stores");
      return res.json();
    },
  });

  // Fetch Inventory items in current store (source stock)
  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Fetch Full Transfer Details
  const { data: fullTransfer, isLoading: isLoadingDetails } = useQuery<FullTransfer>({
    queryKey: ["/api/stock-transfers", selectedTransferId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stock-transfers/${selectedTransferId}`);
      return res.json();
    },
    enabled: !!selectedTransferId,
  });

  // Create Transfer mutation
  const createTransferMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("At least one item is required.");
      if (!toStoreId) throw new Error("Please select a target store.");
      if (toStoreId === currentStore!.id) throw new Error("Source and target stores must be different.");

      // Ensure all quantities are valid numbers >= 1 and clamped to maxStock
      const sanitizedItems = items.map(item => {
        const selectedInv = inventoryItems.find(i => i.id === item.inventoryId);
        const maxStock = selectedInv ? selectedInv.quantity : 0;
        const val = Number(item.quantity) || 1;
        const clamped = maxStock ? Math.min(maxStock, val) : val;
        return {
          inventoryId: item.inventoryId,
          quantity: Math.max(1, clamped),
        };
      });

      const submission = {
        fromStoreId: currentStore!.id,
        toStoreId,
        notes: notes || null,
        items: sanitizedItems,
      };
      await apiRequest("POST", "/api/stock-transfers", submission);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      toast({ title: "Transfer Initialized", description: "Stock shipment draft recorded successfully." });
      setActiveTab("list");
      resetForm();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to initiate transfer.", variant: "destructive" });
    },
  });

  // Update status mutation (approve / cancel)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/stock-transfers/${id}/status`, { status });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ 
        title: variables.status === "completed" ? "Transfer Approved" : "Transfer Cancelled", 
        description: variables.status === "completed" ? "Stock has been shifted atomically across stores." : "Stock transfer proposal declined." 
      });
      setIsDetailsOpen(false);
      setSelectedTransferId(null);
    },
    onError: (error) => {
      toast({ title: "Fulfillment Failed", description: error.message || "Could not complete transfer.", variant: "destructive" });
    },
  });

  // Bulk cancel (pending transfers only — the server rejects transitions that aren't valid)
  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/stock-transfers/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      setSelectedIds([]);
      const cancelled = counts.cancelled ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${cancelled} transfer${cancelled !== 1 ? "s" : ""} cancelled` }
          : { title: `${cancelled} cancelled, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk cancel failed", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/stock-transfers/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      setSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} transfer${deleted !== 1 ? "s" : ""} deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const resetForm = () => {
    setToStoreId("");
    setNotes("");
    setItems([]);
  };

  const addItemRow = () => {
    setItems([...items, { inventoryId: "", quantity: 1 }]);
  };

  const removeItemRow = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, field: string, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "pending") return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending Approval</Badge>;
    if (s === "completed") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Completed & Dispatched</Badge>;
    if (s === "cancelled") return <Badge variant="secondary" className="bg-red-100 text-red-800">Declined / Cancelled</Badge>;
    return <Badge>{status}</Badge>;
  };

  const columns = [
    {
      key: "direction",
      header: "Direction",
      render: (t: TransferWithStores) => {
        const isOutgoing = t.fromStoreId === currentStore!.id;
        return isOutgoing ? (
          <span className="flex items-center gap-1.5 text-blue-500 font-semibold text-sm">
            <ArrowUpRight className="h-4 w-4" /> Outgoing
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-purple-500 font-semibold text-sm">
            <ArrowDownLeft className="h-4 w-4" /> Incoming
          </span>
        );
      },
    },
    {
      key: "fromStore",
      header: "Origin Branch",
      render: (t: TransferWithStores) => (
        <span className="font-medium text-sm">{t.fromStore?.name || "Unknown Origin"}</span>
      ),
    },
    {
      key: "toStore",
      header: "Destination Branch",
      render: (t: TransferWithStores) => (
        <span className="font-medium text-sm">{t.toStore?.name || "Unknown Target"}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Transfer Date",
      render: (t: TransferWithStores) => (
        <span className="text-muted-foreground text-sm">
          {new Date(t.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t: TransferWithStores) => getStatusBadge(t.status),
    },
    {
      key: "actions",
      header: "Actions",
      render: (t: TransferWithStores) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedTransferId(t.id);
            setIsDetailsOpen(true);
          }}
        >
          View shipment
        </Button>
      ),
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Stock Transfers" description="Manage multi-location inventory movement." />
        <StoreRequiredAlert title="Store Required for Stock Transfers" />
      </div>
    );
  }

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <PageHeader title="Stock Transfers" description="Manage multi-location inventory movement." />
        <ConsolidatedFallbackAlert pageTitle="Stock Transfers" />
      </div>
    );
  }

  // Filter destination stores to exclude origin
  const otherStores = stores.filter(s => s.id !== currentStore.id);

  // Aggregates
  const outgoingCount = transfers.filter(t => t.fromStoreId === currentStore.id).length;
  const incomingCount = transfers.filter(t => t.toStoreId === currentStore.id).length;
  const pendingCount = transfers.filter(t => t.status === "pending").length;

  const transfersWithDirection = transfers.map(t => ({
    ...t,
    direction: t.fromStoreId === currentStore.id ? "outgoing" : "incoming",
  }));

  const transferFilterConfigs: TableFilterConfig[] = [
    { key: "status", label: "Status", type: "select" },
    { key: "direction", label: "Direction", type: "select" },
    { key: "createdAt", label: "Transfer Date", type: "date-range" },
  ];

  const exportColumns = [
    { key: "direction", header: "Direction" },
    { key: "fromStore.name", header: "Origin Branch" },
    { key: "toStore.name", header: "Destination Branch" },
    { key: "status", header: "Status" },
    { key: "createdAt", header: "Transfer Date" },
    { key: "notes", header: "Notes" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Stock Transfers"
        description="Shift inventory dynamically across different branch stores, balancing regional demand with atomic logs."
        actions={
          <BulkOperations
            entityConfig={STOCK_TRANSFER_BULK_CONFIG}
            data={transfersWithDirection as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            isLoading={isLoadingTransfers}
            storeId={currentStore.id}
            pdfTitle="Stock Transfers Report"
            showImportOption={isManagerOrOwner}
          />
        }
      />

      <MetricGrid>
        <MetricCard
          title="Outgoing Shipments"
          value={outgoingCount}
          icon={<ArrowUpRight className="h-4 w-4 text-blue-500" />}
          isLoading={isLoadingTransfers}
        />
        <MetricCard
          title="Incoming Shipments"
          value={incomingCount}
          icon={<ArrowDownLeft className="h-4 w-4 text-purple-500" />}
          isLoading={isLoadingTransfers}
        />
        <MetricCard
          title="Pending Approvals"
          value={pendingCount}
          icon={<Clock className="h-4 w-4 text-amber-500" />}
          isLoading={isLoadingTransfers}
        />
      </MetricGrid>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="list" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" /> Transfer Registry
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" /> Create Stock Dispatch
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Cross-Store Shipment Registry</CardTitle>
              <CardDescription>Monitor outstanding transfer requests, origins, and arrival logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isManagerOrOwner && (
                <BulkSelectionActionBar
                  count={selectedIds.length}
                  unitLabel="transfer"
                  onClear={() => setSelectedIds([])}
                  actions={[
                    {
                      key: "cancel",
                      label: "Cancel Selected",
                      pendingLabel: "Cancelling…",
                      icon: <XCircle className="h-3.5 w-3.5" />,
                      tone: "warning",
                      pending: bulkCancelMutation.isPending,
                      onClick: () => bulkCancelMutation.mutate(selectedIds as string[]),
                    },
                    {
                      key: "delete",
                      label: "Delete Selected",
                      pendingLabel: "Deleting…",
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      tone: "destructive",
                      pending: bulkDeleteMutation.isPending,
                      onClick: () => bulkDeleteMutation.mutate(selectedIds as string[]),
                    },
                  ]}
                />
              )}
              <DataTable
                data={transfersWithDirection}
                columns={columns}
                searchable
                searchPlaceholder="Search notes..."
                searchKeys={["notes"]}
                filterConfigs={transferFilterConfigs}
                isLoading={isLoadingTransfers}
                emptyMessage="No stock transfers recorded. Draft one to relocate stock."
                multiselect={isManagerOrOwner}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
                urlKey="transfers"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Initiate Stock Transfer</CardTitle>
              <CardDescription>Reallocate inventory cohorts between branch locations. Source stock is reserved pending approval.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Origin Branch (Source)</Label>
                    <Input value={currentStore.name} disabled className="font-semibold bg-muted" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="toStore">Destination Branch (Target)</Label>
                    <Select value={toStoreId} onValueChange={setToStoreId}>
                      <SelectTrigger id="toStore">
                        <SelectValue placeholder="Select target store branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherStores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({s.address || "No Address"})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Required Items Grid</Label>
                  <div className="space-y-3">
                    {items.map((item, index) => {
                      const selectedInv = inventoryItems.find(i => i.id === item.inventoryId);
                      const maxStock = selectedInv ? selectedInv.quantity : 0;

                      return (
                        <div key={index} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center bg-muted/40 p-3 rounded-lg border">
                          <div className="flex-1 sm:min-w-[200px]">
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
                                    {inv.name} (SKU: {inv.id.substring(0, 8).toUpperCase()}) | Stock: {inv.quantity}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-full sm:w-36">
                            <div className="flex justify-between items-center mb-1">
                              <Label className="text-xs text-muted-foreground">Transfer Qty</Label>
                              {selectedInv && (
                                <span className="text-[10px] text-amber-600 font-semibold font-mono">Max: {maxStock}</span>
                              )}
                            </div>
                            <Input
                              type="number"
                              min="1"
                              max={maxStock || undefined}
                              value={item.quantity}
                              onChange={(e) => {
                                const valStr = e.target.value;
                                if (valStr === "") {
                                  updateItemRow(index, "quantity", "");
                                  return;
                                }
                                const val = Number(valStr);
                                if (isNaN(val)) return;
                                const clamped = maxStock ? Math.min(maxStock, val) : val;
                                updateItemRow(index, "quantity", clamped);
                              }}
                              onBlur={() => {
                                const val = Number(item.quantity);
                                const clamped = maxStock ? Math.min(maxStock, val) : val;
                                updateItemRow(index, "quantity", Math.max(1, clamped));
                              }}
                            />
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItemRow(index)}
                            className="text-red-500 hover:text-red-700 self-end sm:self-auto sm:mt-5"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}

                    <Button variant="outline" onClick={addItemRow} className="w-full gap-2">
                      <PlusCircle className="h-4 w-4" /> Add Item Line
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Dispatch notes (Optional)</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Relocating slow-moving items due to promotion in branch B."
                  />
                </div>

                <div className="flex justify-end gap-2 bg-muted/20 p-4 rounded-lg border">
                  <Button variant="ghost" onClick={resetForm}>Reset Form</Button>
                  <Button
                    onClick={() => createTransferMutation.mutate()}
                    disabled={createTransferMutation.isPending || items.length === 0}
                    className="px-6"
                  >
                    Initiate Stock Transfer
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transfer Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl border border-border bg-background/90 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center w-full pr-6">
              <span>Stock Transfer Shipment Review</span>
              <div className="flex gap-2">
                {fullTransfer && fullTransfer.status === "pending" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                      onClick={() => updateStatusMutation.mutate({ id: fullTransfer.id, status: "completed" })}
                    >
                      <CheckCircle className="h-4 w-4" /> Approve & Dispatch
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-700 gap-1"
                      onClick={() => updateStatusMutation.mutate({ id: fullTransfer.id, status: "cancelled" })}
                    >
                      <XCircle className="h-4 w-4" /> Decline
                    </Button>
                  </>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="py-12 flex justify-center items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !fullTransfer ? (
            <p className="text-center text-muted-foreground py-8">Stock transfer not found.</p>
          ) : (
            <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-2">
              <div className="bg-card rounded-lg border p-6 space-y-4">
                <div className="flex justify-between items-start pb-4 border-b">
                  <div>
                    <h3 className="text-lg font-bold font-mono">Shipment ID: #{fullTransfer.id.slice(-6)}</h3>
                    <p className="text-xs text-muted-foreground mt-1">Status: {getStatusBadge(fullTransfer.status)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Dispatched: {new Date(fullTransfer.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-3 rounded-lg border">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Origin Branch</p>
                    <p className="font-bold">{fullTransfer.fromStore?.name}</p>
                    <p className="text-xs text-muted-foreground">{fullTransfer.fromStore?.address || "No Address details"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Destination Branch</p>
                    <p className="font-bold">{fullTransfer.toStore?.name}</p>
                    <p className="text-xs text-muted-foreground">{fullTransfer.toStore?.address || "No Address details"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase font-semibold">Items List</p>
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b bg-muted font-semibold text-muted-foreground">
                        <th className="py-2 px-3">Product Name</th>
                        <th className="py-2 px-3 text-right">Transfer Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullTransfer.items.map((item, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-3 px-3">
                            <p className="font-medium">{item.inventory.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{item.inventory.id.substring(0, 8).toUpperCase()}</p>
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-blue-600">
                            {item.quantity} units
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {fullTransfer.notes && (
                  <div className="pt-4 border-t text-sm">
                    <span className="text-xs text-muted-foreground font-semibold uppercase block mb-1">Transfer Notes:</span>
                    <span className="italic text-muted-foreground">{fullTransfer.notes}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
