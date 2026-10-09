import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";

export interface PickedOrg { id: string; name: string }

/** Search real businesses and keep them as removable chips. Ids are never typed by hand. */
export function OrgPicker({
  value, onChange, disabled,
}: {
  value: PickedOrg[];
  onChange: (next: PickedOrg[]) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q.trim(), 250);
  const picked = new Set(value.map((o) => o.id));

  const { data, isFetching } = useQuery({
    queryKey: ["/api/admin/organisations-search", debounced],
    queryFn: async () => (await apiRequest("GET", `/api/admin/organisations-search?q=${encodeURIComponent(debounced)}`)).json(),
    enabled: debounced.length >= 2,
  });
  const results = ((data?.organisations ?? []) as PickedOrg[]).filter((o) => !picked.has(o.id));

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Businesses in scope">
          {value.map((o) => (
            <li key={o.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary pl-3 pr-1 py-1 text-sm font-semibold">
              <span className="break-all">{o.name}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v.id !== o.id))}
                  className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-primary/20"
                  aria-label={`Remove ${o.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 rounded-xl bg-background"
            placeholder="Find a business by name or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find a business"
          />
          {debounced.length >= 2 && (
            <div className="mt-1 rounded-xl border border-border bg-card shadow-sm overflow-hidden" role="listbox" aria-label="Matching businesses">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">{isFetching ? "Searching…" : "No other business matches."}</p>
              ) : (
                results.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onChange([...value, o]); setQ(""); }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60 focus-visible:bg-muted/60 outline-none"
                  >
                    {o.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
