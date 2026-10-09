import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Heart, LifeBuoy, CreditCard, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, markIntentionalLogout } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";

const REASONS: { value: string; label: string }[] = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "missing_features", label: "It's missing features I need" },
  { value: "too_complicated", label: "It's too complicated to use" },
  { value: "switching_tool", label: "I'm switching to another tool" },
  { value: "closing_business", label: "I'm closing or pausing my business" },
  { value: "bugs_or_reliability", label: "Bugs or reliability problems" },
  { value: "poor_support", label: "I didn't get the support I needed" },
  { value: "created_by_mistake", label: "I created this business by mistake" },
  { value: "other", label: "Something else" },
];

type Step = "convince" | "survey" | "confirm";

export function DeleteBusinessDialog({ open, onOpenChange, businessName }: { open: boolean; onOpenChange: (o: boolean) => void; businessName: string }) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("convince");
  const [reasons, setReasons] = useState<string[]>([]);
  const [details, setDetails] = useState("");
  const [wouldReturn, setWouldReturn] = useState<"yes" | "maybe" | "no" | "">("");
  const [contactOk, setContactOk] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setStep("convince");
      setConfirmName("");
    }
  };

  const toggleReason = (value: string, on: boolean) => setReasons((r) => (on ? [...r, value] : r.filter((x) => x !== value)));
  const nameMatches = confirmName.trim().toLowerCase() === businessName.trim().toLowerCase();

  const del = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/business/delete", {
        confirmName,
        reasons,
        details: details.trim() || undefined,
        wouldReturn: wouldReturn || undefined,
        contactOk,
      });
      return res.json();
    },
    onSuccess: () => {
      markIntentionalLogout();
      queryClient.clear();
      window.location.href = "/";
    },
    onError: (error: unknown) => {
      toast({ title: "Couldn't delete the business", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg" data-testid="dialog-delete-business">
        {step === "convince" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Heart className="h-5 w-5 text-rose-500" /> We're sad to see you go</DialogTitle>
              <DialogDescription>
                {businessName} is more than a record of sales — it's the work you've put in. Before you decide, a few things that might help.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3 rounded-md border p-3">
                <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p><strong>Something not working?</strong> Tell our support team from Help &amp; Support. Most problems get fixed fast, and we'd rather help than lose you.</p>
              </div>
              <div className="flex gap-3 rounded-md border p-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p><strong>Is it the cost?</strong> You can switch to a cheaper plan or drop add-ons from Settings → Billing instead of closing everything.</p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="font-medium">If you delete it:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>You and your staff are signed out and can't open this business again.</li>
                  <li>Subscription renewals stop.</li>
                  <li>Your records aren't wiped straight away, but only our team can bring them back.</li>
                </ul>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setStep("survey")} data-testid="button-delete-continue">I still want to delete it</Button>
              <Button onClick={() => close(false)} data-testid="button-delete-keep">Keep my business</Button>
            </DialogFooter>
          </>
        )}

        {step === "survey" && (
          <>
            <DialogHeader>
              <DialogTitle>Why are you leaving?</DialogTitle>
              <DialogDescription>Your honest answer helps us improve for the next business owner. It takes a few seconds.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Pick all that apply</Label>
                {REASONS.map((r) => (
                  <label key={r.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={reasons.includes(r.value)} onCheckedChange={(c) => toggleReason(r.value, c === true)} data-testid={`checkbox-reason-${r.value}`} />
                    {r.label}
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delete-details">Anything else you'd like us to know? (optional)</Label>
                <Textarea id="delete-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} data-testid="input-delete-details" />
              </div>
              <div className="space-y-1.5">
                <Label>Would you consider coming back?</Label>
                <RadioGroup value={wouldReturn} onValueChange={(v) => setWouldReturn(v as any)} className="flex gap-4">
                  {[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1.5 text-sm"><RadioGroupItem value={v} /> {l}</label>
                  ))}
                </RadioGroup>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={contactOk} onCheckedChange={(c) => setContactOk(c === true)} />
                You may contact me about this feedback
              </label>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => close(false)}>Keep my business</Button>
              <Button disabled={reasons.length === 0} onClick={() => setStep("confirm")} data-testid="button-survey-next">Continue</Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" /> Delete {businessName}?</DialogTitle>
              <DialogDescription>Type the business name to confirm. You'll be signed out straight away.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm-name">Business name</Label>
              <Input id="delete-confirm-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={businessName} autoComplete="off" data-testid="input-delete-confirm-name" />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setStep("survey")}>Back</Button>
              <Button variant="destructive" disabled={!nameMatches || del.isPending} onClick={() => del.mutate()} data-testid="button-delete-confirm">
                {del.isPending ? "Deleting…" : "Delete business"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
