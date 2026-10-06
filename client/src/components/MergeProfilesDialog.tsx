import { ArrowLeftRight, Coins, MapPin, Phone, TriangleAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BrandMark } from "@/components/brand-mark";
import { Spinner } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import type { Customer, CustomerPhone } from "@shared/schema";

// Merge two customer profiles. Layout: a fixed header and footer around a scrolling body, so the
// Confirm and Cancel buttons are always reachable, including on a phone with a long comparison.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Customer | null;
  duplicate: Customer | null;
  targetPhones: CustomerPhone[];
  duplicatePhones: CustomerPhone[];
  nameChoice: string;
  onNameChoice: (name: string) => void;
  addressChoice: string;
  onAddressChoice: (address: string) => void;
  formatMoney: (value: number) => string;
  onSwap: () => void;
  onConfirm: () => void;
  isPending: boolean;
};

const phonesOf = (c: Customer, phones: CustomerPhone[]) =>
  phones.length ? phones.map((p) => p.number).join(", ") : c.mobileNumber || "";

function ProfileCard({ customer, phones, keeps, formatMoney }: { customer: Customer; phones: CustomerPhone[]; keeps: boolean; formatMoney: (n: number) => string }) {
  const phone = phonesOf(customer, phones);
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-3.5",
        keeps ? "border-primary/40 bg-primary/5" : "border-dashed bg-muted/40",
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
          keeps ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {keeps ? "Keeps" : "Retires"}
      </span>
      <p className="mt-2 truncate text-base font-semibold leading-tight">{customer.name}</p>
      <p className="text-xs text-muted-foreground">{customer.customerNumber}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-start gap-2">
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0 break-words">{phone || "—"}</dd>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0 break-words">{customer.address || "—"}</dd>
        </div>
        <div className="flex items-start gap-2">
          <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0">
            {Number(customer.loyaltyPoints || 0)} pts · {formatMoney(Number(customer.storeCreditBalance || 0))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ChoiceGroup({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { label: string; value: string; from: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Same value on both sides: nothing to choose.
  if (options[0].value === options[1].value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-sm">
        <span className="text-muted-foreground">{legend}</span>
        <span className="min-w-0 truncate font-medium">{options[0].label}</span>
      </div>
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <label
              key={o.from}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
                selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name={legend}
                checked={selected}
                onChange={() => onChange(o.value)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block break-words text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.from}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function MergeProfilesDialog({
  open,
  onOpenChange,
  target,
  duplicate,
  targetPhones,
  duplicatePhones,
  nameChoice,
  onNameChoice,
  addressChoice,
  onAddressChoice,
  formatMoney,
  onSwap,
  onConfirm,
  isPending,
}: Props) {
  const points = target && duplicate ? Number(target.loyaltyPoints || 0) + Number(duplicate.loyaltyPoints || 0) : 0;
  const credit = target && duplicate ? Number(target.storeCreditBalance || 0) + Number(duplicate.storeCreditBalance || 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b bg-primary/5 px-5 py-4 pr-12">
          <BrandMark size={36} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold leading-tight tracking-tight">Merge customer profiles</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Combine two profiles of the same customer into one. This is permanent.
            </DialogDescription>
          </div>
        </div>

        {target && duplicate && (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileCard customer={target} phones={targetPhones} keeps formatMoney={formatMoney} />
                  <ProfileCard customer={duplicate} phones={duplicatePhones} keeps={false} formatMoney={formatMoney} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="w-full text-primary" onClick={onSwap}>
                  <ArrowLeftRight className="mr-2 h-4 w-4" aria-hidden="true" /> Keep the other profile instead
                </Button>
              </div>

              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <User className="h-4 w-4 text-primary" aria-hidden="true" /> What to keep
                </h3>
                <ChoiceGroup
                  legend="Name"
                  value={nameChoice}
                  onChange={onNameChoice}
                  options={[
                    { label: target.name, value: target.name, from: "Surviving profile" },
                    { label: duplicate.name, value: duplicate.name, from: "Retiring profile" },
                  ]}
                />
                <ChoiceGroup
                  legend="Address"
                  value={addressChoice}
                  onChange={onAddressChoice}
                  options={[
                    { label: target.address || "No address", value: target.address || "", from: "Surviving profile" },
                    { label: duplicate.address || "No address", value: duplicate.address || "", from: "Retiring profile" },
                  ]}
                />
              </section>

              <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <h3 className="text-sm font-semibold">After the merge</h3>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Loyalty points</dt>
                    <dd className="text-lg font-bold text-primary">{points} pts</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Store credit</dt>
                    <dd className="text-lg font-bold text-primary">{formatMoney(credit)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Every phone number from both profiles stays on the surviving profile.</p>
              </section>

              <details className="group rounded-xl border border-amber-500/30 bg-amber-500/10">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400 [&::-webkit-details-marker]:hidden">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  What happens to the retiring profile
                  <span className="ml-auto text-xs font-medium group-open:hidden">Show</span>
                  <span className="ml-auto hidden text-xs font-medium group-open:inline">Hide</span>
                </summary>
                <ul className="list-disc space-y-1.5 px-4 pb-3 pl-8 text-sm text-foreground/90">
                  <li>Bookings and orders move to the surviving profile.</li>
                  <li>POS sales and transaction history are consolidated.</li>
                  <li>Outstanding credit sales are unified into one ledger.</li>
                  <li>Store credit and loyalty points are added together.</li>
                  <li>The retiring profile is archived and can no longer be used.</li>
                </ul>
              </details>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-background px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <Button variant="outline" className="sm:min-w-28" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button className="font-semibold sm:min-w-44" onClick={onConfirm} disabled={isPending}>
                {isPending ? (
                  <>
                    <Spinner className="mr-2 h-5 w-5" /> Merging…
                  </>
                ) : (
                  "Confirm & merge"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
