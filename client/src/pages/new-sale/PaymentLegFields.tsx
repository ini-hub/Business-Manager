import { Link } from "wouter";
import { Landmark, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StorePaymentAccount } from "@shared/schema";

/** Detail captured alongside a payment leg; mirrors PaymentLegInput in shared/schema/sales.ts. */
export type LegDetail = {
  accountId?: string;
  reference?: string;
  senderName?: string;
  confirmed?: boolean;
  cashTendered?: number;
  changeOwed?: number;
};

const accountText = (a: StorePaymentAccount) =>
  [a.label, a.accountNumber ? `····${a.accountNumber.slice(-4)}` : null].filter(Boolean).join(" ");

export function TransferFields({
  accounts,
  value,
  onChange,
  idPrefix,
}: {
  accounts: StorePaymentAccount[];
  value: LegDetail;
  onChange: (next: LegDetail) => void;
  idPrefix: string;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 rounded border border-dashed p-2">
        <Landmark className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          No payment accounts yet, so this transfer can't be tied to an account.{" "}
          <Link href="/settings/payment-integrations" className="underline">Add one in Settings</Link>.
        </span>
      </p>
    );
  }
  const selected = accounts.find((a) => a.id === value.accountId);
  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground uppercase font-medium" htmlFor={`${idPrefix}-account`}>
          Paid into
        </Label>
        <Select value={value.accountId ?? ""} onValueChange={(v) => onChange({ ...value, accountId: v })}>
          <SelectTrigger id={`${idPrefix}-account`} className="h-8 text-xs" data-testid={`select-account-${idPrefix}`}>
            <SelectValue placeholder="Select the receiving account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{accountText(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (selected.bankName || selected.accountName) && (
          <p className="text-[11px] text-muted-foreground">
            {[selected.bankName, selected.accountNumber, selected.accountName].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Sender name (optional)"
          value={value.senderName ?? ""}
          onChange={(e) => onChange({ ...value, senderName: e.target.value })}
          className="h-8 text-xs"
          aria-label="Sender name"
        />
        <Input
          placeholder="Reference (optional)"
          value={value.reference ?? ""}
          onChange={(e) => onChange({ ...value, reference: e.target.value })}
          className="h-8 text-xs"
          aria-label="Transfer reference"
        />
      </div>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <Checkbox
          checked={!!value.confirmed}
          onCheckedChange={(c) => onChange({ ...value, confirmed: c === true })}
          className="mt-0.5"
          data-testid={`checkbox-confirmed-${idPrefix}`}
        />
        <span>
          I have confirmed the money has landed
          <span className="block text-[11px] text-muted-foreground">
            Leave unticked to record it as pending and confirm it later.
          </span>
        </span>
      </label>
    </div>
  );
}

export function CashFields({
  due,
  value,
  onChange,
  formatCurrency,
  idPrefix,
}: {
  due: number;
  value: LegDetail;
  onChange: (next: LegDetail) => void;
  formatCurrency: (v: number) => string;
  idPrefix: string;
}) {
  const tendered = value.cashTendered ?? due;
  const change = Math.max(0, Math.round((tendered - due) * 100) / 100);
  const short = tendered + 0.005 < due;
  const owing = (value.changeOwed ?? 0) > 0;

  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground uppercase font-medium flex items-center gap-1" htmlFor={`${idPrefix}-tendered`}>
          <Wallet className="h-3 w-3" aria-hidden="true" /> Cash received
        </Label>
        <Input
          id={`${idPrefix}-tendered`}
          type="number"
          min="0"
          step="0.01"
          placeholder={String(due)}
          value={value.cashTendered ?? ""}
          onChange={(e) => {
            const n = e.target.value === "" ? undefined : parseFloat(e.target.value);
            const nextChange = n === undefined ? 0 : Math.max(0, n - due);
            // Owed change can never exceed the change that exists.
            onChange({
              ...value,
              cashTendered: n,
              changeOwed: value.changeOwed ? Math.min(value.changeOwed, nextChange) || undefined : undefined,
            });
          }}
          className="h-8 text-xs font-mono"
          data-testid={`input-tendered-${idPrefix}`}
        />
      </div>
      {short && (
        <p className="text-[11px] text-red-500" role="alert">
          Short by {formatCurrency(due - tendered)}. Receive the full amount, or use a split or credit sale.
        </p>
      )}
      {change > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Change due</span>
            <span className="font-mono font-semibold">{formatCurrency(change)}</span>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
            <span>No change on hand? Owe it to the customer</span>
            <Switch
              checked={owing}
              onCheckedChange={(on) => onChange({ ...value, changeOwed: on ? change : undefined })}
              data-testid={`switch-owe-change-${idPrefix}`}
            />
          </label>
          {owing && (
            <div className="space-y-1">
              <Input
                type="number"
                min="0"
                max={change}
                step="0.01"
                value={value.changeOwed ?? ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  onChange({ ...value, changeOwed: Number.isFinite(n) ? Math.min(Math.max(n, 0), change) : undefined });
                }}
                className="h-8 text-xs font-mono"
                aria-label="Change owed to customer"
              />
              <p className="text-[11px] text-muted-foreground">
                Added to this customer's store credit, to use on a later sale. Returned now: {formatCurrency(change - (value.changeOwed ?? 0))}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
