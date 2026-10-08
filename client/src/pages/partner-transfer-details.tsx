import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import {
  EVENT_LABEL, PARTNER_STATUS_LABEL, PARTNER_STATUS_TONE, PAYMENT_METHOD_LABEL, SETTLEMENT_HELP, SETTLEMENT_LABEL,
} from "@/lib/partner-transfers";

interface Item {
  id: string; name: string; sku: string | null; unit: string | null;
  quantity: number; confirmedQuantity: number | null; unitPrice?: number; agreedUnitPrice?: number | null;
  shortfallReason: "missing" | "damaged" | null; shortfallNote: string | null;
}
interface OwnItem { id: string; name: string; sku: string | null; quantity: number; type: string; isDeleted: boolean }
interface Settlement { id: string; amount: number; method: string | null; status: string; reference: string | null; recordedByOrgId: string; createdAt: string }
interface Detail {
  id: string; kind: "send" | "request"; side: "sender" | "receiver"; status: string; settlementType?: string;
  fromStoreId: string;
  proposedSettlementType?: string | null; dueDate?: string | null; notes: string | null; rejectionReason: string | null;
  agreedTotal?: number; fromOrgId: string; fromOrgName: string; toOrgName: string; fromStoreName: string; toStoreName: string;
  items: Item[];
  events: { id: string; event: string; createdAt: string; orgId: string }[];
  obligation?: { id: string; kind: string; amountDue: number; amountSettled: number; status: string } | null;
  settlements?: Settlement[];
}

export default function PartnerTransferDetailsPage() {
  const [, params] = useRoute("/partners/transfers/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  // Store staff confirm deliveries and follow progress; the server sends them no figures, and the controls for money and management stay hidden.
  const isStaff = user?.role === "staff";
  const currency = currentStore?.currency || "NGN";
  const money = (n: number) => formatCurrency(n, currency);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, { reason: "missing" | "damaged"; note: string }>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "transfer", reference: "" });
  const [fulfilOpen, setFulfilOpen] = useState(false);
  const [fulfil, setFulfil] = useState<Record<string, { inventoryId: string; quantity: string; price: string }>>({});
  const [termsOpen, setTermsOpen] = useState(false);
  const [terms, setTerms] = useState<{ type: string; due: string }>({ type: "payable", due: "" });

  const { data: t, isLoading } = useQuery<Detail | null>({
    queryKey: ["/api/partner-transfers", id],
    queryFn: async () => {
      const res = await fetch(`/api/partner-transfers/${id}`, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: !!id,
  });

  const { data: ownStock = [] } = useQuery<OwnItem[]>({
    queryKey: ["/api/inventory", t?.fromStoreId, "partner-fulfil"],
    queryFn: async () => (await apiRequest("GET", `/api/inventory?storeId=${t!.fromStoreId}`)).json(),
    enabled: fulfilOpen && !!t,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/partner-transfers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/partner-ledger"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
  };
  const call = (path: string, success: string, body?: unknown) =>
    useMutation({
      mutationFn: async (override?: unknown) => (await apiRequest("POST", path, override ?? body)).json(),
      onSuccess: () => { refresh(); toast({ title: success }); },
      onError: (e: Error) => toast({ title: "That didn't work", description: e.message, variant: "destructive" }),
    });

  const accept = call(`/api/partner-transfers/${id}/accept`, "Accepted", {});
  const reject = call(`/api/partner-transfers/${id}/reject`, "Declined", {});
  const cancel = call(`/api/partner-transfers/${id}/cancel`, "Cancelled");
  const ship = call(`/api/partner-transfers/${id}/ship`, "Shipped. The stock has left your shelf.");
  const close = call(`/api/partner-transfers/${id}/close`, "Closed");
  const receive = call(`/api/partner-transfers/${id}/receive`, "Receipt confirmed. The stock is now on your shelf.");
  const resolve = call(`/api/partner-transfers/${id}/resolve`, "Shortfall resolved");
  const proposeTerms = call(`/api/partner-transfers/${id}/settlement`, "Terms sent");
  const answerTerms = call(`/api/partner-transfers/${id}/settlement/respond`, "Answer sent");
  const record = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/partner-ledger/obligations/${t!.obligation!.id}/settlements`, {
      amount: Number(pay.amount), method: pay.method, reference: pay.reference.trim() || null,
    })).json(),
    onSuccess: () => { refresh(); setPayOpen(false); setPay({ amount: "", method: "transfer", reference: "" }); toast({ title: "Payment recorded" }); },
    onError: (e: Error) => toast({ title: "Could not record payment", description: e.message, variant: "destructive" }),
  });
  const answerPayment = useMutation({
    mutationFn: async (v: { sid: string; accept: boolean }) => (await apiRequest("POST", `/api/partner-ledger/settlements/${v.sid}/answer`, { accept: v.accept })).json(),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "That didn't work", description: e.message, variant: "destructive" }),
  });
  const waive = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/partner-ledger/obligations/${t!.obligation!.id}/waive`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Balance waived" }); },
    onError: (e: Error) => toast({ title: "Could not waive", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40 w-full" /></div>;
  if (!t) return <div className="space-y-4"><PageHeader title="Transfer not found" description="" /><Button variant="outline" onClick={() => setLocation("/partners")}>Back to Partners</Button></div>;

  const sender = t.side === "sender";
  const isRequest = t.kind === "request";
  const ob = isStaff ? null : (t.obligation ?? null);
  const remaining = ob ? ob.amountDue - ob.amountSettled : 0;
  const canManage = !isStaff;
  // The party who opened the transfer sets its terms outright; the other side can only propose.
  const termsOpenForSender = (sender || (isRequest && t.status === "requested")) && !ob && !t.proposedSettlementType && !["rejected", "cancelled"].includes(t.status);
  const shortLines = t.items.filter((i) => i.confirmedQuantity != null && i.confirmedQuantity < i.quantity);
  const anyMissing = shortLines.some((i) => i.shortfallReason !== "damaged");
  const catalogue = ownStock.filter((i) => i.type === "product" && !i.isDeleted);
  const guess = (it: Item) =>
    catalogue.find((c) => (it.sku && c.sku === it.sku) || c.name.trim().toLowerCase() === it.name.trim().toLowerCase())?.id ?? "";
  const received = ["received", "disputed", "closed"].includes(t.status);
  const other = sender ? `${t.toOrgName} · ${t.toStoreName}` : `${t.fromOrgName} · ${t.fromStoreName}`;

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title={isRequest ? (sender ? `Requested by ${other}` : `Requested from ${other}`) : (sender ? `Sent to ${other}` : `From ${other}`)}
        description={isStaff ? `${t.items.length} ${t.items.length === 1 ? "item" : "items"}` : `${(t.agreedTotal ?? 0) > 0 ? money(t.agreedTotal ?? 0) : "No price set yet"} · ${SETTLEMENT_LABEL[t.settlementType ?? "none"]}`}
        actions={<Badge variant={PARTNER_STATUS_TONE[t.status] ?? "outline"}>{PARTNER_STATUS_LABEL[t.status] ?? t.status}</Badge>}
      />

      {t.notes && <p className="rounded-md bg-muted p-3 text-sm">{t.notes}</p>}
      {t.rejectionReason && <p className="rounded-md bg-destructive/10 p-3 text-sm">Declined: {t.rejectionReason}</p>}

      <div className="flex flex-wrap gap-2">
        {canManage && !sender && t.status === "offered" && (<>
          <Button onClick={() => accept.mutate(undefined)} disabled={accept.isPending}>Accept</Button>
          <Button variant="outline" onClick={() => reject.mutate(undefined)} disabled={reject.isPending}>Decline</Button>
        </>)}
        {canManage && sender && isRequest && t.status === "requested" && (<>
          <Button
            onClick={() => { setFulfil(Object.fromEntries(t.items.map((i) => [i.id, { inventoryId: "", quantity: String(i.quantity), price: "" }]))); setFulfilOpen(true); }}
            data-testid="button-review-request"
          >Review and accept</Button>
          <Button variant="outline" onClick={() => reject.mutate(undefined)} disabled={reject.isPending}>Decline</Button>
        </>)}
        {canManage && !sender && isRequest && t.status === "requested" && (
          <Button variant="outline" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending}>Withdraw request</Button>
        )}
        {canManage && sender && ["offered", "accepted"].includes(t.status) && <Button variant="outline" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending}>Cancel offer</Button>}
        {canManage && sender && t.status === "accepted" && <Button onClick={() => ship.mutate(undefined)} disabled={ship.isPending}>Ship now</Button>}
        {!sender && t.status === "shipped" && (
          <Button onClick={() => { setConfirmed(Object.fromEntries(t.items.map((i) => [i.id, String(i.quantity)]))); setReasons({}); setReceiveOpen(true); }}>Confirm what arrived</Button>
        )}
        {canManage && sender && t.status === "disputed" && (<>
          {anyMissing && <Button onClick={() => resolve.mutate({ returnToStock: true })} disabled={resolve.isPending}>Put missing stock back on my shelf</Button>}
          <Button variant={anyMissing ? "outline" : "default"} onClick={() => resolve.mutate({ returnToStock: false })} disabled={resolve.isPending}>{anyMissing ? "Write it off" : "Acknowledge and close"}</Button>
        </>)}
        {canManage && sender && t.status === "received" && (!ob || ob.status !== "open") && <Button variant="outline" onClick={() => close.mutate(undefined)} disabled={close.isPending}>Close transfer</Button>}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {t.items.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{i.name}</div>
                {i.sku && <div className="text-xs text-muted-foreground">SKU {i.sku}</div>}
                {i.confirmedQuantity != null && i.confirmedQuantity < i.quantity && (
                  <div className="text-xs text-destructive">
                    {i.quantity - i.confirmedQuantity} {i.shortfallReason === "damaged" ? "damaged" : "missing"}{i.shortfallNote ? `: ${i.shortfallNote}` : ""}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div>
                  {i.confirmedQuantity != null && i.confirmedQuantity !== i.quantity
                    ? <>{i.confirmedQuantity} of {i.quantity}</> : <>{i.quantity}</>} {i.unit ?? ""}
                </div>
                {canManage && i.unitPrice != null && (i.agreedUnitPrice != null || i.unitPrice > 0) && <div className="text-xs text-muted-foreground">{money(i.unitPrice)} each</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">What is owed</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{SETTLEMENT_HELP[t.settlementType ?? "none"]}</p>

          {t.proposedSettlementType && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="font-medium">{sender ? "You proposed" : "Proposed by the sender"}: {SETTLEMENT_LABEL[t.proposedSettlementType]}</p>
              {!sender && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => answerTerms.mutate({ accept: true })} disabled={answerTerms.isPending}>Agree</Button>
                  <Button size="sm" variant="outline" onClick={() => answerTerms.mutate({ accept: false })} disabled={answerTerms.isPending}>Decline</Button>
                </div>
              )}
              {sender && <p className="mt-1 text-xs text-muted-foreground">Waiting for your partner to agree.</p>}
            </div>
          )}

          {termsOpenForSender && (
            <Button size="sm" variant="outline" onClick={() => setTermsOpen(true)}>
              {t.settlementType === "none" ? (received ? "Propose terms" : "Set terms") : "Change terms"}
            </Button>
          )}

          {ob && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{ob.kind === "money" ? "Money" : "Goods"} · {money(ob.amountSettled)} of {money(ob.amountDue)} settled</div>
                  <div className="text-xs text-muted-foreground">
                    {sender ? "They owe you" : "You owe them"} {money(remaining)}{t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <Badge variant={ob.status === "open" ? "secondary" : "outline"}>{ob.status === "open" ? "Open" : ob.status === "settled" ? "Settled" : "Waived"}</Badge>
              </div>
              {ob.status === "open" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setPay({ amount: String(remaining), method: ob.kind === "goods" ? "goods_return" : "transfer", reference: "" }); setPayOpen(true); }}>
                    {sender ? "Record a payment received" : "I have paid"}
                  </Button>
                  {sender && <Button size="sm" variant="ghost" onClick={() => waive.mutate()} disabled={waive.isPending}>Waive the rest</Button>}
                </div>
              )}
              {(t.settlements ?? []).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                  <span>{money(s.amount)} · {PAYMENT_METHOD_LABEL[s.method ?? ""] ?? s.method} · {new Date(s.createdAt).toLocaleDateString()}{s.reference ? ` · ${s.reference}` : ""}</span>
                  {s.status === "pending" && sender ? (
                    <span className="flex gap-2">
                      <Button size="sm" onClick={() => answerPayment.mutate({ sid: s.id, accept: true })} disabled={answerPayment.isPending}>Confirm</Button>
                      <Button size="sm" variant="outline" onClick={() => answerPayment.mutate({ sid: s.id, accept: false })} disabled={answerPayment.isPending}>Not received</Button>
                    </span>
                  ) : <Badge variant="outline">{s.status === "pending" ? "Awaiting confirmation" : s.status === "confirmed" ? "Confirmed" : "Not accepted"}</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {t.events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{EVENT_LABEL[e.event] ?? e.event}</span>
              <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={fulfilOpen} onOpenChange={setFulfilOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review the request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {t.items.map((i) => {
              const f = fulfil[i.id] ?? { inventoryId: "", quantity: String(i.quantity), price: "" };
              const chosen = f.inventoryId || guess(i);
              const set = (change: Partial<typeof f>) => setFulfil((all) => ({ ...all, [i.id]: { ...f, ...change } }));
              return (
                <div key={i.id} className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">{i.name} <span className="text-xs font-normal text-muted-foreground">(asked for {i.quantity})</span></div>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={chosen} onChange={(e) => set({ inventoryId: e.target.value })} aria-label={`Your item for ${i.name}`}>
                    <option value="">{catalogue.length === 0 ? "Loading your items…" : "Choose your item…"}</option>
                    {catalogue.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.quantity} in stock</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">You can supply (0 to leave out)</Label>
                      <Input type="number" aria-label={`Quantity you can supply of ${i.name}`} min={0} max={i.quantity} step="any" value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price each</Label>
                      {i.agreedUnitPrice != null
                        ? <div className="flex h-10 items-center text-sm">{money(i.agreedUnitPrice)} (set by requester)</div>
                        : <Input type="number" aria-label={`Price each for ${i.name}`} min={0} step="any" value={f.price} placeholder="Optional" onChange={(e) => set({ price: e.target.value })} />}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">Nothing leaves your shelf until you ship. You can supply less than was asked, but not more.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFulfilOpen(false)}>Cancel</Button>
            <Button
              disabled={accept.isPending}
              onClick={() => accept.mutate({
                lines: Object.fromEntries(t.items.map((i) => {
                  const f = fulfil[i.id] ?? { inventoryId: "", quantity: String(i.quantity), price: "" };
                  return [i.id, {
                    inventoryId: f.inventoryId || guess(i) || null,
                    quantity: Number(f.quantity),
                    ...(i.agreedUnitPrice == null && f.price !== "" ? { agreedUnitPrice: Number(f.price) } : {}),
                  }];
                })),
              }, { onSuccess: () => setFulfilOpen(false) })}
            >Accept request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm what arrived</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {t.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3">
                <Label htmlFor={`recv-${i.id}`} className="flex-1">{i.name} <span className="text-xs text-muted-foreground">(sent {i.quantity})</span></Label>
                <Input id={`recv-${i.id}`} className="w-28" type="number" min={0} max={i.quantity} step="any" value={confirmed[i.id] ?? ""} onChange={(e) => setConfirmed((c) => ({ ...c, [i.id]: e.target.value }))} />
              </div>
            ))}
            {t.items.filter((i) => (Number(confirmed[i.id]) || 0) < i.quantity).map((i) => {
              const r = reasons[i.id] ?? { reason: "missing" as const, note: "" };
              return (
                <div key={`why-${i.id}`} className="grid grid-cols-[auto_1fr] gap-2 rounded-md bg-muted/50 p-2">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label={`Why ${i.name} is short`}
                    value={r.reason}
                    onChange={(e) => setReasons((all) => ({ ...all, [i.id]: { ...r, reason: e.target.value as "missing" | "damaged" } }))}
                  >
                    <option value="missing">Missing</option>
                    <option value="damaged">Damaged</option>
                  </select>
                  <Input
                    className="h-9" placeholder={`Note about ${i.name} (optional)`} maxLength={300} value={r.note}
                    onChange={(e) => setReasons((all) => ({ ...all, [i.id]: { ...r, note: e.target.value } }))}
                  />
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">Anything short is flagged to the sender to resolve. Only what you confirm is added to your stock and counted as owed.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)}>Cancel</Button>
            <Button
              disabled={receive.isPending}
              onClick={() => {
                const counted = Object.fromEntries(t.items.map((i) => [i.id, Number(confirmed[i.id]) || 0]));
                const shortfalls = Object.fromEntries(t.items.filter((i) => counted[i.id] < i.quantity).map((i) => [i.id, { reason: reasons[i.id]?.reason ?? "missing", note: reasons[i.id]?.note.trim() || null }]));
                receive.mutate({ confirmed: counted, shortfalls }, { onSuccess: () => setReceiveOpen(false) });
              }}
            >Confirm receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{sender ? "Record a payment received" : "Report a payment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input id="pay-amount" type="number" min={0} step="any" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">How</Label>
              <select id="pay-method" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference (optional)</Label>
              <Input id="pay-ref" value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
            </div>
            {!sender && <p className="text-xs text-muted-foreground">Your partner confirms it before it reduces what you owe.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => record.mutate()} disabled={record.isPending || !(Number(pay.amount) > 0)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{received ? "Propose settlement terms" : "Settlement terms"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(["payable", "return_in_kind"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTerms((s) => ({ ...s, type: k }))} aria-pressed={terms.type === k}
                className={`w-full rounded-md border p-3 text-left text-sm ${terms.type === k ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                <div className="font-medium">{SETTLEMENT_LABEL[k]}</div>
                <div className="text-xs text-muted-foreground">{SETTLEMENT_HELP[k]}</div>
              </button>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="terms-due">Due by (optional)</Label>
              <Input id="terms-due" type="date" value={terms.due} onChange={(e) => setTerms((s) => ({ ...s, due: e.target.value }))} />
            </div>
            {received && <p className="text-xs text-muted-foreground">Your partner has already received the goods, so they have to agree before this becomes a balance.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTermsOpen(false)}>Cancel</Button>
            <Button disabled={proposeTerms.isPending} onClick={() => proposeTerms.mutate({ type: terms.type, dueDate: terms.due || null }, { onSuccess: () => setTermsOpen(false) })}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
