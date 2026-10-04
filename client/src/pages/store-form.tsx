import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import SettingsStoresPage from "@/pages/settings/stores";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store-context";
import { getFeatureDef } from "@shared/features";
import { formatCurrency } from "@/lib/currency-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { countries, currencies } from "@/lib/currency-utils";
import { TIMEZONES, TIMEZONE_REGIONS, getTimezoneLabel } from "@/lib/timezones";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store, Staff } from "@shared/schema";
import { fetchAllStaff } from "@/lib/staff-api";

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
  timezone: z.string().default("Africa/Lagos"),
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
  const { business, stores } = useStore();
  const codeTouched = useRef(false);

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

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", storeId],
    enabled: !!storeId,
    queryFn: () => fetchAllStaff(storeId!),
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
      timezone: "Africa/Lagos",
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
        timezone: (store as any).timezone || "Africa/Lagos",
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
    if (data.phone) {
      const phoneCheck = validatePhoneNumber(data.phone, data.phoneCountryCode);
      if (!phoneCheck.valid) {
        form.setError("phone", { message: phoneCheck.error });
        return;
      }
    }
    mutation.mutate(data);
  };

  // Suggest a code from the name until the owner types their own: "G.R.A Branch" -> "GRAB".
  const suggestCode = (name: string) =>
    name.split(/\s+/).filter(Boolean).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).join("").toUpperCase().slice(0, 4);

  const addon = getFeatureDef("store_addon");
  const trialEnds = (business as any)?.trialEndsAt ? new Date((business as any).trialEndsAt) : null;
  const inTrial = !!trialEnds && trialEnds.getTime() > Date.now();
  const isExtraStore = !storeId && stores.filter((s) => s.isActive !== false).length >= (addon?.freeLimit ?? 1);
  const price = addon?.price?.monthly;
  const priceNote = isExtraStore && price != null
    ? inTrial
      ? `Free during your trial. After ${trialEnds!.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, each store after the first costs ${formatCurrency(price, "NGN")} a month.`
      : `Each store after the first costs ${formatCurrency(price, "NGN")} a month.`
    : null;

  if (storeId && isLoadingStore) {
    return <div className="flex items-center justify-center min-h-[400px]">Loading...</div>;
  }

  if (!isOwner) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Store Configuration" description="Only owners can manage store settings." compact />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/settings/stores")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Stores
        </Button>
      </div>
    );
  }

  const field = "space-y-2";
  const hint = "text-xs text-muted-foreground";
  const splitOn = form.watch("commissionSplitOverride");

  const closeDrawer = () => setLocation("/settings/stores");

  return (
    <>
    <SettingsStoresPage />
    <Sheet open onOpenChange={(open) => { if (!open) closeDrawer(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4 text-left">
          <SheetTitle>{storeId ? `Edit ${store?.name ?? "store"}` : "Add a store"}</SheetTitle>
          <SheetDescription className="sr-only">Store name, code, contact details, region and manager.</SheetDescription>
        </SheetHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <FormField control={form.control} name="name" render={({ field: f }) => (
              <FormItem className={field}>
                <FormLabel>Store name</FormLabel>
                <FormControl>
                  <Input placeholder="Downtown Outlet" {...f} data-testid="input-store-name"
                    onChange={(e) => { f.onChange(e); if (!storeId && !codeTouched.current) form.setValue("code", suggestCode(e.target.value), { shouldValidate: true }); }} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="code" render={({ field: f }) => (
              <FormItem className={field}>
                <FormLabel>Store code</FormLabel>
                <FormControl>
                  {storeId ? (
                    <div className="flex h-10 items-center gap-2 rounded-md border bg-muted px-3 text-sm font-semibold"><Lock className="h-3.5 w-3.5 text-muted-foreground" />{f.value}</div>
                  ) : (
                    <Input placeholder="DT01" {...f} maxLength={10} data-testid="input-store-code"
                      onChange={(e) => { codeTouched.current = true; f.onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); }} />
                  )}
                </FormControl>
                <p className={hint}>
                  {storeId ? "Codes can't change once a store exists, so old receipts keep matching." : "Starts every receipt and label number from this store. You can't change it later."}
                </p>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <FormField control={form.control} name="address" render={({ field: f }) => (
            <FormItem className={field}>
              <FormLabel>Address</FormLabel>
              <FormControl><Input placeholder="Street, area, city" {...f} /></FormControl>
              <p className={hint}>Optional. Printed on this store's receipts.</p>
              <FormMessage />
            </FormItem>
          )} />

          <FormItem className={field}>
            <FormLabel>Phone</FormLabel>
            <div className="flex gap-2">
              <FormField control={form.control} name="phoneCountryCode" render={({ field: f }) => (
                <Select onValueChange={f.onChange} value={f.value}>
                  <SelectTrigger className="w-28" aria-label="Country code"><SelectValue placeholder="+234" /></SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {deduplicatedCountryCodes.map((cc) => (
                      <SelectItem key={cc.dialCode} value={cc.dialCode}>{cc.dialCode} ({cc.name})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
              <FormField control={form.control} name="phone" render={({ field: f }) => (
                <FormControl><Input className="flex-1" inputMode="tel" placeholder="801 234 5678" {...f} /></FormControl>
              )} />
            </div>
            <p className={hint}>Optional</p>
            <FormMessage>{form.formState.errors.phone?.message}</FormMessage>
          </FormItem>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField control={form.control} name="country" render={({ field: f }) => (
              <FormItem className={field}>
                <FormLabel>Country</FormLabel>
                <Select onValueChange={f.onChange} value={f.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="currency" render={({ field: f }) => (
              <FormItem className={field}>
                <FormLabel>Currency</FormLabel>
                <Select onValueChange={f.onChange} value={f.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {currencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <FormField control={form.control} name="timezone" render={({ field: f }) => (
            <FormItem className={field}>
              <FormLabel>Time zone</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button type="button" variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !f.value && "text-muted-foreground")}>
                      {f.value ? getTimezoneLabel(f.value) : "Select time zone"}
                      <Check className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search city or time zone" />
                    <CommandList className="max-h-[300px]">
                      <CommandEmpty>No time zone found.</CommandEmpty>
                      {TIMEZONE_REGIONS.map((region) => (
                        <CommandGroup key={region} heading={region}>
                          {TIMEZONES.filter((t) => t.region === region).map((tz) => (
                            <CommandItem key={tz.value} value={`${tz.label} ${tz.value}`} onSelect={() => f.onChange(tz.value)}>
                              <Check className={cn("mr-2 h-4 w-4", f.value === tz.value ? "opacity-100" : "opacity-0")} />
                              <span className="flex-1">{tz.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">UTC{tz.offset}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className={hint}>Reports and date filters for this store use this time, wherever staff are.</p>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="managerStaffId" render={({ field: f }) => (
            <FormItem className={field}>
              <FormLabel>Store manager</FormLabel>
              {storeId ? (
                <Select onValueChange={(v) => f.onChange(v === "none" ? null : v)} value={f.value || "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Assign a manager" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No manager yet</SelectItem>
                    {activeStaff.map((st) => <SelectItem key={st.id} value={st.id}>{st.name} ({st.staffNumber})</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
                  Staff belong to a store, so you can pick a manager once the store exists.
                </p>
              )}
              {storeId && <p className={hint}>Gets the Store Manager role for this store.</p>}
              <FormMessage />
            </FormItem>
          )} />

          <div className="space-y-3 rounded-lg border p-4">
            <FormField control={form.control} name="commissionSplitOverride" render={({ field: f }) => (
              <FormItem className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <FormLabel>Use a different commission split here</FormLabel>
                  <p className={hint}>Otherwise this store follows the business default in Business profile.</p>
                </div>
                <FormControl><Switch checked={f.value} onCheckedChange={f.onChange} /></FormControl>
              </FormItem>
            )} />
            {splitOn && (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="commissionSplitStaffShare" render={({ field: f }) => (
                  <FormItem className={field}>
                    <FormLabel>Staff earn (%)</FormLabel>
                    <FormControl>
                      <Input type="number" {...f} onChange={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value))); f.onChange(v); form.setValue("commissionSplitBusinessShare", 100 - v); }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="commissionSplitBusinessShare" render={({ field: f }) => (
                  <FormItem className={field}>
                    <FormLabel>Business keeps (%)</FormLabel>
                    <FormControl><Input type="number" {...f} onChange={(e) => f.onChange(Number(e.target.value))} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}
          </div>

          {priceNote && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{priceNote}</p>}

          </div>

          <SheetFooter className="flex-row justify-end gap-3 border-t px-6 py-4 sm:space-x-0">
            <Button type="button" variant="outline" onClick={closeDrawer}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-save-store">
              {mutation.isPending ? "Saving..." : storeId ? "Save changes" : "Add store"}
            </Button>
          </SheetFooter>
        </form>
      </Form>
      </SheetContent>
    </Sheet>
    </>
  );
}
