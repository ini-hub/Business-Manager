import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Customer } from "@shared/schema";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { BookingFormValues, InsertCustomer, newCustomerSchema } from "./types";

interface StepCustomerProps {
  form: UseFormReturn<BookingFormValues>;
  onNext: () => void;
}

export function StepCustomer({ form, onNext }: StepCustomerProps) {
  const { currentStore } = useStore();
  const { toast } = useToast();

  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [newCustomerDialogOpen, setNewCustomerDialogOpen] = useState(false);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: globalCustomerMatches = [] } = useQuery<any[]>({
    queryKey: ["/api/customers/search-global", currentStore?.id, customerSearchQuery],
    queryFn: async () => {
      if (customerSearchQuery.trim().length < 2) return [];
      const res = await apiRequest(
        "GET",
        `/api/customers/search-global?storeId=${currentStore?.id}&query=${encodeURIComponent(customerSearchQuery)}`
      );
      return res.json();
    },
    enabled:
      !!currentStore?.id &&
      currentStore?.id !== "all" &&
      customerSearchQuery.trim().length >= 2,
  });

  const profileCustomerMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await apiRequest("POST", "/api/customers/profile-global", {
        customerId,
        storeId: currentStore?.id,
      });
      return res.json();
    },
    onSuccess: (newLocalCustomer) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      form.setValue("customerId", newLocalCustomer.id);
      setCustomerOpen(false);
      toast({
        title: "Customer Profiled Successfully",
        description: `${newLocalCustomer.name} has been imported to this branch.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Profile Customer",
        description: error.message || "Failed to copy customer profile.",
        variant: "destructive",
      });
    },
  });

  const customerForm = useForm<InsertCustomer>({
    resolver: zodResolver(newCustomerSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      countryCode: "NG",
      mobileNumber: "",
      address: "",
      customerNumber: "",
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: InsertCustomer) => {
      const response = await apiRequest("POST", "/api/customers", {
        ...data,
        storeId: currentStore?.id,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Customer created successfully" });
      form.setValue("customerId", data.id);
      setNewCustomerDialogOpen(false);
      customerForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Add Customer", description: error.message, variant: "destructive" });
    },
  });

  const watchType = form.watch("type");
  const watchCustomerId = form.watch("customerId");
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId);

  const handleNext = async () => {
    const valid = await form.trigger(["type", "customerId"]);
    if (valid) onNext();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Booking Type</CardTitle>
          <CardDescription>Select whether this is a service appointment or a product pre-order.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  >
                    {[
                      { value: "appointment", label: "Service Appointment", desc: "Schedule a service at a specific time" },
                      { value: "order", label: "Product Pre-Order", desc: "Reserve products for pick-up or delivery" },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        htmlFor={`type-${opt.value}`}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-all",
                          field.value === opt.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        )}
                      >
                        <FormControl>
                          <RadioGroupItem value={opt.value} id={`type-${opt.value}`} className="mt-0.5" />
                        </FormControl>
                        <div>
                          <p className="font-semibold text-sm">{opt.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select Customer</CardTitle>
          <CardDescription>Search existing customers or add a new one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            control={form.control}
            name="customerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Customer</FormLabel>
                <div className="flex items-center gap-2">
                  <Popover
                    open={customerOpen}
                    onOpenChange={(open) => {
                      setCustomerOpen(open);
                      if (!open) setCustomerSearchQuery("");
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerOpen}
                        className="flex-1 justify-between font-normal"
                        disabled={profileCustomerMutation.isPending}
                      >
                        {profileCustomerMutation.isPending ? (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
                            Profiling customer...
                          </span>
                        ) : field.value ? (
                          selectedCustomer?.name ?? "Customer selected"
                        ) : (
                          "Search customers..."
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search by name or ID..."
                          value={customerSearchQuery}
                          onValueChange={setCustomerSearchQuery}
                        />
                        <CommandList>
                          {!profileCustomerMutation.isPending &&
                            customers.filter((c) => !c.isArchived).length === 0 &&
                            globalCustomerMatches.length === 0 && (
                              <CommandEmpty>No customer found.</CommandEmpty>
                            )}

                          {!profileCustomerMutation.isPending && (
                            <>
                              <CommandGroup heading="Local Store Branch">
                                {customers
                                  .filter((c) => !c.isArchived)
                                  .filter((c) => {
                                    if (!customerSearchQuery.trim()) return true;
                                    const q = customerSearchQuery.toLowerCase();
                                    return (
                                      c.name.toLowerCase().includes(q) ||
                                      c.customerNumber.toLowerCase().includes(q) ||
                                      (c.mobileNumber || "").toLowerCase().includes(q)
                                    );
                                  })
                                  .map((customer) => {
                                    const presenter = new CustomerPresenter(customer);
                                    return (
                                      <CommandItem
                                        key={customer.id}
                                        value={`${customer.name} ${customer.customerNumber} ${customer.mobileNumber || ""}`}
                                        onSelect={() => {
                                          field.onChange(customer.id);
                                          setCustomerOpen(false);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            field.value === customer.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        <EntityDisplay presenter={presenter} />
                                      </CommandItem>
                                    );
                                  })}
                              </CommandGroup>

                              {globalCustomerMatches.length > 0 && (
                                <CommandGroup heading="Other Branches (Same Business)">
                                  {globalCustomerMatches.map((customer) => {
                                    const presenter = new CustomerPresenter(customer);
                                    return (
                                      <CommandItem
                                        key={customer.id}
                                        value={`${customer.name} ${customer.customerNumber} ${customer.mobileNumber || ""}`}
                                        onSelect={() => profileCustomerMutation.mutate(customer.id)}
                                        className="flex items-center justify-between cursor-pointer"
                                      >
                                        <div className="flex items-center flex-1">
                                          <Check className="mr-2 h-4 w-4 opacity-0" />
                                          <EntityDisplay presenter={presenter} />
                                        </div>
                                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium shrink-0 ml-2">
                                          {customer.storeName}
                                        </span>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              )}
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => setNewCustomerDialogOpen(true)}
                    title="Add New Customer"
                    id="booking-add-customer-btn"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedCustomer && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center gap-3 animate-in fade-in duration-200">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                {selectedCustomer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-sm">{selectedCustomer.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedCustomer.customerNumber}
                  {selectedCustomer.mobileNumber ? ` · ${selectedCustomer.mobileNumber}` : ""}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={handleNext} id="booking-next-step-1" className="min-w-[140px]">
          Next: Items & Services →
        </Button>
      </div>

      {/* New Customer Dialog */}
      <Dialog open={newCustomerDialogOpen} onOpenChange={setNewCustomerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Create a new customer profile. They will be automatically selected for this booking.
            </DialogDescription>
          </DialogHeader>
          <Form {...customerForm}>
            <form onSubmit={customerForm.handleSubmit((data) => createCustomerMutation.mutate(data))} className="space-y-4">
              <FormField
                control={customerForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customerForm.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <FormControl>
                      <Input placeholder="08012345678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" type="button" onClick={() => setNewCustomerDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createCustomerMutation.isPending}>
                  {createCustomerMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding...</>
                  ) : (
                    "Add Customer"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
