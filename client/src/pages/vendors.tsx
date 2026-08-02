import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import { buildSlug } from "@/lib/slug";
import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Phone, Mail, MapPin, FileText, Building2, Archive, RotateCcw } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { BulkOperations } from "@/components/bulk-operations";
import { VENDOR_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";
import type { Vendor, VendorBill } from "@shared/schema";

type VendorWithStats = Vendor & {
  totalBilled?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  billCount?: number;
};

const emptyForm = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
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

  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedBill, setSelectedBill] = useState<VendorBill | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [billForm, setBillForm] = useState({ amount: "", dueDate: "", notes: "" });
  const [payAmount, setPayAmount] = useState("");
  const [activeTab, setActiveTab] = useUrlState<"active" | "archived">("tab", "active");
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [archivedSelectedIds, setArchivedSelectedIds] = useState<(string | number)[]>([]);
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

  // Enrich vendors with bill stats
  const vendorsWithStats: VendorWithStats[] = vendors.map((v) => {
    const vBills = bills.filter((b) => b.vendorId === v.id);
    const totalBilled = vBills.reduce((s, b) => s + Number(b.amount), 0);
    const totalPaid = vBills.reduce((s, b) => s + Number(b.amountPaid ?? 0), 0);
    return { ...v, totalBilled, totalPaid, outstandingBalance: totalBilled - totalPaid, billCount: vBills.length };
  });

  const selectedVendorBills = bills.filter((b) => b.vendorId === selectedVendorId);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Vendor name is required.");
      const payload = { ...form, storeId: currentStore!.id };
      const res = editingVendor
        ? await apiRequest("PATCH", `/api/vendors/${editingVendor.id}`, payload)
        : await apiRequest("POST", "/api/vendors", payload);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Failed to save vendor"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      toast({ title: editingVendor ? "Vendor updated" : "Vendor added" });
      setVendorDialogOpen(false);
      setEditingVendor(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("PATCH", `/api/vendors/${id}/archive`, {}, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("archive failed");
        return "archived" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      setSelectedIds([]);
      const archived = counts.archived ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${archived} vendor${archived !== 1 ? "s" : ""} archived` }
          : { title: `${archived} archived, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk archive failed", variant: "destructive" }),
  });

  const bulkRestoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("PATCH", `/api/vendors/${id}/restore`, {}, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("restore failed");
        return "restored" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      setArchivedSelectedIds([]);
      const restored = counts.restored ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${restored} vendor${restored !== 1 ? "s" : ""} restored` }
          : { title: `${restored} restored, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk restore failed", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id, batchId) => {
        const res = await apiRequest("DELETE", `/api/vendors/${id}`, undefined, { "X-Batch-Id": batchId });
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      setArchivedSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} vendor${deleted !== 1 ? "s" : ""} permanently deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const addBillMutation = useMutation({
    mutationFn: async () => {
      if (!billForm.amount || Number(billForm.amount) <= 0) throw new Error("Valid amount is required.");
      const res = await apiRequest("POST", "/api/vendors/bills", {
        storeId: currentStore!.id,
        vendorId: selectedVendorId,
        amount: Number(billForm.amount),
        dueDate: billForm.dueDate || undefined,
        notes: billForm.notes || undefined,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Failed to add bill"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills", currentStore?.id] });
      toast({ title: "Bill recorded" });
      setBillDialogOpen(false);
      setBillForm({ amount: "", dueDate: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const payBillMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBill || !payAmount || Number(payAmount) <= 0) throw new Error("Valid payment amount is required.");
      const res = await apiRequest("PATCH", `/api/vendors/bills/${selectedBill.id}`, {
        amountPaid: Number(selectedBill.amountPaid ?? 0) + Number(payAmount),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Failed to record payment"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills", currentStore?.id] });
      toast({ title: "Payment recorded" });
      setPayDialogOpen(false);
      setPayAmount("");
      setSelectedBill(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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

  const vendorFilterConfigs: TableFilterConfig[] = [
    { key: "outstandingBalance", label: "Outstanding Balance", type: "range", currencySymbol: storeCurrency === "USD" ? "$" : "₦" },
  ];

  const vendorColumns = [
    { key: "name", header: "Vendor", render: (v: VendorWithStats) => (
      <button className="text-left" onClick={() => setSelectedVendorId(selectedVendorId === v.id ? null : v.id)}>
        <p className="font-medium text-sm">{v.name}</p>
        {v.contactName && <p className="text-xs text-muted-foreground">{v.contactName}</p>}
      </button>
    )},
    { key: "phone", header: "Contact", render: (v: VendorWithStats) => (
      <div className="space-y-0.5">
        {v.phone && <p className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" />{v.phone}</p>}
        {v.email && <p className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" />{v.email}</p>}
      </div>
    )},
    { key: "totalBilled", header: "Total Billed", render: (v: VendorWithStats) => <span className="font-mono text-sm">{formatCurrency(v.totalBilled ?? 0)}</span> },
    { key: "outstandingBalance", header: "Outstanding", render: (v: VendorWithStats) => (
      <span className={`font-mono text-sm font-medium ${(v.outstandingBalance ?? 0) > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
        {formatCurrency(v.outstandingBalance ?? 0)}
      </span>
    )},
    { key: "actions", header: "", render: (v: VendorWithStats) => isManagerOrOwner && (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)} title="Edit vendor"><Edit className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => archiveMutation.mutate(v.id)} title="Archive vendor" disabled={archiveMutation.isPending}>
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </div>
    )},
  ];

  const archivedVendorColumns = [
    { key: "name", header: "Vendor", render: (v: VendorWithStats) => (
      <div>
        <p className="font-medium text-sm text-muted-foreground">{v.name}</p>
        {v.contactName && <p className="text-xs text-muted-foreground">{v.contactName}</p>}
      </div>
    )},
    { key: "phone", header: "Contact", render: (v: VendorWithStats) => (
      <div className="space-y-0.5">
        {v.phone && <p className="text-xs flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{v.phone}</p>}
        {v.email && <p className="text-xs flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{v.email}</p>}
      </div>
    )},
    { key: "actions", header: "", render: (v: VendorWithStats) => isManagerOrOwner && (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600" onClick={() => restoreMutation.mutate(v.id)} title="Restore vendor" disabled={restoreMutation.isPending}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        {/* Permanent delete matches the server's owner-only requireRole("owner") gate on DELETE /api/vendors/:id */}
        {isOwner && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(v.id)} title="Permanently delete" disabled={deleteMutation.isPending}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
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
        title="Vendors"
        description="Manage your suppliers and track outstanding bills"
        actions={
          <div className="flex items-center gap-2">
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
            {isManagerOrOwner && (
              <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" />Add Vendor</Button>
            )}
          </div>
        }
      />

      {/* Summary cards */}
      <MetricGrid>
        <MetricCard title="Total Vendors" value={vendors.length} />
        <MetricCard title="Open Bills" value={unpaidBills} />
        <MetricCard
          title="Total Outstanding"
          value={formatCurrency(totalOutstanding)}
          compactValue={formatCompact(totalOutstanding)}
        />
        <MetricCard title="Total Bills" value={bills.length} />
      </MetricGrid>

      {/* Vendor list with tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "active" | "archived")}>
        <TabsList>
          <TabsTrigger value="active">Active ({vendors.length})</TabsTrigger>
          <TabsTrigger value="archived">Archived ({archivedVendors.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-3">
          {isManagerOrOwner && (
            <BulkSelectionActionBar
              count={selectedIds.length}
              unitLabel="vendor"
              onClear={() => setSelectedIds([])}
              actions={[
                {
                  key: "archive",
                  label: "Archive Selected",
                  pendingLabel: "Archiving…",
                  icon: <Archive className="h-3.5 w-3.5" />,
                  tone: "warning",
                  pending: bulkArchiveMutation.isPending,
                  onClick: () => bulkArchiveMutation.mutate(selectedIds as string[]),
                },
              ]}
            />
          )}
          <DataTable
            data={vendorsWithStats}
            columns={vendorColumns}
            searchable
            searchPlaceholder="Search vendors..."
            searchKeys={["name", "contactName", "email", "phone"]}
            filterConfigs={vendorFilterConfigs}
            isLoading={isLoading}
            emptyTitle="No Vendors Yet"
            emptyMessage="Add your suppliers to start tracking bills and payments."
            emptyIcon={<Building2 className="h-6 w-6" />}
            emptyAction={isManagerOrOwner && <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" />Add First Vendor</Button>}
            multiselect={isManagerOrOwner}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            onVisibleDataChange={setVisibleVendorRows}
            urlKey="active"
          />
        </TabsContent>

        <TabsContent value="archived" className="mt-4 space-y-3">
          {isManagerOrOwner && (
            <BulkSelectionActionBar
              count={archivedSelectedIds.length}
              unitLabel="vendor"
              onClear={() => setArchivedSelectedIds([])}
              actions={[
                {
                  key: "restore",
                  label: "Restore Selected",
                  pendingLabel: "Restoring…",
                  icon: <RotateCcw className="h-3.5 w-3.5" />,
                  pending: bulkRestoreMutation.isPending,
                  onClick: () => bulkRestoreMutation.mutate(archivedSelectedIds as string[]),
                },
                // Permanent delete matches the server's owner-only requireRole("owner") gate.
                ...(isOwner
                  ? [
                      {
                        key: "delete",
                        label: "Delete Selected",
                        pendingLabel: "Deleting…",
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        tone: "destructive" as const,
                        pending: bulkDeleteMutation.isPending,
                        onClick: () => bulkDeleteMutation.mutate(archivedSelectedIds as string[]),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          <DataTable
            data={archivedVendors as VendorWithStats[]}
            columns={archivedVendorColumns}
            searchable
            searchPlaceholder="Search archived vendors..."
            searchKeys={["name", "contactName", "email", "phone"]}
            isLoading={isLoading}
            emptyTitle="No Archived Vendors"
            emptyMessage="Archived vendors appear here. Their bill history is preserved."
            emptyIcon={<Archive className="h-6 w-6 opacity-40" />}
            multiselect={isManagerOrOwner}
            selectedIds={archivedSelectedIds}
            onSelectedIdsChange={setArchivedSelectedIds}
            onVisibleDataChange={(rows) => setVisibleVendorRows(rows as VendorWithStats[])}
            urlKey="archivedTbl"
          />
        </TabsContent>
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
