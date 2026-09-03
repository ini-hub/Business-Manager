import { Check, ChevronsUpDown, Store, Building2, Settings, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";
import { useStore } from "@/lib/store-context";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export function StoreSelector() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { stores: allStores, currentStore, setCurrentStore, isLoading } = useStore();
  // Archived stores are hidden here - manage them from Settings > Stores.
  const stores = allStores.filter(s => s.isActive !== false);

  if (isLoading) {
    return (
      <Button variant="outline" className="w-full justify-between" disabled>
        <span className="flex items-center gap-2">
          <Store className="h-4 w-4" />
          <span className="truncate">Loading...</span>
        </span>
      </Button>
    );
  }

  if (stores.length === 0) {
    if (user?.role === "staff") {
      return (
        <Button variant="outline" className="w-full justify-start text-muted-foreground" disabled>
          <Building2 className="mr-2 h-4 w-4 text-muted-foreground/40" />
          No stores available
        </Button>
      );
    }
    return (
      <Link href="/settings/stores">
        <Button variant="outline" className="w-full justify-start" data-testid="button-add-first-store">
          <Building2 className="mr-2 h-4 w-4" />
          Set Up Your Store
        </Button>
      </Link>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid="button-store-selector"
        >
          <span className="flex items-center gap-2 truncate">
            <Store className="h-4 w-4 shrink-0" />
            <span className="truncate">{currentStore?.name || "Select store..."}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search stores..." data-testid="input-store-search" />
          <CommandList>
            <CommandEmpty>No store found.</CommandEmpty>
            <CommandGroup heading="Stores">
              {user?.role === "owner" && stores.length > 1 && (
                <CommandItem
                  value="All Stores (Consolidated)"
                  onSelect={() => {
                    setCurrentStore({
                      id: "all",
                      name: "All Stores (Consolidated)",
                      currency: stores[0]?.currency || "NGN",
                      code: "GLOBAL",
                      businessId: stores[0]?.businessId,
                    } as any);
                    setOpen(false);
                  }}
                  data-testid="option-store-all"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentStore?.id === "all" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <Coins className="mr-2 h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="truncate">All Stores (Consolidated)</span>
                  <span className="ml-auto text-xs text-muted-foreground">GLOBAL</span>
                </CommandItem>
              )}
              {stores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={store.name}
                  onSelect={() => {
                    setCurrentStore(store);
                    setOpen(false);
                  }}
                  data-testid={`option-store-${store.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentStore?.id === store.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{store.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{store.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {user?.role !== "staff" && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <Link href="/settings/stores">
                    <CommandItem
                      onSelect={() => setOpen(false)}
                      data-testid="link-manage-stores"
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Manage Stores
                    </CommandItem>
                  </Link>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
