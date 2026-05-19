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
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Building2, Store, Pencil, Trash2, MapPin, Phone, Globe, Coins, User, UserPlus, CreditCard, Lock, Check, ShieldCheck, Database, Upload, Download, FileText, Settings2, Trash } from "lucide-react";
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

  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const openAddRole = () => {
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPermissions([]);
    setIsRoleDialogOpen(true);
  };

  const openEditRole = (role: any) => {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDesc(role.description || "");
    setSelectedPermissions(role.permissions || []);
    setIsRoleDialogOpen(true);
  };

  const createCustomRoleMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/custom-roles", data);
      return res.json();
    },
    onSuccess: () => {
      refetchCustomRoles();
      toast({ title: "Custom role created successfully." });
      setIsRoleDialogOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

  const updateCustomRoleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/custom-roles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      refetchCustomRoles();
      toast({ title: "Custom role updated successfully." });
      setIsRoleDialogOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

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

  const handleRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName) return;

    const data = {
      name: roleName,
      description: roleDesc,
      permissions: selectedPermissions,
    };

    if (editingRole) {
      updateCustomRoleMutation.mutate({ id: editingRole.id, data });
    } else {
      createCustomRoleMutation.mutate(data);
    }
  };

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business & Stores"
        description="Manage your business information and store locations"
      />

      <Tabs defaultValue="stores" className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 bg-muted/50 p-1 rounded-xl gap-1">
          <TabsTrigger value="stores" className="flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-xs md:text-sm">
            <Store className="h-4 w-4" />
            Stores Management
          </TabsTrigger>
          <TabsTrigger value="business" className="flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-xs md:text-sm">
            <Building2 className="h-4 w-4" />
            Business Details
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-xs md:text-sm animate-fade-in" data-testid="tab-roles-permissions">
            <ShieldCheck className="h-4 w-4" />
            Roles & Permissions
          </TabsTrigger>
          <TabsTrigger value="bulk" className="flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-xs md:text-sm animate-fade-in" data-testid="tab-bulk-operations">
            <Database className="h-4 w-4" />
            Bulk Operations
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-xs md:text-sm">
            <CreditCard className="h-4 w-4" />
            Payment Gateways
          </TabsTrigger>
        </TabsList>

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
                  setIsBusinessDialogOpen(true);
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
              {!currentStore ? (
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
          {!currentStore ? (
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
      </Tabs>

      <Dialog open={isBusinessDialogOpen} onOpenChange={setIsBusinessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{business ? "Edit Business" : "Set Up Business"}</DialogTitle>
            <DialogDescription>
              Enter your business information. This will appear across all your stores.
            </DialogDescription>
          </DialogHeader>
          <Form {...businessForm}>
            <form onSubmit={businessForm.handleSubmit(handleBusinessSubmit)} className="space-y-4">
              <div className="flex flex-col items-center gap-4 mb-4">
                <Avatar className="h-20 w-20 border-2">
                  <AvatarImage src={businessForm.watch("logoUrl") || ""} />
                  <AvatarFallback className="bg-primary/10">
                    <Building2 className="h-10 w-10 text-primary/40" />
                  </AvatarFallback>
                </Avatar>
                <div className="w-full">
                  <Label className="text-xs mb-1 block text-center">Business Logo</Label>
                  <Input 
                    type="file" 
                    accept="image/*"
                    className="cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const maxSize = 2 * 1024 * 1024; // 2MB
                        if (file.size > maxSize) {
                          toast({
                            title: "File too large",
                            description: "Business logo must be smaller than 2MB.",
                            variant: "destructive"
                          });
                          e.target.value = ""; // clear input
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          businessForm.setValue("logoUrl", reader.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">
                    Upload logo (JPG, PNG). Max size 2MB (Strictly enforced).
                  </p>
                </div>
              </div>

              <FormField
                control={businessForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="My Business" data-testid="input-business-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={businessForm.control}
                name="businessUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Website (Optional)</FormLabel>
                    <FormControl>
                      <div className="flex">
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                          https://
                        </span>
                        <Input 
                          {...field} 
                          placeholder="example.com" 
                          className="rounded-l-none"
                          data-testid="input-business-url" 
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={businessForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="123 Main St, City" data-testid="input-business-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Phone (Optional)</FormLabel>
                <div className="flex gap-2">
                  <FormField
                    control={businessForm.control}
                    name="phoneCountryCode"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || "+234"}>
                        <SelectTrigger className="w-[120px]" data-testid="select-business-phone-country">
                          <SelectValue placeholder="+234" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {countryCodes.map((cc) => (
                            <SelectItem key={cc.dialCode} value={cc.dialCode}>
                              {cc.dialCode} ({cc.name})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormControl>
                        <Input {...field} placeholder="Phone number" className="flex-1" data-testid="input-business-phone" />
                      </FormControl>
                    )}
                  />
                </div>
              </FormItem>

              <div className="border border-muted/80 p-3 rounded-lg bg-muted/10 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Default Hybrid Commission Split</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={businessForm.control}
                    name="commissionSplitBusinessShare"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Business Share (%)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            placeholder="80"
                            data-testid="input-business-split-business"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="commissionSplitStaffShare"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Staff Share (%)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            placeholder="20"
                            data-testid="input-business-split-staff"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">Standard split applies to checkouts unless overriden at the store or service level. Must total 100%.</p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsBusinessDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-business">
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>



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

      {/* Custom Roles Dialog */}
      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Custom Role" : "Create Custom Role"}</DialogTitle>
            <DialogDescription>
              Define name, description, and assign modular permissions for staff roles.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRoleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Role Name</Label>
              <Input
                id="role-name"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Frontdesk"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea
                id="role-desc"
                value={roleDesc}
                onChange={(e) => setRoleDesc(e.target.value)}
                placeholder="e.g. Handles appointments and client registration"
              />
            </div>
            <div className="space-y-2.5">
              <Label>Modular Permissions</Label>
              <div className="grid grid-cols-2 gap-2 border p-3 rounded-lg bg-muted/10">
                {["Dashboard", "Sales & Checkout", "Customers", "Staff & Payroll", "Inventory & Catalog", "Expenses & Reports", "Settings"].map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-xs font-medium cursor-pointer p-1 hover:bg-muted/40 rounded transition-colors">
                    <input
                      type="checkbox"
                      className="rounded border-muted text-primary focus:ring-primary h-3.5 w-3.5"
                      checked={selectedPermissions.includes(perm)}
                      onChange={() => togglePermission(perm)}
                    />
                    {perm}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsRoleDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingRole ? "Save Changes" : "Create Role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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

  useEffect(() => {
    if (settingsData) {
      setReceiptPrefix(settingsData.receiptPrefix || "RCP");
      setThankYouMessage(settingsData.receiptThankYouMessage || "");
      setLowStockThreshold(settingsData.lowStockThreshold || 5);
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <Building2 className="h-6 w-6 text-primary" />
          Store Receipt Branding
        </CardTitle>
        <CardDescription>Configure how your store appears on receipts and invoices for {currentStore.name}</CardDescription>
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
          Save Business Settings
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

  const [activeTab, setActiveTab] = useState<"flutterwave" | "stripe" | "paystack">("flutterwave");
  
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
              Public Key
            </Label>
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder={`Enter your public key`}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              Secret Key
            </Label>
            <Input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Enter your secret key"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              Webhook Secret / Hash
            </Label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Enter your webhook secret hash"
              className="font-mono text-sm"
            />
          </div>

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

