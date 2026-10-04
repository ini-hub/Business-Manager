import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { IconButton } from "@/components/icon-button";
import { getFeatureDef } from "@shared/features";
import { formatCurrency } from "@/lib/currency-utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Store, Pencil, Archive, ArchiveRestore, Trash2, Star } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import type { Store as StoreType, Staff } from "@shared/schema";
import { getTimezoneOffset } from "@/lib/timezones";
import { getCountryByCode } from "@/lib/currency-utils";
import { fetchAllStaff } from "@/lib/staff-api";

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
    setMainStore,
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
          staffByStore[store.id] = await fetchAllStaff<Staff>(store.id);
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

  const handleSetMainStore = async (store: StoreType) => {
    try {
      await setMainStore(store.id);
      toast({ title: `"${store.name}" is now your main store` });
    } catch (error) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const addon = getFeatureDef("store_addon");
  const extraStorePrice = addon?.price?.monthly;

  const Chip = ({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "blue" | "green" }) => (
    <span
      className={
        "rounded px-2 py-0.5 text-xs font-medium " +
        (tone === "blue" ? "bg-primary/10 text-primary" : tone === "green" ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300" : "bg-muted text-muted-foreground")
      }
    >
      {children}
    </span>
  );

  const placeLine = (store: StoreType) => {
    const tz = (store as any).timezone || "Africa/Lagos";
    return `${getCountryByCode(store.country || "NG")?.name || "Nigeria"} · ${store.currency || "NGN"} · ${tz} (UTC${getTimezoneOffset(tz)})`;
  };
  const contactLine = (store: StoreType) =>
    [store.address, store.phone ? `${store.phoneCountryCode || "+234"} ${store.phone}` : ""].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="font-semibold">Your stores</h2>
        {!business ? (
          <p className="mt-2 text-sm text-muted-foreground">Set up your business details first, then add stores.</p>
        ) : activeStores.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No stores yet. Add your first store location.</p>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {activeStores.map((store) => {
              const manager = store.managerStaffId ? getManagerName(store.managerStaffId, store.id) : null;
              const contact = contactLine(store);
              const rows: { label: string; value: React.ReactNode }[] = [
                { label: "Location", value: placeLine(store) },
                { label: "Contact", value: contact ? contact : <span className="text-muted-foreground">No address or phone yet</span> },
                {
                  label: "Manager",
                  value: manager ? <span className="font-medium">{manager}</span> : <span className="font-medium text-amber-800 dark:text-amber-300">No manager</span>,
                },
              ];
              return (
                <li
                  key={store.id}
                  className={"flex min-w-0 flex-col rounded-lg border p-4 " + (store.isMain ? "border-primary/40 bg-primary/[0.03]" : "bg-background")}
                  data-testid={`card-store-${store.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Store className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold" data-testid={`text-store-name-${store.id}`}>{store.name}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span data-testid={`text-store-code-${store.id}`}><Chip>{store.code}</Chip></span>
                      </div>
                    </div>
                    <div className="-mr-2 -mt-1 flex shrink-0">
                      {store.isMain ? (
                        <span
                          className="flex size-10 items-center justify-center"
                          title="Main store"
                          role="img"
                          aria-label="Main store"
                          data-testid={`badge-main-store-${store.id}`}
                        >
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                        </span>
                      ) : (
                        <IconButton label={`Make ${store.name} the main store`} variant="ghost" onClick={() => handleSetMainStore(store)} data-testid={`button-set-main-store-${store.id}`}>
                          <Star className="h-4 w-4" />
                        </IconButton>
                      )}
                      <IconButton label={`Edit ${store.name}`} variant="ghost" onClick={() => openEditStore(store)} data-testid={`button-edit-store-${store.id}`}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      {!store.isMain && (
                        <IconButton
                          label={activeStores.length === 1 ? "You must keep at least one active store" : `Archive ${store.name}`}
                          variant="ghost"
                          onClick={() => setArchivingStore(store)}
                          disabled={activeStores.length === 1}
                          data-testid={`button-archive-store-${store.id}`}
                        >
                          <Archive className="h-4 w-4" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <dl className="mt-4 divide-y border-t text-[13px]">
                    {rows.map((r) => (
                      <div key={r.label} className="grid gap-0.5 py-3 sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3">
                        <dt className="text-xs font-medium text-muted-foreground sm:pt-px">{r.label}</dt>
                        <dd className="min-w-0 break-words">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {store.isMain && <p className="mt-auto border-t pt-3 text-xs text-muted-foreground">Your main store can't be archived.</p>}
                </li>
              );
            })}
          </ul>
        )}
        {extraStorePrice != null && (
          <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
            Your first store is included. After your trial, each extra store is {formatCurrency(extraStorePrice, "NGN")} a month.{" "}
            <Link href="/settings/billing" className="font-medium text-primary underline">See plan</Link>
          </p>
        )}
      </section>

      {archivedStores.length > 0 && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Archived stores</h2>
          <p className="text-sm text-muted-foreground">
            Hidden from day-to-day use, with their data untouched. Restore one to bring it back, or delete it for good once it has no customers, staff or stock.
          </p>
          <ul className="mt-3 divide-y">
            {archivedStores.map((store) => (
              <li key={store.id} className="flex items-center gap-3 py-3" data-testid={`card-archived-store-${store.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" data-testid={`text-archived-store-name-${store.id}`}>{store.name}</span>
                    <Chip>{store.code}</Chip>
                    <Chip>Archived</Chip>
                  </div>
                  <p className="text-sm text-muted-foreground">{placeLine(store)}</p>
                </div>
                <IconButton label={`Restore ${store.name}`} variant="ghost" onClick={() => setRestoringStore(store)} data-testid={`button-restore-store-${store.id}`}>
                  <ArchiveRestore className="h-4 w-4" />
                </IconButton>
                <IconButton label={`Delete ${store.name} for good`} variant="ghost" onClick={() => setDeletingStore(store)} data-testid={`button-delete-store-${store.id}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
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
    </div>
  );
}
