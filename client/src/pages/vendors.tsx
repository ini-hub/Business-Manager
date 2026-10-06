import { useState } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { AddButton } from "@/components/add-button";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import { buildSlug } from "@/lib/slug";
import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Phone, Mail, FileText, Building2, Archive, RotateCcw } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type BulkAction, type RowAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
import { ListControls } from "@/components/list-controls";
import { MetricRow } from "@/components/metric-row";
import { VendorFiltersSheet, VendorSortSheet } from "@/components/vendor-filter-sheets";
import {
  EMPTY_VENDOR_FILTERS,
  buildVendorFilterChips,
  clearVendorFilterChip,
  countActiveVendorFilters,
  sortVendors,
  vendorMatchesFilters,
  vendorSortLabel,
  type VendorFilterState,
  type VendorSortState,
} from "@/lib/vendor-filters";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { BulkOperations } from "@/components/bulk-operations";
import { VENDOR_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { Vendor, VendorBill } from "@shared/schema";

type VendorWithStats = Vendor & {
  totalBilled?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  billCount?: number;
  openOrders?: number;
  lastOrderAt?: string | null;
};

export default function VendorsPage() {
  const { currentStore, business } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { toast } = useToast();
  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";
  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (v: number) => formatCurrencyUtil(v, storeCurrency);
  const formatCompact = (v: number) => formatCurrencyCompact(v, storeCurrency);

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useUrlState<"active" | "archived">("tab", "active");
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [archivedSelectedIds, setArchivedSelectedIds] = useState<(string | number)[]>([]);
  const [vendorSearchTerm, setVendorSearchTerm] = useState("");
  const [vendorFilters, setVendorFilters] = useState<VendorFilterState>(EMPTY_VENDOR_FILTERS);
  const [vendorSort, setVendorSort] = useState<VendorSortState | null>(null);
  const [archivedSearchTerm, setArchivedSearchTerm] = useState("");
  const [archivedSort, setArchivedSort] = useState<VendorSortState | null>(null);
  const [visibleVendorRows, setVisibleVendorRows] = useState<VendorWithStats[]>([]);
  const [location, setLocation] = useLocation();
  const search = useSearch();

  // Fetch all vendors (active + archived) — client splits them
  const { data: allVendors = [], isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors?storeId=${currentStore!.id}&includeArchived=true`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore.id !== "all",
    staleTime: STALE_TIMES.reference,
  });

  const vendors = allVendors.filter(v => !v.isArchived);
  const archivedVendors = allVendors.filter(v => v.isArchived);

  const { data: bills = [] } = useQuery<(VendorBill & { vendorName?: string })[]>({
    queryKey: ["/api/vendors/bills", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors/bills?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore.id !== "all",
  });

  const { isDisabled } = useEntitlements();
  const { data: vendorPOs = [] } = useQuery<{ vendorId: string; status: string; createdAt: string }[]>({
    queryKey: ["/api/purchase-orders", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/purchase-orders?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !isDisabled("purchase_order_tracking") && !!currentStore?.id && currentStore.id !== "all",
  });

  // Enrich vendors with bill stats
  const vendorsWithStats: VendorWithStats[] = vendors.map((v) => {
    const vBills = bills.filter((b) => b.vendorId === v.id);
    const totalBilled = vBills.reduce((s, b) => s + Number(b.amount), 0);
    const totalPaid = vBills.reduce((s, b) => s + Number(b.amountPaid ?? 0), 0);
    const vPOs = vendorPOs.filter((po) => po.vendorId === v.id);
    const openOrders = vPOs.filter((po) => po.status === "ordered" || po.status === "partially_received").length;
    const lastOrderAt = vPOs.reduce<string | null>((m, po) => (!m || po.createdAt > m ? po.createdAt : m), null);
    return { ...v, totalBilled, totalPaid, outstandingBalance: totalBilled - totalPaid, billCount: vBills.length, openOrders, lastOrderAt };
  });

  const selectedVendorBills = bills.filter((b) => b.vendorId === selectedVendorId);

  const archiveMutation = useMutation({
    mutationFn: (vendorId: string) => apiRequest("PATCH", `/api/vendors/${vendorId}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      toast({ title: "Vendor archived" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (vendorId: string) => apiRequest("PATCH", `/api/vendors/${vendorId}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      toast({ title: "Vendor restored" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (vendorId: string) => {
      const res = await apiRequest("DELETE", `/api/vendors/${vendorId}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Failed to delete"); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      toast({ title: "Vendor permanently deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // No toast/selection-clear in these 3 — driven via BulkAction.onExecute now, and
  // BulkActionsBar reports the outcome itself; a toast here too would double up.
  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("PATCH", `/api/vendors/${id}/archive`, {}, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("archive failed");
        return "archived" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
    },
  });

  const bulkRestoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("PATCH", `/api/vendors/${id}/restore`, {}, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("restore failed");
        return "restored" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("DELETE", `/api/vendors/${id}`, undefined, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
    },
  });

  const activeVendorBulkActions: BulkAction<VendorWithStats>[] = [
    {
      id: "archive",
      label: "Archive",
      icon: <Archive className="h-3.5 w-3.5" />,
      kind: "reversible",
      onExecute: async (selection) => {
        const { counts } = await bulkArchiveMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.archived ?? 0, failed: counts.failed ?? 0 };
      },
      onUndo: async () => {
        const ids = selectedIds as string[];
        await Promise.allSettled(ids.map((id) => restoreMutation.mutateAsync(id)));
      },
    },
  ];

  const archivedVendorBulkActions: BulkAction<VendorWithStats>[] = [
    {
      id: "restore",
      label: "Restore",
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      kind: "safe",
      onExecute: async (selection) => {
        const { counts } = await bulkRestoreMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.restored ?? 0, failed: counts.failed ?? 0 };
      },
    },
    // Permanent delete matches the server's owner-only requireRole("owner") gate.
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      kind: "destructive",
      hidden: !isOwner,
      destructiveDescription: "This can't be undone.",
      onExecute: async (selection) => {
        const { counts } = await bulkDeleteMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.deleted ?? 0, failed: counts.failed ?? 0 };
      },
    },
  ];

  if (!currentStore) return <div className="space-y-6"><PageHeader title="Vendors" description="Manage suppliers and outstanding bills" /><StoreRequiredAlert title="Store Required" /></div>;

  const openCreate = () => setLocation("/vendors/new");
  const openEdit = (v: Vendor) => setLocation(`/vendors/${buildSlug(v.name, v.id)}/edit`);

  const totalOutstanding = vendorsWithStats.reduce((s, v) => s + (v.outstandingBalance ?? 0), 0);
  const unpaidBills = bills.filter((b) => b.status !== "paid").length;

  const exportColumns = [
    { key: "name", header: "Vendor" },
    { key: "contactName", header: "Contact Name" },
    { key: "phone", header: "Phone" },
    { key: "email", header: "Email" },
    { key: "address", header: "Address" },
    { key: "totalBilled", header: "Total Billed" },
    { key: "outstandingBalance", header: "Outstanding" },
  ];

  const handleVendorsReportExport = (filtered = false) => {
    const rows = filtered
      ? visibleVendorRows
      : (activeTab === "active" ? vendorsWithStats : (archivedVendors as VendorWithStats[]));
    const scopedVendorIds = filtered ? new Set(rows.map((v) => v.id)) : null;
    const scopedBills = scopedVendorIds ? bills.filter((b) => scopedVendorIds.has(b.vendorId)) : bills;
    return exportReportToPDF({
      filename: `vendors-report_${activeTab}_${new Date().toISOString().slice(0, 10)}`,
      title: `Vendors Report (${activeTab === "active" ? "Active" : "Archived"})`,
      businessName: business?.name ?? currentStore.name,
      storeName: currentStore.name,
      kpis: [
        { label: "Total Vendors", value: String(rows.length) },
        { label: "Open Bills", value: String(scopedBills.filter((b) => b.status !== "paid").length) },
        { label: "Total Outstanding", value: formatCurrency(rows.reduce((s, v) => s + (v.outstandingBalance ?? 0), 0)) },
        { label: "Total Bills", value: String(scopedBills.length) },
      ],
      columns: [
        { key: "name", header: "Vendor" },
        { key: "contactName", header: "Contact" },
        { key: "phone", header: "Phone" },
        { key: "email", header: "Email" },
        { key: "totalBilled", header: "Total Billed", align: "right" as const, format: (v: VendorWithStats) => formatCurrency(v.totalBilled ?? 0) },
        { key: "outstandingBalance", header: "Outstanding", align: "right" as const, format: (v: VendorWithStats) => formatCurrency(v.outstandingBalance ?? 0) },
      ],
      rows,
      amountKey: "outstandingBalance",
      formatAmount: formatCurrency,
      unitLabel: "vendors",
    });
  };

  const vendorCardAvatar = (v: VendorWithStats) => (
    <Avatar className="h-10 w-10">
      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
        {getCustomerInitials(v.name)}
      </AvatarFallback>
    </Avatar>
  );

  const activeRowActions = (v: VendorWithStats): RowAction[] =>
    isManagerOrOwner
      ? [
          { label: "Edit vendor", icon: <Edit className="h-4 w-4" />, onClick: () => openEdit(v) },
          { label: "Archive vendor", icon: <Archive className="h-4 w-4" />, onClick: () => archiveMutation.mutate(v.id), disabled: archiveMutation.isPending },
        ]
      : [];

  const archivedRowActions = (v: VendorWithStats): RowAction[] =>
    isManagerOrOwner
      ? [
          { label: "Restore vendor", icon: <RotateCcw className="h-4 w-4" />, onClick: () => restoreMutation.mutate(v.id), disabled: restoreMutation.isPending },
          // Permanent delete matches the server's owner-only requireRole("owner") gate on DELETE /api/vendors/:id
          ...(isOwner ? [{ label: "Permanently delete", icon: <Trash2 className="h-4 w-4" />, onClick: () => deleteMutation.mutate(v.id), destructive: true, disabled: deleteMutation.isPending }] : []),
        ]
      : [];

  const vendorColumns = [
    { key: "name", header: "Vendor", priority: 1 as const, cardRender: (v: VendorWithStats) => <span className="truncate">{v.name}</span>, render: (v: VendorWithStats) => (
      <button className="text-left" onClick={() => setSelectedVendorId(selectedVendorId === v.id ? null : v.id)}>
        <p className="font-medium text-sm">{v.name}</p>
        {v.contactName && <p className="text-xs text-muted-foreground">{v.contactName}</p>}
      </button>
    )},
    { key: "phone", header: "Contact", priority: 2 as const, cardRender: (v: VendorWithStats) => <span className="truncate">{v.phone || v.email || v.contactName || "—"}</span>, render: (v: VendorWithStats) => (
      <div className="space-y-0.5">
        {v.phone && <p className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" />{v.phone}</p>}
        {v.email && <p className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" />{v.email}</p>}
      </div>
    )},
    { key: "totalBilled", header: "Total Billed", priority: 2 as const, render: (v: VendorWithStats) => <span className="font-mono text-sm">{formatCurrency(v.totalBilled ?? 0)}</span> },
    { key: "outstandingBalance", header: "Outstanding", priority: 1 as const, render: (v: VendorWithStats) => (
      <span className={`font-mono text-sm font-medium ${(v.outstandingBalance ?? 0) > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
        {formatCurrency(v.outstandingBalance ?? 0)}
      </span>
    )},
  ];

  const archivedVendorColumns = [
    { key: "name", header: "Vendor", priority: 1 as const, cardRender: (v: VendorWithStats) => <span className="truncate">{v.name}</span>, render: (v: VendorWithStats) => (
      <div>
        <p className="font-medium text-sm text-muted-foreground">{v.name}</p>
        {v.contactName && <p className="text-xs text-muted-foreground">{v.contactName}</p>}
      </div>
    )},
    { key: "phone", header: "Contact", priority: 2 as const, cardRender: (v: VendorWithStats) => <span className="truncate">{v.phone || v.email || "—"}</span>, render: (v: VendorWithStats) => (
      <div className="space-y-0.5">
        {v.phone && <p className="text-xs flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{v.phone}</p>}
        {v.email && <p className="text-xs flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{v.email}</p>}
      </div>
    )},
  ];

  const billColumns = [
    { key: "amount", header: "Amount", render: (b: any) => <span className="font-mono">{formatCurrency(Number(b.amount))}</span> },
    { key: "amountPaid", header: "Paid", render: (b: any) => <span className="font-mono text-emerald-600">{formatCurrency(Number(b.amountPaid ?? 0))}</span> },
    { key: "status", header: "Status", render: (b: any) => (
      <Badge variant={b.status === "paid" ? "default" : b.status === "partial" ? "secondary" : "destructive"} className="capitalize">{b.status}</Badge>
    )},
    { key: "dueDate", header: "Due", render: (b: any) => b.dueDate ? new Date(b.dueDate).toLocaleDateString() : "—" },
    { key: "actions", header: "", render: (b: any) => b.status !== "paid" && isManagerOrOwner && (
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLocation(appendReturnTo(`/vendors/bills/${b.id}/pay`, location, search))}>Pay</Button>
    )},
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Vendors"
        description="Manage your suppliers and track outstanding bills"
        actions={
          <div className="flex items-center gap-2">
            <div className="lg:hidden">
              <BulkOperations
                entityConfig={VENDOR_BULK_CONFIG}
                data={(activeTab === "active" ? vendorsWithStats : archivedVendors) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Vendors Report (${activeTab})`}
                onExportPDF={() => handleVendorsReportExport()}
                onExportFilteredPDF={() => handleVendorsReportExport(true)}
                visibleData={visibleVendorRows as unknown as Record<string, unknown>[]}
                showImportOption={isManagerOrOwner}
                compact
              />
            </div>
            <div className="hidden lg:block">
              <BulkOperations
                entityConfig={VENDOR_BULK_CONFIG}
                data={(activeTab === "active" ? vendorsWithStats : archivedVendors) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Vendors Report (${activeTab})`}
                onExportPDF={() => handleVendorsReportExport()}
                onExportFilteredPDF={() => handleVendorsReportExport(true)}
                visibleData={visibleVendorRows as unknown as Record<string, unknown>[]}
                showImportOption={isManagerOrOwner}
              />
            </div>
            {isManagerOrOwner && (
              <AddButton label="Add Vendor" gate="vendor_details" onClick={openCreate} data-testid="button-add-vendor" />
            )}
          </div>
        }
      />

      <MetricRow
        metrics={[
          { title: "Total Vendors", value: vendors.length },
          { title: "Open Bills", value: unpaidBills },
          { title: "Total Outstanding", value: formatCurrency(totalOutstanding), compactValue: formatCompact(totalOutstanding) },
          { title: "Total Bills", value: bills.length },
        ]}
      />

      {/* Vendor list with tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "active" | "archived")}>
        <PolymorphicTabsList
          tabs={[
            { value: "active", label: `Active ${vendors.length}` },
            { value: "archived", label: `Archived ${archivedVendors.length}` },
          ]}
          variant="bordered"
        />

        {(() => {
          const searchRows = <T extends VendorWithStats>(rows: T[], term: string): T[] => {
            const q = term.trim().toLowerCase();
            if (!q) return rows;
            return rows.filter((v) =>
              v.name.toLowerCase().includes(q) ||
              v.contactName?.toLowerCase().includes(q) ||
              v.email?.toLowerCase().includes(q) ||
              v.phone?.toLowerCase().includes(q)
            );
          };
          const searchedActive = searchRows(vendorsWithStats, vendorSearchTerm);
          const visibleActive = sortVendors(searchedActive.filter((v) => vendorMatchesFilters(v, vendorFilters)), vendorSort);
          const searchedArchived = searchRows(archivedVendors as VendorWithStats[], archivedSearchTerm);
          const visibleArchived = sortVendors(searchedArchived, archivedSort);

          return (
            <>
              <TabsContent value="active" className="mt-4 space-y-3">
                <ListControls
                  testIdPrefix="vendor"
                  placeholder="Search vendor, contact, phone or email"
                  search={vendorSearchTerm}
                  onSearchChange={setVendorSearchTerm}
                  filterCount={countActiveVendorFilters(vendorFilters)}
                  filters={(trigger) => (
                    <VendorFiltersSheet
                      filters={vendorFilters}
                      onApply={setVendorFilters}
                      resultCountFor={(draft) => searchedActive.filter((v) => vendorMatchesFilters(v, draft)).length}
                      trigger={trigger}
                    />
                  )}
                  sortLabel={vendorSortLabel(vendorSort).replace(/^Sort: /, "")}
                  sort={(trigger) => <VendorSortSheet sort={vendorSort} onChange={setVendorSort} trigger={trigger} />}
                  chips={buildVendorFilterChips(vendorFilters)}
                  onRemoveChip={(key) => setVendorFilters((f) => clearVendorFilterChip(f, key as keyof VendorFilterState))}
                  hasSort={vendorSort !== null}
                  onClearAll={() => { setVendorFilters(EMPTY_VENDOR_FILTERS); setVendorSort(null); }}
                  visibleCount={visibleActive.length}
                  noun="vendor"
                />

                <DataTable
                  data={visibleActive}
                  columns={vendorColumns}
                  hideToolbar
                  isLoading={isLoading}
                  emptyTitle="No Vendors Yet"
                  emptyMessage="Add your suppliers to start tracking bills and payments."
                  emptyIcon={<Building2 className="h-6 w-6" />}
                  emptyAction={isManagerOrOwner && <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" />Add First Vendor</Button>}
                  multiselect={isManagerOrOwner}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={setSelectedIds}
                  bulkActions={isManagerOrOwner ? activeVendorBulkActions : undefined}
                  entityNoun={{ singular: "vendor", plural: "vendors" }}
                  onVisibleDataChange={setVisibleVendorRows}
                  urlKey="active"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={vendorCardAvatar}
                  rowActions={activeRowActions}
                />
              </TabsContent>

              <TabsContent value="archived" className="mt-4 space-y-3">
                <ListControls
                  testIdPrefix="archived-vendor"
                  placeholder="Search vendor, contact, phone or email"
                  search={archivedSearchTerm}
                  onSearchChange={setArchivedSearchTerm}
                  filterCount={0}
                  sortLabel={vendorSortLabel(archivedSort).replace(/^Sort: /, "")}
                  sort={(trigger) => <VendorSortSheet sort={archivedSort} onChange={setArchivedSort} nameOnly trigger={trigger} />}
                  chips={[]}
                  onRemoveChip={() => {}}
                  hasSort={archivedSort !== null}
                  onClearAll={() => setArchivedSort(null)}
                  visibleCount={visibleArchived.length}
                  noun="vendor"
                />

                <DataTable
                  data={visibleArchived}
                  columns={archivedVendorColumns}
                  hideToolbar
                  isLoading={isLoading}
                  emptyTitle="No Archived Vendors"
                  emptyMessage="Archived vendors appear here. Their bill history is preserved."
                  emptyIcon={<Archive className="h-6 w-6" />}
                  multiselect={isManagerOrOwner}
                  selectedIds={archivedSelectedIds}
                  onSelectedIdsChange={setArchivedSelectedIds}
                  bulkActions={isManagerOrOwner ? archivedVendorBulkActions : undefined}
                  entityNoun={{ singular: "vendor", plural: "vendors" }}
                  onVisibleDataChange={(rows) => setVisibleVendorRows(rows as VendorWithStats[])}
                  urlKey="archivedTbl"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={vendorCardAvatar}
                  rowActions={archivedRowActions}
                />
              </TabsContent>
            </>
          );
        })()}
      </Tabs>

      {/* Bills panel for selected vendor */}
      {selectedVendorId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Bills — {vendors.find(v => v.id === selectedVendorId)?.name}
            </CardTitle>
            {isManagerOrOwner && (
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setLocation(`/vendors/${selectedVendorId}/bills/new`)}>
                <Plus className="h-3.5 w-3.5" />Add Bill
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable
              data={selectedVendorBills}
              columns={billColumns}
              isLoading={false}
              emptyMessage="No bills recorded for this vendor."
              emptyIcon={<FileText className="h-5 w-5" />}
            />
          </CardContent>
        </Card>
      )}

      {isManagerOrOwner && (
        <SpeedDialFAB
          actions={[
            {
              label: "Add Vendor",
              icon: <Building2 className="h-5 w-5" />,
              onClick: openCreate,
              testId: "fab-add-vendor",
            },
          ]}
        />
      )}
    </div>
  );
}
