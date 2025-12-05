import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Building2, Store, Pencil, Trash2, MapPin, Phone } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store as StoreType } from "@shared/schema";

const businessFormSchema = z.object({
  name: z.string().min(1, "Business name is required").max(200, "Name is too long"),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required").max(200, "Name is too long"),
  code: z.string()
    .min(1, "Store code is required")
    .max(10, "Store code must be 10 characters or less")
    .regex(/^[A-Z0-9]+$/, "Store code must be uppercase letters and numbers only"),
  address: z.string().optional(),
  phone: z.string().optional(),
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
    },
  });

  const storeForm = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: "",
      code: "",
      address: "",
      phone: "",
    },
  });

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
                  {business.phone}
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
                  <CardContent className="text-sm text-muted-foreground">
                    {store.address && (
                      <p className="flex items-center gap-2 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {store.address}
                      </p>
                    )}
                    {store.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-3 w-3 shrink-0" />
                        {store.phone}
                      </p>
                    )}
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
              <FormField
                control={businessForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+1 234 567 8900" data-testid="input-business-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              <FormField
                control={storeForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+1 234 567 8900" data-testid="input-store-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
