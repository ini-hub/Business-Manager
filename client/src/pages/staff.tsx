import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Phone, Hash, FileCheck, FileX, AlertCircle, RotateCcw, Archive, ArrowRightLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkOperations } from "@/components/bulk-operations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { insertStaffSchema, type Staff, type InsertStaff } from "@shared/schema";
import { Mail, Shield } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { Link } from "wouter";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";

export default function StaffPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const userRole = user?.role || "staff";
  const isOwner = userRole === "owner";
  
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPermanentDeleteOpen, setIsPermanentDeleteOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [transferTargetStoreId, setTransferTargetStoreId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("active");

  const { data: staffList = [], isLoading } = useQuery<Staff[]>({
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
        const mergedMap = new Map<string, Staff & { storeName?: string }>();
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
      const res = await fetch(`/api/staff?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch staff");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const activeStaff = staffList.filter(s => !s.isArchived);
  const archivedStaff = staffList.filter(s => s.isArchived);

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/staff/${selectedStaff?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member archived successfully" });
      setIsDeleteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Archive Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/staff/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member restored successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Restore Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/staff/${id}/permanent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member permanently deleted" });
      setIsPermanentDeleteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Delete Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: ({ staffId, targetStoreId }: { staffId: string; targetStoreId: string }) => 
      apiRequest("POST", `/api/staff/${staffId}/transfer`, { targetStoreId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member transferred successfully" });
      setIsTransferOpen(false);
      setSelectedStaff(null);
      setTransferTargetStoreId("");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Transfer Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const otherStores = stores.filter(s => s.id !== currentStore?.id);
  const storeCurrency = currentStore?.currency || "NGN";
  const currencyInfo = getCurrencyByCode(storeCurrency);
  
  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const activeColumns = useMemo(() => {
    const storeColumn = currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (staff: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {staff.storeName || "Global"}
        </Badge>
      ),
    }] : [];

    const baseColumns = [
      ...storeColumn,
      {
        key: "name",
        header: "Staff Member",
        render: (staff: Staff) => {
          const presenter = new StaffPresenter(staff);
          return <EntityDisplay presenter={presenter} />;
        },
      },
      {
        key: "email",
        header: "Email",
        render: (staff: Staff) => (
          <div className="flex items-center gap-2">
            <Mail className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{staff.email || "-"}</span>
          </div>
        ),
      },
      {
        key: "mobileNumber",
        header: "Mobile",
        render: (staff: Staff) => (
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 text-muted-foreground" />
            <span>{formatPhoneDisplay(staff.mobileNumber, staff.countryCode || "+234")}</span>
          </div>
        ),
      },
    ];

    if (isOwner) {
      const mobileCol = baseColumns.find(c => c.key === "mobileNumber")!;
      const nonMobileBaseCols = baseColumns.filter(c => c.key !== "mobileNumber");

      return [
        ...nonMobileBaseCols,
        {
          key: "role",
          header: "Role",
          render: (staff: Staff) => (
            <Badge variant={staff.role === "manager" ? "default" : "secondary"} className="gap-1 capitalize">
              <Shield className="h-3 w-3" />
              {staff.role || "Staff"}
            </Badge>
          ),
        },
        {
          key: "paymentMethod",
          header: "Model",
          render: (staff: Staff) => (
            <Badge variant="outline" className="capitalize">
              {staff.paymentMethod}
            </Badge>
          ),
        },
        mobileCol,
        {
          key: "payPerMonth",
          header: "Monthly Pay",
          render: (staff: Staff) => (
            <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
          ),
        },
        {
          key: "signedContract",
          header: "Contract",
          render: (staff: Staff) => (
            <Badge variant={staff.signedContract ? "default" : "secondary"} className="gap-1">
              {staff.signedContract ? (
                <>
                  <FileCheck className="h-3 w-3" />
                  Signed
                </>
              ) : (
                <>
                  <FileX className="h-3 w-3" />
                  Pending
                </>
              )}
            </Badge>
          ),
        },
        {
          key: "actions",
          header: "",
          className: "w-32",
          render: (staff: Staff) => (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setLocation(`/staff/${staff.id}/edit`);
                }}
                title="Edit staff member"
              >
                <Edit className="h-4 w-4" />
              </Button>
              {otherStores.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStaff(staff);
                    setTransferTargetStoreId("");
                    setIsTransferOpen(true);
                  }}
                  title="Transfer to another store"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedStaff(staff);
                  setIsDeleteOpen(true);
                }}
                title="Archive staff member"
              >
                <Archive className="h-4 w-4" />
              </Button>
            </div>
          ),
        },
      ];
    }

    return [
      ...baseColumns,
      {
        key: "actions",
        header: "",
        className: "w-12",
        render: (staff: Staff) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setLocation(`/staff/${staff.id}/edit`);
              }}
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ];
  }, [isOwner, formatCurrency, setLocation, otherStores.length]);

  const archivedColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (staff: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {staff.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "name",
      header: "Staff Member",
      render: (staff: Staff) => {
        const presenter = new StaffPresenter(staff);
        return (
          <div className="flex items-center gap-2">
            <EntityDisplay presenter={presenter} />
            <Badge variant="secondary">Archived</Badge>
          </div>
        );
      },
    },
    {
      key: "mobileNumber",
      header: "Mobile",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <Phone className="h-3 w-3 text-muted-foreground" />
          <span>{formatPhoneDisplay(staff.mobileNumber, staff.countryCode || "+234")}</span>
        </div>
      ),
    },
    {
      key: "payPerMonth",
      header: "Monthly Pay",
      render: (staff: Staff) => (
        <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (staff: Staff) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              restoreMutation.mutate(staff.id);
            }}
            title="Restore staff member"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedStaff(staff);
              setIsPermanentDeleteOpen(true);
            }}
            title="Permanently delete staff member"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const exportColumns = isOwner 
    ? [
        { key: "name", header: "Name" },
        { key: "email", header: "Email" },
        { key: "role", header: "Role" },
        { key: "staffNumber", header: "Staff Number" },
        { key: "mobileNumber", header: "Mobile Number" },
        { key: "payPerMonth", header: "Pay Per Month" },
        { key: "paymentMethod", header: "Payment Method" },
        { key: "signedContract", header: "Signed Contract" },
      ]
    : [
        { key: "name", header: "Name" },
        { key: "email", header: "Email" },
        { key: "staffNumber", header: "Staff Number" },
        { key: "mobileNumber", header: "Mobile Number" },
      ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff" description="Manage your staff members and their contracts" />
        <StoreRequiredAlert title="Store Required for Staff" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description={`Managing staff for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            <BulkOperations
              entityType="staff"
              data={(activeTab === "active" ? activeStaff : archivedStaff) as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              isLoading={isLoading}
              storeId={currentStore.id}
              pdfTitle={`Staff Report (${activeTab})`}
              showImportOption={isOwner}
            />
            {isOwner && (
              <Link href="/staff/new">
                <Button data-testid="button-add-staff">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Staff
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active">Active ({activeStaff.length})</TabsTrigger>
          {isOwner && <TabsTrigger value="archived">Archived ({archivedStaff.length})</TabsTrigger>}
        </TabsList>
        {(() => {
          const filterConfigs = [
            { 
              key: "role", 
              label: "Role", 
              type: "select" as const,
              valueMapper: (val: any) => String(val).charAt(0).toUpperCase() + String(val).slice(1)
            },
            { key: "status", label: "Status", type: "select" as const }
          ];

          const activeTableData = activeStaff.map((s) => ({
            ...s,
            status: s.signedContract ? "Active" : "Pending"
          }));

          const archivedTableData = archivedStaff.map((s) => ({
            ...s,
            status: "Deactivated"
          }));

          return (
            <>
              <TabsContent value="active" className="mt-4">
                <DataTable
                  data={activeTableData}
                  columns={activeColumns}
                  searchable
                  searchPlaceholder="Search active staff..."
                  searchKeys={["name", "email", "staffNumber", "mobileNumber"]}
                  isLoading={isLoading}
                  emptyMessage="No active staff members found. Add your first staff member to get started."
                  filterConfigs={filterConfigs}
                />
              </TabsContent>
              <TabsContent value="archived" className="mt-4">
                <DataTable
                  data={archivedTableData}
                  columns={archivedColumns}
                  searchable
                  searchPlaceholder="Search archived staff..."
                  searchKeys={["name", "email", "staffNumber", "mobileNumber"]}
                  isLoading={isLoading}
                  emptyMessage="No archived staff members. Deleted staff will appear here."
                  filterConfigs={filterConfigs}
                />
              </TabsContent>
            </>
          );
        })()}
      </Tabs>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Archive Staff Member"
        description={`Are you sure you want to archive "${selectedStaff?.name}"? You can restore them later from the Archived tab.`}
        confirmText="Archive"
        isDestructive
        onConfirm={() => archiveMutation.mutate()}
        isLoading={archiveMutation.isPending}
      />

      <ConfirmDialog
        open={isPermanentDeleteOpen}
        onOpenChange={setIsPermanentDeleteOpen}
        title="Permanently delete this staff member?"
        description="This cannot be undone."
        confirmText="Delete"
        isDestructive
        onConfirm={() => permanentDeleteMutation.mutate(selectedStaff!.id)}
        isLoading={permanentDeleteMutation.isPending}
      />

      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Staff Member</DialogTitle>
            <DialogDescription>
              Move "{selectedStaff?.name}" to another store you own.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Target Store</label>
              <Select onValueChange={setTransferTargetStoreId} value={transferTargetStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a store" />
                </SelectTrigger>
                <SelectContent>
                  {otherStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransferOpen(false)}>Cancel</Button>
            <Button 
              disabled={!transferTargetStoreId || transferMutation.isPending}
              onClick={() => transferMutation.mutate({ staffId: selectedStaff!.id, targetStoreId: transferTargetStoreId })}
            >
              {transferMutation.isPending ? "Transferring..." : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
