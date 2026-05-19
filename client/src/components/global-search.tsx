import * as React from "react";
import { useLocation } from "wouter";
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
import { Search, Users, Package, Receipt, ArrowRight } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();

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

  const { data: results, isLoading } = useQuery({
    queryKey: ["/api/search", debouncedQuery, currentStore?.id],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return null;
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}&storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && debouncedQuery.length >= 2 && !!currentStore?.id,
  });

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

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput 
          placeholder="Search customers, products, transactions..." 
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isLoading ? "Searching..." : "No results found."}
          </CommandEmpty>
          
          {results?.customers?.length > 0 && (
            <CommandGroup heading="Customers">
              {results.customers.map((c: any) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => runCommand(() => setLocation(`/customers/${c.id}`))}
                >
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{c.name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">{c.customerNumber}</Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {results?.inventory?.length > 0 && (
            <CommandGroup heading="Inventory">
              {results.inventory.map((i: any) => (
                <CommandItem
                  key={i.id}
                  onSelect={() => runCommand(() => setLocation(`/inventory/${i.id}`))}
                >
                  <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{i.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground capitalize">{i.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {results?.transactions?.length > 0 && (
            <CommandGroup heading="Transactions">
              {results.transactions.map((t: any) => (
                <CommandItem
                  key={t.id}
                  onSelect={() => runCommand(() => setLocation(`/transactions`))}
                >
                  <Receipt className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{t.receiptNumber}</span>
                  <span className="ml-auto text-xs font-mono">{t.totalPrice}</span>
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
