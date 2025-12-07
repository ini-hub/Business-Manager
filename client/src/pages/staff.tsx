import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Phone, Hash, DollarSign, FileCheck, FileX, AlertCircle, RotateCcw, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema, type Staff, type InsertStaff } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { Link } from "wouter";
import { countryCodes, validatePhoneNumber, formatPhoneDisplay } from "@/lib/phone-utils";
import { z } from "zod";

const staffFormSchema = insertStaffSchema.extend({
  mobileNumber: z.string().min(1, "Mobile number is required"),
});

export default function StaffPage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [activeTab, setActiveTab] = useState("active");

  const { data: staffList = [], isLoading } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const activeStaff = staffList.filter(s => !s.isArchived);
  const archivedStaff = staffList.filter(s => s.isArchived);

  const form = useForm<InsertStaff>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertStaff) => apiRequest("POST", "/api/staff", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member created successfully" });
      closeForm();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Add Staff Member", 
        description: getUserFriendlyError(error, "staff"), 
        variant: "destructive" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertStaff) =>
      apiRequest("PATCH", `/api/staff/${selectedStaff?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      toast({ title: "Staff member updated successfully" });
      closeForm();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Update Staff Member", 
        description: getUserFriendlyError(error, "staff"), 
        variant: "destructive" 
      });
    },
  });

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
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Delete Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const openCreateForm = () => {
    form.reset({
      storeId: currentStore?.id || "",
      name: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    });
    setSelectedStaff(null);
    setIsFormOpen(true);
  };

  const openEditForm = (staff: Staff) => {
    let countryCode = staff.countryCode || "NG";
    if (countryCode.startsWith("+")) {
      const country = countryCodes.find(c => c.dialCode === countryCode);
      countryCode = country?.code || "NG";
    }
    form.reset({
      storeId: staff.storeId,
      name: staff.name,
      staffNumber: staff.staffNumber,
      countryCode,
      mobileNumber: staff.mobileNumber,
      payPerMonth: staff.payPerMonth,
      signedContract: staff.signedContract,
    });
    setSelectedStaff(staff);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedStaff(null);
    form.reset();
  };

  const onSubmit = (data: InsertStaff) => {
    const countryCode = data.countryCode || "NG";
    const validation = validatePhoneNumber(data.mobileNumber, countryCode);
    if (!validation.valid) {
      form.setError("mobileNumber", { message: validation.error });
      return;
    }
    
    if (selectedStaff) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const activeColumns = [
    {
      key: "staffNumber",
      header: "Staff ID",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-sm">{staff.staffNumber}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (staff: Staff) => (
        <span className="font-medium">{staff.name}</span>
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
    {
      key: "payPerMonth",
      header: "Monthly Pay",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
        </div>
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
      className: "w-24",
      render: (staff: Staff) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(staff);
            }}
            data-testid={`button-edit-${staff.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedStaff(staff);
              setIsDeleteOpen(true);
            }}
            data-testid={`button-archive-${staff.id}`}
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const archivedColumns = [
    {
      key: "staffNumber",
      header: "Staff ID",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-sm">{staff.staffNumber}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{staff.name}</span>
          <Badge variant="secondary">Archived</Badge>
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
    {
      key: "payPerMonth",
      header: "Monthly Pay",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
        </div>
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
            data-testid={`button-restore-${staff.id}`}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Permanently delete this staff member? This cannot be undone.")) {
                permanentDeleteMutation.mutate(staff.id);
              }
            }}
            data-testid={`button-delete-permanent-${staff.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff" description="Manage your staff members and their contracts" />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to manage staff.
          </AlertDescription>
        </Alert>
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
              data={activeStaff as unknown as Record<string, unknown>[]}
              columns={[
                { key: "name", header: "Name" },
                { key: "staffNumber", header: "Staff Number" },
                { key: "mobileNumber", header: "Mobile Number" },
                { key: "payPerMonth", header: "Pay Per Month" },
                { key: "signedContract", header: "Signed Contract" },
              ]}
              isLoading={isLoading}
              storeId={currentStore.id}
            />
            <Button onClick={openCreateForm} data-testid="button-add-staff">
              <Plus className="mr-2 h-4 w-4" />
              Add Staff
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-staff">
            Active ({activeStaff.length})
          </TabsTrigger>
          <TabsTrigger value="archived" data-testid="tab-archived-staff">
            Archived ({archivedStaff.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <DataTable
            data={activeStaff}
            columns={activeColumns}
            searchable
            searchPlaceholder="Search active staff..."
            searchKeys={["name", "staffNumber", "mobileNumber"]}
            isLoading={isLoading}
            emptyMessage="No active staff members found. Add your first staff member to get started."
          />
        </TabsContent>
        <TabsContent value="archived" className="mt-4">
          <DataTable
            data={archivedStaff}
            columns={archivedColumns}
            searchable
            searchPlaceholder="Search archived staff..."
            searchKeys={["name", "staffNumber", "mobileNumber"]}
            isLoading={isLoading}
            emptyMessage="No archived staff members. Deleted staff will appear here."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedStaff ? "Edit Staff Member" : "Add New Staff Member"}
            </DialogTitle>
            <DialogDescription>
              {selectedStaff
                ? "Update the staff member information below."
                : "Fill in the details to add a new staff member."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Smith" {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="staffNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Staff ID</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="EMP-001" 
                          {...field} 
                          disabled={!!selectedStaff}
                          className={selectedStaff ? "bg-muted cursor-not-allowed" : ""}
                          data-testid="input-staff-number" 
                        />
                      </FormControl>
                      <FormDescription>
                        {selectedStaff 
                          ? "Staff ID cannot be changed after creation."
                          : "Enter a unique staff identifier."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="countryCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "NG"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-country-code">
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px]">
                          {countryCodes.map((country) => (
                            <SelectItem key={country.code} value={country.code}>
                              {country.name} ({country.dialCode})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mobileNumber"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Mobile Number</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="8012345678" 
                          {...field} 
                          data-testid="input-mobile" 
                        />
                      </FormControl>
                      <FormDescription>
                        Enter number without country code
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="payPerMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Pay</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        data-testid="input-pay"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signedContract"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Contract Signed</FormLabel>
                      <FormDescription>
                        Has this staff member signed their employment contract?
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-contract"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : selectedStaff
                    ? "Update Staff"
                    : "Add Staff"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Archive Staff Member"
        description={`Are you sure you want to archive "${selectedStaff?.name}"? You can restore them later from the Archived tab.`}
        confirmText="Archive"
        onConfirm={() => archiveMutation.mutate()}
        isDestructive
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}
