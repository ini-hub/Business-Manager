import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchAllStaff } from "@/lib/staff-api";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_PERFORMERS = 3; // lead + two assistants, same cap as checkout

export interface PerformedByLine {
  checkoutId: string;
  serviceName: string;
  /** Lead first, then assistants — the order stored on the checkout row. */
  staffIds: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutId: string;
  storeId: string;
  lines: PerformedByLine[];
  onSaved?: () => void;
}

export function PerformedByDialog({ open, onOpenChange, checkoutId, storeId, lines, onSaved }: Props) {
  const { toast } = useToast();
  const [selection, setSelection] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (open) setSelection(Object.fromEntries(lines.map((l) => [l.checkoutId, l.staffIds])));
  }, [open, lines]);

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", storeId],
    queryFn: () => fetchAllStaff(storeId),
    enabled: open && !!storeId,
  });

  const nameOf = (id: string) => staffList.find((s) => s.id === id)?.name ?? "Unknown";

  const toggle = (lineId: string, staffId: string) =>
    setSelection((prev) => {
      const current = prev[lineId] ?? [];
      if (current.includes(staffId)) return { ...prev, [lineId]: current.filter((x) => x !== staffId) };
      if (current.length >= MAX_PERFORMERS) return prev;
      return { ...prev, [lineId]: [...current, staffId] };
    });

  const mutation = useMutation({
    mutationFn: async () => {
      const assignments = lines.map((l) => ({ checkoutId: l.checkoutId, staffIds: selection[l.checkoutId] ?? [] }));
      const res = await apiRequest("PATCH", `/api/transactions/${checkoutId}/staff`, { assignments });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Performed by updated" });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const incomplete = lines.some((l) => (selection[l.checkoutId] ?? []).length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct performed by</DialogTitle>
          <DialogDescription>
            Pick everyone who did each service — the first person is the lead, the rest assist.
            Commission follows this. Not possible once the sale is in a finalized payroll period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {lines.map((line) => {
            const chosen = selection[line.checkoutId] ?? [];
            return (
              <div key={line.checkoutId} className="space-y-1.5">
                <p className="text-sm font-medium">{line.serviceName}</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-between font-normal h-auto min-h-9", chosen.length === 0 && "border-destructive/50")}
                    >
                      <span className="flex flex-wrap gap-1 text-left">
                        {chosen.length === 0 ? (
                          <span className="text-muted-foreground">Select staff…</span>
                        ) : (
                          chosen.map((id, i) => (
                            <Badge key={id} variant={i === 0 ? "default" : "secondary"} className="font-normal">
                              {nameOf(id)}{i === 0 ? " · lead" : ""}
                            </Badge>
                          ))
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search staff…" />
                      <CommandList>
                        <CommandEmpty>Not found</CommandEmpty>
                        <CommandGroup>
                          {staffList
                            .filter((s) => !s.isArchived || chosen.includes(s.id))
                            .map((s) => (
                              <CommandItem
                                key={s.id}
                                value={s.name}
                                disabled={!chosen.includes(s.id) && chosen.length >= MAX_PERFORMERS}
                                onSelect={() => toggle(line.checkoutId, s.id)}
                              >
                                <Check className={cn("mr-2 h-4 w-4", chosen.includes(s.id) ? "opacity-100" : "opacity-0")} />
                                {s.name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || incomplete}>
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
