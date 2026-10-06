import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Store as StoreIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { useEntitlements } from "@/hooks/useEntitlements";
import { openBilling } from "@/lib/upgrade-prompt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Owner-only. A trial may open extra stores; once it (and its grace) ends, the plan covers `limit` of them. While more
 * are active than that, this shows a pill that opens the chooser: keep up to `limit` stores active (the rest are
 * archived, never deleted) or buy Additional Store to keep them all.
 */
export function StoreChoice() {
  const { storeCount } = useEntitlements();
  const { stores } = useStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const active = stores.filter((s) => s.isActive !== false);
  const [keep, setKeep] = useState<string[]>([]);

  const overCap = !!storeCount && !storeCount.unlimited && storeCount.used > storeCount.limit;
  const limit = storeCount?.limit ?? 1;

  const choose = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stores/choose-active", { keepStoreIds: keep })).json(),
    onSuccess: () => {
      toast({ title: "Stores updated", description: "The others are archived. You can bring them back any time with Additional Store." });
      setOpen(false);
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast({ title: "Couldn't update your stores", description: error.message, variant: "destructive" }),
  });

  if (!overCap) return null;

  const toggle = (id: string) =>
    setKeep((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : prev.length < limit ? [...prev, id] : prev));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKeep(active.filter((s) => s.isMain).map((s) => s.id).slice(0, limit));
          setOpen(true);
        }}
        data-testid="button-choose-stores"
        className="flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20"
      >
        <StoreIcon className="h-3.5 w-3.5" />
        Choose your stores
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your plan covers {limit} store{limit === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              You have {active.length} active. Pick the {limit === 1 ? "one" : `up to ${limit}`} to keep working in. The others are archived, not deleted, and come back when you add Additional Store.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {active.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50">
                <Checkbox checked={keep.includes(s.id)} onCheckedChange={() => toggle(s.id)} data-testid={`choose-store-${s.id}`} />
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                {s.isMain && <Badge variant="secondary">Main</Badge>}
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => { setOpen(false); openBilling(navigate); }}>Keep all - view plans</Button>
            <Button onClick={() => choose.mutate()} disabled={choose.isPending || keep.length === 0}>
              {choose.isPending ? "Saving..." : `Keep ${keep.length} store${keep.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
