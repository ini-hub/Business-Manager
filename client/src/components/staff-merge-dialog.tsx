import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/error-utils";
import { formatCurrency } from "@/lib/currency-utils";
import { summarise, payLabel } from "@/lib/staff-merge";

export type MergeMember = {
  id: string;
  storeId: string;
  storeName: string;
  /** The member's own store currency: pay is never shown in another store's currency. */
  currency: string;
  name: string;
  email: string;
  staffNumber: string;
  payPerMonth: number;
  isArchived: boolean;
};
export type MergeGroup = { userId: string; suggestedSurvivorId: string; members: MergeMember[] };
type MergeReport = {
  ok: boolean;
  dryRun: boolean;
  moved: Record<string, number>;
  discarded: Record<string, number>;
  payDifferences: string[];
  conflicts: Array<{ code: string; detail: string }>;
};

export function StaffMergeDialog({
  open, onOpenChange, groups, isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: MergeGroup[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{ survivorId: string; loserId: string; report: MergeReport } | null>(null);
  const [payFrom, setPayFrom] = useState<"survivor" | "loser">("survivor");

  const survivorOf = (g: MergeGroup) => survivors[g.userId] ?? g.suggestedSurvivorId;
  const find = (id: string) => groups.flatMap((g) => g.members).find((m) => m.id === id);

  const run = useMutation({
    mutationFn: async (vars: { survivorId: string; loserId: string; dryRun: boolean; payFrom?: "survivor" | "loser" }) => {
      const res = await apiRequest("POST", "/api/staff/merge", vars);
      return (await res.json()) as MergeReport;
    },
    onSuccess: (report, vars) => {
      if (vars.dryRun) {
        setReview({ survivorId: vars.survivorId, loserId: vars.loserId, report });
        return;
      }
      if (!report.ok) {
        setReview({ survivorId: vars.survivorId, loserId: vars.loserId, report });
        return;
      }
      toast({ title: "Staff records merged" });
      setReview(null);
      setPayFrom("survivor");
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/merge-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't merge these records", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const close = (next: boolean) => {
    if (!next) { setReview(null); setPayFrom("survivor"); }
    onOpenChange(next);
  };

  const survivor = review ? find(review.survivorId) : undefined;
  const loser = review ? find(review.loserId) : undefined;
  const needsPayChoice = !!review && review.report.payDifferences.length > 0;
  const blocking = review?.report.conflicts.filter((c) => c.code !== "pay_differs") ?? [];
  const canConfirm = !!review && blocking.length === 0 && (!needsPayChoice || !!payFrom);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-staff-merge">
        {!review ? (
          <>
            <DialogHeader>
              <DialogTitle>Merge duplicate staff</DialogTitle>
              <DialogDescription>
                These people have a separate staff record in each store. Merging keeps one record, moves all of
                its history across, and keeps the other store as an additional store for that person.
              </DialogDescription>
            </DialogHeader>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Looking for duplicates…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-duplicates">No duplicate staff records found.</p>
            ) : (
              <div className="space-y-4">
                {groups.map((g) => {
                  const keep = survivorOf(g);
                  return (
                    <div key={g.userId} className="rounded-md border p-3 space-y-3" data-testid={`merge-group-${g.userId}`}>
                      <RadioGroup value={keep} onValueChange={(v) => setSurvivors((s) => ({ ...s, [g.userId]: v }))}>
                        {g.members.map((m) => (
                          <div key={m.id} className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <RadioGroupItem value={m.id} id={`keep-${m.id}`} aria-label={`Keep ${m.name} at ${m.storeName}`} />
                              <Label htmlFor={`keep-${m.id}`} className="min-w-0">
                                <span className="font-medium">{m.name}</span>
                                <span className="text-muted-foreground"> · {m.storeName} · {m.staffNumber} · {formatCurrency(m.payPerMonth, m.currency)}</span>
                              </Label>
                              {m.isArchived && <Badge variant="secondary">Archived</Badge>}
                              {m.id === keep && <Badge>Keep</Badge>}
                            </div>
                            {m.id !== keep && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={run.isPending}
                                onClick={() => run.mutate({ survivorId: keep, loserId: m.id, dryRun: true })}
                                data-testid={`button-review-merge-${m.id}`}
                              >
                                Review merge
                              </Button>
                            )}
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                  );
                })}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review merge</DialogTitle>
              <DialogDescription>
                {loser?.name} at {loser?.storeName} will be merged into {survivor?.name} at {survivor?.storeName}.
                This cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {blocking.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription className="space-y-1">
                  <p className="font-medium">This merge can't go ahead:</p>
                  <ul className="list-disc pl-5">
                    {blocking.map((c, i) => <li key={i}>{c.detail}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {blocking.length === 0 && (
              <div className="space-y-3 text-sm">
                {summarise(review.report.moved).length > 0 ? (
                  <div>
                    <p className="font-medium mb-1">Moved to {survivor?.name}</p>
                    <ul className="grid grid-cols-2 gap-x-4">
                      {summarise(review.report.moved).map((r) => (
                        <li key={r.label} className="flex justify-between"><span>{r.label}</span><span className="tabular-nums">{r.n}</span></li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Nothing needs moving apart from the store assignment.</p>
                )}

                {summarise(review.report.discarded).length > 0 && (
                  <Alert>
                    <AlertDescription>
                      Settings that exist on both records keep {survivor?.name}'s version:{" "}
                      {summarise(review.report.discarded).map((r) => `${r.n} ${r.label}`).join(", ")} from {loser?.name} will be dropped.
                    </AlertDescription>
                  </Alert>
                )}

                {needsPayChoice && (
                  <div className="space-y-2" data-testid="merge-pay-choice">
                    <p className="font-medium">Pay settings differ ({review.report.payDifferences.map(payLabel).join(", ")}). Which should the merged person use?</p>
                    <RadioGroup value={payFrom} onValueChange={(v) => setPayFrom(v as "survivor" | "loser")}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="survivor" id="pay-survivor" />
                        <Label htmlFor="pay-survivor">{survivor?.name} at {survivor?.storeName} ({survivor ? formatCurrency(survivor.payPerMonth, survivor.currency) : ""})</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="loser" id="pay-loser" />
                        <Label htmlFor="pay-loser">{loser?.name} at {loser?.storeName} ({loser ? formatCurrency(loser.payPerMonth, loser.currency) : ""})</Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setReview(null)} disabled={run.isPending}>Back</Button>
              <Button
                disabled={!canConfirm || run.isPending}
                onClick={() => review && run.mutate({
                  survivorId: review.survivorId,
                  loserId: review.loserId,
                  dryRun: false,
                  payFrom: needsPayChoice ? payFrom : undefined,
                })}
                data-testid="button-confirm-merge"
              >
                {run.isPending ? "Merging…" : "Merge records"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Owner-only: the duplicates list, kept in one place so the page can show a count on its button. */
export function useStaffMergeCandidates(enabled: boolean) {
  return useQuery<{ groups: MergeGroup[] }>({
    queryKey: ["/api/staff/merge-candidates"],
    enabled,
  });
}
