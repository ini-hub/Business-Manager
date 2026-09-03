import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Store, Pencil, Archive, ArchiveRestore, Trash2, MapPin, Phone, Globe, Coins, User } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store as StoreType, Staff } from "@shared/schema";
import { getCurrencyByCode, getCountryByCode } from "@/lib/currency-utils";
import { getTimezoneOffset } from "@/lib/timezones";
import { Clock } from "lucide-react";

export function StoresManagementSection() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const {
    business,
    stores,
    currentStore,
    setCurrentStore,
    archiveStore,
    restoreStore,
    deleteStore,
  } = useStore();

  const activeStores = stores.filter((s) => s.isActive !== false);
  const archivedStores = stores.filter((s) => s.isActive === false);

  const [archivingStore, setArchivingStore] = useState<StoreType | null>(null);
  const [restoringStore, setRestoringStore] = useState<StoreType | null>(null);
  const [deletingStore, setDeletingStore] = useState<StoreType | null>(null);
  const [allStaffByStore, setAllStaffByStore] = useState<Record<string, Staff[]>>({});

  useEffect(() => {
    const fetchAllStaffForStores = async () => {
      if (!stores || stores.length === 0) return;
      const staffByStore: Record<string, Staff[]> = {};
      for (const store of stores) {
        try {
          const response = await fetch(`/api/staff?storeId=${store.id}`);
          if (response.ok) {
            const staff = await response.json();
            staffByStore[store.id] = staff;
          }
        } catch {
          staffByStore[store.id] = [];
        }
      }
      setAllStaffByStore(staffByStore);
    };
    fetchAllStaffForStores();
  }, [stores]);

  const getManagerName = (managerId: string | null | undefined, storeId?: string) => {
    if (!managerId) return null;
    if (storeId && allStaffByStore[storeId]) {
      const manager = allStaffByStore[storeId].find((s) => s.id === managerId);
      if (manager) return manager.name;
    }
    return null;
  };

  const handleArchiveStore = async () => {
    if (!archivingStore) return;
    try {
      await archiveStore(archivingStore.id);
      if (currentStore?.id === archivingStore.id) {
        const nextStore = activeStores.find((s) => s.id !== archivingStore.id);
        if (nextStore) setCurrentStore(nextStore);
      }
      toast({ title: "Store archived successfully" });
      setArchivingStore(null);
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleRestoreStore = async () => {
    if (!restoringStore) return;
    try {
      await restoreStore(restoringStore.id);
      toast({ title: "Store restored successfully" });
      setRestoringStore(null);
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
      toast({ title: "Store permanently deleted" });
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
    setLocation(`/settings/stores/${store.id}/edit`);
  };

  const openAddStore = () => {
    setLocation("/settings/stores/new");
  };

  const renderStoreDetails = (store: StoreType) => (
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
      <p className="flex items-center gap-2">
        <Clock className="h-3 w-3 shrink-0" />
        {(store as any).timezone || "Africa/Lagos"} (UTC{getTimezoneOffset((store as any).timezone || "Africa/Lagos")})
      </p>
      {store.managerStaffId && getManagerName(store.managerStaffId, store.id) && (
        <p className="flex items-center gap-2">
          <User className="h-3 w-3 shrink-0" />
          Manager: {getManagerName(store.managerStaffId, store.id)}
        </p>
      )}
      {currentStore?.id === store.id && (
        <p className="mt-2 text-xs text-primary font-medium">Currently Selected</p>
      )}
    </CardContent>
  );

  return (
    <>
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
          ) : activeStores.length === 0 ? (
            <p className="text-muted-foreground">
              No stores set up yet. Click "Add Store" to create your first store location.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeStores.map((store) => (
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
                          onClick={() => setArchivingStore(store)}
                          disabled={activeStores.length === 1}
                          title={activeStores.length === 1 ? "You must have at least one active store" : "Archive store"}
                          data-testid={`button-archive-store-${store.id}`}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {renderStoreDetails(store)}
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {archivedStores.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Archived Stores
            </CardTitle>
            <CardDescription>
              Hidden from day-to-day use, but their data is untouched. Restore a store to bring it back, or permanently
              delete it once it has no customers, staff, or inventory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archivedStores.map((store) => (
                <Card key={store.id} className="relative opacity-80" data-testid={`card-archived-store-${store.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base truncate" data-testid={`text-archived-store-name-${store.id}`}>
                            {store.name}
                          </CardTitle>
                          <Badge variant="secondary">Archived</Badge>
                        </div>
                        <CardDescription className="font-mono text-xs">Code: {store.code}</CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRestoringStore(store)}
                          title="Restore store"
                          data-testid={`button-restore-store-${store.id}`}
                        >
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingStore(store)}
                          title="Permanently delete store"
                          data-testid={`button-delete-store-${store.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {renderStoreDetails(store)}
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!archivingStore}
        onOpenChange={() => setArchivingStore(null)}
        title="Archive Store"
        description={`Are you sure you want to archive "${archivingStore?.name}"? It will be hidden from the store switcher and reports, but its customers, staff, and inventory stay exactly as they are. You can restore it anytime.`}
        onConfirm={handleArchiveStore}
        confirmText="Archive Store"
      />

      <ConfirmDialog
        open={!!restoringStore}
        onOpenChange={() => setRestoringStore(null)}
        title="Restore Store"
        description={`Restore "${restoringStore?.name}"? It will reappear in the store switcher and become selectable again.`}
        onConfirm={handleRestoreStore}
        confirmText="Restore Store"
      />

      <ConfirmDialog
        open={!!deletingStore}
        onOpenChange={() => setDeletingStore(null)}
        title="Permanently Delete Store"
        description={`Are you sure you want to permanently delete "${deletingStore?.name}"? This cannot be undone. You can only delete a store if it has no customers, staff, or inventory.`}
        onConfirm={handleDeleteStore}
        confirmText="Delete Permanently"
        isDestructive
      />
    </>
  );
}
