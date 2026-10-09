import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type CustomerOption = { id: string; name: string; mobileNumber?: string | null };

interface Props {
  storeId: string;
  /** Selected customer id, or "" for none. */
  value: string;
  onChange: (customerId: string) => void;
  noneLabel?: string;
}

/**
 * Picks a customer by typing: each search asks the server for a short page of matches (name, number or phone),
 * so the picker never loads the whole customer list.
 */
export function CustomerSearchSelect({ storeId, value, onChange, noneLabel = "Walk-in / General" }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const search = useDebounce(term.trim(), 250);

  const { data: matches = [], isFetching } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", storeId, "picker", search],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId, limit: "20", page: "1" });
      if (search) params.set("search", search);
      const res = await apiRequest("GET", `/api/customers?${params}`);
      return (await res.json()).data ?? [];
    },
    enabled: open && !!storeId,
    staleTime: 30_000,
  });

  // The current choice may not be among the matches (or the list may be closed), so its name is read on its own.
  const { data: selected } = useQuery<CustomerOption | null>({
    queryKey: ["/api/customers", value, "picker-selected"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/customers/${value}`);
      return res.json();
    },
    enabled: !!value,
    staleTime: 60_000,
  });

  const label = !value ? noneLabel : selected ? `${selected.name} (${selected.mobileNumber || "No Phone"})` : "Loading…";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* The server does the matching, so cmdk's own filtering is off. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name or phone…" value={term} onValueChange={setTerm} />
          <CommandList>
            <CommandItem value="__none" onSelect={() => { onChange(""); setOpen(false); }}>
              <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
              {noneLabel}
            </CommandItem>
            {matches.map((c) => (
              <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c.id); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                {c.name} ({c.mobileNumber || "No Phone"})
              </CommandItem>
            ))}
            {!isFetching && matches.length === 0 && <CommandEmpty>No customers found.</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
