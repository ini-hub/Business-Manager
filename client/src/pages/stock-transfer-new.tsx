import { fetchAllPages } from "@/lib/paginated";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Minus, Plus, Save, Search, Store as StoreIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import type { Inventory, Store } from "@shared/schema";

type Line = { inventoryId: string; quantity: number | "" };

type Mode = "send" | "request";

const NEXT_STEPS = (mode: Mode, from: string, to: string) =>
  mode === "send"
    ? [
        `Stock is set aside at ${from} so it can't be sold.`,
        `${to} approves and marks it received.`,
        "Stock moves to their inventory. Cancelling releases it back.",
      ]
    : [
        `${from} reviews your request. Nothing leaves their shelves until they approve.`,
        `${from} approves it, schedules delivery and sends the stock.`,
        `You confirm it arrived and the stock moves into ${to}'s inventory.`,
      ];

function NextSteps({ mode, from, to }: { mode: Mode; from: string; to: string }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What happens next</h3>
      <ol className="space-y-3">
        {NEXT_STEPS(mode, from, to).map((text, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">{n}</span>
      <div>
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export default function StockTransferNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore, business } = useStore();

  const [mode, setModeRaw] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get("mode") === "request" ? "request" : "send");
  // The other branch: the receiver when sending, the supplier when requesting.
  const [otherId, setOtherId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const hasStore = !!currentStore?.id && currentStore.id !== "all";

  // ── Drafts ────────────────────────────────────────────────────────────
  // Saved server-side (stock_transfer_drafts). A draft is form state only: it reserves
  // no stock and the other branch never sees it.
  const draftParam = new URLSearchParams(useSearch()).get("draft");
  const [draftId, setDraftId] = useState<string | null>(draftParam);
  const [savingDraft, setSavingDraft] = useState(false);
  const hydrated = useRef(false);

  const { data: loadedDraft, isError: draftMissing } = useQuery<any>({
    queryKey: ["/api/stock-transfer-drafts", draftParam],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stock-transfer-drafts/${draftParam}`);
      if (!res.ok) throw new Error("Draft not found");
      return res.json();
    },
    enabled: !!draftParam,
    retry: false,
  });

  useEffect(() => {
    if (!loadedDraft || hydrated.current) return;
    hydrated.current = true;
    const f = (loadedDraft.formData ?? {}) as any;
    setModeRaw(loadedDraft.kind === "request" ? "request" : "send");
    setOtherId(loadedDraft.otherStoreId ?? "");
    setNotes(f.notes ?? "");
    setLines(Array.isArray(f.lines) ? f.lines : []);
  }, [loadedDraft]);

  useEffect(() => {
    if (draftMissing) {
      toast({ title: "Draft not found", description: "It may have been discarded or sent.", variant: "destructive" });
      setDraftId(null);
    }
  }, [draftMissing, toast]);

  const saveDraft = async () => {
    if (!currentStore?.id || currentStore.id === "all") return;
    setSavingDraft(true);
    try {
      const payload = {
        storeId: currentStore.id,
        kind: mode,
        otherStoreId: otherId || null,
        formData: { notes, lines },
      };
      const res = draftId
        ? await apiRequest("PUT", `/api/stock-transfer-drafts/${draftId}`, payload)
        : await apiRequest("POST", "/api/stock-transfer-drafts", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save draft");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfer-drafts"] });
      toast({ title: "Draft saved", description: "Find it under Drafts on the Stock Transfers page." });
      setLocation("/stock-transfers");
    } catch (err: any) {
      toast({ title: "Couldn't save draft", description: err.message, variant: "destructive" });
    } finally {
      setSavingDraft(false);
    }
  };

  const { data: stores = [] } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
    queryFn: async () => (await apiRequest("GET", "/api/stores")).json(),
  });

  // Stock always leaves `fromStoreId` and arrives at `toStoreId`; the mode only decides
  // which of the two is the branch you are working in.
  const fromStoreId = mode === "send" ? currentStore?.id ?? "" : otherId;
  const toStoreId = mode === "send" ? otherId : currentStore?.id ?? "";

  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", fromStoreId],
    queryFn: async () => fetchAllPages<any>(`/api/inventory?storeId=${fromStoreId}`),
    enabled: hasStore && !!fromStoreId,
  });

  const resetLines = () => setLines([]);
  const setMode = (next: Mode) => {
    if (next === mode) return;
    setModeRaw(next);
    setOtherId("");
    resetLines();
  };
  const changeOther = (id: string) => {
    setOtherId(id);
    // In a request the items come from the chosen branch, so a new choice invalidates them.
    if (mode === "request") resetLines();
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one item.");
      if (!otherId) throw new Error(mode === "send" ? "Please select a receiving branch." : "Please select the branch to request from.");
      if (otherId === currentStore!.id) throw new Error("Source and target stores must be different.");
      const items = lines.map((line) => {
        const inv = inventoryItems.find((i) => i.id === line.inventoryId);
        const max = inv ? inv.quantity : 0;
        const val = Number(line.quantity) || 1;
        return { inventoryId: line.inventoryId, quantity: Math.max(1, max ? Math.min(max, val) : val) };
      });
      const res = await apiRequest("POST", "/api/stock-transfers", {
        kind: mode,
        fromStoreId,
        toStoreId,
        notes: notes.trim() || null,
        items,
      });
      return res.json().catch(() => ({}));
    },
    onSuccess: async () => {
      if (draftId) {
        // The transfer now exists, so the draft is spent. A failed cleanup must not undo the send.
        await apiRequest("DELETE", `/api/stock-transfer-drafts/${draftId}`).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/stock-transfer-drafts"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast(mode === "send"
        ? { title: "Transfer sent", description: "Stock is set aside until the receiving branch confirms it." }
        : { title: "Request sent", description: `${fromName} has been asked to approve it.` });
      setLocation("/stock-transfers");
    },
    onError: (error: Error) => {
      toast({ title: mode === "send" ? "Could not send transfer" : "Could not send request", description: error.message || "Failed to initiate transfer.", variant: "destructive" });
    },
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="New stock transfer" description="Move stock to another branch" />
        <StoreRequiredAlert title="Store Required for Stock Transfers" />
      </div>
    );
  }
  if (currentStore.id === "all") {
    return (
      <div className="space-y-6">
        <PageHeader title="New stock transfer" description="Move stock to another branch" />
        <ConsolidatedFallbackAlert pageTitle="Stock Transfers" />
      </div>
    );
  }

  const otherStores = stores.filter((s) => s.id !== currentStore.id && s.isActive !== false);
  const otherStore = otherStores.find((s) => s.id === otherId);
  const fromName = mode === "send" ? currentStore.name : otherStore?.name ?? "the supplying branch";
  const toName = mode === "send" ? otherStore?.name ?? "the receiving branch" : currentStore.name;
  const fmt = (v: number) => formatCurrency(v, currentStore.currency || "NGN");

  const invById = (id: string) => inventoryItems.find((i) => i.id === id);
  const available = inventoryItems.filter((i) => i.quantity > 0);
  const pickable = available
    .filter((i) => !lines.some((l) => l.inventoryId === i.id))
    .filter((i) => i.name.toLowerCase().includes(pickerSearch.trim().toLowerCase()));

  const clampQty = (inv: Inventory | undefined, v: number) => Math.max(1, inv ? Math.min(inv.quantity, v) : v);
  const setQty = (index: number, quantity: number | "") =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity } : l)));
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));
  const addLine = (inventoryId: string) => {
    setLines((prev) => [...prev, { inventoryId, quantity: 1 }]);
    setPickerOpen(false);
    setPickerSearch("");
  };

  const totalUnits = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const totalCost = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * Number(invById(l.inventoryId)?.costPrice ?? 0), 0);
  const itemsLabel = `${lines.length} ${lines.length === 1 ? "item" : "items"}, ${totalUnits} ${totalUnits === 1 ? "unit" : "units"}`;
  const canSend = !!toStoreId && lines.length > 0 && !createMutation.isPending && !savingDraft;
  const send = () => createMutation.mutate();

  const sendButton = (className?: string) => (
    <Button className={className} size="lg" onClick={send} disabled={!canSend} data-testid="button-send-transfer">
      {createMutation.isPending ? "Sending…" : mode === "send" ? "Send transfer" : "Send request"}
    </Button>
  );
  // Worth saving once there is something to come back to.
  const canSaveDraft = (lines.length > 0 || !!otherId || notes.trim() !== "") && !createMutation.isPending && !savingDraft;
  const draftButton = (className?: string) => (
    <Button className={className} size="lg" variant="outline" onClick={saveDraft} disabled={!canSaveDraft} data-testid="button-save-transfer-draft">
      <Save className="mr-1.5 h-4 w-4" />
      {savingDraft ? "Saving…" : "Save as draft"}
    </Button>
  );

  const footnote = mode === "send"
    ? `Stock is set aside at ${fromName} now and moves when ${toName} confirms it has arrived.`
    : `Nothing moves until ${fromName} approves. You confirm when the stock arrives.`;

  const currentBranchField = (label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex h-11 items-center gap-3 rounded-lg bg-muted/60 px-3">
        <StoreIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-semibold">{currentStore.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Current branch</span>
      </div>
    </div>
  );
  const branchSelect = (label: string, placeholder: string) => (
    <div className="space-y-2">
      <Label htmlFor="otherStore">{label}</Label>
      <Select value={otherId} onValueChange={changeOther}>
        <SelectTrigger id="otherStore" className="h-11">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {otherStores.length === 0 ? (
            <div className="px-2 py-2 text-center text-sm text-muted-foreground">No other branches</div>
          ) : (
            otherStores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
          )}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6 pb-44 lg:pb-0">
      <PageHeader
        title={mode === "send" ? "New stock transfer" : "Request stock"}
        description={mode === "send"
          ? `Move stock from ${currentStore.name} to another branch${business?.name ? ` of ${business.name}` : ""}.`
          : `Ask another branch${business?.name ? ` of ${business.name}` : ""} to send stock to ${currentStore.name}.`}
        compact
        actions={
          <Button variant="outline" onClick={() => setLocation("/stock-transfers")} aria-label="Back to stock transfers">
            <ArrowLeft className="h-4 w-4 lg:mr-2" />
            <span className="hidden lg:inline">Stock transfers</span>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4 min-w-0">
          {/* Send or request */}
          <div role="tablist" aria-label="Transfer type" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {([
              { value: "send", label: "Send stock", hint: "Push stock to another branch" },
              { value: "request", label: "Request stock", hint: "Ask a branch to send you stock" },
            ] as const).map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={mode === m.value}
                onClick={() => setMode(m.value)}
                data-testid={`tab-transfer-${m.value}`}
                className={`rounded-lg px-3 py-2 text-left transition-colors ${mode === m.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="hidden text-xs sm:block">{m.hint}</span>
              </button>
            ))}
          </div>

          {/* 1. Route */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <StepHeading
                n={1}
                title="Route"
                sub={mode === "send" ? "Stock leaves the branch you are working in." : "Stock arrives at the branch you are working in."}
              />
              <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
                {mode === "send" ? currentBranchField("From") : branchSelect("From", "Select branch to request from")}
                <ArrowRight className="hidden h-4 w-4 mb-3.5 text-muted-foreground lg:block" />
                {mode === "send" ? branchSelect("To", "Select receiving branch") : currentBranchField("To")}
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "send"
                  ? "To send from a different branch, switch branch at the top of the page first."
                  : "To request for a different branch, switch branch at the top of the page first."}
              </p>
            </CardContent>
          </Card>

          {/* 2. Items */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <StepHeading n={2} title={`Items (${lines.length})`} sub={mode === "send" ? `Only stock on hand at ${fromName} can be sent.` : otherId ? `Only stock on hand at ${fromName} can be requested.` : "Choose the branch to request from first."} />

              {lines.length > 0 && (
                <>
                  <div className="hidden grid-cols-[minmax(0,1.4fr)_150px_minmax(0,1fr)_110px_32px] gap-3 border-b pb-2 text-xs font-semibold text-muted-foreground lg:grid">
                    <span>Item</span><span>Quantity</span><span>Availability</span><span className="text-right">Value at cost</span><span />
                  </div>
                  <div className="divide-y">
                    {lines.map((line, index) => {
                      const inv = invById(line.inventoryId);
                      const max = inv?.quantity ?? 0;
                      const qty = Number(line.quantity) || 0;
                      return (
                        <div key={line.inventoryId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-3 py-4 first:pt-0 lg:grid-cols-[minmax(0,1.4fr)_150px_minmax(0,1fr)_110px_32px]">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{inv?.name ?? "Unknown item"}</p>
                            <p className="text-xs capitalize text-muted-foreground lg:block hidden">{inv?.type ?? "product"}</p>
                            <p className="text-xs text-muted-foreground lg:hidden">{max} available at {fromName}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            aria-label={`Remove ${inv?.name ?? "item"}`}
                            className="justify-self-end rounded p-1 text-muted-foreground hover:text-foreground lg:order-last"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <div className="col-span-2 flex items-center gap-3 lg:col-span-1 lg:contents">
                            <div className="flex h-11 w-[150px] items-center rounded-lg border">
                              <button type="button" aria-label="Decrease quantity" className="flex h-full w-10 items-center justify-center text-muted-foreground disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty(index, clampQty(inv, qty - 1))}>
                                <Minus className="h-4 w-4" />
                              </button>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={max || undefined}
                                value={line.quantity}
                                aria-label="Quantity"
                                className="h-full min-w-0 flex-1 border-0 px-0 text-center font-semibold shadow-none focus-visible:ring-0"
                                onChange={(e) => {
                                  if (e.target.value === "") return setQty(index, "");
                                  const v = Number(e.target.value);
                                  if (!isNaN(v)) setQty(index, max ? Math.min(max, v) : v);
                                }}
                                onBlur={() => setQty(index, clampQty(inv, qty || 1))}
                              />
                              <button type="button" aria-label="Increase quantity" className="flex h-full w-10 items-center justify-center text-muted-foreground disabled:opacity-40" disabled={!!max && qty >= max} onClick={() => setQty(index, clampQty(inv, qty + 1))}>
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground lg:hidden">{fromName} keeps {max - qty}</p>
                          </div>
                          <div className="hidden text-xs text-muted-foreground lg:block">
                            <p>{max} available at {fromName}</p>
                            <p>{fromName} keeps {max - qty}</p>
                          </div>
                          <p className="hidden text-right text-sm font-semibold tabular-nums lg:block">{fmt(qty * Number(inv?.costPrice ?? 0))}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {!!fromStoreId && available.length === 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {fromStoreId ? `No inventory at ${fromName} is in stock, so there is nothing to ${mode === "send" ? "transfer" : "request"}.` : null}
                </p>
              )}

              <Button
                type="button"
                variant="outline"
                className="h-11 w-full border-dashed text-primary"
                onClick={() => setPickerOpen(true)}
                disabled={!fromStoreId || available.length === 0 || lines.length >= available.length}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add item from {fromName}
              </Button>
            </CardContent>
          </Card>

          {/* 3. Note */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <StepHeading
                n={3}
                title={mode === "send" ? "Note for the receiving branch" : "Note for the supplying branch"}
                sub={mode === "send" ? "Optional. Shown to whoever receives the stock." : "Optional. Shown to whoever reviews your request."}
              />
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                aria-label={mode === "send" ? "Note for the receiving branch" : "Note for the supplying branch"}
                placeholder={mode === "send"
                  ? `For example: slow sellers here, promotion running at ${toName}`
                  : `For example: running low on these, needed before the weekend`}
              />
            </CardContent>
          </Card>

          {/* Phones: what happens next */}
          <Card className="lg:hidden">
            <CardContent className="p-5"><NextSteps mode={mode} from={fromName} to={toName} /></CardContent>
          </Card>
        </div>

        {/* Desktop: summary */}
        <Card className="hidden lg:block lg:sticky lg:top-4">
          <CardContent className="space-y-4 p-5">
            <h2 className="text-lg font-bold">Transfer summary</h2>
            <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-3 text-sm font-semibold">
              <span className="truncate">{fromName}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{toName}</span>
            </div>
            <dl className="space-y-2 border-b pb-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Sending</dt><dd className="font-semibold tabular-nums">{itemsLabel}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Value at cost</dt><dd className="font-semibold tabular-nums">{fmt(totalCost)}</dd></div>
            </dl>
            <NextSteps mode={mode} from={fromName} to={toName} />
            <div className="space-y-2">{sendButton("w-full")}{draftButton("w-full")}</div>
            <p className="text-xs text-muted-foreground">{footnote}</p>
          </CardContent>
        </Card>
      </div>

      {/* Phones: sticky send bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="flex items-center justify-between text-sm">
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="truncate">{fromName}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{toName}</span>
          </span>
          <span className="shrink-0 text-muted-foreground">{itemsLabel}</span>
        </div>
        <div className="flex gap-2">{draftButton("shrink-0")}{sendButton("flex-1")}</div>
        <p className="text-center text-xs text-muted-foreground">{footnote}</p>
      </div>

      {/* Item picker */}
      <Dialog open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setPickerSearch(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add item from {fromName}</DialogTitle>
            <DialogDescription>Only items with stock on hand are listed.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Search items" aria-label="Search items" className="pl-9" />
          </div>
          <div className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
            {pickable.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{pickerSearch ? `No items match "${pickerSearch}".` : "Every item in stock has been added."}</p>
            ) : (
              pickable.map((inv) => (
                <button key={inv.id} type="button" onClick={() => addLine(inv.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{inv.name}</span>
                    <span className="block text-xs capitalize text-muted-foreground">{inv.type}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{inv.quantity} in stock</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
