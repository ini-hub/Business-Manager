import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { Inventory } from "@shared/schema";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { SETTLEMENT_HELP, SETTLEMENT_LABEL } from "@/lib/partner-transfers";

// `inventoryId` is the sender's item when sending and the requester's own item when requesting;
// a requested line with no inventoryId is free text, which the supplier maps to their own stock.
interface Line { key: string; inventoryId?: string; supplierId?: string; name?: string; quantity: string; price: string }
interface SharedItem { id: string; name: string; sku: string | null; unit: string | null; listPrice: number; inStock: boolean; allowFractional: boolean }
type Mode = "send" | "request"
const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function PartnerTransferNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const currency = currentStore?.currency || "NGN";

  const [mode, setModeRaw] = useState<Mode>(() => (new URLSearchParams(window.location.search).get("mode") === "request" ? "request" : "send"));
  const [partnerOrgId, setPartnerOrgId] = useState(() => new URLSearchParams(window.location.search).get("partner") ?? "");
  // The partner's store: the receiver when sending, the supplier when requesting.
  const [toStoreId, setToStoreId] = useState("");
  const [settlementType, setSettlementType] = useState<"none" | "payable" | "return_in_kind">("none");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  // One key per form, so a double tap or a retry after a dropped connection cannot send twice.
  const idempotencyKey = useRef(crypto.randomUUID());

  const hasStore = !!currentStore?.id && currentStore.id !== "all";

  const { data: partnerData } = useQuery<{ partnerships: { status: string; partner: { id: string; name: string } }[] }>({
    queryKey: ["/api/partners"],
    queryFn: async () => (await apiRequest("GET", "/api/partners")).json(),
  });
  const partners = (partnerData?.partnerships ?? []).filter((p) => p.status === "active");

  const { data: partnerStores = [] } = useQuery<{ id: string; name: string; address: string | null }[]>({
    queryKey: ["/api/partners", partnerOrgId, "stores"],
    queryFn: async () => (await apiRequest("GET", `/api/partners/${partnerOrgId}/stores`)).json(),
    enabled: !!partnerOrgId,
  });

  // What the chosen partner store has opted to share, so a request can name real items.
  const { data: catalog = [] } = useQuery<SharedItem[]>({
    queryKey: ["/api/partners", partnerOrgId, "catalog", toStoreId],
    queryFn: async () => (await apiRequest("GET", `/api/partners/${partnerOrgId}/catalog?storeId=${toStoreId}`)).json(),
    enabled: mode === "request" && !!partnerOrgId && !!toStoreId,
  });

  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => (await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`)).json(),
    enabled: hasStore,
  });

  const isRequest = mode === "request";
  // Sending needs stock on the shelf; requesting is for things you are short of, so out-of-stock items count.
  const candidates = useMemo(
    () => inventory.filter((i) => i.type === "product" && !i.isDeleted && (isRequest || i.quantity > 0)),
    [inventory, isRequest],
  );
  const byId = useMemo(() => new Map(candidates.map((i) => [i.id, i])), [candidates]);
  const picked = new Set(lines.map((l) => l.inventoryId).filter(Boolean));
  const pickedSupplier = new Set(lines.map((l) => l.supplierId).filter(Boolean));
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const term = search.trim();
  const sharedMatches = catalog
    .filter((c) => !pickedSupplier.has(c.id) && c.name.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 6);
  const matches = candidates
    .filter((i) => !picked.has(i.id) && i.name.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 8);

  // A send is priced at the sender's cost unless a price is set; a request has no known cost, so only entered prices count.
  const total = lines.reduce((sum, l) => {
    const inv = l.inventoryId ? byId.get(l.inventoryId) : undefined;
    const unit = l.price !== "" ? Number(l.price) : isRequest ? 0 : inv?.costPrice ?? 0;
    return sum + (Number(l.quantity) || 0) * unit;
  }, 0);

  const patch = (key: string, change: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const setMode = (next: Mode) => {
    if (next === mode) return;
    setModeRaw(next);
    setToStoreId("");
    setLines([]);
    setSearch("");
    idempotencyKey.current = crypto.randomUUID();
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!partnerOrgId) throw new Error("Choose a partner.");
      if (!toStoreId) throw new Error(isRequest ? "Choose which of their stores to ask." : "Choose which of their stores should receive it.");
      if (!lines.length) throw new Error("Add at least one item.");
      const res = await apiRequest("POST", "/api/partner-transfers", {
        partnerOrgId,
        kind: mode,
        // Stock always leaves fromStoreId and arrives at toStoreId; the mode only decides which one is yours.
        fromStoreId: isRequest ? toStoreId : currentStore!.id,
        toStoreId: isRequest ? currentStore!.id : toStoreId,
        settlementType,
        dueDate: settlementType !== "none" && dueDate ? dueDate : null,
        notes: notes.trim() || null,
        idempotencyKey: idempotencyKey.current,
        items: lines.map((l) => ({
          ...(isRequest
            ? (l.supplierId ? { fromInventoryId: l.supplierId } : l.inventoryId ? { toInventoryId: l.inventoryId } : { name: l.name })
            : { fromInventoryId: l.inventoryId }),
          quantity: Number(l.quantity),
          agreedUnitPrice: l.price !== "" ? Number(l.price) : null,
        })),
      });
      return res.json();
    },
    onSuccess: (t: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner-transfers"] });
      toast(isRequest
        ? { title: "Request sent", description: "They will choose what they can supply and ship it." }
        : { title: "Offer sent", description: "Your stock stays on your shelf until you ship it." });
      setLocation(`/partners/transfers/${t.id}`);
    },
    onError: (e: Error) => toast({ title: isRequest ? "Could not send request" : "Could not send offer", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) {
    return <div className="space-y-6"><PageHeader title="Send stock to a partner" description="" /><StoreRequiredAlert title="Store required" /></div>;
  }
  if (!hasStore) {
    return <div className="space-y-6"><PageHeader title="Send stock to a partner" description="" /><ConsolidatedFallbackAlert pageTitle="Partner transfers" /></div>;
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader compact title={isRequest ? "Request stock from a partner" : "Send stock to a partner"} description={isRequest ? `For ${currentStore.name}` : `From ${currentStore.name}`} />

      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Transfer type">
        {(["send", "request"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} data-testid={`mode-${m}`}
            className={`rounded px-4 py-1.5 text-sm font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {m === "send" ? "Send stock" : "Request stock"}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">1. {isRequest ? "Who are you asking?" : "Who is it for?"}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="partner">Partner business</Label>
            <select id="partner" className={SELECT_CLASS} value={partnerOrgId} onChange={(e) => { setPartnerOrgId(e.target.value); setToStoreId(""); }}>
              <option value="">Choose a partner…</option>
              {partners.map((p) => <option key={p.partner.id} value={p.partner.id}>{p.partner.name}</option>)}
            </select>
            {partners.length === 0 && <p className="text-xs text-muted-foreground">You have no active partners yet. Connect on the Partners page first.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-store">{isRequest ? "Store to ask" : "Their store"}</Label>
            <select id="to-store" className={SELECT_CLASS} value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} disabled={!partnerOrgId}>
              <option value="">Choose a store…</option>
              {partnerStores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` · ${s.address}` : ""}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">2. {isRequest ? "What do you need?" : "What are you sending?"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="item-search">{isRequest ? "Add what you need" : "Add an item"}</Label>
            <Input id="item-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isRequest ? "Search your products, or type a new name…" : "Search your products…"} />
            {term && (
              <div className="rounded-md border">
                {isRequest && sharedMatches.length > 0 && (
                  <>
                    <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Shared by your partner</p>
                    {sharedMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 border-b p-3 text-left hover:bg-muted/50"
                        onClick={() => { setLines((ls) => [...ls, { key: `s-${c.id}`, supplierId: c.id, quantity: "1", price: "" }]); setSearch(""); }}
                      >
                        <span>{c.name}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">{c.inStock ? "In stock" : "Out of stock"} <Plus className="h-4 w-4" /></span>
                      </button>
                    ))}
                    {matches.length > 0 && <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">From your own items</p>}
                  </>
                )}
                {matches.length === 0 && !isRequest && <p className="p-3 text-sm text-muted-foreground">No matching products in stock.</p>}
                {matches.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 border-b p-3 text-left last:border-b-0 hover:bg-muted/50"
                    onClick={() => { setLines((ls) => [...ls, { key: i.id, inventoryId: i.id, quantity: "1", price: "" }]); setSearch(""); }}
                  >
                    <span>{i.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">{i.quantity} {isRequest ? "on your shelf" : "in stock"} <Plus className="h-4 w-4" /></span>
                  </button>
                ))}
                {isRequest && (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/50"
                    onClick={() => { setLines((ls) => [...ls, { key: `new-${crypto.randomUUID()}`, name: term, quantity: "1", price: "" }]); setSearch(""); }}
                  >
                    <span>Ask for “{term}” as a new item</span>
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {lines.map((l) => {
            const inv = l.inventoryId ? byId.get(l.inventoryId) : undefined;
            const shared = l.supplierId ? catalogById.get(l.supplierId) : undefined;
            return (
              <div key={l.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border p-3 sm:grid-cols-[1fr_120px_160px_auto] sm:items-end">
                <div>
                  <div className="font-medium">{shared?.name ?? inv?.name ?? l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {shared
                      ? `Shared by your partner · ${shared.inStock ? "in stock" : "out of stock"}${shared.listPrice > 0 ? ` · lists at ${formatCurrency(shared.listPrice, currency)}` : ""}`
                      : inv ? `${inv.quantity} ${isRequest ? "on your shelf" : "available"}` : "New item. Your partner will match it to their stock."}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="sm:order-last" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove item">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="space-y-1">
                  <Label className="text-xs">Quantity</Label>
                  <Input type="number" aria-label={`Quantity of ${shared?.name ?? inv?.name ?? l.name}`} min={0} step={inv?.allowFractional || !inv ? "any" : 1} max={isRequest ? undefined : inv?.quantity} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isRequest ? "Price you offer (optional)" : "Price each (optional)"}</Label>
                  <Input type="number" aria-label={`Price each for ${shared?.name ?? inv?.name ?? l.name}`} min={0} step="any" value={l.price} placeholder={!isRequest && inv ? String(inv.costPrice) : ""} onChange={(e) => patch(l.key, { price: e.target.value })} />
                </div>
              </div>
            );
          })}
          {lines.length > 0 && total > 0 && <p className="text-right text-sm">Value <span className="font-semibold">{formatCurrency(total, currency)}</span></p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">3. How will it be settled?</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(["none", "payable", "return_in_kind"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSettlementType(t)}
                className={`rounded-md border p-3 text-left text-sm ${settlementType === t ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                aria-pressed={settlementType === t}
                data-testid={`settlement-${t}`}
              >
                <div className="font-medium">{SETTLEMENT_LABEL[t]}</div>
                <div className="mt-1 text-xs text-muted-foreground">{SETTLEMENT_HELP[t]}</div>
              </button>
            ))}
          </div>
          {settlementType !== "none" && (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="due">Due by (optional)</Label>
              <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Note to your partner (optional)</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
          </div>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="w-full sm:w-auto" onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-send-offer">
          {create.isPending ? "Sending…" : isRequest ? "Send request" : "Send offer"}
        </Button>
      </div>
    </div>
  );
}
