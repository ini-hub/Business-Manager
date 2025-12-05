import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Phone, MapPin, Hash, RefreshCw, AlertCircle } from "lucide-react";
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

export default function Customers() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [generatedCustomerNumber, setGeneratedCustomerNumber] = useState("");

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const form = useForm<InsertCustomer>({
    resolver: zodResolver(insertCustomerSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      customerNumber: "",
      mobileNumber: "",
      address: "",
    },
  });

  const fetchNewCustomerNumber = async () => {
    if (!currentStore?.id) return;
    try {
      const res = await fetch(`/api/stores/${currentStore.id}/generate-customer-number`);
      if (res.ok) {
        const data = await res.json();
        setGeneratedCustomerNumber(data.customerNumber);
        form.setValue("customerNumber", data.customerNumber);
      }
    } catch (error) {
      console.error("Failed to generate customer number:", error);
    }
  };

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

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/customers/${selectedCustomer?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Customer deleted successfully" });
      setIsDeleteOpen(false);
      setSelectedCustomer(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Delete Customer", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const openCreateForm = async () => {
    form.reset({
      storeId: currentStore?.id || "",
      name: "",
      customerNumber: "",
      mobileNumber: "",
      address: "",
    });
    setSelectedCustomer(null);
    setIsFormOpen(true);
    await fetchNewCustomerNumber();
  };

  const openEditForm = (customer: Customer) => {
    form.reset({
      storeId: customer.storeId,
      name: customer.name,
      customerNumber: customer.customerNumber,
      mobileNumber: customer.mobileNumber,
      address: customer.address,
    });
    setSelectedCustomer(customer);
    setGeneratedCustomerNumber("");
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedCustomer(null);
    setGeneratedCustomerNumber("");
    form.reset();
  };

  const onSubmit = (data: InsertCustomer) => {
    if (selectedCustomer) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
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
          <Phone className="h-3 w-3 text-muted-foreground" />
          <span>{customer.mobileNumber}</span>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      render: (customer: Customer) => (
        <div className="flex items-center gap-2 max-w-xs">
          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="truncate">{customer.address}</span>
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
            data-testid={`button-delete-${customer.id}`}
          >
            <Trash2 className="h-4 w-4" />
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
              data={customers as unknown as Record<string, unknown>[]}
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

      <DataTable
        data={customers}
        columns={columns}
        searchable
        searchPlaceholder="Search customers..."
        searchKeys={["name", "customerNumber", "mobileNumber", "address"]}
        isLoading={isLoading}
        emptyMessage="No customers found. Add your first customer to get started."
      />

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
              <div className="grid gap-4 sm:grid-cols-2">
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
                <FormField
                  control={form.control}
                  name="customerNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer ID</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input 
                            placeholder={generatedCustomerNumber || "Auto-generated"} 
                            {...field} 
                            data-testid="input-customer-number" 
                          />
                        </FormControl>
                        {!selectedCustomer && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={fetchNewCustomerNumber}
                            title="Generate new ID"
                            data-testid="button-regenerate-id"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <FormDescription>
                        Auto-generated based on store code. You can edit it if needed.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 234 567 8900" {...field} data-testid="input-mobile" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
        title="Delete Customer"
        description={`Are you sure you want to delete "${selectedCustomer?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => deleteMutation.mutate()}
        isDestructive
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
