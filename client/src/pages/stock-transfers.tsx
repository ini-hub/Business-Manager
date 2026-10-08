import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, CheckCircle, XCircle, Clock, Trash2, ArrowUpRight, ArrowDownLeft, RefreshCw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type BulkAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { useAuth } from "@/hooks/useAuth";
import { ListControls } from "@/components/list-controls";
import { MetricRow } from "@/components/metric-row";
import { TransferFiltersSheet, TransferSortSheet } from "@/components/transfer-filter-sheets";
import {
  EMPTY_TRANSFER_FILTERS,
  buildTransferFilterChips,
  clearTransferFilterChip,
  countActiveTransferFilters,
  sortTransfers,
  transferMatchesFilters,
  transferMatchesSearch, transferSortLabel,
  type TransferFilterState,
  type TransferSortState
} from "@/lib/transfer-filters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { STOCK_TRANSFER_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { runBulkFanOut } from "@/lib/bulk-actions";
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
  const [, setLocation] = useLocation();

  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [transferSearchTerm, setTransferSearchTerm] = useState("");
  const [transferFilters, setTransferFilters] = useState<TransferFilterState>(EMPTY_TRANSFER_FILTERS);
  const [transferSort, setTransferSort] = useState<TransferSortState | null>(null);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // Confirm receipt state
  const [isConfirmReceiptOpen, setIsConfirmReceiptOpen] = useState(false);
  const [confirmedQuantities, setConfirmedQuantities] = useState<Record<string, number>>({});

  // Fetch Transfers
  const { data: transfers = [], isLoading: isLoadingTransfers } = useQuery<TransferWithStores[]>({
    queryKey: ["/api/stock-transfers", currentStore?.id],
    queryFn: () => fetchAllPages<TransferWithStores>(`/api/stock-transfers?storeId=${currentStore!.id}`),
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Saved send/request forms for this branch. They reserve no stock and are not transfers.
  const draftsStoreId = currentStore?.id && currentStore.id !== "all" ? currentStore.id : null;
  const { data: draftsList = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-transfer-drafts", draftsStoreId],
    queryFn: () => fetchAllPages<any>(`/api/stock-transfer-drafts?storeId=${draftsStoreId}`),
    enabled: !!draftsStoreId,
  });
  const discardDraft = async (id: string) => {
    const res = await apiRequest("DELETE", `/api/stock-transfer-drafts/${id}`);
    if (!res.ok) {
      toast({ title: "Couldn't discard draft", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["/api/stock-transfer-drafts"] });
    toast({ title: "Draft discarded" });
  };

  // Fetch Stores (for destination selection)
  const { data: stores = [] } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stores");
      return res.json();
    },
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

  // New workflow transition mutations
  const acceptTransferMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PUT", `/api/stock-transfers/${id}/accept`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ title: "Transfer Accepted", description: "Next: the supplying branch will schedule delivery." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Could not accept transfer.", variant: "destructive" });
    },
  });

  const rejectTransferMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("PUT", `/api/stock-transfers/${id}/reject`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ title: "Transfer Rejected", description: "Stock transfer has been declined." });
      setIsDetailsOpen(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Could not reject transfer.", variant: "destructive" });
    },
  });

  const scheduleDeliveryMutation = useMutation({
    mutationFn: async (id: string) => {
      const deliveryDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await apiRequest("PUT", `/api/stock-transfers/${id}/schedule`, {
        deliveryDate,
        deliveryMethod: "courier",
        deliveryNotes: "Scheduled via app"
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ title: "Delivery Scheduled", description: "Transfer is now scheduled for delivery." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Could not schedule delivery.", variant: "destructive" });
    },
  });

  const markDeliveredMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PUT", `/api/stock-transfers/${id}/deliver`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ title: "Transfer Dispatched", description: "Marked as delivered. Destination will confirm receipt." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Could not mark as delivered.", variant: "destructive" });
    },
  });

  const confirmReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PUT", `/api/stock-transfers/${id}/confirm`, {
        confirmedQuantities,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", selectedTransferId] });
      toast({ title: "Receipt Confirmed", description: "Stock has been received and inventory updated." });
      setIsConfirmReceiptOpen(false);
      setConfirmedQuantities({});
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Could not confirm receipt.", variant: "destructive" });
    },
  });

  // Bulk cancel (pending transfers only — the server rejects transitions that aren't valid).
  // No toast/selection-clear here — driven via BulkAction.onExecute now, and
  // BulkActionsBar reports the outcome itself; a toast here too would double up.
  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/stock-transfers/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/stock-transfers/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
    },
  });

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "requested") return <Badge variant="secondary" className="bg-sky-100 text-sky-800">Requested</Badge>;
    if (s === "pending") return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending Approval</Badge>;
    if (s === "completed") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Completed & Dispatched</Badge>;
    if (s === "cancelled") return <Badge variant="secondary" className="bg-red-100 text-red-800">Declined / Cancelled</Badge>;
    return <Badge>{status}</Badge>;
  };

  const columns = [
    {
      key: "direction",
      header: "Direction",
      priority: 2 as const,
      render: (t: TransferWithStores) => {
        const isOutgoing = t.fromStoreId === currentStore!.id;
        return isOutgoing ? (
          <span className="flex items-center gap-2 text-blue-500 font-semibold text-sm">
            <ArrowUpRight className="h-4 w-4" /> Outgoing
          </span>
        ) : (
          <span className="flex items-center gap-2 text-purple-500 font-semibold text-sm">
            <ArrowDownLeft className="h-4 w-4" /> Incoming
          </span>
        );
      },
    },
    {
      key: "fromStore",
      header: "Origin Branch",
      priority: 1 as const,
      render: (t: TransferWithStores) => (
        <span className="font-medium text-sm">{t.fromStore?.name || "Unknown Origin"}</span>
      ),
      cardRender: (t: TransferWithStores) => (
        <span className="truncate">{t.fromStore?.name || "Unknown Origin"} → {t.toStore?.name || "Unknown Target"}</span>
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
      priority: 2 as const,
      render: (t: TransferWithStores) => (
        <span className="text-muted-foreground text-sm">
          {new Date(t.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      priority: 1 as const,
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



  // Aggregates
  const outgoingCount = transfers.filter(t => t.fromStoreId === currentStore.id).length;
  const incomingCount = transfers.filter(t => t.toStoreId === currentStore.id).length;
  const pendingCount = transfers.filter(t => t.status === "pending" || t.status === "requested").length;

  const transfersWithDirection = transfers.map(t => ({
    ...t,
    direction: t.fromStoreId === currentStore.id ? "outgoing" : "incoming",
  }));

  const transferBulkActions: BulkAction<typeof transfersWithDirection[number]>[] = [
    {
      id: "cancel",
      label: "Cancel",
      icon: <XCircle className="h-3.5 w-3.5" />,
      // Not truly undoable (no "un-cancel" endpoint) — "safe" rather than "reversible"
      // so the bar doesn't offer an Undo it can't back up. Only pending transfers are
      // valid to cancel; the server rejects the rest, counted here as failures (same
      // no-precheck behavior the old bar had).
      kind: "safe",
      onExecute: async (selection) => {
        const { counts } = await bulkCancelMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.cancelled ?? 0, failed: counts.failed ?? 0 };
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      kind: "destructive",
      destructiveDescription: "This can't be undone.",
      onExecute: async (selection) => {
        const { counts } = await bulkDeleteMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.deleted ?? 0, failed: counts.failed ?? 0 };
      },
    },
  ];

  const searchedTransfers = transfersWithDirection.filter((t) => transferMatchesSearch(t, transferSearchTerm));
  const visibleTransfers = sortTransfers(
    searchedTransfers.filter((t) => transferMatchesFilters(t, transferFilters)),
    transferSort,
  );
  const branchOptions = Array.from(
    new Set(transfersWithDirection.flatMap((t) => [t.fromStore?.name, t.toStore?.name]).filter((n): n is string => !!n)),
  ).sort();

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
        compact
        title="Stock Transfers"
        description="Shift inventory dynamically across different branch stores, balancing regional demand with atomic logs."
        actions={
          <>
            <AddButton label="Create request" gate="stock_transfer" onClick={() => setLocation("/stock-transfers/new")} data-testid="button-create-transfer" />
            <div className="lg:hidden">
              <BulkOperations
                entityConfig={STOCK_TRANSFER_BULK_CONFIG}
                data={transfersWithDirection as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoadingTransfers}
                storeId={currentStore.id}
                pdfTitle="Stock Transfers Report"
                showImportOption={isManagerOrOwner}
                compact
              />
            </div>
            <div className="hidden lg:block">
              <BulkOperations
                entityConfig={STOCK_TRANSFER_BULK_CONFIG}
                data={transfersWithDirection as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoadingTransfers}
                storeId={currentStore.id}
                pdfTitle="Stock Transfers Report"
                showImportOption={isManagerOrOwner}
              />
            </div>
          </>
        }
      />

      <MetricRow
        metrics={[
          { title: "Outgoing Shipments", value: outgoingCount, icon: <ArrowUpRight className="h-4 w-4 text-blue-500" />, isLoading: isLoadingTransfers },
          { title: "Incoming Shipments", value: incomingCount, icon: <ArrowDownLeft className="h-4 w-4 text-purple-500" />, isLoading: isLoadingTransfers },
          { title: "Pending Approvals", value: pendingCount, icon: <Clock className="h-4 w-4 text-amber-500" />, isLoading: isLoadingTransfers },
        ]}
      />

      {draftsList.length > 0 && (
        <div className="rounded-lg border" data-testid="transfer-drafts">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3 text-sm font-medium">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Drafts ({draftsList.length})
            <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
              Not sent yet. No stock is set aside and the other branch can't see them.
            </span>
          </div>
          <div className="divide-y">
            {draftsList.map((d: any) => {
              const other = stores.find((st) => st.id === d.otherStoreId)?.name;
              const count = Array.isArray(d.formData?.lines) ? d.formData.lines.length : 0;
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {d.kind === "request"
                        ? `Request from ${other ?? "a branch to be chosen"}`
                        : `Send to ${other ?? "a branch to be chosen"}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {count} {count === 1 ? "item" : "items"} · saved {new Date(d.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" onClick={() => setLocation(`/stock-transfers/new?draft=${d.id}`)}>Continue</Button>
                    <Button size="sm" variant="ghost" onClick={() => discardDraft(d.id)}>Discard</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
          <ListControls
            testIdPrefix="transfer"
            placeholder="Search branch or notes"
            search={transferSearchTerm}
            onSearchChange={setTransferSearchTerm}
            filterCount={countActiveTransferFilters(transferFilters)}
            filters={(trigger) => (
              <TransferFiltersSheet
                filters={transferFilters}
                onApply={setTransferFilters}
                branches={branchOptions}
                resultCountFor={(draft) => searchedTransfers.filter((t) => transferMatchesFilters(t, draft)).length}
                trigger={trigger}
              />
            )}
            sortLabel={transferSortLabel(transferSort).replace(/^Sort: /, "")}
            sort={(trigger) => <TransferSortSheet sort={transferSort} onChange={setTransferSort} trigger={trigger} />}
            chips={buildTransferFilterChips(transferFilters)}
            onRemoveChip={(key) => setTransferFilters((f) => clearTransferFilterChip(f, key as keyof TransferFilterState))}
            hasSort={transferSort !== null}
            onClearAll={() => { setTransferFilters(EMPTY_TRANSFER_FILTERS); setTransferSort(null); }}
            visibleCount={visibleTransfers.length}
            noun="transfer"
          />

          <DataTable
            data={visibleTransfers}
            columns={columns}
            hideToolbar
            isLoading={isLoadingTransfers}
            emptyMessage="No stock transfers recorded. Draft one to relocate stock."
            multiselect={isManagerOrOwner}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            bulkActions={isManagerOrOwner ? transferBulkActions : undefined}
            entityNoun={{ singular: "transfer", plural: "transfers" }}
            urlKey="transfers"
            onRowClick={(t) => {
              setSelectedTransferId(t.id);
              setIsDetailsOpen(true);
            }}
            showCardChevron
            cardLayout="compact-grid"
            cardAvatar={(t) => (
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${t.fromStoreId === currentStore.id ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"}`}>
                {t.fromStoreId === currentStore.id ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
              </div>
            )}
          />
      </div>

      {/* Transfer Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl border border-border bg-background/90 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center w-full pr-6">
              <span>Stock Transfer Shipment Review</span>
              <div className="flex gap-2">
                {/* The branch that did not start the transfer decides on it: the receiver for
                    a send, the supplier for a request. The branch that started a request can
                    withdraw it. */}
                {fullTransfer && fullTransfer.status === "requested" && fullTransfer.fromStoreId === currentStore?.id && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                      onClick={() => acceptTransferMutation.mutate(fullTransfer.id)}
                      disabled={acceptTransferMutation.isPending}
                    >
                      <CheckCircle className="h-4 w-4" /> Approve request
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-700 gap-1"
                      onClick={() => rejectTransferMutation.mutate({ id: fullTransfer.id, reason: "Declined by the supplying branch" })}
                      disabled={rejectTransferMutation.isPending}
                    >
                      <XCircle className="h-4 w-4" /> Decline
                    </Button>
                  </>
                )}
                {fullTransfer && fullTransfer.status === "requested" && fullTransfer.toStoreId === currentStore?.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-500 hover:text-red-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullTransfer.id, status: "cancelled" })}
                    disabled={updateStatusMutation.isPending}
                  >
                    <XCircle className="h-4 w-4" /> Cancel request
                  </Button>
                )}
                {fullTransfer && fullTransfer.status === "pending" && fullTransfer.toStoreId === currentStore?.id && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                      onClick={() => acceptTransferMutation.mutate(fullTransfer.id)}
                      disabled={acceptTransferMutation.isPending}
                    >
                      <CheckCircle className="h-4 w-4" /> Accept
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-700 gap-1"
                      onClick={() => rejectTransferMutation.mutate({ id: fullTransfer.id, reason: "Rejected by destination store" })}
                      disabled={rejectTransferMutation.isPending}
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </>
                )}
                {fullTransfer && fullTransfer.status === "accepted" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-blue-600 text-white hover:bg-blue-700 gap-1"
                    onClick={() => scheduleDeliveryMutation.mutate(fullTransfer.id)}
                  >
                    <Clock className="h-4 w-4" /> Schedule Delivery
                  </Button>
                )}
                {fullTransfer && fullTransfer.status === "scheduled" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-amber-600 text-white hover:bg-amber-700 gap-1"
                    onClick={() => markDeliveredMutation.mutate(fullTransfer.id)}
                  >
                    <ArrowDownLeft className="h-4 w-4" /> Mark Delivered
                  </Button>
                )}
                {fullTransfer && fullTransfer.status === "delivered" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-green-600 text-white hover:bg-green-700 gap-1"
                    onClick={() => {
                      const initial: Record<string, number> = {};
                      fullTransfer.items.forEach(item => {
                        initial[item.inventoryId] = item.quantity;
                      });
                      setConfirmedQuantities(initial);
                      setIsConfirmReceiptOpen(true);
                    }}
                  >
                    <CheckCircle className="h-4 w-4" /> Confirm Receipt
                  </Button>
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
                    {fullTransfer.kind === "request" && (
                      <p className="text-xs text-muted-foreground mt-1">Requested by {fullTransfer.toStore?.name}</p>
                    )}
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

      {/* Confirm Receipt Dialog */}
      <Dialog open={isConfirmReceiptOpen} onOpenChange={setIsConfirmReceiptOpen}>
        <DialogContent className="max-w-2xl border border-border bg-background/90 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle>Confirm Stock Receipt</DialogTitle>
          </DialogHeader>
          {fullTransfer && (
            <div className="space-y-6 max-h-[75vh] overflow-y-auto">
              <p className="text-sm text-muted-foreground">
                Verify the quantities received from {fullTransfer.fromStore?.name}. Adjust any items that arrived with shortages or damage.
              </p>
              <div className="space-y-4">
                {fullTransfer.items.map((item) => (
                  <div key={item.inventoryId} className="grid grid-cols-3 gap-4 items-end p-3 bg-muted/40 rounded-lg border">
                    <div>
                      <Label className="text-xs text-muted-foreground">Product</Label>
                      <p className="font-medium">{item.inventory.name}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Shipped Qty</Label>
                      <p className="font-mono font-bold text-blue-600">{item.quantity} units</p>
                    </div>
                    <div>
                      <Label htmlFor={`qty-${item.inventoryId}`} className="text-xs text-muted-foreground">Received Qty</Label>
                      <Input
                        id={`qty-${item.inventoryId}`}
                        type="number"
                        min="0"
                        max={item.quantity}
                        value={confirmedQuantities[item.inventoryId] ?? item.quantity}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(item.quantity, Number(e.target.value) || 0));
                          setConfirmedQuantities(prev => ({
                            ...prev,
                            [item.inventoryId]: val,
                          }));
                        }}
                        className="font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setIsConfirmReceiptOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => confirmReceiptMutation.mutate(fullTransfer.id)}
                  disabled={confirmReceiptMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {confirmReceiptMutation.isPending ? "Confirming..." : "Confirm Receipt"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SpeedDialFAB
        actions={[
          {
            label: "Create request",
            icon: <Plus className="h-5 w-5" />,
            onClick: () => setLocation("/stock-transfers/new"),
            testId: "fab-create-transfer",
          },
        ]}
      />
    </div>
  );
}
