import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Trash2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AddButton } from "@/components/add-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/icon-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { formatCurrency } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";
import type { Promotion, Inventory } from "@shared/schema";

type Kind = "buy_x_get_y" | "spend_x_get_y";

const KINDS: { value: Kind; label: string }[] = [
  { value: "buy_x_get_y", label: "Buy X, get Y free" },
  { value: "spend_x_get_y", label: "Spend over an amount" },
];

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const digits = (v: string) => v.replace(/[^0-9]/g, "");

export default function PromotionsPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const storeId = currentStore?.id;
  const currency = currentStore?.currency || "NGN";

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("buy_x_get_y");
  const [name, setName] = useState("");
  const [buyItemId, setBuyItemId] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("1");
  const [getItemId, setGetItemId] = useState("");
  const [getQuantity, setGetQuantity] = useState("1");
  const [spendAmount, setSpendAmount] = useState("");
  const [deleting, setDeleting] = useState<Promotion | null>(null);

  const promosKey = ["/api/promotions", storeId];

  const { data: promotions = [], isLoading: promoLoading } = useQuery<Promotion[]>({
    queryKey: promosKey,
    queryFn: async () => (await apiRequest("GET", `/api/promotions?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const { data: inventory = [], isLoading: inventoryLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", storeId],
    queryFn: async () => (await apiRequest("GET", `/api/inventory?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const fail = (title: string) => (err: any) =>
    toast({ title, description: err.message || "An unexpected error occurred", variant: "destructive" });

  const reset = () => {
    setName(""); setBuyItemId(""); setBuyQuantity("1"); setGetItemId(""); setGetQuantity("1"); setSpendAmount("");
    setKind("buy_x_get_y");
  };

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/promotions", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promosKey });
      toast({ title: `${name.trim()} is running` });
      setOpen(false);
      reset();
    },
    onError: fail("Failed to create promotion"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/promotions/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: promosKey }),
    onError: fail("Failed to update promotion"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/promotions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promosKey });
      toast({ title: `${deleting?.name ?? "Promotion"} deleted` });
      setDeleting(null);
    },
    onError: fail("Failed to delete promotion"),
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <SettingsPageHeader title="Promotions" description="Discounts that apply by themselves at checkout." scope="store" />
        <StoreRequiredAlert title="Store Required for Promotions" />
      </div>
    );
  }

  const itemName = (id: string | null) => inventory.find((i) => i.id === id)?.name ?? "an item";
  const rule = (p: Promotion) =>
    p.type === "buy_x_get_y"
      ? `Buy ${p.buyQuantity} × ${itemName(p.buyItemId)}, get ${p.getQuantity} × ${itemName(p.getItemId)} free`
      : `Spend ${formatCurrency(Number(p.spendAmount) || 0, currency)} or more, get ${p.getQuantity} × ${itemName(p.getItemId)} free`;

  const buyQ = parseInt(buyQuantity) || 0;
  const getQ = parseInt(getQuantity) || 0;
  const spend = parseFloat(spendAmount) || 0;

  // What's still missing, in the order the form asks for it. Drives both the helper line and the button.
  const missing: string[] = [];
  if (!name.trim()) missing.push("name it");
  if (kind === "buy_x_get_y") {
    if (!buyItemId) missing.push("choose what they buy");
    if (!getItemId) missing.push("choose what they get");
    if (buyQ <= 0 || getQ <= 0) missing.push("enter quantities");
  } else {
    if (spend <= 0) missing.push("enter the minimum spend");
    if (!getItemId) missing.push("choose what they get");
    if (getQ <= 0) missing.push("enter how many they get");
  }

  const preview =
    kind === "buy_x_get_y"
      ? buyItemId && getItemId && buyQ > 0 && getQ > 0
        ? `Buy ${buyQ} × ${itemName(buyItemId)}, get ${getQ} × ${itemName(getItemId)} free.`
        : null
      : spend > 0 && getItemId && getQ > 0
        ? `Spend ${formatCurrency(spend, currency)} or more, get ${getQ} × ${itemName(getItemId)} free.`
        : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length) return;
    const payload: any = { storeId, name: name.trim(), type: kind, isActive: true, getItemId, getQuantity: getQ };
    if (kind === "buy_x_get_y") Object.assign(payload, { buyItemId, buyQuantity: buyQ });
    else payload.spendAmount = spend;
    createMutation.mutate(payload);
  };

  const itemSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">Choose an item</option>
      {inventory.map((i) => (
        <option key={i.id} value={i.id}>{i.name}</option>
      ))}
    </select>
  );

  const loading = promoLoading || inventoryLoading;

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title="Promotions"
        description={`Discounts that apply by themselves at ${currentStore.name} checkout.`}
        scope="store"
        actions={!open && <AddButton label="New promotion" gate="promotions" onClick={() => { reset(); setOpen(true); }} data-testid="button-new-promotion" />}
      />

      {open && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border-2 border-primary bg-card p-4 sm:p-5" aria-label="New promotion">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">New promotion</h2>
            <IconButton type="button" variant="ghost" label="Close" onClick={() => setOpen(false)}><X className="h-4 w-4" /></IconButton>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-name">Name</Label>
            <Input id="promo-name" placeholder="For example: Ileya oil deal" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">Customers see this on the receipt.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Type</p>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <Button key={k.value} type="button" size="sm" variant={kind === k.value ? "default" : "outline"} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
                  {k.label}
                </Button>
              ))}
            </div>
          </div>

          {kind === "buy_x_get_y" ? (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <div className="space-y-2"><Label htmlFor="buy-item">When a customer buys</Label>{itemSelect("buy-item", buyItemId, setBuyItemId)}</div>
              <div className="space-y-2"><Label htmlFor="buy-qty">How many</Label><Input id="buy-qty" inputMode="numeric" value={buyQuantity} onChange={(e) => setBuyQuantity(digits(e.target.value))} /></div>
            </div>
          ) : (
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="spend">When a customer spends</Label>
              <div className="flex">
                <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">{currency === "NGN" ? "₦" : currency}</span>
                <Input id="spend" inputMode="numeric" className="rounded-l-none" value={spendAmount} onChange={(e) => setSpendAmount(digits(e.target.value))} />
              </div>
              <p className="text-xs text-muted-foreground">or more in one sale.</p>
            </div>
          )}

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2"><Label htmlFor="get-item">They get free</Label>{itemSelect("get-item", getItemId, setGetItemId)}</div>
            <div className="space-y-2"><Label htmlFor="get-qty">How many</Label><Input id="get-qty" inputMode="numeric" value={getQuantity} onChange={(e) => setGetQuantity(digits(e.target.value))} /></div>
          </div>

          <p className={cn("rounded-lg bg-muted/60 p-3 text-sm", preview ? "font-medium" : "text-muted-foreground")}>
            {preview ?? "Fill in the rule to see how it reads at checkout."}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className={cn("text-sm", missing.length ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
              {missing.length ? `To create it, ${missing.join(", ")}.` : "It applies by itself at checkout when a cart qualifies."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={missing.length > 0 || createMutation.isPending} data-testid="button-start-promotion">
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start promotion
              </Button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : promotions.length === 0 ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="rounded-lg bg-muted/60 px-4 py-8 text-center">
            <p className="font-semibold">No promotions running</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              A promotion applies by itself at checkout when a cart qualifies. For example: buy 2 of one item, get 1 of another free.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {promotions.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-4" data-testid={`promotion-${p.id}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted-foreground">{rule(p)}</p>
              </div>
              <span className={cn("text-sm font-medium", p.isActive ? "text-green-700 dark:text-green-400" : "text-muted-foreground")}>
                {p.isActive ? "Running" : "Paused"}
              </span>
              <Switch
                checked={!!p.isActive}
                disabled={toggleMutation.isPending}
                onCheckedChange={(isActive) => toggleMutation.mutate({ id: p.id, isActive })}
                aria-label={`${p.isActive ? "Pause" : "Run"} ${p.name}`}
              />
              <IconButton variant="ghost" label={`Delete ${p.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(p)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "promotion"}?`}
        description="Checkout stops applying it straight away. This can't be undone."
        confirmText="Delete"
        isDestructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); }}
      />
    </div>
  );
}
