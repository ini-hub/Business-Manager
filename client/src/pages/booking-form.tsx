import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, Trash2, CalendarIcon, ChevronLeft, ShoppingCart, Percent, Tag, ShieldAlert, Check, ChevronsUpDown } from "lucide-react";
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Customer, Staff, Inventory } from "@shared/schema";
import { insertCustomerSchema } from "@shared/schema";

// Form schema based on the backend requirements
const bookingFormSchema = z.object({
  type: z.enum(["appointment", "order"]),
  customerId: z.string().min(1, "Customer is required"),
  scheduledAt: z.date({ required_error: "Date is required" }),
  time: z.string().optional(), // We'll combine this with scheduledAt before submitting
  expectedReadyAt: z.date().optional(),
  leadStaffId: z.string().optional(),
  depositAmount: z.coerce.number().min(0, "Deposit cannot be negative").default(0),
  depositPaymentMethod: z.enum(["cash", "transfer", "pos"]).default("cash"),
  reminderPreference: z.enum(["whatsapp", "sms", "both", "none"]).default("whatsapp"),
  notes: z.string().optional(),
  subtotal: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  discountPercent: z.number().min(0).default(0),
  discountReason: z.string().optional(),
  discountApprovedBy: z.string().optional(),
  totalPrice: z.number().min(0).default(0),
  bookingItems: z.array(z.object({
    inventoryId: z.string().min(1, "Item is required"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    unitPrice: z.coerce.number().min(0),
  })).min(1, "At least one item or service is required"),
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;

const newCustomerSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
});
type InsertCustomer = z.infer<typeof newCustomerSchema>;

export default function BookingFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const { toast } = useToast();

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      type: "appointment",
      depositAmount: 0,
      depositPaymentMethod: "cash",
      reminderPreference: "whatsapp",
      bookingItems: [{ inventoryId: "", quantity: 1, unitPrice: 0 }],
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    name: "bookingItems",
    control: form.control,
  });

  const watchType = form.watch("type");

  // Customer UI states
  const [customerOpen, setCustomerOpen] = useState(false);
  const [newCustomerDialogOpen, setNewCustomerDialogOpen] = useState(false);

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
      const response = await apiRequest("POST", "/api/customers", { ...data, storeId: currentStore?.id });
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

  const onCustomerSubmit = (data: InsertCustomer) => {
    createCustomerMutation.mutate(data);
  };

  // Discount States
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [discountApprovedBy, setDiscountApprovedBy] = useState("");
  
  // Supervisor Override States
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [supervisorOverrideOpen, setSupervisorOverrideOpen] = useState(false);
  const [isAuthorizingSupervisor, setIsAuthorizingSupervisor] = useState(false);

  // Fetch data
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: staff } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: inventory } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  // Calculate total price dynamically
  const watchBookingItems = form.watch("bookingItems");
  const subtotal = watchBookingItems.reduce((acc, item) => {
    return acc + (Number(item.quantity) * Number(item.unitPrice));
  }, 0);
  
  useEffect(() => {
    if (applyDiscount && discountPercent > 0) {
      setDiscountAmount(subtotal * (discountPercent / 100));
    }
  }, [subtotal, discountPercent, applyDiscount]);

  const finalTotalPrice = applyDiscount ? Math.max(0, subtotal - discountAmount) : subtotal;

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      // If appointment, combine date and time.
      let scheduledAt = values.scheduledAt;
      if (values.type === "appointment" && values.time) {
        const [hours, minutes] = values.time.split(":");
        scheduledAt = new Date(scheduledAt);
        scheduledAt.setHours(parseInt(hours, 10), parseInt(minutes, 10));
      }

      const payload = {
        storeId: currentStore?.id,
        customerId: values.customerId,
        type: values.type,
        scheduledAt: scheduledAt.toISOString(),
        expectedReadyAt: values.type === "order" && values.expectedReadyAt ? values.expectedReadyAt.toISOString() : undefined,
        leadStaffId: values.leadStaffId === "unassigned" ? undefined : values.leadStaffId,
        depositAmount: values.depositAmount,
        depositPaymentMethod: values.depositPaymentMethod,
        subtotal: subtotal,
        discountAmount: applyDiscount ? discountAmount : 0,
        discountPercent: applyDiscount ? discountPercent : 0,
        discountReason: applyDiscount ? discountReason : undefined,
        discountApprovedBy: applyDiscount ? discountApprovedBy : undefined,
        totalPrice: finalTotalPrice,
        reminderPreference: values.reminderPreference,
        notes: values.notes,
        bookingItems: values.bookingItems.map((item: any) => ({
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
        })),
      };

      const res = await apiRequest("POST", "/api/bookings", payload);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create booking");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Success",
        description: `Booking successfully created.`,
      });
      setLocation("/bookings");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: BookingFormValues) => {
    mutation.mutate(values);
  };

  const handleInventorySelect = (index: number, inventoryId: string) => {
    const selectedItem = inventory?.find(i => i.id === inventoryId);
    if (selectedItem) {
      form.setValue(`bookingItems.${index}.unitPrice`, selectedItem.sellingPrice);
    }
  };

  const handleDiscountToggle = (checked: boolean) => {
    setApplyDiscount(checked);
    if (!checked) {
      setDiscountAmount(0);
      setDiscountPercent(0);
      setDiscountReason("");
      setDiscountApprovedBy("");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? "Edit Booking" : "New Booking"}
        description="Schedule an appointment or product pre-order"
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2 space-y-6">
              
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Booking Type</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-1 sm:flex-row sm:space-x-4 sm:space-y-0"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="appointment" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                Service Appointment
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="order" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                Product Pre-Order
                              </FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="customerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer</FormLabel>
                          <div className="flex items-center gap-2">
                            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={customerOpen}
                                  className="flex-1 justify-between font-normal"
                                >
                                  {field.value
                                    ? customers?.find((c) => c.id === field.value)?.name
                                    : "Search customers..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[300px] p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Search by name or ID..." />
                                  <CommandList>
                                    <CommandEmpty>No customer found.</CommandEmpty>
                                    <CommandGroup>
                                      {customers?.filter(c => !c.isArchived).map((customer) => (
                                        <CommandItem
                                          key={customer.id}
                                          value={`${customer.name} ${customer.customerNumber}`}
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
                                          <div className="flex flex-col">
                                            <span>{customer.name}</span>
                                            <span className="text-xs text-muted-foreground font-mono">{customer.customerNumber}</span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
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
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {watchType === "appointment" && (
                      <FormField
                        control={form.control}
                        name="leadStaffId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Staff</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select staff member" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {staff?.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t pt-6">
                    <FormField
                      control={form.control}
                      name="scheduledAt"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>{watchType === "appointment" ? "Appointment Date" : "Order Date"}</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date < new Date(new Date().setHours(0, 0, 0, 0))
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {watchType === "appointment" ? (
                      <FormField
                        control={form.control}
                        name="time"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Time</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <FormField
                        control={form.control}
                        name="expectedReadyAt"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Expected Ready/Delivery Date</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant={"outline"}
                                    className={cn(
                                      "w-full pl-3 text-left font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4" />
                    Items & Services
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex flex-col gap-4 p-4 border rounded-md relative">
                      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-4">
                        <FormField
                          control={form.control}
                          name={`bookingItems.${index}.inventoryId`}
                          render={({ field: selectField }) => (
                            <FormItem>
                              <FormLabel>Item/Service</FormLabel>
                              <Select 
                                onValueChange={(val) => {
                                  selectField.onChange(val);
                                  handleInventorySelect(index, val);
                                }} 
                                defaultValue={selectField.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select an item" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {inventory?.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name}
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
                          name={`bookingItems.${index}.quantity`}
                          render={({ field: inputField }) => (
                            <FormItem>
                              <FormLabel>Quantity</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  value={inputField.value === 0 ? "" : inputField.value ?? ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    let cleanVal = val;
                                    if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                    inputField.onChange(cleanVal === "" ? 1 : parseInt(cleanVal, 10) || 1);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`bookingItems.${index}.unitPrice`}
                          render={({ field: inputField }) => (
                            <FormItem>
                              <FormLabel>Price (₦)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={inputField.value === 0 ? "0" : inputField.value ?? ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    let cleanVal = val;
                                    if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                    inputField.onChange(cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {fields.length > 1 && (
                        <div className="absolute top-2 right-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex justify-start mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ inventoryId: "", quantity: 1, unitPrice: 0 })}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Item
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Additional Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="reminderPreference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reminder Preference</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select reminder preference" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="sms">SMS</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                            <SelectItem value="none">None</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes / Special Requests</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="E.g., Special hair styling requirements, allergies, etc." 
                            className="resize-none h-24"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6 lg:sticky lg:top-6 self-start">
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₦{subtotal.toLocaleString()}</span>
                  </div>

                  {/* Discount Module (Matches POS) */}
                  <div className="border rounded-md p-4 space-y-4 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">Apply Discount</span>
                      </div>
                      <Switch
                        checked={applyDiscount}
                        onCheckedChange={handleDiscountToggle}
                      />
                    </div>

                    {applyDiscount && (
                      <div className="space-y-4 pt-2 border-t">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Amount (₦)</Label>
                            <Input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={discountAmount === 0 ? "0" : discountAmount || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                let cleanVal = val;
                                if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                const numVal = cleanVal === "" ? 0 : parseFloat(cleanVal) || 0;
                                setDiscountAmount(numVal);
                                if (subtotal > 0) {
                                  setDiscountPercent(Math.min(100, (numVal / subtotal) * 100));
                                }
                              }}
                              className="h-8"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Percent (%)</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={discountPercent === 0 ? "0" : discountPercent || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                let cleanVal = val;
                                if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                const numVal = cleanVal === "" ? 0 : parseFloat(cleanVal) || 0;
                                setDiscountPercent(numVal);
                                setDiscountAmount(subtotal * (numVal / 100));
                              }}
                              className="h-8"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Reason for Discount</Label>
                          <Select value={discountReason} onValueChange={setDiscountReason}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="loyalty">Customer Loyalty</SelectItem>
                              <SelectItem value="promo">Promotional Event</SelectItem>
                              <SelectItem value="apology">Service Apology</SelectItem>
                              <SelectItem value="staff_perk">Staff/Family Perk</SelectItem>
                              <SelectItem value="custom">Custom (Requires Approval)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>

                  {applyDiscount && discountAmount > 0 && (
                    <div className="flex items-center justify-between text-green-600">
                      <span>Discount</span>
                      <span>-₦{discountAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}

                  <Separator />
                  
                  <div className="flex items-center justify-between font-medium text-lg">
                    <span>Total</span>
                    <span>₦{finalTotalPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>

                  <Separator />

                  <FormField
                    control={form.control}
                    name="depositAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deposit Paid (₦)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={field.value === 0 ? "0" : field.value ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              let cleanVal = val;
                              if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                              field.onChange(cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="depositPaymentMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deposit Method</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Method" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="transfer">Bank Transfer</SelectItem>
                            <SelectItem value="pos">POS</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex items-center justify-between text-sm pt-2">
                    <span className="text-muted-foreground">Outstanding Balance</span>
                    <span className="font-medium text-orange-600">
                      ₦{Math.max(0, finalTotalPrice - (form.watch("depositAmount") || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-3">
                <Button 
                  type="submit" 
                  disabled={mutation.isPending} 
                  className="w-full text-lg h-12"
                >
                  {mutation.isPending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-2 h-5 w-5" />
                  )}
                  {isEditing ? "Update Booking" : "Create Booking"}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setLocation("/bookings")}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
              </div>
            </div>
          </form>
        </Form>

        <Dialog open={newCustomerDialogOpen} onOpenChange={setNewCustomerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Create a new customer profile. They will be automatically selected for this booking.
            </DialogDescription>
          </DialogHeader>
          <Form {...customerForm}>
            <form onSubmit={customerForm.handleSubmit(onCustomerSubmit)} className="space-y-4">
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
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</>
                  ) : "Add Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
