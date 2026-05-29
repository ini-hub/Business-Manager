import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useQuery, useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Building2, Store, Pencil, Trash2, MapPin, Phone, Globe, Coins, User, UserPlus, CreditCard, Lock, Check, ShieldCheck, Database, Upload, Download, FileText, Settings2, Trash, BookOpen } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store as StoreType, Staff, InsertStaff } from "@shared/schema";
import { insertStaffSchema } from "@shared/schema";
import { countries, currencies, getCurrencyByCode, getCountryByCode } from "@/lib/currency-utils";
import { countryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useRef } from "react";

const businessFormSchema = z.object({
  name: z.string().min(1, "Business name is required").max(200, "Name is too long"),
  address: z.string().optional(),
  phone: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  logoUrl: z.string().optional(),
  businessUrl: z.string().optional(),
  commissionSplitBusinessShare: z.number().min(0).max(100).default(80),
  commissionSplitStaffShare: z.number().min(0).max(100).default(20),
}).refine(data => data.commissionSplitBusinessShare + data.commissionSplitStaffShare === 100, {
  message: "Commission split percentages must sum to exactly 100%",
  path: ["commissionSplitStaffShare"]
});

const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required").max(200, "Name is too long"),
  code: z.string()
    .min(1, "Store code is required")
    .max(10, "Store code must be 10 characters or less")
    .regex(/^[A-Z0-9]+$/, "Store code must be uppercase letters and numbers only"),
  address: z.string().optional(),
  phone: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  country: z.string().default("NG"),
  currency: z.string().default("NGN"),
  managerStaffId: z.string().nullable().optional(),
  commissionSplitOverride: z.boolean().default(false),
  commissionSplitBusinessShare: z.number().min(0).max(100).default(80),
  commissionSplitStaffShare: z.number().min(0).max(100).default(20),
}).refine(data => {
  if (data.commissionSplitOverride) {
    return data.commissionSplitBusinessShare + data.commissionSplitStaffShare === 100;
  }
  return true;
}, {
  message: "Override split percentages must sum to exactly 100%",
  path: ["commissionSplitStaffShare"]
});

const staffFormSchema = insertStaffSchema.extend({
  mobileNumber: z.string().min(1, "Mobile number is required"),
  staffNumber: z.string().optional().default(""),
});

type BusinessFormValues = z.infer<typeof businessFormSchema>;
type StoreFormValues = z.infer<typeof storeFormSchema>;

export default function SettingsStoresPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const {
    business,
    stores,
    currentStore,
    setCurrentStore,
    isLoading,
    createBusiness,
    updateBusiness,
    createStore,
    updateStore,
    deleteStore,
  } = useStore();

  const [isBusinessDialogOpen, setIsBusinessDialogOpen] = useState(false);
  const [isStoreDialogOpen, setIsStoreDialogOpen] = useState(false);
  const [isAddStaffDialogOpen, setIsAddStaffDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreType | null>(null);
  const [deletingStore, setDeletingStore] = useState<StoreType | null>(null);
  const [newlyCreatedStaffId, setNewlyCreatedStaffId] = useState<string | null>(null);
  const [allStaffByStore, setAllStaffByStore] = useState<Record<string, Staff[]>>({});

  // Custom Roles States and Queries
  const { data: customRoles = [], refetch: refetchCustomRoles } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: !!business,
  });

  const openAddRole = () => {
    setLocation("/settings/roles/new");
  };

  const openEditRole = (role: any) => {
    setLocation(`/settings/roles/${role.id}/edit`);
  };

  const deleteCustomRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/custom-roles/${id}`);
      return res.json();
    },
    onSuccess: () => {
      refetchCustomRoles();
      toast({ title: "Custom role deleted successfully." });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to delete role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

  // CSV Template, Exports, & Bulk Imports States
  const downloadCSVTemplate = (type: string) => {
    let headers: string[] = [];
    let row: string[] = [];
    let filename = "";

    if (type === "staff") {
      headers = ["name", "staffNumber", "email", "mobileNumber", "payPerMonth", "signedContract", "paymentMethod"];
      row = ["Jane Smith", "STF-001", "jane.smith@example.com", "08031234567", "50000", "true", "hybrid"];
      filename = "staff_template.csv";
    } else if (type === "expenses") {
      headers = ["description", "amount", "category", "date"];
      row = ["Store Rent", "150000", "Rent", "2026-05-19"];
      filename = "expenses_template.csv";
    } else if (type === "inventory") {
      headers = ["name", "type", "costPrice", "sellingPrice", "quantity"];
      row = ["Widget Pro", "product", "10.00", "25.00", "100"];
      filename = "inventory_template.csv";
    } else if (type === "customers") {
      headers = ["name", "customerNumber", "mobileNumber", "address"];
      row = ["John Doe", "CUST-001", "08039876543", "123 Main Street"];
      filename = "customers_template.csv";
    }

    const csvContent = [headers.join(","), row.join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Template downloaded",
      description: "Fill in the template and upload it to import your data.",
    });
  };

  const exportRoster = async (type: string) => {
    if (!currentStore) return;
    try {
      let endpoint = "";
      let filename = "";
      if (type === "staff") {
        endpoint = `/api/staff?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_staff_export.csv`;
      } else if (type === "expenses") {
        endpoint = `/api/expenses?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_expenses_export.csv`;
      } else if (type === "inventory") {
        endpoint = `/api/inventory?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_inventory_export.csv`;
      } else if (type === "customers") {
        endpoint = `/api/customers?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_customers_export.csv`;
      }

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Failed to fetch list.");
      const listData = await res.json();

      if (!Array.isArray(listData) || listData.length === 0) {
        toast({
          title: "Nothing to Export",
          description: "No entries found to export.",
          variant: "destructive"
        });
        return;
      }

      const headers = Object.keys(listData[0]).filter(k => typeof listData[0][k] !== "object" && k !== "id");
      const rows = listData.map((item: any) =>
        headers.map((h) => `"${String(item[h] ?? "").replace(/"/g, '""')}"`).join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export completed",
        description: `${listData.length} records exported to CSV.`,
      });
    } catch (err) {
      toast({
        title: "Export Failed",
        description: "Could not export records at this time.",
        variant: "destructive"
      });
    }
  };

  const [activeImportType, setActiveImportType] = useState<string | null>(null);
  const [isImportingProgressOpen, setIsImportingProgressOpen] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [bulkImportResult, setBulkImportResult] = useState<any>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  const triggerUpload = (type: string) => {
    setActiveImportType(type);
    setTimeout(() => {
      bulkFileInputRef.current?.click();
    }, 100);
  };

  const handleBulkFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeImportType || !currentStore) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n").filter(l => l.trim());
        if (lines.length < 2) {
          toast({
            title: "Empty File",
            description: "No data rows found in CSV.",
            variant: "destructive"
          });
          return;
        }

        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        const parsed = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
          const row: any = {};
          headers.forEach((h, index) => {
            row[h] = values[index] ?? "";
          });
          parsed.push(row);
        }

        setIsImportingProgressOpen(true);
        setBulkImportProgress(40);
        setBulkImportResult(null);

        let endpoint = "";
        let bodyKey = "data";
        if (activeImportType === "staff") {
          endpoint = "/api/staff/bulk";
          bodyKey = "data";
        } else if (activeImportType === "expenses") {
          endpoint = "/api/expenses/bulk";
          bodyKey = "expenses";
        } else if (activeImportType === "inventory") {
          endpoint = "/api/inventory/bulk";
          bodyKey = "data";
        } else if (activeImportType === "customers") {
          endpoint = "/api/customers/bulk";
          bodyKey = "data";
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: currentStore.id,
            [bodyKey]: parsed,
          })
        });

        const resData = await res.json();
        setBulkImportProgress(100);
        setBulkImportResult(resData);
        
        queryClient.invalidateQueries();
      } catch (err: any) {
        setIsImportingProgressOpen(false);
        toast({
          title: "Import Error",
          description: err.message || "Failed to process import.",
          variant: "destructive"
        });
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = "";
  };

  const editingStoreId = editingStore?.id;
  
  const { data: storeStaff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", editingStoreId],
    enabled: !!editingStoreId,
  });

  const refreshStaffForStore = async (storeId: string) => {
    try {
      const response = await fetch(`/api/staff?storeId=${storeId}`);
      if (response.ok) {
        const staff = await response.json();
        setAllStaffByStore(prev => ({ ...prev, [storeId]: staff }));
      }
    } catch {
      // Keep existing data on error
    }
  };

  useEffect(() => {
    const fetchAllStaffForStores = async () => {
      if (!stores || stores.length === 0) return;
      const staffByStore: Record<string, Staff[]> = {};
      for (const store of stores) {
        try {
          const response = await fetch(`/api/staff?storeId=${store.id}`);
          if (response.ok) {
            const staff = await response.json();
            staffByStore[store.id] = staff;
          }
        } catch {
          staffByStore[store.id] = [];
        }
      }
      setAllStaffByStore(staffByStore);
    };
    fetchAllStaffForStores();
  }, [stores]);

  // Only show staff with manager role for the store manager dropdown
  const activeStaffForStore = storeStaff.filter(s => !s.isArchived && s.role === "manager");

  const staffForm = useForm<InsertStaff>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      storeId: editingStoreId || "",
      name: "",
      email: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    },
  });

  const createStaffMutation = useMutation({
    mutationFn: async (data: InsertStaff): Promise<Staff> => {
      if (!editingStoreId) {
        throw new Error("Cannot create staff without a store");
      }
      // Create staff with manager role since this is for store manager assignment
      const response = await apiRequest("POST", "/api/staff", { 
        ...data, 
        storeId: editingStoreId,
        role: "manager" 
      });
      return await response.json() as Staff;
    },
    onSuccess: async (newStaff: Staff) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/staff", editingStoreId] });
      if (editingStoreId) {
        await refreshStaffForStore(editingStoreId);
        
        // Auto-assign the new staff as store manager
        try {
          await apiRequest("PATCH", `/api/stores/${editingStoreId}`, {
            managerStaffId: newStaff.id
          });
          await queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
        } catch {
          // Store update failed but staff was created
        }
      }
      setNewlyCreatedStaffId(newStaff.id);
      storeForm.setValue("managerStaffId", newStaff.id);
      toast({ title: "Staff member created and assigned as manager" });
      setIsAddStaffDialogOpen(false);
      staffForm.reset();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Create Staff Member", 
        description: error.message || "Please check the information and try again.", 
        variant: "destructive" 
      });
    },
  });

  const handleStaffSubmit = (data: InsertStaff) => {
    const countryCode = data.countryCode || "NG";
    const validation = validatePhoneNumber(data.mobileNumber, countryCode);
    if (!validation.valid) {
      staffForm.setError("mobileNumber", { message: validation.error });
      return;
    }
    createStaffMutation.mutate(data);
  };
  
  const isEditingExistingStore = !!editingStore;

  const businessForm = useForm<BusinessFormValues>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      name: business?.name || "",
      address: (business as any)?.address || "",
      phone: (business as any)?.phone || "",
      phoneCountryCode: (business as any)?.phoneCountryCode || "+234",
      logoUrl: (business as any)?.logoUrl || "",
      businessUrl: (business as any)?.businessUrl || "",
    },
  });

  const storeForm = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: "",
      code: "",
      address: "",
      phone: "",
      phoneCountryCode: "+234",
      country: "NG",
      currency: "NGN",
      managerStaffId: null,
    },
  });

  const watchedCountry = storeForm.watch("country");
  
  useEffect(() => {
    const countryInfo = getCountryByCode(watchedCountry);
    if (countryInfo) {
      storeForm.setValue("currency", countryInfo.currency);
    }
  }, [watchedCountry, storeForm]);

  useEffect(() => {
    if (business) {
      businessForm.reset({
        name: business.name || "",
        address: (business as any).address || "",
        phone: (business as any).phone || "",
        phoneCountryCode: (business as any).phoneCountryCode || "+234",
        logoUrl: (business as any).logoUrl || "",
        businessUrl: (business as any).businessUrl || "",
        commissionSplitBusinessShare: (business as any).commissionSplitBusinessShare ?? 80,
        commissionSplitStaffShare: (business as any).commissionSplitStaffShare ?? 20,
      });
    }
  }, [business, businessForm]);

  const handleBusinessSubmit = async (values: BusinessFormValues) => {
    try {
      if (business) {
        await updateBusiness(business.id, values);
        toast({ title: "Business updated successfully" });
      } else {
        await createBusiness(values);
        toast({ title: "Business created successfully" });
      }
      setIsBusinessDialogOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleStoreSubmit = async (values: StoreFormValues) => {
    try {
      if (editingStore) {
        const updated = await updateStore(editingStore.id, values);
        if (currentStore?.id === editingStore.id) {
          setCurrentStore(updated);
        }
        await refreshStaffForStore(editingStore.id);
        toast({ title: "Store updated successfully" });
      } else {
        if (!business) {
          toast({
            title: "Error",
            description: "Please set up your business information first.",
            variant: "destructive",
          });
          return;
        }
        const newStore = await createStore({ ...values, businessId: business.id });
        if (!currentStore) {
          setCurrentStore(newStore);
        }
        toast({ title: "Store created successfully" });
      }
      setIsStoreDialogOpen(false);
      setEditingStore(null);
      storeForm.reset();
    } catch (error) {
      toast({
        title: editingStore ? "Store Update Failed" : "Store Creation Failed",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleDeleteStore = async () => {
    if (!deletingStore) return;
    try {
      await deleteStore(deletingStore.id);
      if (currentStore?.id === deletingStore.id && stores.length > 1) {
        const nextStore = stores.find(s => s.id !== deletingStore.id);
        if (nextStore) setCurrentStore(nextStore);
      }
      toast({ title: "Store deleted successfully" });
      setDeletingStore(null);
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const openEditStore = (store: StoreType) => {
    setLocation(`/settings/stores/${store.id}/edit`);
  };

  const openAddStore = () => {
    setLocation("/settings/stores/new");
  };

  const openAddStaffDialog = () => {
    if (!editingStoreId) return;
    staffForm.reset({
      storeId: editingStoreId,
      name: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    });
    setIsAddStaffDialogOpen(true);
  };

  const getManagerName = (managerId: string | null | undefined, storeId?: string) => {
    if (!managerId) return null;
    if (storeId && allStaffByStore[storeId]) {
      const manager = allStaffByStore[storeId].find(s => s.id === managerId);
      if (manager) return manager.name;
    }
    const manager = activeStaffForStore.find(s => s.id === managerId);
    return manager?.name || null;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const tabItems: TabItem[] = [
    { value: "stores", label: "Stores Management", icon: <Store className="h-4 w-4" /> },
    { value: "business", label: "Business Details", icon: <Building2 className="h-4 w-4" /> },
    { value: "roles", label: "Roles & Permissions", icon: <ShieldCheck className="h-4 w-4" />, testId: "tab-roles-permissions" },
    { value: "bulk", label: "Bulk Operations", icon: <Database className="h-4 w-4" />, testId: "tab-bulk-operations" },
    { value: "payments", label: "Plugins & Integrations", icon: <CreditCard className="h-4 w-4" /> },
    { value: "borrow-book", label: "Borrow Book Reminders", icon: <BookOpen className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business & Stores"
        description="Manage your business information and store locations"
      />

      <Tabs defaultValue="stores" className="w-full space-y-6">
        <PolymorphicTabsList tabs={tabItems} variant="default" />

        <TabsContent value="stores" className="space-y-6 mt-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  Your Stores
                </CardTitle>
                <CardDescription>
                  Manage individual store locations. Each store has separate customers, staff, and inventory.
                </CardDescription>
              </div>
              <Button onClick={openAddStore} disabled={!business} data-testid="button-add-store">
                <Plus className="h-4 w-4 mr-2" />
                Add Store
              </Button>
            </CardHeader>
            <CardContent>
              {!business ? (
                <p className="text-muted-foreground">
                  Please set up your business information first before adding stores.
                </p>
              ) : stores.length === 0 ? (
                <p className="text-muted-foreground">
                  No stores set up yet. Click "Add Store" to create your first store location.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {stores.map((store) => (
                    <Card
                      key={store.id}
                      className={`relative ${currentStore?.id === store.id ? "ring-2 ring-primary" : ""}`}
                      data-testid={`card-store-${store.id}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate" data-testid={`text-store-name-${store.id}`}>
                              {store.name}
                            </CardTitle>
                            <CardDescription className="font-mono text-xs" data-testid={`text-store-code-${store.id}`}>
                              Code: {store.code}
                            </CardDescription>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditStore(store)}
                              data-testid={`button-edit-store-${store.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingStore(store)}
                              disabled={stores.length === 1}
                              data-testid={`button-delete-store-${store.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground space-y-1">
                        {store.address && (
                          <p className="flex items-center gap-2 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {store.address}
                          </p>
                        )}
                        {store.phone && (
                          <p className="flex items-center gap-2">
                            <Phone className="h-3 w-3 shrink-0" />
                            {store.phoneCountryCode || "+234"} {store.phone}
                          </p>
                        )}
                        <p className="flex items-center gap-2">
                          <Globe className="h-3 w-3 shrink-0" />
                          {getCountryByCode(store.country || "NG")?.name || "Nigeria"}
                        </p>
                        <p className="flex items-center gap-2">
                          <Coins className="h-3 w-3 shrink-0" />
                          {getCurrencyByCode(store.currency || "NGN")?.symbol || "₦"} {store.currency || "NGN"}
                        </p>
                        {store.managerStaffId && getManagerName(store.managerStaffId, store.id) && (
                          <p className="flex items-center gap-2">
                            <User className="h-3 w-3 shrink-0" />
                            Manager: {getManagerName(store.managerStaffId, store.id)}
                          </p>
                        )}
                        {currentStore?.id === store.id && (
                          <p className="mt-2 text-xs text-primary font-medium">Currently Selected</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="business" className="space-y-6 mt-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Business Information
                </CardTitle>
                <CardDescription>
                  Your business details that appear across all stores
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setLocation(business ? "/settings/business/edit" : "/settings/business/new");
                }}
                data-testid="button-edit-business"
              >
                <Pencil className="h-4 w-4 mr-2" />
                {business ? "Edit" : "Set Up"}
              </Button>
            </CardHeader>
            <CardContent>
              {business ? (
                <div className="space-y-2">
                  <p className="font-medium text-lg" data-testid="text-business-name">{business.name}</p>
                  {(business as any).address && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {(business as any).address}
                    </p>
                  )}
                  {(business as any).phone && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      {(business as any).phoneCountryCode || "+234"} {(business as any).phone}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No business information set up yet. Click "Set Up" to add your business details.
                </p>
              )}
            </CardContent>
          </Card>

          {!currentStore ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <Store className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure receipt branding.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <BusinessSettingsSection />
          )}
        </TabsContent>

        <TabsContent value="roles" className="space-y-6 mt-0 animate-in fade-in duration-200">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Roles & Permissions
                </CardTitle>
                <CardDescription>
                  Define system roles, edit checkboxes for permissions, and add custom roles.
                </CardDescription>
              </div>
              <Button onClick={openAddRole} data-testid="button-create-role">
                <Plus className="h-4 w-4 mr-2" />
                Create Custom Role
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* System Roles */}
                <Card className="border border-muted/60 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 font-semibold">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      Owner / Admin <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Full administrative controls and financial dashboard visibility.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Dashboard", "Sales & Checkout", "Customers", "Staff & Payroll", "Inventory & Catalog", "Expenses & Reports", "Settings"].map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                          <Check className="h-3 w-3 text-green-500" /> {p}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-muted/60 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 font-semibold">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      Store Manager <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Store operations, sales execution, inventory and staff control.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Dashboard", "Sales & Checkout", "Customers", "Staff & Payroll", "Inventory & Catalog", "Expenses & Reports"].map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                          <Check className="h-3 w-3 text-green-500" /> {p}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-muted/60 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 font-semibold">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      Staff <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Perform checkouts, record sales, and update inventory counters.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Sales & Checkout", "Customers", "Inventory & Catalog"].map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                          <Check className="h-3 w-3 text-green-500" /> {p}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Custom Roles */}
                {customRoles.map((role) => (
                  <Card key={role.id} className="border border-muted/60 shadow-xs relative group animate-in zoom-in-95 duration-150">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4 text-primary" />
                          {role.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => openEditRole(role)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteCustomRoleMutation.mutate(role.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {role.description || "No description provided."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Active Permissions:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {role.permissions && role.permissions.length > 0 ? (
                          role.permissions.map((p: string) => (
                            <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-primary/5 text-primary border-primary/20">
                              <Check className="h-3 w-3 text-primary" /> {p}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No modular permissions assigned yet.</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-6 mt-0 animate-in fade-in duration-200">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Unified Bulk Operations
              </CardTitle>
              <CardDescription>
                Download templates, perform bulk uploads, and export data lists to CSV files.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!currentStore || currentStore.id === "all" ? (
                <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
                  <Database className="h-10 w-10 text-muted-foreground/50" />
                  <div>
                    <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                    <CardDescription className="max-w-sm mt-1">
                      You need to select or create a store location first under the <strong>Stores Management</strong> tab to use bulk operations.
                    </CardDescription>
                  </div>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Bulk Staff */}
                  <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                        <User className="h-4 w-4" />
                        Bulk Staff Operations
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Upload a roster of staff using our CSV template, or export active rosters.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("staff")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("staff")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                        </Button>
                      </div>
                      <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("staff")}>
                        <Upload className="h-6 w-6 text-muted-foreground/60" />
                        <span className="text-xs font-semibold">Upload Staff CSV</span>
                        <span className="text-[10px] text-muted-foreground">Standardized template match required</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Bulk Expenses */}
                  <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                        <Coins className="h-4 w-4" />
                        Bulk Expense Operations
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Upload expense lists with automated category name matching (no category IDs needed).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("expenses")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("expenses")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                        </Button>
                      </div>
                      <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("expenses")}>
                        <Upload className="h-6 w-6 text-muted-foreground/60" />
                        <span className="text-xs font-semibold">Upload Expenses CSV</span>
                        <span className="text-[10px] text-muted-foreground">Categories resolved by name</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Bulk Inventory */}
                  <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                        <Store className="h-4 w-4" />
                        Bulk Inventory Operations
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Populate your store's products/services, or export current stock catalogs.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("inventory")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("inventory")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                        </Button>
                      </div>
                      <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("inventory")}>
                        <Upload className="h-6 w-6 text-muted-foreground/60" />
                        <span className="text-xs font-semibold">Upload Inventory CSV</span>
                        <span className="text-[10px] text-muted-foreground">Standard template fields supported</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Bulk Customers */}
                  <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                        <UserPlus className="h-4 w-4" />
                        Bulk Customer Operations
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Onboard directory profiles, or export the active client database.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("customers")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("customers")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                        </Button>
                      </div>
                      <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("customers")}>
                        <Upload className="h-6 w-6 text-muted-foreground/60" />
                        <span className="text-xs font-semibold">Upload Customers CSV</span>
                        <span className="text-[10px] text-muted-foreground">Up to 5MB file size</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-6 mt-0">
          {!currentStore || currentStore.id === "all" ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <CreditCard className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure custom payment integrations.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <StoreIntegrationsSection />
          )}
        </TabsContent>

        <TabsContent value="borrow-book" className="space-y-6 mt-0">
          {!currentStore || currentStore.id === "all" ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <BookOpen className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure debt reminder policies.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <BorrowBookSettingsSection />
          )}
        </TabsContent>
      </Tabs>




      <Dialog open={isAddStaffDialogOpen} onOpenChange={setIsAddStaffDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Staff Member</DialogTitle>
            <DialogDescription>
              Create a new staff member to assign as the store manager.
            </DialogDescription>
          </DialogHeader>
          <Form {...staffForm}>
            <form onSubmit={staffForm.handleSubmit(handleStaffSubmit)} className="space-y-4">
              <FormField
                control={staffForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="John Doe" data-testid="input-staff-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={staffForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="staff@example.com" data-testid="input-staff-email" />
                    </FormControl>
                    <FormDescription>
                      Staff will use this email to log in
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Mobile Number</FormLabel>
                <div className="flex gap-2">
                  <FormField
                    control={staffForm.control}
                    name="countryCode"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || "NG"}>
                        <SelectTrigger className="w-[120px]" data-testid="select-staff-country-code">
                          <SelectValue placeholder="NG" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {countryCodes.map((cc) => (
                            <SelectItem key={cc.code} value={cc.code}>
                              {cc.dialCode} ({cc.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={staffForm.control}
                    name="mobileNumber"
                    render={({ field }) => (
                      <FormControl>
                        <Input {...field} placeholder="Phone number" className="flex-1" data-testid="input-staff-mobile" />
                      </FormControl>
                    )}
                  />
                </div>
                {staffForm.formState.errors.mobileNumber && (
                  <p className="text-sm text-destructive">{staffForm.formState.errors.mobileNumber.message}</p>
                )}
              </FormItem>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={staffForm.control}
                  name="payPerMonth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pay Per Month</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          placeholder="50000" 
                          data-testid="input-staff-pay" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={staffForm.control}
                  name="signedContract"
                  render={({ field }) => (
                    <FormItem className="flex flex-col justify-end">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-staff-contract"
                          />
                        </FormControl>
                        <FormLabel className="mb-0">Signed Contract</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddStaffDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createStaffMutation.isPending} data-testid="button-save-staff">
                  {createStaffMutation.isPending ? "Creating..." : "Create Staff"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingStore}
        onOpenChange={() => setDeletingStore(null)}
        title="Delete Store"
        description={`Are you sure you want to delete "${deletingStore?.name}"? This cannot be undone. You can only delete a store if it has no customers, staff, or inventory.`}
        onConfirm={handleDeleteStore}
        confirmText="Delete Store"
        isDestructive
      />


      {/* Bulk Progress Dialog */}
      <Dialog open={isImportingProgressOpen} onOpenChange={setIsImportingProgressOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">Import {activeImportType}</DialogTitle>
            <DialogDescription>
              {bulkImportResult ? "Import completed." : "Processing data rows..."}
            </DialogDescription>
          </DialogHeader>

          {!bulkImportResult && (
            <div className="space-y-4 py-2">
              <Progress value={bulkImportProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Uploading and saving entries...</p>
            </div>
          )}

          {bulkImportResult && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <span className="text-xs">
                  Success: <strong className="text-green-600">{bulkImportResult.success ?? 0}</strong>
                </span>
                <span className="text-xs">
                  Failed: <strong className="text-red-600">{bulkImportResult.failed ?? 0}</strong>
                </span>
              </div>

              {bulkImportResult.errors && bulkImportResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">Errors list:</p>
                  <ScrollArea className="h-32 border p-2 rounded bg-muted/10">
                    {bulkImportResult.errors.map((err: any, idx: number) => (
                      <p key={idx} className="text-[10px] text-red-600 mb-1">
                        Row {err.row || idx + 1}: {err.message || String(err)}
                      </p>
                    ))}
                  </ScrollArea>
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => setIsImportingProgressOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden file input for unified CSV uploads */}
      <input
        type="file"
        ref={bulkFileInputRef}
        accept=".csv"
        onChange={handleBulkFileSelect}
        className="hidden"
      />
    </div>
  );
}

function BusinessSettingsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  
  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/settings", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", currentStore?.id] });
      toast({ title: "Settings updated successfully" });
    },
  });

  const [receiptPrefix, setReceiptPrefix] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState(5);

  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("hybrid");
  const [commissionType, setCommissionType] = useState("percentage");
  const [commissionFixedAmount, setCommissionFixedAmount] = useState(0);
  const [commissionFormula, setCommissionFormula] = useState("formula_b");
  const [activeDayTransport, setActiveDayTransport] = useState(1000);
  const [passiveDayTransport, setPassiveDayTransport] = useState(500);
  const [commissionRate, setCommissionRate] = useState(30);
  const [fixedBaseAmount, setFixedBaseAmount] = useState(30000);
  
  const [leaveDayRate, setLeaveDayRate] = useState(0);
  const [payLeaveDays, setPayLeaveDays] = useState(false);
  const [holidayDayRate, setHolidayDayRate] = useState(0);
  const [payHolidayDays, setPayHolidayDays] = useState(false);
  const [offDayRate, setOffDayRate] = useState(0);
  const [payOffDays, setPayOffDays] = useState(false);
  
  const [leadSplit2, setLeadSplit2] = useState(80);
  const [asstSplit2, setAsstSplit2] = useState(20);
  const [leadSplit3, setLeadSplit3] = useState(60);
  const [asst1Split3, setAsst1Split3] = useState(20);
  const [asst2Split3, setAsst2Split3] = useState(20);

  useEffect(() => {
    if (settingsData) {
      setReceiptPrefix(settingsData.receiptPrefix || "RCP");
      setThankYouMessage(settingsData.receiptThankYouMessage || "");
      setLowStockThreshold(settingsData.lowStockThreshold || 5);
      
      setDefaultPaymentMethod(settingsData.defaultPaymentMethod || "hybrid");
      setCommissionType(settingsData.commissionType || "percentage");
      setCommissionFixedAmount(settingsData.commissionFixedAmount ?? 0);
      setCommissionFormula(settingsData.commissionFormula || "formula_b");
      setActiveDayTransport(settingsData.activeDayTransport ?? 1000);
      setPassiveDayTransport(settingsData.passiveDayTransport ?? 500);
      setCommissionRate(Math.round((settingsData.commissionRate ?? 0.30) * 100));
      setFixedBaseAmount(settingsData.fixedBaseAmount ?? 30000);
      
      setLeaveDayRate(settingsData.leaveDayRate ?? 0);
      setPayLeaveDays(!!settingsData.payLeaveDays);
      setHolidayDayRate(settingsData.holidayDayRate ?? 0);
      setPayHolidayDays(!!settingsData.payHolidayDays);
      setOffDayRate(settingsData.offDayRate ?? 0);
      setPayOffDays(!!settingsData.payOffDays);
      
      setLeadSplit2(settingsData.leadSplit2 ?? 80);
      setAsstSplit2(settingsData.asstSplit2 ?? 20);
      setLeadSplit3(settingsData.leadSplit3 ?? 60);
      setAsst1Split3(settingsData.asst1Split3 ?? 20);
      setAsst2Split3(settingsData.asst2Split3 ?? 20);
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;

  return (
    <div className="space-y-6">
      {/* Receipt Branding Card */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Building2 className="h-6 w-6 text-primary" />
            Store Receipt Branding & Low Stock
          </CardTitle>
          <CardDescription>Configure receipt branding and stock alerts for {currentStore.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prefix" className="text-sm font-semibold">Receipt Number Prefix</Label>
              <Input 
                id="prefix" 
                value={receiptPrefix} 
                onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase())} 
                className="font-mono"
              />
              <p className="text-[10px] text-muted-foreground">E.g. RCP-2024-001</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lowStock" className="text-sm font-semibold">Low Stock Threshold</Label>
              <Input 
                id="lowStock" 
                type="number"
                value={lowStockThreshold} 
                onChange={(e) => setLowStockThreshold(parseInt(e.target.value))} 
              />
              <p className="text-[10px] text-muted-foreground">Alert when stock falls below this number</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="thank-you" className="text-sm font-semibold">Receipt Thank You Message</Label>
            <Textarea 
              id="thank-you" 
              placeholder="Thank you for your patronage!" 
              value={thankYouMessage}
              onChange={(e) => setThankYouMessage(e.target.value)}
              className="min-h-[100px]"
            />
            <p className="text-[10px] text-muted-foreground">This will appear at the bottom of all printed receipts</p>
          </div>
        </CardContent>
        <Separator />
        <CardContent className="pt-6 flex justify-end">
          <Button 
            onClick={() => updateSettingsMutation.mutate({ receiptPrefix, receiptThankYouMessage: thankYouMessage, lowStockThreshold })}
            disabled={updateSettingsMutation.isPending}
            className="gap-2"
          >
            {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Save Branding Settings
          </Button>
        </CardContent>
      </Card>

      {/* Payroll Configuration Defaults Card */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Coins className="h-6 w-6 text-primary" />
            Payroll Configuration & Compensation Defaults
          </CardTitle>
          <CardDescription>Configure store-wide default base salaries, commission formulas, transport rates, and multi-staff split settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ─── STEP 1: PAYMENT MODEL ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
              <h3 className="text-sm font-bold">Choose the Default Payment Model</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              This is the pay structure applied to newly created staff members. Each model determines which fields below are relevant.
            </p>
            <div className="ml-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                {
                  value: "fixed",
                  label: "Fixed Salary",
                  icon: "🏦",
                  desc: "A flat monthly amount regardless of services worked. Commission fields are ignored.",
                  color: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
                  active: "ring-2 ring-blue-500",
                },
                {
                  value: "commission",
                  label: "Commission Only",
                  icon: "💰",
                  desc: "Earnings come purely from service commission splits. No fixed base salary.",
                  color: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
                  active: "ring-2 ring-amber-500",
                },
                {
                  value: "hybrid",
                  label: "Hybrid",
                  icon: "⚡",
                  desc: "Fixed base salary + daily transport/attendance pay + commission on services.",
                  color: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
                  active: "ring-2 ring-emerald-500",
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultPaymentMethod(opt.value)}
                  className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${opt.color} ${defaultPaymentMethod === opt.value ? opt.active : "opacity-70 hover:opacity-100"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{opt.icon}</span>
                    <span className="text-sm font-bold">{opt.label}</span>
                    {defaultPaymentMethod === opt.value && (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary">Selected</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* ─── STEP 2: BASE SALARY ─── */}
          <div className={`space-y-3 transition-opacity duration-300 ${defaultPaymentMethod === "commission" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
              <h3 className="text-sm font-bold">Default Base Salary</h3>
              {defaultPaymentMethod === "commission" && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not used for Commission Only</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              The guaranteed monthly base paid to staff <strong>before</strong> attendance transport or commission is added.
            </p>
            <div className="ml-8 flex items-center gap-3 max-w-xs">
              <span className="text-lg font-bold text-muted-foreground">₦</span>
              <Input
                id="fixedBaseAmount"
                type="number"
                value={fixedBaseAmount}
                onChange={(e) => setFixedBaseAmount(parseFloat(e.target.value) || 0)}
                className="font-mono text-lg h-12"
                placeholder="e.g. 40000"
              />
            </div>
          </div>

          <Separator />

          {/* ─── STEP 3: COMMISSION SETUP ─── */}
          <div className={`space-y-4 transition-opacity duration-300 ${defaultPaymentMethod === "fixed" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
              <h3 className="text-sm font-bold">Commission Setup</h3>
              {defaultPaymentMethod === "fixed" && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not used for Fixed Salary</span>
              )}
            </div>
            <div className="ml-8 grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl">
              {[
                { value: "percentage", label: "Percentage of Service Value", icon: "%", desc: "Staff earns a % of the service sale price." },
                { value: "fixed_per_service", label: "Flat Amount per Service", icon: "₦", desc: "Staff earns a fixed naira amount for each service worked — regardless of price." },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCommissionType(opt.value)}
                  className={`rounded-lg border-2 p-3 text-left transition-all duration-200 ${commissionType === opt.value ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{opt.icon}</span>
                    <span className="text-xs font-bold">{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
            <div className="ml-8 max-w-2xl">
              {commissionType === "percentage" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="commissionRate" className="text-xs font-semibold">Default Commission Rate</Label>
                  <div className="flex items-center gap-2">
                    <Input id="commissionRate" type="number" min={0} max={100} value={commissionRate} onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)} className="font-mono h-10 max-w-[100px]" />
                    <span className="text-sm font-bold text-muted-foreground">% of service value</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">e.g. enter 30 for 30% commission on each service.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="commissionFixedAmount" className="text-xs font-semibold">Flat Amount Per Service (₦)</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-muted-foreground">₦</span>
                    <Input id="commissionFixedAmount" type="number" value={commissionFixedAmount} onChange={(e) => setCommissionFixedAmount(parseFloat(e.target.value) || 0)} className="font-mono h-10 max-w-[150px]" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Staff earns this fixed amount for each completed service.</p>
                </div>
              )}
            </div>
            {commissionType === "percentage" && (
              <div className="ml-8 space-y-3 max-w-2xl">
                <div>
                  <Label className="text-xs font-semibold">Commission Formula</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Determines how attendance transport costs interact with the commissionable service revenue pool before your commission rate is applied.</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { value: "formula_d", label: "Formula D — Pure Commission", badge: "Simplest", eq: "Commission = Rate% × Total Service Revenue", desc: "No transport costs are deducted. Staff earns their full percentage of every service they worked on.", badgeColor: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300" },
                    { value: "formula_b", label: "Formula B — Active & Passive Deduction", badge: "Recommended", eq: "Commission = Rate% × (Revenue − Active Transport − Passive Transport)", desc: "Active and passive day transport pay is subtracted from the pool before commission is calculated. Most balanced for salons.", badgeColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
                    { value: "formula_a", label: "Formula A — Total Attendance Deduction", badge: "Most conservative", eq: "Commission = Rate% × (Revenue − All Attendance Pay incl. Leaves & Holidays)", desc: "All attendance entitlements (including paid leaves and holidays) are deducted from the revenue pool before commission.", badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
                    { value: "formula_c", label: "Formula C — Active Days Only Deduction", badge: "Focused", eq: "Commission = Rate% × (Revenue − Active Transport Only)", desc: "Only active day transport is deducted. Passive, leave, and holiday days are not deducted.", badgeColor: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
                  ].map((formula) => (
                    <button key={formula.value} type="button" onClick={() => setCommissionFormula(formula.value)}
                      className={`rounded-lg border-2 p-3 text-left transition-all duration-200 ${commissionFormula === formula.value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/30"}`}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-bold">{formula.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${formula.badgeColor}`}>{formula.badge}</span>
                        {commissionFormula === formula.value && <span className="ml-auto text-[10px] font-bold text-primary uppercase">Active</span>}
                      </div>
                      <code className="block text-[10px] font-mono bg-muted/50 rounded px-2 py-1 mb-1.5 text-muted-foreground">{formula.eq}</code>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{formula.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* ─── STEP 4: ATTENDANCE TRANSPORT RATES ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">4</span>
              <h3 className="text-sm font-bold">Daily Attendance Transport Rates</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Transport is paid every day a staff member shows up — regardless of commission. An <strong>Active day</strong> means they worked at least one service. A <strong>Passive day</strong> means they were present but no services were assigned to them.
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <Label htmlFor="activeDayTransport" className="text-xs font-bold">Active Day Rate (₦)</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Paid when staff works at least 1 service</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground font-mono">₦</span>
                  <Input id="activeDayTransport" type="number" value={activeDayTransport} onChange={(e) => setActiveDayTransport(parseFloat(e.target.value) || 0)} className="font-mono h-10" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ day</span>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <Label htmlFor="passiveDayTransport" className="text-xs font-bold">Passive Day Rate (₦)</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Paid when present but no service assigned</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground font-mono">₦</span>
                  <Input id="passiveDayTransport" type="number" value={passiveDayTransport} onChange={(e) => setPassiveDayTransport(parseFloat(e.target.value) || 0)} className="font-mono h-10" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ day</span>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* ─── STEP 5: LEAVES & SPECIAL DAYS ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">5</span>
              <h3 className="text-sm font-bold">Leaves & Special Day Pay Policy</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Toggle whether these day categories earn pay. When enabled, set the daily rate. When disabled, staff receive ₦0 for those days.
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payLeaveDays ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">📋 Approved Leaves</p><p className="text-[10px] text-muted-foreground">Sick, annual leave</p></div>
                  <Switch id="payLeaveDays" checked={payLeaveDays} onCheckedChange={setPayLeaveDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payLeaveDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="leaveDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="leaveDayRate" type="number" disabled={!payLeaveDays} value={leaveDayRate} onChange={(e) => setLeaveDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payLeaveDays && <p className="text-[10px] text-blue-600 dark:text-blue-400">✓ Paid at ₦{leaveDayRate.toLocaleString()}/day</p>}
                </div>
                {!payLeaveDays && <p className="text-[10px] text-muted-foreground">Leaves are currently <strong>unpaid</strong></p>}
              </div>
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payHolidayDays ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">🎉 Public Holidays</p><p className="text-[10px] text-muted-foreground">National & public holidays</p></div>
                  <Switch id="payHolidayDays" checked={payHolidayDays} onCheckedChange={setPayHolidayDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payHolidayDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="holidayDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="holidayDayRate" type="number" disabled={!payHolidayDays} value={holidayDayRate} onChange={(e) => setHolidayDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payHolidayDays && <p className="text-[10px] text-violet-600 dark:text-violet-400">✓ Paid at ₦{holidayDayRate.toLocaleString()}/day</p>}
                </div>
                {!payHolidayDays && <p className="text-[10px] text-muted-foreground">Holidays are currently <strong>unpaid</strong></p>}
              </div>
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payOffDays ? "border-rose-400 bg-rose-50/50 dark:bg-rose-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">🌙 Sundays / Off Days</p><p className="text-[10px] text-muted-foreground">Rest days & scheduled off</p></div>
                  <Switch id="payOffDays" checked={payOffDays} onCheckedChange={setPayOffDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payOffDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="offDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="offDayRate" type="number" disabled={!payOffDays} value={offDayRate} onChange={(e) => setOffDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payOffDays && <p className="text-[10px] text-rose-600 dark:text-rose-400">✓ Paid at ₦{offDayRate.toLocaleString()}/day</p>}
                </div>
                {!payOffDays && <p className="text-[10px] text-muted-foreground">Off days are currently <strong>unpaid</strong></p>}
              </div>
            </div>
          </div>

          <Separator />

          {/* ─── STEP 6: MULTI-STAFF SPLITS ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">6</span>
              <h3 className="text-sm font-bold">Multi-Staff Service Revenue Splits</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              When two or three staff members collaborate on a single service, the service revenue pool is split between them before commission rates are applied. <strong>Splits must add up to exactly 100%.</strong>
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div className="rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">👥 2-Staff Session</p><p className="text-[10px] text-muted-foreground">Lead + 1 assistant</p></div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${leadSplit2 + asstSplit2 === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"}`}>{leadSplit2 + asstSplit2}% total</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="leadSplit2" className="text-[10px] font-semibold">Lead Staff %</Label>
                    <Input id="leadSplit2" type="number" min={0} max={100} value={leadSplit2} onChange={(e) => { const v = parseInt(e.target.value) || 0; setLeadSplit2(v); setAsstSplit2(Math.max(0, 100 - v)); }} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asstSplit2" className="text-[10px] font-semibold">Assistant %</Label>
                    <Input id="asstSplit2" type="number" min={0} max={100} value={asstSplit2} onChange={(e) => { const v = parseInt(e.target.value) || 0; setAsstSplit2(v); setLeadSplit2(Math.max(0, 100 - v)); }} className="h-8 text-sm font-mono" />
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${leadSplit2}%` }} />
                  <div className="bg-indigo-200 dark:bg-indigo-700 h-full transition-all duration-300" style={{ width: `${asstSplit2}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>Lead: {leadSplit2}%</span><span>Asst: {asstSplit2}%</span></div>
              </div>
              <div className="rounded-xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold text-purple-700 dark:text-purple-300">👥👥 3-Staff Session</p><p className="text-[10px] text-muted-foreground">Lead + 2 assistants</p></div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${leadSplit3 + asst1Split3 + asst2Split3 === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"}`}>{leadSplit3 + asst1Split3 + asst2Split3}% total</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="leadSplit3" className="text-[10px] font-semibold">Lead %</Label>
                    <Input id="leadSplit3" type="number" min={0} max={100} value={leadSplit3} onChange={(e) => setLeadSplit3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asst1Split3" className="text-[10px] font-semibold">Asst #1 %</Label>
                    <Input id="asst1Split3" type="number" min={0} max={100} value={asst1Split3} onChange={(e) => setAsst1Split3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asst2Split3" className="text-[10px] font-semibold">Asst #2 %</Label>
                    <Input id="asst2Split3" type="number" min={0} max={100} value={asst2Split3} onChange={(e) => setAsst2Split3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                </div>
                {/* Visual split bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${leadSplit3}%` }} />
                  <div className="bg-purple-300 dark:bg-purple-600 h-full transition-all duration-300" style={{ width: `${asst1Split3}%` }} />
                  <div className="bg-purple-200 dark:bg-purple-800 h-full transition-all duration-300" style={{ width: `${asst2Split3}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Lead: {leadSplit3}%</span>
                  <span>A1: {asst1Split3}%</span>
                  <span>A2: {asst2Split3}%</span>
                </div>
                {leadSplit3 + asst1Split3 + asst2Split3 !== 100 && (
                  <p className="text-[10px] text-red-500 font-medium">
                    ⚠ Total is {leadSplit3 + asst1Split3 + asst2Split3}% — must be exactly 100%
                  </p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* ─────────────────────────────────────────────────────────
              LIVE PAY PREVIEW
          ───────────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">✓</span>
              <h3 className="text-sm font-bold">Live Pay Preview</h3>
              <span className="text-[10px] text-muted-foreground">(sample: 1 active day + 1 passive day + ₦50,000 service revenue)</span>
            </div>
            <div className="ml-8 max-w-2xl">
              {(() => {
                const sampleRevenue = 50000;
                const sampleActiveDays = 1;
                const samplePassiveDays = 1;
                const activeTransportPay = sampleActiveDays * activeDayTransport;
                const passiveTransportPay = samplePassiveDays * passiveDayTransport;
                const totalAttendance = activeTransportPay + passiveTransportPay;

                let commissionable = sampleRevenue;
                if (commissionFormula === "formula_b") commissionable = Math.max(0, sampleRevenue - activeTransportPay - passiveTransportPay);
                else if (commissionFormula === "formula_a") commissionable = Math.max(0, sampleRevenue - totalAttendance);
                else if (commissionFormula === "formula_c") commissionable = Math.max(0, sampleRevenue - activeTransportPay);

                const commissionEarned = commissionType === "percentage"
                  ? (commissionRate / 100) * commissionable
                  : commissionFixedAmount;

                let netPay = 0;
                if (defaultPaymentMethod === "fixed") {
                  netPay = fixedBaseAmount;
                } else if (defaultPaymentMethod === "commission") {
                  netPay = totalAttendance + commissionEarned;
                } else {
                  netPay = fixedBaseAmount + totalAttendance + commissionEarned;
                }

                const fmt = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

                return (
                  <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
                    <div className="space-y-1.5 text-xs">
                      {defaultPaymentMethod !== "commission" && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Base Salary</span>
                          <span className="font-mono font-semibold">{fmt(fixedBaseAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active Day Transport ({sampleActiveDays} day × {fmt(activeDayTransport)})</span>
                        <span className="font-mono font-semibold">{fmt(activeTransportPay)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Passive Day Transport ({samplePassiveDays} day × {fmt(passiveDayTransport)})</span>
                        <span className="font-mono font-semibold">{fmt(passiveTransportPay)}</span>
                      </div>
                      {defaultPaymentMethod !== "fixed" && (
                        <>
                          <div className="flex justify-between text-muted-foreground/70 text-[10px]">
                            <span>Service Revenue Pool</span>
                            <span className="font-mono">{fmt(sampleRevenue)}</span>
                          </div>
                          {commissionable < sampleRevenue && (
                            <div className="flex justify-between text-muted-foreground/70 text-[10px]">
                              <span>After Formula Deductions</span>
                              <span className="font-mono">{fmt(commissionable)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Commission{commissionType === "percentage" ? ` (${commissionRate}%)` : " (flat)"}
                            </span>
                            <span className="font-mono font-semibold">{fmt(commissionEarned)}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold">Estimated Net Pay</span>
                      <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">{fmt(netPay)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">This is a sample calculation based on your current settings. Actual payroll reflects real attendance logs and service transactions.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </CardContent>
        <Separator />
        <CardContent className="pt-6 flex justify-end">
          <Button 
            onClick={() => updateSettingsMutation.mutate({
              defaultPaymentMethod,
              commissionType,
              commissionFixedAmount,
              commissionFormula,
              activeDayTransport,
              passiveDayTransport,
              commissionRate: commissionRate / 100,
              fixedBaseAmount,
              leaveDayRate,
              payLeaveDays,
              holidayDayRate,
              payHolidayDays,
              offDayRate,
              payOffDays,
              leadSplit2,
              asstSplit2,
              leadSplit3,
              asst1Split3,
              asst2Split3,
            })}
            disabled={updateSettingsMutation.isPending}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
          >
            {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Save Payroll Configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function BorrowBookSettingsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  
  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/settings", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", currentStore?.id] });
      toast({ title: "Borrow Book settings updated successfully" });
    },
  });

  const [daysBefore, setDaysBefore] = useState(2);
  const [onDueDate, setOnDueDate] = useState(true);
  const [daysAfter, setDaysAfter] = useState(3);
  const [repeatDays, setRepeatDays] = useState(7);
  const [stopDays, setStopDays] = useState(30);
  const [language, setLanguage] = useState("both");

  useEffect(() => {
    if (settingsData) {
      setDaysBefore(settingsData.borrowBookReminderDaysBefore ?? 2);
      setOnDueDate(settingsData.borrowBookReminderOnDueDate ?? true);
      setDaysAfter(settingsData.borrowBookReminderDaysAfter ?? 3);
      setRepeatDays(settingsData.borrowBookReminderRepeatDays ?? 7);
      setStopDays(settingsData.borrowBookReminderStopDays ?? 30);
      setLanguage(settingsData.borrowBookReminderLanguage ?? "both");
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <BookOpen className="h-6 w-6 text-amber-500" />
          Borrow Book Reminder Settings
        </CardTitle>
        <CardDescription>Configure automated WhatsApp & SMS notifications to gently remind customers of their outstanding balance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="days-before" className="text-sm font-semibold">Days Before Due Date</Label>
            <Input 
              id="days-before" 
              type="number"
              value={daysBefore} 
              onChange={(e) => setDaysBefore(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Send first gentle warning reminder N days before due date</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language" className="text-sm font-semibold">Reminder Language Dialect</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="english">Standard English Dialect</SelectItem>
                <SelectItem value="pidgin">Nigerian Pidgin Dialect</SelectItem>
                <SelectItem value="both">Bilingual (English + Pidgin)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Select dialect style for messaging templates</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/40 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="on-due-date" className="text-sm font-semibold">Reminder On Due Date</Label>
            <p className="text-[10px] text-muted-foreground">Send an urgent collection notification exactly on the expected due date</p>
          </div>
          <Switch 
            id="on-due-date" 
            checked={onDueDate} 
            onCheckedChange={setOnDueDate} 
          />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="days-after" className="text-sm font-semibold">First Overdue Delay (Days)</Label>
            <Input 
              id="days-after" 
              type="number"
              value={daysAfter} 
              onChange={(e) => setDaysAfter(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Days after due date before sending first overdue reminder</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repeat-days" className="text-sm font-semibold">Follow-Up Frequency (Days)</Label>
            <Input 
              id="repeat-days" 
              type="number"
              value={repeatDays} 
              onChange={(e) => setRepeatDays(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Interval in days between repeat overdue notifications</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stop-days" className="text-sm font-semibold">Auto-Silence Threshold (Days)</Label>
            <Input 
              id="stop-days" 
              type="number"
              value={stopDays} 
              onChange={(e) => setStopDays(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Stop sending automated reminders after N days from due date</p>
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardContent className="pt-6 flex justify-end">
        <Button 
          onClick={() => updateSettingsMutation.mutate({ 
            borrowBookReminderDaysBefore: daysBefore, 
            borrowBookReminderOnDueDate: onDueDate, 
            borrowBookReminderDaysAfter: daysAfter, 
            borrowBookReminderRepeatDays: repeatDays, 
            borrowBookReminderStopDays: stopDays, 
            borrowBookReminderLanguage: language 
          })}
          disabled={updateSettingsMutation.isPending}
          className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
        >
          {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
          Save Ledger Settings
        </Button>
      </CardContent>
    </Card>
  );
}

function StoreIntegrationsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();

  const { data: integrations = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/stores", currentStore?.id, "integrations"],
    enabled: !!currentStore?.id,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", `/api/stores/${currentStore?.id}/integrations`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Integration settings updated successfully" });
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save integration",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const [activeTab, setActiveTab] = useState<"flutterwave" | "stripe" | "paystack" | "twilio" | "quickbooks">("flutterwave");
  
  // Custom states for key configurations
  const [isActive, setIsActive] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [currency, setCurrency] = useState("NGN");

  const activeConfig = integrations.find((int) => int.provider === activeTab);

  useEffect(() => {
    if (activeConfig) {
      setIsActive(activeConfig.isActive ?? false);
      setPublicKey(activeConfig.publicKey || "");
      setSecretKey(activeConfig.secretKey || "••••••••••••••••");
      setWebhookSecret(activeConfig.webhookSecret || "••••••••••••••••");
      setCurrency(activeConfig.currency || "NGN");
    } else {
      setIsActive(false);
      setPublicKey("");
      setSecretKey("");
      setWebhookSecret("");
      setCurrency(activeTab === "stripe" ? "USD" : "NGN");
    }
  }, [activeConfig, activeTab]);

  if (!currentStore) return null;
  if (isLoading) {
    return (
      <Card className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </Card>
    );
  }

  const handleSave = () => {
    saveMutation.mutate({
      provider: activeTab,
      isActive,
      publicKey,
      secretKey,
      webhookSecret,
      currency,
    });
  };

  const providers = [
    { id: "flutterwave", name: "Flutterwave", desc: "Perfect for local and international cards and bank transfers across Africa." },
    { id: "stripe", name: "Stripe", desc: "Premium global processor accepting cards, Apple Pay, Google Pay, and localized bank rails." },
    { id: "paystack", name: "Paystack", desc: "Fast, reliable payments via cards, USSD, and bank transfers, tailored for Africa." },
    { id: "twilio", name: "Twilio SMS", desc: "Send automated SMS notifications to staff and customers for checkouts and bookings." },
    { id: "quickbooks", name: "QuickBooks", desc: "Synchronize transaction records, product list, and payroll reports with your QuickBooks ledger." },
  ];

  return (
    <Card className="border-primary/20 shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <CreditCard className="h-6 w-6 text-primary" />
              Dynamic Payment Integrations
            </CardTitle>
            <CardDescription>
              Link your store to your personal payment gateways. Customers will pay directly into your account.
            </CardDescription>
          </div>
          <div className="flex bg-muted p-1 rounded-lg self-start md:self-auto">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveTab(p.id as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === p.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        <div className="flex items-start justify-between gap-4 p-4 bg-primary/5 rounded-lg border border-primary/10">
          <div className="space-y-1">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              {providers.find(p => p.id === activeTab)?.name} Integration
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
              }`}>
                {isActive ? "Active" : "Inactive"}
              </span>
            </h4>
            <p className="text-xs text-muted-foreground max-w-xl">
              {providers.find(p => p.id === activeTab)?.desc}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="active-toggle" className="text-xs font-semibold">Enable</Label>
            <Switch
              id="active-toggle"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Account SID" : activeTab === "quickbooks" ? "Client ID" : "Public Key"}
            </Label>
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder={activeTab === "twilio" ? "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" : activeTab === "quickbooks" ? "Enter QuickBooks Client ID" : "Enter public key"}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Auth Token" : activeTab === "quickbooks" ? "Client Secret" : "Secret Key"}
            </Label>
            <Input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={activeTab === "twilio" ? "Enter Twilio Auth Token" : activeTab === "quickbooks" ? "Enter QuickBooks Client Secret" : "Enter secret key"}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Twilio Phone Number" : activeTab === "quickbooks" ? "Company ID (Realm ID)" : "Webhook Secret / Hash"}
            </Label>
            <Input
              type="text"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={activeTab === "twilio" ? "e.g. +1234567890" : activeTab === "quickbooks" ? "Enter Realm ID" : "Enter webhook secret"}
              className="font-mono text-sm"
            />
          </div>

          {activeTab !== "twilio" && activeTab !== "quickbooks" && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Settlement Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Settlement Currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">₦ NGN (Nigerian Naira)</SelectItem>
                  <SelectItem value="USD">$ USD (US Dollar)</SelectItem>
                  <SelectItem value="GHS">₵ GHS (Ghanaian Cedi)</SelectItem>
                  <SelectItem value="KES">KSh KES (Kenyan Shilling)</SelectItem>
                  <SelectItem value="GBP">£ GBP (British Pound)</SelectItem>
                  <SelectItem value="EUR">€ EUR (Euro)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="p-4 bg-muted/30 rounded-lg border text-xs space-y-2">
          <h5 className="font-semibold flex items-center gap-1 text-muted-foreground uppercase tracking-wider text-[10px]">
            <Lock className="h-3 w-3" /> Webhook Endpoint Url Configuration
          </h5>
          <p className="text-muted-foreground leading-relaxed">
            Copy the endpoint URL below and configure it in your {providers.find(p => p.id === activeTab)?.name} developer settings dashboard to enable automatic checkout payment status updates:
          </p>
          <div className="flex items-center justify-between gap-4 p-2 bg-background border rounded font-mono text-[11px] overflow-x-auto select-all">
            {window.location.origin}/api/payments/webhook/{activeTab}
          </div>
        </div>
      </CardContent>

      <Separator />

      <CardContent className="pt-6 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          )}
          Save Integration Settings
        </Button>
      </CardContent>
    </Card>
  );
}

