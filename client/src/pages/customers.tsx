import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Edit, Trash2, Phone, MapPin, Hash, AlertCircle, RotateCcw, Archive, ChevronRight } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCustomerSchema, type Customer, type InsertCustomer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";
import { countryCodes, validatePhoneNumber, formatPhoneDisplay } from "@/lib/phone-utils";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";

const customerFormSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
  customerNumber: z.string().optional().default(""),
});

export default function Customers() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeTab, setActiveTab] = useState("active");

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const activeCustomers = customers.filter(c => !c.isArchived);
  const archivedCustomers = customers.filter(c => c.isArchived);

  const navigateToCustomerDetails = (customer: Customer) => {
    setLocation(`/customers/${customer.id}`);
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
    mutationFn: (data: InsertCustomer) => apiRequest("POST", "/api/customers", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Customer created successfully" });
      closeForm();
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
      closeForm();
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

  const openCreateForm = () => {
    form.reset({
      storeId: currentStore?.id || "",
      name: "",
      customerNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      address: "",
    });
    setSelectedCustomer(null);
    setIsFormOpen(true);
  };

  const openEditForm = (customer: Customer) => {
    let countryCode = customer.countryCode || "NG";
    if (countryCode.startsWith("+")) {
      const country = countryCodes.find(c => c.dialCode === countryCode);
      countryCode = country?.code || "NG";
    }
    form.reset({
      storeId: customer.storeId,
      name: customer.name,
      customerNumber: customer.customerNumber,
      countryCode,
      mobileNumber: customer.mobileNumber,
      address: customer.address,
    });
    setSelectedCustomer(customer);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedCustomer(null);
    form.reset();
  };

  const onSubmit = (data: InsertCustomer) => {
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
      createMutation.mutate(data);
    }
  };

  const activeColumns = [
    {
      key: "customerNumber",
      header: "ID",
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-sm">{customer.customerNumber}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (customer: Customer) => (
        <span className="font-medium">{customer.name}</span>
      ),
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
        <div className="flex items-center gap-2 max-w-xs">
          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="truncate">{customer.address || "-"}</span>
        </div>
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
  ];

  const archivedColumns = [
    {
      key: "customerNumber",
      header: "ID",
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-sm">{customer.customerNumber}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (customer: Customer) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{customer.name}</span>
          <Badge variant="secondary">Archived</Badge>
        </div>
      ),
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
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" description="Manage your customer records" />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to manage customers.
          </AlertDescription>
        </Alert>
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
              entityType="customers"
              data={activeCustomers as unknown as Record<string, unknown>[]}
              columns={[
                { key: "name", header: "Name" },
                { key: "customerNumber", header: "Customer Number" },
                { key: "mobileNumber", header: "Mobile Number" },
                { key: "address", header: "Address" },
              ]}
              isLoading={isLoading}
              storeId={currentStore.id}
            />
            <Button onClick={openCreateForm} data-testid="button-add-customer">
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
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
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <DataTable
            data={activeCustomers}
            columns={activeColumns}
            searchable
            searchPlaceholder="Search active customers..."
            searchKeys={["name", "customerNumber", "mobileNumber", "address"]}
            isLoading={isLoading}
            emptyMessage="No active customers found. Add your first customer to get started."
            onRowClick={navigateToCustomerDetails}
          />
        </TabsContent>
        <TabsContent value="archived" className="mt-4">
          <DataTable
            data={archivedCustomers}
            columns={archivedColumns}
            searchable
            searchPlaceholder="Search archived customers..."
            searchKeys={["name", "customerNumber", "mobileNumber"]}
            isLoading={isLoading}
            emptyMessage="No archived customers. Deleted customers will appear here."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedCustomer ? "Edit Customer" : "Add New Customer"}
            </DialogTitle>
            <DialogDescription>
              {selectedCustomer
                ? "Update the customer information below."
                : "Fill in the details to create a new customer record."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                      <FormLabel>Mobile Number (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="8012345678" 
                          {...field} 
                          data-testid="input-mobile" 
                        />
                      </FormControl>
                      <FormDescription>
                        Enter number without country code (e.g., 8012345678)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="123 Main St, City, State, ZIP"
                        {...field}
                        data-testid="input-address"
                      />
                    </FormControl>
                    <FormMessage />
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
                    : selectedCustomer
                    ? "Update Customer"
                    : "Create Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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

    </div>
  );
}
