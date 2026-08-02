import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import { Plus, UserPlus, Edit, Trash2, Phone, MapPin, Hash, AlertCircle, RotateCcw, Archive, ChevronRight, Users, Clock, Percent, ArrowUpRight, Award, ShoppingBag, Wrench } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
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
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
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
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buildSlug } from "@/lib/slug";
import { Link } from "wouter";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { exportReportToPDF } from "@/lib/export-utils";
import { countryCodes, validatePhoneNumber, formatPhoneDisplay } from "@/lib/phone-utils";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar
} from "recharts";

const customerFormSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
  customerNumber: z.string().optional().default(""),
});

const PAGE_LIMIT = 50;

export default function Customers() {
  const { toast } = useToast();
  const { currentStore, stores, business } = useStore();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "active");
  const [duplicateCustomer, setDuplicateCustomer] = useState<any | null>(null);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [pendingSubmitValues, setPendingSubmitValues] = useState<any | null>(null);
  const [page, setPage] = useUrlState("page", 1, Number);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search: wait 350ms after the user stops typing before sending to server
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset search and page when store changes
  useEffect(() => { setSearchInput(""); setPage(1); }, [currentStore?.id]);
  // Reset page when debounced search changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id, stores.map(s => s.id).join(","), page, debouncedSearch],
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
        setTotalPages(1);
        return Array.from(mergedMap.values());
      }
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : "";
      const res = await fetch(`/api/customers?storeId=${currentStore?.id}&page=${page}&limit=${PAGE_LIMIT}${searchParam}`);
      if (!res.ok) throw new Error("Failed to fetch customers");
      const json = await res.json();
      if (Array.isArray(json)) {
        setTotalPages(1);
        return json;
      }
      setTotalPages(json.pagination?.totalPages ?? 1);
      return json.data as Customer[];
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const { data: transactionsData = [], isLoading: isLoadingTxs } = useQuery<any[]>({
    queryKey: ["/api/transactions", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/transactions?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
      }
      const res = await fetch(`/api/transactions?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Calculate Customer Analytics Metrics
  const validTxs = useMemo(
    () => transactionsData.filter((tx: any) => tx.checkout && !tx.checkout.isVoided),
    [transactionsData]
  );

  const customerVisits = useMemo(() => {
    const visitsMap = new Map<string, { checkoutId: string, customerId: string, date: Date, items: { name: string, type: string }[] }>();
    validTxs.forEach((tx: any) => {
      if (!tx.checkoutId || !tx.customerId) return;
      const date = new Date(tx.transactionDate || tx.checkout?.createdAt);
      if (!visitsMap.has(tx.checkoutId)) {
        visitsMap.set(tx.checkoutId, {
          checkoutId: tx.checkoutId,
          customerId: tx.customerId,
          date,
          items: []
        });
      }
      if (tx.inventory) {
        visitsMap.get(tx.checkoutId)!.items.push({
          name: tx.inventory.name,
          type: tx.inventory.type
        });
      }
    });

    const visits = Array.from(visitsMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

    const map = new Map<string, typeof visits>();
    visits.forEach(v => {
      if (!map.has(v.customerId)) {
        map.set(v.customerId, []);
      }
      map.get(v.customerId)!.push(v);
    });
    return map;
  }, [validTxs]);

  const totalCustomersCount = customerVisits.size;
  const returningCustomersCount = Array.from(customerVisits.values()).filter(vList => vList.length >= 2).length;
  const retentionRate = totalCustomersCount > 0 ? Math.round((returningCustomersCount / totalCustomersCount) * 100) : 0;

  let totalGapsMs = 0;
  let gapCount = 0;
  customerVisits.forEach((vList) => {
    if (vList.length < 2) return;
    for (let i = 1; i < vList.length; i++) {
      const gap = vList[i].date.getTime() - vList[i - 1].date.getTime();
      totalGapsMs += gap;
      gapCount++;
    }
  });
  const avgReturnDays = gapCount > 0 ? Math.round(totalGapsMs / gapCount / (1000 * 60 * 60 * 24)) : 0;

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  let newThisMonth = 0;
  let newLastMonth = 0;

  customerVisits.forEach(vList => {
    const firstVisitDate = vList[0].date;
    if (firstVisitDate >= startOfThisMonth) {
      newThisMonth++;
    } else if (firstVisitDate >= startOfLastMonth && firstVisitDate <= endOfLastMonth) {
      newLastMonth++;
    }
  });

  const acquisitionPercentChange = newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0;

  const acquisitionDrivers = new Map<string, { name: string, type: string, count: number }>();
  const retentionDrivers = new Map<string, { name: string, type: string, count: number }>();

  customerVisits.forEach(vList => {
    const firstVisit = vList[0];
    firstVisit.items.forEach(item => {
      const key = `${item.name}-${item.type}`;
      if (!acquisitionDrivers.has(key)) {
        acquisitionDrivers.set(key, { name: item.name, type: item.type, count: 0 });
      }
      acquisitionDrivers.get(key)!.count++;
    });

    for (let i = 1; i < vList.length; i++) {
      vList[i].items.forEach(item => {
        const key = `${item.name}-${item.type}`;
        if (!retentionDrivers.has(key)) {
          retentionDrivers.set(key, { name: item.name, type: item.type, count: 0 });
        }
        retentionDrivers.get(key)!.count++;
      });
    }
  });

  const topAcquisition = Array.from(acquisitionDrivers.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  const topRetention = Array.from(retentionDrivers.values()).sort((a, b) => b.count - a.count).slice(0, 5);

  const monthlyTrendsMap = new Map<string, { monthLabel: string, newCount: number, returningCount: number, sortKey: number }>();
  
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('default', { month: 'short', year: '2-digit' });
    const sortKey = d.getFullYear() * 12 + d.getMonth();
    monthlyTrendsMap.set(label, { monthLabel: label, newCount: 0, returningCount: 0, sortKey });
  }

  customerVisits.forEach(vList => {
    const firstMonthLabel = vList[0].date.toLocaleDateString('default', { month: 'short', year: '2-digit' });
    if (monthlyTrendsMap.has(firstMonthLabel)) {
      monthlyTrendsMap.get(firstMonthLabel)!.newCount++;
    }

    for (let i = 1; i < vList.length; i++) {
      const monthLabel = vList[i].date.toLocaleDateString('default', { month: 'short', year: '2-digit' });
      if (monthlyTrendsMap.has(monthLabel)) {
        monthlyTrendsMap.get(monthLabel)!.returningCount++;
      }
    }
  });

  const trendData = Array.from(monthlyTrendsMap.values()).sort((a, b) => a.sortKey - b.sortKey);

  let topLoyaltyCustomerName = "-";
  let topLoyaltyVisitCount = 0;
  customerVisits.forEach((vList, custId) => {
    if (vList.length > topLoyaltyVisitCount) {
      topLoyaltyVisitCount = vList.length;
      const found = customers.find(c => c.id === custId);
      if (found) {
        topLoyaltyCustomerName = found.name;
      }
    }
  });

  const activeCustomers = customers.filter(c => !c.isArchived);
  const archivedCustomers = customers.filter(c => c.isArchived);

  // Lifetime spend per customer, deduped by checkout so a multi-item basket counts once.
  const customerSpends = useMemo(() => {
    const spends = new Map<string, number>();
    const processedCheckouts = new Set<string>();
    validTxs.forEach((tx: any) => {
      if (!tx.customerId || !tx.checkout || !tx.checkout.id) return;
      if (processedCheckouts.has(tx.checkout.id)) return;
      processedCheckouts.add(tx.checkout.id);
      const current = spends.get(tx.customerId) || 0;
      spends.set(tx.customerId, current + (tx.checkout.totalPrice || 0));
    });
    return spends;
  }, [validTxs]);

  // Most recent visit date per customer, for follow-up triage.
  const lastVisitedMap = useMemo(() => {
    const map = new Map<string, string>();
    customerVisits.forEach((vList, customerId) => {
      const last = vList.at(-1);
      if (last) map.set(customerId, last.date.toISOString());
    });
    return map;
  }, [customerVisits]);

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

  const createMutation = useMutation({
    mutationFn: (data: InsertCustomer) => apiRequest("POST", "/api/customers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Customer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Customer updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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
      render: (customer: Customer) => {
        const presenter = new CustomerPresenter(customer);
        return <EntityDisplay presenter={presenter} />;
      },
    },
    {
      key: "mobileNumber",
      header: "Mobile",
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
    },
    {
      key: "address",
      header: "Address",
      render: (customer: Customer) => (
        <div className="flex items-start gap-2 max-w-xs">
          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
          <span className="line-clamp-2">{customer.address || "-"}</span>
        </div>
      ),
    },
    {
      key: "totalSpend",
      header: "Total Spend",
      render: (customer: CustomerRow) => (
        <span className="font-mono text-sm">{formatCurrency(customer.totalSpend ?? 0)}</span>
      ),
    },
    {
      key: "lastVisited",
      header: "Last Visited",
      render: (customer: CustomerRow) => (
        <span className="text-sm">{formatDate(customer.lastVisited)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (customer: Customer) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(customer);
            }}
            data-testid={`button-edit-${customer.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedCustomer(customer);
              setIsDeleteOpen(true);
            }}
            data-testid={`button-archive-${customer.id}`}
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ].filter(col => col.key !== "actions" || user?.role !== "staff");

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
      render: (customer: Customer) => {
        const presenter = new CustomerPresenter(customer);
        return (
          <div className="flex items-center gap-2">
            <EntityDisplay presenter={presenter} />
            <Badge variant="secondary" className="h-5">Archived</Badge>
          </div>
        );
      },
    },
    {
      key: "mobileNumber",
      header: "Mobile",
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
    },
    {
      key: "totalSpend",
      header: "Total Spend",
      render: (customer: CustomerRow) => (
        <span className="font-mono text-sm">{formatCurrency(customer.totalSpend ?? 0)}</span>
      ),
    },
    {
      key: "lastVisited",
      header: "Last Visited",
      render: (customer: CustomerRow) => (
        <span className="text-sm">{formatDate(customer.lastVisited)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (customer: Customer) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              restoreMutation.mutate(customer.id);
            }}
            title="Restore customer"
            data-testid={`button-restore-${customer.id}`}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Permanently delete this customer? This cannot be undone.")) {
                permanentDeleteMutation.mutate(customer.id);
              }
            }}
            data-testid={`button-delete-permanent-${customer.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ].filter(col => col.key !== "actions" || user?.role !== "staff");

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
      totalSpend: customerSpends.get(c.id) || 0,
      updatedAt: c.updatedAt,
    }));

    return exportReportToPDF<CustomerReportRow>({
      filename: `customers-report_${activeTab}_${new Date().toISOString().slice(0, 10)}`,
      title: `Customers Report (${activeTab === "active" ? "Active" : "Archived"})`,
      businessName: business?.name ?? currentStore?.name ?? "Business",
      storeName: currentStore?.name ?? "All Stores",
      kpis: [
        { label: "New This Month", value: String(newThisMonth), sub: `${acquisitionPercentChange >= 0 ? "+" : ""}${acquisitionPercentChange}% vs last month` },
        { label: "Retention Rate", value: `${retentionRate}%`, sub: `${returningCustomersCount} of ${totalCustomersCount} active` },
        { label: "Avg Days to Return", value: `${avgReturnDays} days` },
        { label: "Top Loyalty Customer", value: topLoyaltyCustomerName, sub: `${topLoyaltyVisitCount} visits` },
      ],
      columns: [
        { key: "name", header: "Name" },
        { key: "customerNumber", header: "Customer #" },
        { key: "mobileNumber", header: "Mobile" },
        { key: "address", header: "Address" },
        { key: "loyaltyPoints", header: "Loyalty Pts", align: "right" },
        { key: "totalSpend", header: "Total Spend", align: "right", format: (r) => formatCurrency(r.totalSpend) },
        { key: "updatedAt", header: "Last Updated", format: (r) => formatDate(r.updatedAt) },
      ],
      rows: pdfRows,
      amountKey: "totalSpend",
      formatAmount: formatCurrency,
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
        description={`Managing customers for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
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
            {user?.role !== "staff" && (
              <Button onClick={openCreateForm} data-testid="button-add-customer">
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-customers">
            Active ({activeCustomers.length})
          </TabsTrigger>
          <TabsTrigger value="archived" data-testid="tab-archived-customers">
            Archived ({archivedCustomers.length})
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics-customers">
            Analytics & Retention
          </TabsTrigger>
        </TabsList>
        {(() => {
          const filterConfigs = [
            { key: "createdAt", label: "Date Added", type: "date-range" as const },
            { key: "lastVisited", label: "Last Visited", type: "date-range" as const },
            { key: "totalSpend", label: "Total Spend", type: "range" as const, currencySymbol: currentStore?.currency === "USD" ? "$" : "₦" }
          ];

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

          const showPagination = currentStore?.id !== "all" && totalPages > 1;

          return (
            <>
              <TabsContent value="active" className="mt-4">
                {/* Server-side search for single-store (paginated); internal search for all-stores */}
                {currentStore?.id !== "all" && (
                  <div className="mb-3">
                    <Input
                      placeholder="Search active customers..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="max-w-xs h-9"
                    />
                  </div>
                )}
                <DataTable
                  data={activeTableData}
                  columns={activeColumns}
                  searchable={currentStore?.id === "all"}
                  searchPlaceholder="Search active customers..."
                  searchKeys={["name", "customerNumber", "mobileNumber", "address"]}
                  isLoading={isLoading}
                  emptyMessage="Add active profiles to start tracking their credit limits, transactions, and retention logs."
                  onRowClick={navigateToCustomerDetails}
                  filterConfigs={filterConfigs}
                  onVisibleDataChange={setVisibleCustomerRows}
                  urlKey="active"
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
                {showPagination && (
                  <Pagination className="mt-4">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          aria-disabled={page === 1}
                          className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <span className="px-3 py-2 text-sm text-muted-foreground">
                          Page {page} of {totalPages}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          aria-disabled={page === totalPages}
                          className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </TabsContent>
              <TabsContent value="archived" className="mt-4">
                <DataTable
                  data={archivedTableData}
                  columns={archivedColumns}
                  searchable
                  searchPlaceholder="Search archived customers..."
                  searchKeys={["name", "customerNumber", "mobileNumber"]}
                  isLoading={isLoading}
                  emptyMessage="Archived or deleted customers will be filed here for compliance histories."
                  filterConfigs={filterConfigs}
                  onVisibleDataChange={setVisibleCustomerRows}
                  urlKey="archivedTbl"
                  emptyIcon={<Users className="h-6 w-6 opacity-40" />}
                  emptyTitle="No Archived Profiles"
                />
              </TabsContent>
            </>
          );
        })()}
        <TabsContent value="analytics" className="space-y-6 mt-4">
          {isLoading || isLoadingTxs ? (
            <MetricGrid>
              {[...Array(4)].map((_, i) => (
                <MetricCard key={i} title="" value="" isLoading className="border-primary/10" />
              ))}
            </MetricGrid>
          ) : (
            <>
              {/* Key Indicators Row */}
              <MetricGrid>
                <MetricCard
                  title="New Customers (This Month)"
                  value={newThisMonth}
                  icon={<Users className="h-4 w-4 text-indigo-500" />}
                  trend={acquisitionPercentChange >= 0 ? "up" : "down"}
                  trendValue={`${acquisitionPercentChange >= 0 ? "+" : ""}${acquisitionPercentChange}%`}
                  description="vs last month"
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Returning Customer Rate"
                  value={`${retentionRate}%`}
                  icon={<Percent className="h-4 w-4 text-emerald-500" />}
                  description={`${returningCustomersCount} out of ${totalCustomersCount} active profiles`}
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Avg. Days to Return"
                  value={`${avgReturnDays} days`}
                  icon={<Clock className="h-4 w-4 text-cyan-500" />}
                  description="Typical gap between checkouts for regulars"
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Top Loyalty Customer"
                  value={topLoyaltyCustomerName}
                  valueClassName="font-sans text-base sm:text-lg truncate"
                  icon={<Award className="h-4 w-4 text-amber-500" />}
                  description={`Completed ${topLoyaltyVisitCount} visits overall`}
                  className="border-primary/10 hover:border-primary/20"
                />
              </MetricGrid>

              {/* Trend Chart */}
              <Card className="border-primary/10 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>Acquisition vs Retention Over Time</span>
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">Last 6 Months</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                        <XAxis
                          dataKey="monthLabel"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted)/0.15)" }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-background/95 backdrop-blur-md border border-border/80 p-3 rounded-lg shadow-xl text-xs space-y-1.5 font-sans min-w-[150px]">
                                  <p className="font-semibold text-foreground border-b border-border/60 pb-1 mb-1">{label}</p>
                                  {payload.map((item: any, idx: number) => (
                                    <p key={idx} className="flex justify-between gap-4 font-medium" style={{ color: item.color }}>
                                      <span>{item.name}:</span>
                                      <span className="font-mono font-bold">{item.value} visits</span>
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="newCount" name="New Customers" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={25} />
                        <Bar dataKey="returningCount" name="Returning Customers" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Drivers Breakdown */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Acquisition Drivers */}
                <Card className="border-primary/10 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ArrowUpRight className="h-4 w-4 text-indigo-500" />
                      Top Acquisition Drivers
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">What services or products bring in customers for their very first checkout</p>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    {topAcquisition.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-6">No acquisition statistics available.</p>
                    ) : (
                      topAcquisition.map((item, idx) => {
                        const maxVal = topAcquisition[0]?.count || 1;
                        const percentage = Math.round((item.count / maxVal) * 100);
                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-medium">
                              <span className="truncate flex items-center gap-1.5">
                                {item.type === "service" ? (
                                  <Wrench className="h-3.5 w-3.5 text-indigo-400" />
                                ) : (
                                  <ShoppingBag className="h-3.5 w-3.5 text-amber-400" />
                                )}
                                {item.name}
                              </span>
                              <span className="text-muted-foreground">{item.count} checkouts</span>
                            </div>
                            <div className="w-full bg-indigo-50 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>

                {/* Retention Drivers */}
                <Card className="border-primary/10 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-emerald-500" />
                      Top Retention Drivers
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">What services or products keep customers returning for subsequent checkouts</p>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    {topRetention.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-6">No retention statistics available.</p>
                    ) : (
                      topRetention.map((item, idx) => {
                        const maxVal = topRetention[0]?.count || 1;
                        const percentage = Math.round((item.count / maxVal) * 100);
                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-medium">
                              <span className="truncate flex items-center gap-1.5">
                                {item.type === "service" ? (
                                  <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <ShoppingBag className="h-3.5 w-3.5 text-amber-400" />
                                )}
                                {item.name}
                              </span>
                              <span className="text-muted-foreground">{item.count} return visits</span>
                            </div>
                            <div className="w-full bg-emerald-50 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-emerald-600 h-full rounded-full transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
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

      {user?.role !== "staff" && activeTab !== "analytics" && (
        <SpeedDialFAB
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
