import * as React from "react";
import { useLocation, useSearch } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useStore } from "@/lib/store-context";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, Package, Receipt } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { appendReturnTo } from "@/lib/return-to";
import { formatCurrency } from "@/lib/currency-utils";

const MIN_QUERY_LENGTH = 2;

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { currentStore, stores } = useStore();

  // Results from the consolidated view span stores, so each row has to say
  // which one it came from.
  const isConsolidated = currentStore?.id === "all";
  const storeNameById = React.useMemo(
    () => new Map(stores.map((s) => [s.id, s.name])),
    [stores],
  );

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const { data: results, isLoading, isError } = useQuery({
    queryKey: ["/api/search", debouncedQuery, currentStore?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&storeId=${currentStore?.id}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && debouncedQuery.length >= MIN_QUERY_LENGTH && !!currentStore?.id,
  });

  const customers = results?.customers ?? [];
  const inventory = results?.inventory ?? [];
  const transactions = results?.transactions ?? [];

  // The debounce means the input can be ahead of the results by ~300ms; treat
  // that gap as loading so the palette never flashes "no results" mid-typing.
  const isPending = isLoading || (query.trim() !== debouncedQuery && query.trim().length >= MIN_QUERY_LENGTH);

  const emptyMessage = query.trim().length < MIN_QUERY_LENGTH
    ? `Type at least ${MIN_QUERY_LENGTH} characters to search`
    : isPending
      ? "Searching..."
      : isError
        ? "Search is unavailable right now"
        : "No results found.";

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 rounded-md border border-input hover:bg-muted transition-colors w-full max-w-[200px]"
      >
        <Search className="h-3 w-3" />
        <span>Search...</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 ml-auto">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* The server has already matched the query — letting cmdk filter again
          would drop every result, since items that mount while the input is
          non-empty are scored before they can register a value. */}
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput
          placeholder="Search customers, products, transactions..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>

          {customers.length > 0 && (
            <CommandGroup heading="Customers">
              {customers.map((c: any) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => runCommand(() => setLocation(appendReturnTo(`/customers/${c.id}`, location, search)))}
                >
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className={c.isArchived ? "text-muted-foreground" : undefined}>{c.name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">{c.customerNumber}</Badge>
                  {c.isArchived && (
                    <Badge className="ml-1 text-[10px] bg-muted text-muted-foreground">Archived</Badge>
                  )}
                  {c.mobileNumber && (
                    <span className="ml-2 text-xs text-muted-foreground">{c.mobileNumber}</span>
                  )}
                  {isConsolidated && (
                    <span className="ml-auto pl-2 text-xs text-muted-foreground">{storeNameById.get(c.storeId)}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {inventory.length > 0 && (
            <CommandGroup heading="Inventory">
              {inventory.map((i: any) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  onSelect={() => runCommand(() => setLocation(`/inventory/${i.id}`))}
                >
                  <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{i.name}</span>
                  {i.sku && <span className="ml-2 text-xs text-muted-foreground">{i.sku}</span>}
                  <span className="ml-auto pl-2 text-xs text-muted-foreground capitalize">
                    {isConsolidated ? `${storeNameById.get(i.storeId)} · ${i.type}` : i.type}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {transactions.length > 0 && (
            <CommandGroup heading="Transactions">
              {transactions.map((t: any) => (
                <CommandItem
                  key={t.id}
                  value={t.id}
                  onSelect={() => runCommand(() => setLocation(appendReturnTo(`/transactions/${t.id}`, location, search)))}
                >
                  <Receipt className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{t.receiptNumber}</span>
                  {t.customerName && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">{t.customerName}</span>
                  )}
                  <span className="ml-auto pl-2 text-xs font-mono">
                    {formatCurrency(Number(t.totalPrice), currentStore?.currency ?? "NGN")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function Badge({ children, variant, className }: any) {
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${variant === 'outline' ? 'border border-input' : ''} ${className}`}>
      {children}
    </span>
  );
}
