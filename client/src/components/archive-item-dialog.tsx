import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type WriteOffReason = "damaged" | "expired" | "lost_or_stolen" | "other";

export interface WriteOffRequest {
  reason: WriteOffReason;
  note: string;
  recordAsLoss: boolean;
}

/** The one stocked row a write-off would apply to. Pass null when archiving a group or an item with no stock. */
export interface WriteOffTarget {
  quantity: number;
  costPrice: number;
  type?: string | null;
  costingMode?: string | null;
}

const REASONS: { value: WriteOffReason; label: string }[] = [
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "lost_or_stolen", label: "Lost or stolen" },
  { value: "other", label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  writeOffTarget: WriteOffTarget | null;
  formatCurrency: (value: number) => string;
  isPending: boolean;
  onArchive: () => void;
  onWriteOffAndArchive: (request: WriteOffRequest) => void;
}

/**
 * Archive confirmation that can also write off the remaining stock in the same step. Writing off is
 * offered only for a single stocked row; the stock on a product group is written off per variant.
 */
export function ArchiveItemDialog({
  open, onOpenChange, title, description, writeOffTarget, formatCurrency, isPending, onArchive, onWriteOffAndArchive,
}: Props) {
  const [writeOff, setWriteOff] = useState(false);
  const [reason, setReason] = useState<WriteOffReason>("damaged");
  const [note, setNote] = useState("");
  const [recordAsLoss, setRecordAsLoss] = useState(true);

  useEffect(() => {
    if (open) { setWriteOff(false); setReason("damaged"); setNote(""); setRecordAsLoss(true); }
  }, [open]);

  const canWriteOff = !!writeOffTarget && writeOffTarget.type !== "service" && writeOffTarget.quantity > 0;
  // An expensed supply was charged to the P&L when it was bought, so there is no cost left to book.
  const alreadyCharged = writeOffTarget?.type === "supply" && (writeOffTarget.costingMode ?? "expensed") === "expensed";
  const loss = canWriteOff ? writeOffTarget!.quantity * writeOffTarget!.costPrice : 0;
  const noteMissing = writeOff && reason === "other" && !note.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-amber-500" />
            {title}
          </DialogTitle>
          <DialogDescription className="pt-1">{description}</DialogDescription>
        </DialogHeader>

        {canWriteOff && (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox id="archive-write-off" checked={writeOff} onCheckedChange={(v) => setWriteOff(v === true)} />
              <Label htmlFor="archive-write-off" className="text-sm leading-snug">
                Write off the remaining stock too
              </Label>
            </div>

            {writeOff && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Select value={reason} onValueChange={(v) => setReason(v as WriteOffReason)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="write-off-note">Note{reason === "other" ? "" : " (optional)"}</Label>
                  <Textarea id="write-off-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {alreadyCharged ? (
                  <p className="text-xs text-muted-foreground">
                    This supply was charged to your profit and loss when you bought it, so writing it off won't add another cost.
                  </p>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <Label htmlFor="write-off-loss" className="text-sm leading-snug">
                      Record {loss > 0 ? formatCurrency(loss) : "the cost"} as a loss in profit and loss
                    </Label>
                    <Switch id="write-off-loss" checked={recordAsLoss} onCheckedChange={setRecordAsLoss} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  The stock goes to zero and this can't be reversed. You can still restock the item if you restore it.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            disabled={isPending || noteMissing}
            onClick={() => (writeOff && canWriteOff ? onWriteOffAndArchive({ reason, note: note.trim(), recordAsLoss: recordAsLoss && !alreadyCharged }) : onArchive())}
          >
            {isPending ? "Working…" : writeOff && canWriteOff ? "Write off & archive" : "Archive"}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
