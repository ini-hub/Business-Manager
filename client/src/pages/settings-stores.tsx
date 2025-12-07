import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Building2, Store, Pencil, Trash2, MapPin, Phone, Globe, Coins } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store as StoreType } from "@shared/schema";
import { countries, currencies, getCurrencyByCode, getCountryByCode } from "@/lib/currency-utils";
import { countryCodes } from "@/lib/phone-utils";

const businessFormSchema = z.object({
  name: z.string().min(1, "Business name is required").max(200, "Name is too long"),
  address: z.string().optional(),
  phone: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
});

const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required").max(200, "Name is too long"),
  code: z.string()
    .min(1, "Store code is required")
    .max(10, "Store code must be 10 characters or less")
    .regex(/^[A-Z0-9]+$/, "Store code must be uppercase letters and numbers only"),
  address: z.string().optional(),
  phone: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  country: z.string().default("NG"),
  currency: z.string().default("NGN"),
});

type BusinessFormValues = z.infer<typeof businessFormSchema>;
type StoreFormValues = z.infer<typeof storeFormSchema>;

export default function SettingsStoresPage() {
  const { toast } = useToast();
  const {
    business,
    stores,
    currentStore,
    setCurrentStore,
    isLoading,
    createBusiness,
    updateBusiness,
    createStore,
    updateStore,
    deleteStore,
  } = useStore();

  const [isBusinessDialogOpen, setIsBusinessDialogOpen] = useState(false);
  const [isStoreDialogOpen, setIsStoreDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreType | null>(null);
  const [deletingStore, setDeletingStore] = useState<StoreType | null>(null);

  const businessForm = useForm<BusinessFormValues>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      name: business?.name || "",
      address: business?.address || "",
      phone: business?.phone || "",
      phoneCountryCode: business?.phoneCountryCode || "+234",
    },
  });

  const storeForm = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: "",
      code: "",
      address: "",
      phone: "",
      phoneCountryCode: "+234",
      country: "NG",
      currency: "NGN",
    },
  });

  const watchedCountry = storeForm.watch("country");
  
  useEffect(() => {
    const countryInfo = getCountryByCode(watchedCountry);
    if (countryInfo) {
      storeForm.setValue("currency", countryInfo.currency);
    }
  }, [watchedCountry, storeForm]);

  const handleBusinessSubmit = async (values: BusinessFormValues) => {
    try {
      if (business) {
        await updateBusiness(business.id, values);
        toast({ title: "Business updated successfully" });
      } else {
        await createBusiness(values);
        toast({ title: "Business created successfully" });
      }
      setIsBusinessDialogOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleStoreSubmit = async (values: StoreFormValues) => {
    try {
      if (editingStore) {
        const updated = await updateStore(editingStore.id, values);
        if (currentStore?.id === editingStore.id) {
          setCurrentStore(updated);
        }
        toast({ title: "Store updated successfully" });
      } else {
        if (!business) {
          toast({
            title: "Error",
            description: "Please set up your business information first.",
            variant: "destructive",
          });
          return;
        }
        const newStore = await createStore({ ...values, businessId: business.id });
        if (!currentStore) {
          setCurrentStore(newStore);
        }
        toast({ title: "Store created successfully" });
      }
      setIsStoreDialogOpen(false);
      setEditingStore(null);
      storeForm.reset();
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleDeleteStore = async () => {
    if (!deletingStore) return;
    try {
      await deleteStore(deletingStore.id);
      if (currentStore?.id === deletingStore.id && stores.length > 1) {
        const nextStore = stores.find(s => s.id !== deletingStore.id);
        if (nextStore) setCurrentStore(nextStore);
      }
      toast({ title: "Store deleted successfully" });
      setDeletingStore(null);
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const openEditStore = (store: StoreType) => {
    setEditingStore(store);
    storeForm.reset({
      name: store.name,
      code: store.code,
      address: store.address || "",
      phone: store.phone || "",
      phoneCountryCode: store.phoneCountryCode || "+234",
      country: store.country || "NG",
      currency: store.currency || "NGN",
    });
    setIsStoreDialogOpen(true);
  };

  const openAddStore = () => {
    setEditingStore(null);
    storeForm.reset({
      name: "",
      code: "",
      address: "",
      phone: "",
      phoneCountryCode: "+234",
      country: "NG",
      currency: "NGN",
    });
    setIsStoreDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business & Stores"
        description="Manage your business information and store locations"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Business Information
            </CardTitle>
            <CardDescription>
              Your business details that appear across all stores
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              businessForm.reset({
                name: business?.name || "",
                address: business?.address || "",
                phone: business?.phone || "",
                phoneCountryCode: business?.phoneCountryCode || "+234",
              });
              setIsBusinessDialogOpen(true);
            }}
            data-testid="button-edit-business"
          >
            <Pencil className="h-4 w-4 mr-2" />
            {business ? "Edit" : "Set Up"}
          </Button>
        </CardHeader>
        <CardContent>
          {business ? (
            <div className="space-y-2">
              <p className="font-medium text-lg" data-testid="text-business-name">{business.name}</p>
              {business.address && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {business.address}
                </p>
              )}
              {business.phone && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  {business.phoneCountryCode || "+234"} {business.phone}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No business information set up yet. Click "Set Up" to add your business details.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Your Stores
            </CardTitle>
            <CardDescription>
              Manage individual store locations. Each store has separate customers, staff, and inventory.
            </CardDescription>
          </div>
          <Button onClick={openAddStore} disabled={!business} data-testid="button-add-store">
            <Plus className="h-4 w-4 mr-2" />
            Add Store
          </Button>
        </CardHeader>
        <CardContent>
          {!business ? (
            <p className="text-muted-foreground">
              Please set up your business information first before adding stores.
            </p>
          ) : stores.length === 0 ? (
            <p className="text-muted-foreground">
              No stores set up yet. Click "Add Store" to create your first store location.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stores.map((store) => (
                <Card
                  key={store.id}
                  className={`relative ${currentStore?.id === store.id ? "ring-2 ring-primary" : ""}`}
                  data-testid={`card-store-${store.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate" data-testid={`text-store-name-${store.id}`}>
                          {store.name}
                        </CardTitle>
                        <CardDescription className="font-mono text-xs" data-testid={`text-store-code-${store.id}`}>
                          Code: {store.code}
                        </CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditStore(store)}
                          data-testid={`button-edit-store-${store.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingStore(store)}
                          disabled={stores.length === 1}
                          data-testid={`button-delete-store-${store.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    {store.address && (
                      <p className="flex items-center gap-2 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {store.address}
                      </p>
                    )}
                    {store.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-3 w-3 shrink-0" />
                        {store.phoneCountryCode || "+234"} {store.phone}
                      </p>
                    )}
                    <p className="flex items-center gap-2">
                      <Globe className="h-3 w-3 shrink-0" />
                      {getCountryByCode(store.country || "NG")?.name || "Nigeria"}
                    </p>
                    <p className="flex items-center gap-2">
                      <Coins className="h-3 w-3 shrink-0" />
                      {getCurrencyByCode(store.currency || "NGN")?.symbol || "₦"} {store.currency || "NGN"}
                    </p>
                    {currentStore?.id === store.id && (
                      <p className="mt-2 text-xs text-primary font-medium">Currently Selected</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isBusinessDialogOpen} onOpenChange={setIsBusinessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{business ? "Edit Business" : "Set Up Business"}</DialogTitle>
            <DialogDescription>
              Enter your business information. This will appear across all your stores.
            </DialogDescription>
          </DialogHeader>
          <Form {...businessForm}>
            <form onSubmit={businessForm.handleSubmit(handleBusinessSubmit)} className="space-y-4">
              <FormField
                control={businessForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="My Business" data-testid="input-business-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={businessForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="123 Main St, City" data-testid="input-business-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Phone (Optional)</FormLabel>
                <div className="flex gap-2">
                  <FormField
                    control={businessForm.control}
                    name="phoneCountryCode"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || "+234"}>
                        <SelectTrigger className="w-[120px]" data-testid="select-business-phone-country">
                          <SelectValue placeholder="+234" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {countryCodes.map((cc) => (
                            <SelectItem key={cc.dialCode} value={cc.dialCode}>
                              {cc.dialCode} ({cc.name})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormControl>
                        <Input {...field} placeholder="Phone number" className="flex-1" data-testid="input-business-phone" />
                      </FormControl>
                    )}
                  />
                </div>
              </FormItem>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsBusinessDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-business">
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isStoreDialogOpen} onOpenChange={setIsStoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStore ? "Edit Store" : "Add Store"}</DialogTitle>
            <DialogDescription>
              {editingStore
                ? "Update this store's information."
                : "Add a new store location. Each store has its own customers, staff, and inventory."}
            </DialogDescription>
          </DialogHeader>
          <Form {...storeForm}>
            <form onSubmit={storeForm.handleSubmit(handleStoreSubmit)} className="space-y-4">
              <FormField
                control={storeForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Downtown Store" data-testid="input-store-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={storeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store Code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="DT01"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        data-testid="input-store-code"
                      />
                    </FormControl>
                    <FormDescription>
                      Short code used in customer IDs (e.g., DT01001)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={storeForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="123 Main St, City" data-testid="input-store-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Phone (Optional)</FormLabel>
                <div className="flex gap-2">
                  <FormField
                    control={storeForm.control}
                    name="phoneCountryCode"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || "+234"}>
                        <SelectTrigger className="w-[120px]" data-testid="select-store-phone-country">
                          <SelectValue placeholder="+234" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {countryCodes.map((cc) => (
                            <SelectItem key={cc.dialCode} value={cc.dialCode}>
                              {cc.dialCode} ({cc.name})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={storeForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormControl>
                        <Input {...field} placeholder="Phone number" className="flex-1" data-testid="input-store-phone" />
                      </FormControl>
                    )}
                  />
                </div>
              </FormItem>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={storeForm.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-store-country">
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
                  control={storeForm.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-store-currency">
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
                        Amounts will show in this currency with USD equivalent
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsStoreDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-store">
                  {editingStore ? "Save Changes" : "Add Store"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingStore}
        onOpenChange={() => setDeletingStore(null)}
        title="Delete Store"
        description={`Are you sure you want to delete "${deletingStore?.name}"? This cannot be undone. You can only delete a store if it has no customers, staff, or inventory.`}
        onConfirm={handleDeleteStore}
        confirmText="Delete Store"
        isDestructive
      />
    </div>
  );
}
