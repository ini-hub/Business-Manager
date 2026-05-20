import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Building2, MapPin, Phone, User, Coins, CreditCard, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { countries, currencies } from "@/lib/currency-utils";
import { deduplicatedCountryCodes } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store, Staff } from "@shared/schema";

const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required").max(200, "Name is too long"),
  code: z.string()
    .min(1, "Store code is required")
    .max(10, "Store code must be 10 characters or less")
    .regex(/^[A-Z0-9]+$/, "Store code must be uppercase letters and numbers only"),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
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

export default function StoreFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  // If ID is literal "new", treat as undefined
  const storeId = id === "new" ? undefined : id;

  const { data: store, isLoading: isLoadingStore } = useQuery<Store>({
    queryKey: [`/api/stores/${storeId}`],
    enabled: !!storeId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stores/${storeId}`);
      if (!res.ok) throw new Error("Store location not found");
      return res.json();
    },
  });

  const { data: staffList = [], isLoading: isLoadingStaff } = useQuery<Staff[]>({
    queryKey: ["/api/staff", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff?storeId=${storeId}`);
      return res.json();
    },
  });

  const activeStaff = staffList.filter(s => !s.isArchived);

  const form = useForm<z.infer<typeof storeFormSchema>>({
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
      commissionSplitOverride: false,
      commissionSplitBusinessShare: 80,
      commissionSplitStaffShare: 20,
    },
  });

  useEffect(() => {
    if (store) {
      form.reset({
        name: store.name,
        code: store.code,
        address: store.address || "",
        phone: store.phone || "",
        phoneCountryCode: store.phoneCountryCode || "+234",
        country: store.country || "NG",
        currency: store.currency || "NGN",
        managerStaffId: store.managerStaffId || null,
        commissionSplitOverride: (store as any).commissionSplitOverride ?? false,
        commissionSplitBusinessShare: (store as any).commissionSplitBusinessShare ?? 80,
        commissionSplitStaffShare: (store as any).commissionSplitStaffShare ?? 20,
      });
    }
  }, [store, form]);

  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof storeFormSchema>) => {
      const endpoint = storeId ? `/api/stores/${storeId}` : "/api/stores";
      const method = storeId ? "PATCH" : "POST";
      return apiRequest(method, endpoint, data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `Store location ${storeId ? "updated" : "created"} successfully` });
      setLocation("/settings/stores");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error Saving Store", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const onSubmit = (data: z.infer<typeof storeFormSchema>) => {
    mutation.mutate(data);
  };

  if (storeId && isLoadingStore) {
    return <div className="flex items-center justify-center min-h-[400px]">Loading...</div>;
  }

  if (!isOwner) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Store Configuration" description="Only owners can manage store settings." />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/settings/stores")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Stores
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings/stores")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader 
          title={storeId ? "Edit Store Location" : "Add Store Location"} 
          description={storeId ? `Updating parameters for ${store?.name}` : "Establish a new localized franchise branch"}
        />
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="border border-muted/80 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Store Parameters
            </CardTitle>
            <CardDescription>
              Each store manages its own secure customers, employees, and stock profiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Store Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Downtown Outlet" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Store Code</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="DT01" 
                            {...field} 
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                            disabled={!!storeId}
                          />
                        </FormControl>
                        <FormDescription>
                          Short ID prefix (e.g. DT01) used to sequence custom labels.
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
                      <FormLabel>Physical Address (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="123 Luxury Boulevard, Lagos, Nigeria" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-6 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="phoneCountryCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country Code</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="+234" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[300px]">
                            {deduplicatedCountryCodes.map((cc) => (
                              <SelectItem key={cc.dialCode} value={cc.dialCode}>
                                {cc.dialCode} ({cc.name})
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
                    name="phone"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Phone Number (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="8012345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {countries.map((country) => (
                              <SelectItem key={country.code} value={country.code}>
                                {country.name}
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
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Currency</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {currencies.map((currency) => (
                              <SelectItem key={currency.code} value={currency.code}>
                                {currency.symbol} {currency.code} - {currency.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Amounts will show in this currency.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="managerStaffId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Manager (Optional)</FormLabel>
                      {storeId ? (
                        <Select 
                          onValueChange={(value) => field.onChange(value === "none" ? null : value)} 
                          value={field.value || "none"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Assign a manager" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No manager assigned</SelectItem>
                            {activeStaff.map((staff) => (
                              <SelectItem key={staff.id} value={staff.id}>
                                {staff.name} ({staff.staffNumber})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-lg border border-dashed">
                          Manager assignment becomes available after the store is successfully created.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border border-muted/80 p-4 rounded-lg bg-muted/10 space-y-4">
                  <FormField
                    control={form.control}
                    name="commissionSplitOverride"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-background shadow-xs">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-semibold flex items-center gap-1.5">
                            <Coins className="h-4 w-4 text-primary" />
                            Override Business split
                          </FormLabel>
                          <FormDescription className="text-xs">
                            Enable to define a custom percentage split for this store location.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {form.watch("commissionSplitOverride") && (
                    <div className="grid grid-cols-2 gap-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      <FormField
                        control={form.control}
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
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
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
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/settings/stores")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={mutation.isPending} className="min-w-[120px]">
                    {mutation.isPending ? "Saving..." : storeId ? "Save Changes" : "Create Store"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
