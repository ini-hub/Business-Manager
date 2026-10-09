import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BadgeCheck, Check, ChevronsUpDown, Landmark, Plus, Star } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { ApiError } from "@/lib/queryClient";
import { BankLink } from "./bank-link";
import type { BankConnection, StorePaymentAccount } from "@shared/schema";

const KIND_LABEL: Record<string, string> = { bank: "Bank account", pos: "POS terminal", mobile_money: "Mobile money" };
const EMPTY = { label: "", kind: "bank", bankName: "", bankCode: "", accountNumber: "", accountName: "" };

type Bank = { name: string; code: string };
// idle: nothing to look up yet. unavailable: the lookup service is down, so the name may be typed and saved unverified.
type Lookup = { state: "idle" | "checking" | "verified" | "failed" | "unavailable"; message?: string };

/** The accounts this store receives transfers into; checkout asks which one each transfer went to. */
export function PaymentAccountsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const storeId = currentStore?.id;
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const isBank = form.kind === "bank";

  const { data: banks = [] } = useQuery<Bank[]>({
    queryKey: ["/api/sales/banks"],
    enabled: adding && isBank,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => (await apiRequest("GET", "/api/sales/banks")).json(),
  });

  // Resolve the account name as soon as a bank and a full 10-digit number are in.
  useEffect(() => {
    if (!isBank || !form.bankCode || !/^\d{10}$/.test(form.accountNumber)) {
      setLookup({ state: "idle" });
      return;
    }
    let stale = false;
    setLookup({ state: "checking" });
    apiRequest("POST", "/api/sales/payment-accounts/resolve", { accountNumber: form.accountNumber, bankCode: form.bankCode })
      .then((r) => r.json())
      .then((r: { accountName: string }) => {
        if (stale) return;
        setForm((f) => ({ ...f, accountName: r.accountName }));
        setLookup({ state: "verified" });
      })
      .catch((e: ApiError) => {
        if (stale) return;
        setLookup({ state: e.code === "LOOKUP_UNAVAILABLE" ? "unavailable" : "failed", message: e.message });
      });
    return () => { stale = true; };
  }, [isBank, form.bankCode, form.accountNumber]);

  // A bank account can't be saved until the bank has confirmed it, unless the lookup service itself is down.
  const bankReady = !isBank || lookup.state === "verified" || (lookup.state === "unavailable" && !!form.accountName.trim());
  const reset = () => { setAdding(false); setForm(EMPTY); setLookup({ state: "idle" }); };

  const { data: accounts = [] } = useQuery<StorePaymentAccount[]>({
    queryKey: ["/api/sales/payment-accounts", storeId, "all"],
    enabled: !!storeId,
    queryFn: async () => (await apiRequest("GET", `/api/sales/payment-accounts?storeId=${storeId}&includeInactive=true`)).json(),
  });

  const { data: monoConfig } = useQuery<{ configured: boolean; publicKey: string | null }>({
    queryKey: ["/api/sales/bank-connections/config"],
    queryFn: async () => (await apiRequest("GET", "/api/sales/bank-connections/config")).json(),
    staleTime: 60 * 60 * 1000,
  });
  const { data: connections = [] } = useQuery<BankConnection[]>({
    queryKey: ["/api/sales/bank-connections", storeId],
    enabled: !!storeId && !!monoConfig?.configured,
    queryFn: async () => (await apiRequest("GET", `/api/sales/bank-connections?storeId=${storeId}`)).json(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales/payment-accounts", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales/payment-accounts", storeId, "all"] });
  };
  const onError = (err: any) =>
    toast({ title: "Couldn't save payment account", description: err?.message, variant: "destructive" });

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/sales/payment-accounts", {
        storeId,
        ...form,
        allowUnverified: lookup.state === "unavailable",
      })).json(),
    onSuccess: () => {
      toast({ title: "Payment account added" });
      reset();
      refresh();
    },
    onError,
  });
  const patch = useMutation({
    mutationFn: async (v: { id: string; data: Record<string, unknown> }) =>
      (await apiRequest("PATCH", `/api/sales/payment-accounts/${v.id}`, v.data)).json(),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" aria-hidden="true" /> Payment accounts</CardTitle>
        <CardDescription>
          Accounts this store receives transfers into. Cashiers pick one on every transfer, and the receipt and
          reconciliation report show where the money went.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No accounts yet. Transfers are recorded without an account until you add one.</p>
        )}
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border p-3" data-testid={`row-account-${a.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                {a.label}
                {a.isDefault && <Badge variant="secondary" className="gap-1 text-[11px]"><Star className="h-3 w-3" aria-hidden="true" />Default</Badge>}
                {!a.isActive && <Badge variant="outline" className="text-[11px]">Inactive</Badge>}
                {a.kind === "bank" && (a.accountVerifiedAt
                  ? <Badge variant="secondary" className="gap-1 text-[11px]"><BadgeCheck className="h-3 w-3" aria-hidden="true" />Verified</Badge>
                  : <Badge variant="outline" className="text-[11px]">Unverified</Badge>)}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {[KIND_LABEL[a.kind] ?? a.kind, a.bankName, a.accountNumber, a.accountName].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {monoConfig?.publicKey && storeId && a.kind === "bank" && a.isActive && (
                <BankLink storeId={storeId} accountId={a.id} publicKey={monoConfig.publicKey} connection={connections.find((c) => c.paymentAccountId === a.id)} />
              )}
              {a.isActive && !a.isDefault && (
                <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: a.id, data: { isDefault: true } })}>Make default</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: a.id, data: { isActive: !a.isActive } })}>
                {a.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          </div>
        ))}

        {adding ? (
          <form
            className="space-y-3 rounded-lg border p-3"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pa-label">Name</Label>
                <Input id="pa-label" required maxLength={60} placeholder="e.g. GTBank main" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pa-kind">Type</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v, bankName: "", bankCode: "", accountNumber: "", accountName: "" })}>
                  <SelectTrigger id="pa-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(KIND_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isBank ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="pa-bank">Bank</Label>
                    <Popover open={bankOpen} onOpenChange={setBankOpen}>
                      <PopoverTrigger asChild>
                        <Button id="pa-bank" type="button" variant="outline" role="combobox" aria-expanded={bankOpen} className="w-full justify-between font-normal">
                          <span className="truncate">{form.bankName || "Select bank"}</span>
                          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search banks…" />
                          <CommandList>
                            <CommandEmpty>No bank found.</CommandEmpty>
                            {banks.map((b) => (
                              <CommandItem
                                key={b.code}
                                value={b.name}
                                onSelect={() => { setForm({ ...form, bankName: b.name, bankCode: b.code, accountName: "" }); setBankOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${form.bankCode === b.code ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                                {b.name}
                              </CommandItem>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pa-number">Account number</Label>
                    <Input id="pa-number" inputMode="numeric" maxLength={10} placeholder="10 digits" value={form.accountNumber}
                      onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, ""), accountName: "" })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="pa-name">Account name</Label>
                    <Input id="pa-name" maxLength={100} value={form.accountName}
                      readOnly={lookup.state !== "unavailable"}
                      placeholder={lookup.state === "checking" ? "Checking with the bank…" : "Filled in by the bank"}
                      onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
                    <p className={`text-xs ${lookup.state === "failed" ? "text-destructive" : "text-muted-foreground"}`} role="status">
                      {lookup.state === "verified" && "Verified with the bank."}
                      {(lookup.state === "failed" || lookup.state === "unavailable") && lookup.message}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="pa-bank">Provider</Label>
                    <Input id="pa-bank" maxLength={80} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pa-number">Account / terminal number</Label>
                    <Input id="pa-number" inputMode="numeric" maxLength={40} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="pa-name">Account name</Label>
                    <Input id="pa-name" maxLength={100} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending || !form.label.trim() || !bankReady}>{create.isPending ? "Saving…" : "Save account"}</Button>
              <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="button-add-payment-account">
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" /> Add account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
