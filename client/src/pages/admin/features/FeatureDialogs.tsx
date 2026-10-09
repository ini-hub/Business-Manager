import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { isPriced, type FeatureRow } from "./featureRow";

const CATALOG_KEY = ["/api/admin/feature-catalog"];

async function post(path: string, body: unknown, fallback: string) {
  const res = await apiRequest("POST", path, body);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

export function PublishDialog({ feature, onClose }: { feature: FeatureRow; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const priced = isPriced(feature.tier);
  const [monthly, setMonthly] = useState(feature.price != null ? String(feature.price) : "");
  const [annual, setAnnual] = useState("");

  const mutation = useMutation({
    mutationFn: () => post(`/api/admin/feature-catalog/${feature.id}/publish`, {
      priceMonthly: monthly.trim() === "" ? null : Number(monthly),
      priceAnnual: annual.trim() === "" ? null : Number(annual),
    }, "Failed to publish this feature"),
    onSuccess: (body) => {
      toast({
        title: "Feature published",
        description: body.grandfathered
          ? `Now live. ${body.grandfathered} existing business${body.grandfathered === 1 ? "" : "es"} keep it free.`
          : "Now live and purchasable.",
      });
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't publish this feature", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Publish "{feature.name}"</DialogTitle>
          <DialogDescription>
            {feature.description || "This feature was added by a release."} It is hidden until you publish it. Once live, businesses can see and buy it{priced ? " at the price below" : ""}.
          </DialogDescription>
        </DialogHeader>
        {priced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-2">
            <div className="space-y-1">
              <Label className="text-xs">Monthly price ({feature.currency})</Label>
              <Input type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Annual price ({feature.currency})</Label>
              <Input type="number" min={0} value={annual} onChange={(e) => setAnnual(e.target.value)} className="rounded-xl" />
            </div>
          </div>
        )}
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={mutation.isPending || (priced && monthly.trim() === "")} onClick={() => mutation.mutate()}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface SunsetInfo { scheduled: boolean; effectiveAt: string | null; eligibleOrgs: number; scheduledOrgs: number }

export const sunsetKey = (featureId: string) => ["/api/admin/feature-catalog", "sunset", featureId];

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export function SunsetDialog({ feature, state, onClose }: { feature: FeatureRow; state?: SunsetInfo; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const rescheduling = !!state?.scheduled;
  const reach = rescheduling ? state!.scheduledOrgs : state?.eligibleOrgs;

  const mutation = useMutation({
    mutationFn: () => post(`/api/admin/feature-catalog/${feature.id}/schedule-sunset`, { paywallEffectiveAt: date }, "Failed to schedule this transition"),
    onSuccess: (body) => {
      toast({
        title: rescheduling ? "Sunset rescheduled" : "Sunset scheduled",
        description: `${body.affectedOrgs} business${body.affectedOrgs === 1 ? "" : "es"} will be reminded on a staged 30/7/1-day schedule.`,
      });
      queryClient.invalidateQueries({ queryKey: sunsetKey(feature.id) });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't schedule this transition", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{rescheduling ? "Reschedule" : "Schedule"} "{feature.name}" {rescheduling ? "sunset" : "to become paid"}</DialogTitle>
          <DialogDescription>
            {reach != null && (
              <strong className="block text-foreground mb-1">
                {reach} business{reach === 1 ? "" : "es"} {rescheduling ? "are on notice" : "use this for free and would be put on notice"}.
              </strong>
            )}
            They get staged reminders (30, 7 and 1 day out, plus the day of) before it moves behind the paywall. Nothing changes until the date arrives, and paying at any point keeps it active without interruption.
            {rescheduling && " Reminders restart against the new date."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 my-2">
          <Label className="text-xs">Paywall effective date (minimum 30 days out)</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl" />
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!date || mutation.isPending} onClick={() => mutation.mutate()}>{rescheduling ? "Reschedule" : "Schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelSunsetDialog({ feature, state, onClose }: { feature: FeatureRow; state: SunsetInfo; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/feature-catalog/${feature.id}/schedule-sunset`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel this transition");
      return data;
    },
    onSuccess: (body) => {
      toast({ title: "Sunset cancelled", description: `${body.restoredOrgs} business${body.restoredOrgs === 1 ? "" : "es"} keep it free.` });
      queryClient.invalidateQueries({ queryKey: sunsetKey(feature.id) });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't cancel the sunset", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Cancel the sunset for "{feature.name}"?</DialogTitle>
          <DialogDescription>
            {state.scheduledOrgs} business{state.scheduledOrgs === 1 ? "" : "es"} keep it free and stop getting reminders. Notices already sent stay sent; their on-screen announcements expire on {fmtDate(state.effectiveAt)}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Keep the sunset</Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Cancel sunset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
