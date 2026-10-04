import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import { Plus, UserPlus, Edit, Trash2, Phone, MapPin, RotateCcw, Archive, Users, BarChart3, UserX, Wallet, UserPlus2 } from "lucide-react";
import { ListControls } from "@/components/list-controls";
import { FiltersSheet, SortSheet } from "@/components/customer-filter-sheets";
import { getCustomerInitials, formatRelativeDate } from "@/lib/customer-detail-utils";
import {
  type CustomerFilterState,
  type CustomerSortState,
  EMPTY_CUSTOMER_FILTERS,
  customerMatchesFilters,
  computeTopSpendThreshold,
  countActiveCustomerFilters,
  buildCustomerFilterChips,
  clearCustomerFilterChip,
  customerSortLabel,
  sortCustomers,
} from "@/lib/customer-filters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
import { DataTable, type RowAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkOperations } from "@/components/bulk-operations";
import { CUSTOMER_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCustomerSchema, type Customer, type InsertCustomer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useHasPermission } from "@/lib/permissions";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { buildSlug } from "@/lib/slug";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import { MetricRow } from "@/components/metric-row";
import { exportReportToPDF } from "@/lib/export-utils";
import { validatePhoneNumber, formatPhoneDisplay, normalizePhoneForStorage } from "@/lib/phone-utils";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";

const customerFormSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
  customerNumber: z.string().optional().default(""),
});

// Row cells live at module level: defined inside the page they were new component types
// on every render, which remounted every row on each keystroke in the search box.
const CustomerNameCell = ({ customer }: { customer: Customer }) => {
  const presenter = new CustomerPresenter(customer);
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs font-semibold">
          {getCustomerInitials(customer.name)}
        </AvatarFallback>
      </Avatar>
      <EntityDisplay presenter={presenter} />
    </div>
  );
};

// Mobile/tablet compact-grid card: the avatar renders once, outside the 2x2
// text grid (via cardAvatar below), and this cell's subtitle drops the phone
// number CustomerNameCell's presenter normally appends — it's cramped next
// to the name on a narrow card, and already shown as its own cell in the
// grid, so repeating it here just eats space without adding information.
const customerCardAvatar = (customer: Customer) => (
  <Avatar className="h-10 w-10">
    <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
      {getCustomerInitials(customer.name)}
    </AvatarFallback>
  </Avatar>
);

// Mobile/tablet compact-grid card: name only — customer number moved to its
// own cell (below, replacing the now-hidden contact cell) rather than
// living as a subtitle here.
const CustomerCardNameCell = ({ customer }: { customer: Customer }) => (
  <span className="truncate">{customer.name}</span>
);

export default function Customers() {
  const { toast } = useToast();
  const { currentStore, stores, business } = useStore();
  const { user } = useAuth();
  // Spend and visit history are money figures: owner/manager, or a custom role with the
  // Customers module. The built-in staff role holds that module too but never sees spend
  // (the server enforces the same rule on /api/customers/summary).
  const { hasPermission: hasCustomersModule, isLoading: isLoadingPermission } = useHasPermission("Customers");
  const canSeeSpend = user?.role === "owner" || user?.role === "manager" || (user?.role !== "staff" && hasCustomersModule);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "active");
  // Old bookmarks of the retired in-page analytics tab land on the standalone insights page.
  useEffect(() => {
    if (activeTab === "analytics") setLocation("/customers/insights", { replace: true });
  }, [activeTab, setLocation]);
  const [duplicateCustomer, setDuplicateCustomer] = useState<any | null>(null);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [pendingSubmitValues, setPendingSubmitValues] = useState<any | null>(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [customerFilters, setCustomerFilters] = useState<CustomerFilterState>(EMPTY_CUSTOMER_FILTERS);
  const [customerSort, setCustomerSort] = useState<CustomerSortState | null>(null);
  const [archivedSearchTerm, setArchivedSearchTerm] = useState("");
  const [archivedFilters, setArchivedFilters] = useState<CustomerFilterState>(EMPTY_CUSTOMER_FILTERS);
  const [archivedSort, setArchivedSort] = useState<CustomerSortState | null>(null);
  // Full customer list is always loaded client-side (matching every other
  // list page in this app, e.g. Inventory/Vendors) rather than paged from
  // the server — the Filters/Sort sheets need to compute accurate counts
  // and sort/filter across the *entire* list, which a server-paginated
  // slice can't support correctly.
  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/customers?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Customer[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, Customer & { storeName?: string }>();
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
      const res = await fetch(`/api/customers?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Lifetime spend + first/last visit per customer, computed on the server so the
  // list never has to download the full transaction history.
  type CustomerSummary = { customerId: string; totalSpend: number; firstVisit: string; lastVisit: string };
  const { data: customerSummaries = [], isLoading: isLoadingSummaries } = useQuery<CustomerSummary[]>({
    queryKey: ["/api/customers/summary", currentStore?.id],
    queryFn: async () => {
      const res = await fetch(`/api/customers/summary?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch customer activity");
      return res.json();
    },
    enabled: !!currentStore?.id && canSeeSpend,
    staleTime: 0,
  });

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  let newThisMonth = 0;
  let newLastMonth = 0;

  customerSummaries.forEach((c) => {
    const firstVisitDate = new Date(c.firstVisit);
    if (firstVisitDate >= startOfThisMonth) {
      newThisMonth++;
    } else if (firstVisitDate >= startOfLastMonth && firstVisitDate <= endOfLastMonth) {
      newLastMonth++;
    }
  });

  const acquisitionPercentChange = newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0;

  const activeCustomers = customers.filter(c => !c.isArchived);
  const archivedCustomers = customers.filter(c => c.isArchived);

  const customerSpends = useMemo(
    () => new Map(customerSummaries.map((c) => [c.customerId, c.totalSpend])),
    [customerSummaries],
  );

  // Most recent visit date per customer, for follow-up triage.
  const lastVisitedMap = useMemo(
    () => new Map(customerSummaries.map((c) => [c.customerId, c.lastVisit])),
    [customerSummaries],
  );

  // Header summary metrics — computed from data already fetched for this page.
  const avgSpendPerActiveCustomer = activeCustomers.length > 0
    ? Array.from(customerSpends.values()).reduce((sum, v) => sum + v, 0) / activeCustomers.length
    : 0;
  const inactiveThresholdMs = 30 * 24 * 60 * 60 * 1000;
  const inactive30dCount = activeCustomers.filter((c) => {
    const last = lastVisitedMap.get(c.id);
    return !last || Date.now() - new Date(last).getTime() > inactiveThresholdMs;
  }).length;

  const navigateToCustomerDetails = (customer: Customer) => {
    setLocation(appendReturnTo(`/customers/${buildSlug(customer.name, customer.id)}`, location, search));
  };

  const form = useForm<InsertCustomer>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      customerNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      address: "",
    },
  });

  const selectedCountryCode = form.watch("countryCode");

  // Everything under /api/customers (list, summary, single records) plus the dashboard counts.
  const refreshCustomers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: InsertCustomer) => apiRequest("POST", "/api/customers", data),
    onSuccess: () => {
      refreshCustomers();
      toast({ title: "Customer created successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Add Customer", 
        description: getUserFriendlyError(error, "customer"), 
        variant: "destructive" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertCustomer) =>
      apiRequest("PATCH", `/api/customers/${selectedCustomer?.id}`, data),
    onSuccess: () => {
      refreshCustomers();
      toast({ title: "Customer updated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Update Customer", 
        description: getUserFriendlyError(error, "customer"), 
        variant: "destructive" 
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/customers/${selectedCustomer?.id}`),
    onSuccess: () => {
      refreshCustomers();
      toast({ title: "Customer archived successfully" });
      setIsDeleteOpen(false);
      setSelectedCustomer(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Archive Customer", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/customers/${id}/restore`),
    onSuccess: () => {
      refreshCustomers();
      toast({ title: "Customer restored successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Restore Customer", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/customers/${id}/permanent`),
    onSuccess: () => {
      refreshCustomers();
      toast({ title: "Customer permanently deleted" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Delete Customer", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const openCreateForm = () => setLocation("/customers/new");
  const openEditForm = (customer: Customer) => setLocation(`/customers/${buildSlug(customer.name, customer.id)}/edit`);

  const handleForceCreate = () => {
    if (pendingSubmitValues) {
      createMutation.mutate({
        ...pendingSubmitValues,
        allowDuplicatePhone: true,
      } as any);
      setIsDuplicateOpen(false);
      setPendingSubmitValues(null);
      setDuplicateCustomer(null);
    }
  };

  const onSubmit = async (data: InsertCustomer) => {
    const countryCode = data.countryCode || "NG";
    // Only validate phone if provided
    if (data.mobileNumber && data.mobileNumber.trim()) {
      const validation = validatePhoneNumber(data.mobileNumber, countryCode);
      if (!validation.valid) {
        form.setError("mobileNumber", { message: validation.error });
        return;
      }
    }
    
    if (selectedCustomer) {
      updateMutation.mutate(data);
    } else {
      if (data.mobileNumber && data.mobileNumber.trim()) {
        try {
          const res = await fetch(`/api/customers/check-duplicate?phone=${data.mobileNumber}&storeId=${currentStore?.id}`);
          if (res.status === 409) {
            const result = await res.json();
            setDuplicateCustomer(result.existingCustomer);
            setPendingSubmitValues(data);
            setIsDuplicateOpen(true);
            return;
          }
        } catch (err) {
          console.error("Duplicate check failed:", err);
        }
      }
      createMutation.mutate(data);
    }
  };

  type CustomerRow = Customer & { totalSpend: number; lastVisited: string | null };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "-";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date));
  };

  const activeColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (customer: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {customer.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "name",
      header: "Customer",
      priority: 1 as const,
      render: (customer: Customer) => <CustomerNameCell customer={customer} />,
      cardRender: (customer: Customer) => <CustomerCardNameCell customer={customer} />,
    },
    {
      key: "mobileNumber",
      header: "Contact",
      priority: 2 as const,
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          {customer.mobileNumber ? (
            <>
              <Phone className="h-3 w-3 text-muted-foreground" />
              <span>{formatPhoneDisplay(customer.mobileNumber, customer.countryCode || "+234")}</span>
            </>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
      // Mobile/tablet compact-grid card: shows the customer number instead of
      // the phone number — "Call" lives in the row's "…" menu instead. Desktop
      // table is unchanged (full icon + formatted number via `render` above).
      cardRender: (customer: Customer) => <span className="font-mono truncate">{customer.customerNumber}</span>,
    },
    {
      key: "address",
      header: "Address",
      render: (customer: Customer) => (
        <div className="flex items-start gap-2 max-w-xs">
          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
          {customer.address ? (
            <span className="line-clamp-2">{customer.address}</span>
          ) : (
            <span className="text-muted-foreground">Add address</span>
          )}
        </div>
      ),
    },
    {
      key: "totalSpend",
      header: "Total spend",
      priority: 1 as const,
      render: (customer: CustomerRow) => (
        <span className="text-sm">{formatCurrency(customer.totalSpend ?? 0)}</span>
      ),
    },
    {
      key: "lastVisited",
      header: "Last visit",
      priority: 3 as const,
      render: (customer: CustomerRow) => (
        <div className="text-sm">
          <div>{formatDate(customer.lastVisited)}</div>
          {customer.lastVisited && (
            <div className="text-xs text-muted-foreground">{formatRelativeDate(customer.lastVisited)}</div>
          )}
        </div>
      ),
      // The compact-grid card cell is already text-xs/muted — showing the
      // full absolute date here (sized for the desktop table's dedicated
      // column) reads oddly large/prominent next to the other 3 cells, so
      // the card shows just the relative date, same size as its siblings.
      cardRender: (customer: CustomerRow) => <span>{formatRelativeDate(customer.lastVisited) ?? "-"}</span>,
    },
  ];

  const activeRowActions = (customer: Customer): RowAction[] => [
    ...(customer.mobileNumber ? [{
      label: "Call",
      icon: <Phone className="h-4 w-4" />,
      onClick: () => {
        window.location.href = `tel:${normalizePhoneForStorage(customer.mobileNumber!, customer.countryCode || "+234")}`;
      },
      testId: `button-call-${customer.id}`,
    }] : []),
    {
      label: "Edit",
      icon: <Edit className="h-4 w-4" />,
      onClick: () => openEditForm(customer),
      testId: `button-edit-${customer.id}`,
    },
    {
      label: "Archive",
      icon: <Archive className="h-4 w-4" />,
      onClick: () => {
        setSelectedCustomer(customer);
        setIsDeleteOpen(true);
      },
      destructive: true,
      testId: `button-archive-${customer.id}`,
    },
  ];

  const archivedColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (customer: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {customer.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "name",
      header: "Customer",
      priority: 1 as const,
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          <CustomerNameCell customer={customer} />
          <Badge variant="secondary" className="h-5 shrink-0">Archived</Badge>
        </div>
      ),
      cardRender: (customer: Customer) => <CustomerCardNameCell customer={customer} />,
    },
    {
      key: "mobileNumber",
      header: "Contact",
      priority: 2 as const,
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          {customer.mobileNumber ? (
            <>
              <Phone className="h-3 w-3 text-muted-foreground" />
              <span>{formatPhoneDisplay(customer.mobileNumber, customer.countryCode || "+234")}</span>
            </>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
      // Mobile/tablet compact-grid card: shows the customer number instead of
      // the phone number — "Call" lives in the row's "…" menu instead. Desktop
      // table is unchanged (full icon + formatted number via `render` above).
      cardRender: (customer: Customer) => <span className="font-mono truncate">{customer.customerNumber}</span>,
    },
    {
      key: "address",
      header: "Address",
      render: (customer: Customer) => (
        <div className="flex items-start gap-2 max-w-xs">
          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
          {customer.address ? (
            <span className="line-clamp-2">{customer.address}</span>
          ) : (
            <span className="text-muted-foreground">Add address</span>
          )}
        </div>
      ),
    },
    {
      key: "totalSpend",
      header: "Total spend",
      priority: 1 as const,
      render: (customer: CustomerRow) => (
        <span className="text-sm">{formatCurrency(customer.totalSpend ?? 0)}</span>
      ),
    },
    {
      key: "lastVisited",
      header: "Last visit",
      priority: 3 as const,
      render: (customer: CustomerRow) => (
        <div className="text-sm">
          <div>{formatDate(customer.lastVisited)}</div>
          {customer.lastVisited && (
            <div className="text-xs text-muted-foreground">{formatRelativeDate(customer.lastVisited)}</div>
          )}
        </div>
      ),
      cardRender: (customer: CustomerRow) => <span>{formatRelativeDate(customer.lastVisited) ?? "-"}</span>,
    },
  ];

  const archivedRowActions = (customer: Customer): RowAction[] => [
    {
      label: "Restore",
      icon: <RotateCcw className="h-4 w-4" />,
      onClick: () => restoreMutation.mutate(customer.id),
      testId: `button-restore-${customer.id}`,
    },
    {
      label: "Delete permanently",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => setPermanentDeleteTarget(customer),
      destructive: true,
      testId: `button-delete-permanent-${customer.id}`,
    },
  ];

  const withoutSpendColumns = <T extends { key: string }>(cols: T[]): T[] =>
    canSeeSpend ? cols : cols.filter((c) => c.key !== "totalSpend" && c.key !== "lastVisited");

  const exportColumns = [
    { key: "name", header: "Name" },
    { key: "customerNumber", header: "Customer Number" },
    { key: "mobileNumber", header: "Mobile Number" },
    { key: "countryCode", header: "Country Code" },
    { key: "address", header: "Address" },
  ];

  const formatCurrency = (value: number) => formatCurrencyUtil(value, currentStore?.currency || "NGN");

  type CustomerReportRow = {
    name: string;
    customerNumber: string;
    mobileNumber: string;
    address: string;
    loyaltyPoints: number;
    totalSpend: number;
    updatedAt: Date;
  };

  // Tracks whichever tab's live search/filter result set is currently on screen, so
  // "Export current view" can offer exactly that, separate from the always-full export.
  const [visibleCustomerRows, setVisibleCustomerRows] = useState<Customer[]>([]);

  const handleCustomersReportExport = (filtered = false) => {
    const scoped = filtered ? visibleCustomerRows : (activeTab === "active" ? activeCustomers : archivedCustomers);
    const pdfRows: CustomerReportRow[] = scoped.map((c) => ({
      name: c.name,
      customerNumber: c.customerNumber || "—",
      mobileNumber: c.mobileNumber || "—",
      address: c.address || "—",
      loyaltyPoints: c.loyaltyPoints ?? 0,
      totalSpend: canSeeSpend ? customerSpends.get(c.id) || 0 : 0,
      updatedAt: c.updatedAt,
    }));

    return exportReportToPDF<CustomerReportRow>({
      filename: `customers-report_${activeTab}_${new Date().toISOString().slice(0, 10)}`,
      title: `Customers Report (${activeTab === "active" ? "Active" : "Archived"})`,
      businessName: business?.name ?? currentStore?.name ?? "Business",
      storeName: currentStore?.name ?? "All Stores",
      kpis: [
        ...(canSeeSpend ? [{ label: "New This Month", value: String(newThisMonth), sub: `${acquisitionPercentChange >= 0 ? "+" : ""}${acquisitionPercentChange}% vs last month` }] : []),
      ],
      columns: [
        { key: "name", header: "Name" },
        { key: "customerNumber", header: "Customer #" },
        { key: "mobileNumber", header: "Mobile" },
        { key: "address", header: "Address" },
        { key: "loyaltyPoints", header: "Loyalty Pts", align: "right" },
        ...(canSeeSpend ? [{ key: "totalSpend" as const, header: "Total Spend", align: "right" as const, format: (r: CustomerReportRow) => formatCurrency(r.totalSpend) }] : []),
        { key: "updatedAt", header: "Last Updated", format: (r) => formatDate(r.updatedAt) },
      ],
      rows: pdfRows,
      ...(canSeeSpend ? { amountKey: "totalSpend" as const, formatAmount: formatCurrency } : {}),
      unitLabel: "customers",
    });
  };

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" description="Manage your customer records" />
        <StoreRequiredAlert title="Store Required for Customers" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Manage your customer records"
        compact
        actions={
          <div className="flex items-center gap-2">
            {canSeeSpend && (
              <Button
                variant="outline"
                onClick={() => setLocation("/customers/insights")}
                aria-label="Insights"
                data-testid="button-insights"
              >
                <BarChart3 className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Insights</span>
              </Button>
            )}
            {/* Tablet/mobile: icon-only "..." trigger, matching the mockup's compact header. */}
            <div className="lg:hidden">
              <BulkOperations
                entityConfig={CUSTOMER_BULK_CONFIG}
                data={(activeTab === "active" ? activeCustomers : archivedCustomers) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Customers Report (${activeTab})`}
                onExportPDF={() => handleCustomersReportExport()}
                onExportFilteredPDF={() => handleCustomersReportExport(true)}
                visibleData={visibleCustomerRows as unknown as Record<string, unknown>[]}
                showImportOption={user?.role !== "staff"}
                compact
              />
            </div>
            <div className="hidden lg:block">
              <BulkOperations
                entityConfig={CUSTOMER_BULK_CONFIG}
                data={(activeTab === "active" ? activeCustomers : archivedCustomers) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Customers Report (${activeTab})`}
                onExportPDF={() => handleCustomersReportExport()}
                onExportFilteredPDF={() => handleCustomersReportExport(true)}
                visibleData={visibleCustomerRows as unknown as Record<string, unknown>[]}
                showImportOption={user?.role !== "staff"}
              />
            </div>
            {user?.role !== "staff" && (
              <Button onClick={openCreateForm} aria-label="Add Customer" data-testid="button-add-customer">
                <Plus className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Add Customer</span>
              </Button>
            )}
          </div>
        }
      />

      {(() => {
        // New-this-month, avg. spend and inactivity all come from the spend summary.
        const customerMetrics = [
          { title: "Active", value: activeCustomers.length, icon: <Users className="h-4 w-4" />, isLoading },
          ...(canSeeSpend ? [
            { title: "New this month", value: newThisMonth, icon: <UserPlus2 className="h-4 w-4" />, isLoading: isLoading || isLoadingSummaries },
            { title: "Avg. spend", value: formatCurrency(avgSpendPerActiveCustomer), icon: <Wallet className="h-4 w-4" />, isLoading: isLoading || isLoadingSummaries },
            { title: "Inactive 30d+", value: inactive30dCount, icon: <UserX className="h-4 w-4" />, isLoading: isLoading || isLoadingSummaries },
          ] : []),
        ];
        return <MetricRow metrics={customerMetrics} />;
      })()}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <PolymorphicTabsList
          tabs={[
            { value: "active", label: `Active ${activeCustomers.length}` },
            { value: "archived", label: `Archived ${archivedCustomers.length}` },
          ]}
          variant="bordered"
        />
        {(() => {
          const currencySymbol = getCurrencyByCode(currentStore?.currency || "NGN")?.symbol ?? "₦";

          const activeTableData: CustomerRow[] = activeCustomers.map((c) => ({
            ...c,
            totalSpend: customerSpends.get(c.id) || 0,
            lastVisited: lastVisitedMap.get(c.id) || null,
            createdAt: c.createdAt
          }));

          const archivedTableData: CustomerRow[] = archivedCustomers.map((c) => ({
            ...c,
            totalSpend: customerSpends.get(c.id) || 0,
            lastVisited: lastVisitedMap.get(c.id) || null,
            createdAt: c.createdAt
          }));

          const topSpendThreshold = computeTopSpendThreshold(activeTableData.map((c) => c.totalSpend));
          const searchTerm = customerSearchTerm.trim().toLowerCase();
          const searchedActive = searchTerm
            ? activeTableData.filter((c) =>
                c.name.toLowerCase().includes(searchTerm) ||
                c.customerNumber?.toLowerCase().includes(searchTerm) ||
                c.mobileNumber?.toLowerCase().includes(searchTerm) ||
                c.address?.toLowerCase().includes(searchTerm)
              )
            : activeTableData;
          const filteredActive = searchedActive.filter((c) => customerMatchesFilters(c, customerFilters, topSpendThreshold));
          const visibleActive = sortCustomers(filteredActive, customerSort);

          const archivedSearchLower = archivedSearchTerm.trim().toLowerCase();
          const searchedArchived = archivedSearchLower
            ? archivedTableData.filter((c) =>
                c.name.toLowerCase().includes(archivedSearchLower) ||
                c.customerNumber?.toLowerCase().includes(archivedSearchLower) ||
                c.mobileNumber?.toLowerCase().includes(archivedSearchLower) ||
                c.address?.toLowerCase().includes(archivedSearchLower)
              )
            : archivedTableData;
          const archivedTopSpendThreshold = computeTopSpendThreshold(archivedTableData.map((c) => c.totalSpend));
          const visibleArchived = sortCustomers(
            searchedArchived.filter((c) => customerMatchesFilters(c, archivedFilters, archivedTopSpendThreshold)),
            archivedSort,
          );

          // Search + Filters/Sort sheets + removable chips, shared by the Active and Archived tabs.
          const renderListControls = (cfg: {
            testIdPrefix: string;
            searchTerm: string;
            setSearchTerm: (v: string) => void;
            filters: CustomerFilterState;
            setFilters: React.Dispatch<React.SetStateAction<CustomerFilterState>>;
            sort: CustomerSortState | null;
            setSort: (s: CustomerSortState | null) => void;
            searched: CustomerRow[];
            visibleCount: number;
          }) => {
            const threshold = computeTopSpendThreshold(cfg.searched.map((c) => c.totalSpend));
            const filterCount = countActiveCustomerFilters(cfg.filters);
            const chips = buildCustomerFilterChips(cfg.filters, currencySymbol);
            return (
              <ListControls
                testIdPrefix={cfg.testIdPrefix}
                placeholder="Search name, phone or customer ID"
                search={cfg.searchTerm}
                onSearchChange={cfg.setSearchTerm}
                filterCount={filterCount}
                filters={canSeeSpend ? (trigger) => (
                  <FiltersSheet
                    filters={cfg.filters}
                    onApply={cfg.setFilters}
                    currencySymbol={currencySymbol}
                    resultCountFor={(draft) => cfg.searched.filter((c) => customerMatchesFilters(c, draft, threshold)).length}
                    trigger={trigger}
                  />
                ) : undefined}
                sortLabel={customerSortLabel(cfg.sort).replace(/^Sort: /, "")}
                sort={(trigger) => <SortSheet sort={cfg.sort} onChange={cfg.setSort} trigger={trigger} />}
                chips={chips}
                onRemoveChip={(key) => cfg.setFilters((f) => clearCustomerFilterChip(f, key as Parameters<typeof clearCustomerFilterChip>[1]))}
                hasSort={cfg.sort !== null}
                onClearAll={() => {
                  cfg.setFilters(EMPTY_CUSTOMER_FILTERS);
                  cfg.setSort(null);
                }}
                visibleCount={cfg.visibleCount}
                noun="customer"
              />
            );
          };

          return (
            <>
              <TabsContent value="active" className="mt-4 space-y-3">
                {renderListControls({
                  testIdPrefix: "customer",
                  searchTerm: customerSearchTerm,
                  setSearchTerm: setCustomerSearchTerm,
                  filters: customerFilters,
                  setFilters: setCustomerFilters,
                  sort: customerSort,
                  setSort: setCustomerSort,
                  searched: searchedActive,
                  visibleCount: visibleActive.length,
                })}

                <DataTable
                  data={visibleActive}
                  columns={withoutSpendColumns(activeColumns)}
                  hideToolbar
                  isLoading={isLoading}
                  emptyMessage="Add active profiles to start tracking their credit limits, transactions, and retention logs."
                  onRowClick={navigateToCustomerDetails}
                  rowActions={user?.role !== "staff" ? activeRowActions : undefined}
                  onVisibleDataChange={setVisibleCustomerRows}
                  urlKey="active"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={customerCardAvatar}
                  emptyIcon={<Users className="h-6 w-6" />}
                  emptyTitle="No Active Customers"
                  emptyAction={
                    user?.role !== "staff" && (
                      <Button onClick={openCreateForm} size="sm" className="h-8">
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add Customer
                      </Button>
                    )
                  }
                />
              </TabsContent>
              <TabsContent value="archived" className="mt-4 space-y-3">
                {renderListControls({
                  testIdPrefix: "archived-customer",
                  searchTerm: archivedSearchTerm,
                  setSearchTerm: setArchivedSearchTerm,
                  filters: archivedFilters,
                  setFilters: setArchivedFilters,
                  sort: archivedSort,
                  setSort: setArchivedSort,
                  searched: searchedArchived,
                  visibleCount: visibleArchived.length,
                })}

                <DataTable
                  data={visibleArchived}
                  columns={withoutSpendColumns(archivedColumns)}
                  hideToolbar
                  isLoading={isLoading}
                  emptyMessage="Archived or deleted customers will be filed here for compliance histories."
                  onRowClick={navigateToCustomerDetails}
                  rowActions={user?.role !== "staff" ? archivedRowActions : undefined}
                  onVisibleDataChange={setVisibleCustomerRows}
                  urlKey="archivedTbl"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={customerCardAvatar}
                  emptyIcon={<Users className="h-6 w-6" />}
                  emptyTitle="No Archived Profiles"
                  emptyAction={
                    user?.role !== "staff" && (
                      <Button onClick={openCreateForm} size="sm" className="h-8">
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add Customer
                      </Button>
                    )
                  }
                />
              </TabsContent>
            </>
          );
        })()}
      </Tabs>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Archive Customer"
        description={`Are you sure you want to archive "${selectedCustomer?.name}"? You can restore them later from the Archived tab.`}
        confirmText="Archive"
        onConfirm={() => archiveMutation.mutate()}
        isDestructive
        isLoading={archiveMutation.isPending}
      />

      <ConfirmDialog
        open={permanentDeleteTarget !== null}
        onOpenChange={(o) => !o && setPermanentDeleteTarget(null)}
        title="Delete customer permanently"
        description={`Permanently delete "${permanentDeleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete permanently"
        onConfirm={() => {
          if (permanentDeleteTarget) permanentDeleteMutation.mutate(permanentDeleteTarget.id);
          setPermanentDeleteTarget(null);
        }}
        isDestructive
        isLoading={permanentDeleteMutation.isPending}
      />

      {user?.role !== "staff" && (
        <SpeedDialFAB
          className="md:hidden"
          actions={[
            {
              label: "Add Customer",
              icon: <UserPlus className="h-5 w-5" />,
              onClick: openCreateForm,
              testId: "fab-add-customer",
            },
          ]}
        />
      )}
    </div>
  );
}
