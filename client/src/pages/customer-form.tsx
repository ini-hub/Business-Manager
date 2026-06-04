import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, User, Phone, MapPin, Hash, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { insertCustomerSchema, type InsertCustomer } from "@shared/schema";
import { countryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";

const customerFormSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
  customerNumber: z.string().optional().default(""),
});

export default function CustomerFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const form = useForm<InsertCustomer>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      storeId: currentStore?.id === "all" ? "" : (currentStore?.id || ""),
      name: "",
      customerNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      address: "",
    },
  });

  const { data: customer } = useQuery<any>({
    queryKey: ["/api/customers", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/customers/${id}`);
      return res.json();
    },
    enabled: isEdit,
  });

  useEffect(() => {
    if (customer) {
      let countryCode = customer.countryCode || "NG";
      if (countryCode.startsWith("+")) {
        const country = countryCodes.find((c) => c.dialCode === countryCode);
        countryCode = country?.code || "NG";
      }
      form.reset({
        storeId: customer.storeId,
        name: customer.name,
        customerNumber: customer.customerNumber,
        countryCode,
        mobileNumber: customer.mobileNumber || "",
        address: customer.address || "",
      });
    }
  }, [customer, form]);

  const createMutation = useMutation({
    mutationFn: (data: InsertCustomer) => apiRequest("POST", "/api/customers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Customer created" });
      setLocation("/customers");
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: getUserFriendlyError(error, "customer"), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertCustomer) => apiRequest("PATCH", `/api/customers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Customer updated" });
      setLocation(id ? `/customers/${id}` : "/customers");
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: getUserFriendlyError(error, "customer"), variant: "destructive" }),
  });

  const onSubmit = async (data: InsertCustomer) => {
    const countryCode = data.countryCode || "NG";
    if (data.mobileNumber?.trim()) {
      const validation = validatePhoneNumber(data.mobileNumber, countryCode);
      if (!validation.valid) {
        form.setError("mobileNumber", { message: validation.error });
        return;
      }
    }
    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  };

  if (!currentStore) return <StoreRequiredAlert />;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const initials = form.watch("name")?.slice(0, 2).toUpperCase() || (isEdit ? "CX" : "");

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Top nav bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/customers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">
            {isEdit ? "Edit Customer" : "New Customer"}
          </h1>
          <p className="text-xs text-muted-foreground">{currentStore.name}</p>
        </div>
        <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={isPending} className="shrink-0">
          {isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Customer"}
        </Button>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        {/* Identity banner */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="h-20 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
          <CardContent className="-mt-10 pb-5 px-5">
            <div className="flex items-end gap-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 border-4 border-background flex items-center justify-center shadow-sm">
                {initials
                  ? <span className="text-lg font-bold text-primary">{initials}</span>
                  : <User className="h-7 w-7 text-muted-foreground" />
                }
              </div>
              <div className="pb-1">
                <p className="font-semibold text-sm leading-tight">
                  {form.watch("name") || (isEdit ? "Customer" : "New Customer")}
                </p>
                <Badge variant="outline" className="text-[10px] mt-0.5">Customer</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Store selector (multi-store owners) */}
            {currentStore.id === "all" && !isEdit && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Store className="h-3.5 w-3.5" />Branch
                  </div>
                  <FormField
                    control={form.control}
                    name="storeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Store</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a branch…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {stores.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Basic info */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <User className="h-3.5 w-3.5" />Identity
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Amaka Johnson" className="h-11" autoFocus {...field} />
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
                      <FormLabel className="flex items-center gap-1.5">
                        <Hash className="h-3 w-3" />Customer ID
                        <span className="font-normal text-muted-foreground">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Auto-generated if left blank" className="h-11 font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Contact */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Phone className="h-3.5 w-3.5" />Contact
                </div>

                <div className="grid grid-cols-5 gap-3">
                  <FormField
                    control={form.control}
                    name="countryCode"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Country</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "NG"}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[280px]">
                            {countryCodes.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.name} ({c.dialCode})
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
                      <FormItem className="col-span-3">
                        <FormLabel>Mobile Number <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="8012345678" className="h-11" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">Without country code</FormDescription>
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
                      <FormLabel className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" />Address
                        <span className="font-normal text-muted-foreground">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="123 Main St, Lagos"
                          className="resize-none"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Bottom action bar */}
            <div className="flex gap-3 pt-2 pb-8">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setLocation("/customers")}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Customer"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
