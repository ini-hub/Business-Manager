import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, User, Phone, MapPin, Hash, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest, type ApiError } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { insertCustomerSchema, type InsertCustomer } from "@shared/schema";
import { countryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { buildSlug } from "@/lib/slug";

interface SimilarCustomer {
  id: string;
  name: string;
  customerNumber: string;
  numbers: string[];
  visits: number;
  lastVisit: string | null;
}

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
    onError: (error: Error) => {
      // At the plan cap, apiRequest has already opened the upgrade dialog; a toast saying the same would double up.
      if ((error as ApiError).planLimit) return;
      toast({ title: "Error", description: getUserFriendlyError(error, "customer"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertCustomer) => apiRequest("PATCH", `/api/customers/${id}`, data),
    onSuccess: () => {
      // Prefix invalidation: covers both the store list key and this record's own
      // ["/api/customers", id] key, so re-opening the form shows the saved values.
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Customer updated" });
      setLocation(id ? `/customers/${id}` : "/customers");
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: getUserFriendlyError(error, "customer"), variant: "destructive" }),
  });

  // "Same person?" prompt: a returning customer who gives a different number would otherwise get a second profile.
  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [pendingData, setPendingData] = useState<InsertCustomer | null>(null);

  const addNumberMutation = useMutation({
    mutationFn: async (match: SimilarCustomer) => {
      const number = pendingData?.mobileNumber?.trim();
      if (number) await apiRequest("POST", `/api/customers/${match.id}/phones`, { number });
      return match;
    },
    onSuccess: (match) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: `Number added to ${match.name}` });
      setSimilar([]);
      setLocation(`/customers/${buildSlug(match.name, match.id)}`);
    },
    onError: (error: Error) =>
      toast({ title: "Couldn't add the number", description: error.message, variant: "destructive" }),
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
    if (isEdit) return updateMutation.mutate(data);

    if (data.storeId && data.name.trim()) {
      try {
        const res = await apiRequest("GET", `/api/customers/similar?storeId=${encodeURIComponent(data.storeId)}&name=${encodeURIComponent(data.name.trim())}`);
        const body = await res.json();
        if (body.similar?.length > 0) {
          setPendingData(data);
          setSimilar(body.similar);
          return;
        }
      } catch {
        // The check is a convenience; never block creating a customer because it failed.
      }
    }
    createMutation.mutate(data);
  };

  if (!currentStore) return <StoreRequiredAlert />;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const initials = form.watch("name")?.slice(0, 2).toUpperCase() || (isEdit ? "CX" : "");

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Top nav bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <IconButton label="Back to customers" variant="ghost" className="h-8 w-8" onClick={() => setLocation("/customers")}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm truncate">
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
                <Badge variant="outline" className="text-[11px] mt-0.5">Customer</Badge>
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
                      <FormLabel className="flex items-center gap-2">
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

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <FormField
                    control={form.control}
                    name="countryCode"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
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
                                {c.dialCode}
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
                      <FormItem className="sm:col-span-3">
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
                      <FormLabel className="flex items-center gap-2">
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

        <Dialog open={similar.length > 0} onOpenChange={(open) => !open && setSimilar([])}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Is this an existing customer?</DialogTitle>
              <DialogDescription>
                {similar.length === 1 ? "A customer with a similar name already exists." : "Customers with similar names already exist."}
                {pendingData?.mobileNumber?.trim() ? " If it's the same person, add this number to their profile instead of creating a new one." : ""}
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {similar.map((c) => (
                <li key={c.id} className="rounded-lg border p-3 space-y-2">
                  <div>
                    <p className="text-sm font-medium">{c.name} <span className="text-xs text-muted-foreground">{c.customerNumber}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {c.numbers.length > 0 ? c.numbers.join(", ") : "No number"} · {c.visits} {c.visits === 1 ? "visit" : "visits"}
                      {c.lastVisit ? ` · last ${new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(c.lastVisit))}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {pendingData?.mobileNumber?.trim() ? (
                      <Button size="sm" onClick={() => addNumberMutation.mutate(c)} disabled={addNumberMutation.isPending}>
                        Same person, add number
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setLocation(`/customers/${buildSlug(c.name, c.id)}`)}>Open profile</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  const data = pendingData;
                  setSimilar([]);
                  if (data) createMutation.mutate(data);
                }}
              >
                Different person, create new
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
