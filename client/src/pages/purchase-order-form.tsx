import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, Minus, Plus, Search, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { placedOrderMessage, type SupplierEmailOutcome } from "@/lib/poSupplierEmail";
import { attachPoReceipt, checkPoReceiptFile, PO_RECEIPT_ACCEPT } from "@/lib/poReceiptUpload";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency as formatCurrencyUtil, getCurrencyByCode } from "@/lib/currency-utils";
import type { Inventory } from "@shared/schema";
import type { FullPO } from "@/lib/purchase-order-types";

type Vendor = { id: string; name: string; phone?: string | null; email?: string | null; companyName?: string | null };

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="h-7 w-7 shrink-0 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-semibold flex items-center justify-center">{n}</span>
        <div>
          <h2 className="font-semibold leading-7">{title}</h2>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function PurchaseOrderFormPage() {
  const [, setLocation] = useLocation();
  const { currentStore, stores } = useStore();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  // /purchase-orders/:id/edit edits a draft; /purchase-orders/new creates one.
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = !!editId;
  const { data: editPO } = useQuery<FullPO>({
    queryKey: ["/api/purchase-orders", editId],
    queryFn: async () => (await apiRequest("GET", `/api/purchase-orders/${editId}`)).json(),
    enabled: isEdit,
  });

  // New PO form state
  const [vendorId, setVendorId] = useState<string>("");
  const [poNumber, setPoNumber] = useState<string>("");
  const [supplierRef, setSupplierRef] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [ownPoNumber, setOwnPoNumber] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [items, setItems] = useState<{ inventoryId: string; quantity: number; unitCost: number }[]>([]);

  // Only drafts are editable; anything else goes back to the order's page.
  useEffect(() => {
    if (editPO && editPO.status !== "draft") setLocation(`/purchase-orders/${editPO.id}`);
  }, [editPO, setLocation]);

  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!editPO || prefilled) return;
    setVendorId(editPO.vendorId);
    setPoNumber(editPO.poNumber);
    setSupplierRef(editPO.supplierRef ?? "");
    setNotes(editPO.notes ?? "");
    setOwnPoNumber(true);
    setExpectedDelivery(editPO.expectedDelivery ? new Date(editPO.expectedDelivery).toISOString().slice(0, 10) : "");
    setItems(editPO.items.map((i) => ({ inventoryId: i.inventoryId, quantity: i.quantity, unitCost: i.unitCost })));
    setPrefilled(true);
  }, [editPO, prefilled]);

  // Quick Add Vendor State
  const [isQuickVendorOpen, setIsQuickVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorContact, setNewVendorContact] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorNotes, setNewVendorNotes] = useState("");
  const [newVendorStoreId, setNewVendorStoreId] = useState("");

  const createVendorMutation = useMutation({
    mutationFn: async () => {
      if (!newVendorName.trim()) throw new Error("Vendor name is required.");
      const storeIdToUse = currentStore?.id === "all" ? newVendorStoreId : currentStore!.id;
      if (!storeIdToUse) throw new Error("Please select a store location.");

      const res = await apiRequest("POST", "/api/vendors", {
        storeId: storeIdToUse,
        name: newVendorName.trim(),
        contactName: newVendorContact.trim() || undefined,
        email: newVendorEmail.trim() || undefined,
        phone: newVendorPhone.trim() || undefined,
        address: newVendorAddress.trim() || undefined,
        notes: newVendorNotes.trim() || undefined,
      });
      return (await res.json()) as Vendor;
    },
    onSuccess: async (created) => {
      // Refresh first so the new vendor exists in the dropdown, then select it.
      await queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      if (created?.id) setVendorId(created.id);
      toast({ title: "Success", description: "Supplier / Vendor added successfully." });
      setIsQuickVendorOpen(false);
      setNewVendorName("");
      setNewVendorContact("");
      setNewVendorEmail("");
      setNewVendorPhone("");
      setNewVendorAddress("");
      setNewVendorNotes("");
      setNewVendorStoreId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create vendor.", variant: "destructive" });
    },
  });

  // Fetch Vendors
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", currentStore?.id, stores.map(s => s.id).join(","), editPO?.storeId],
    queryFn: async () => {
      if (editPO) return (await apiRequest("GET", `/api/vendors?storeId=${editPO.storeId}`)).json();
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/vendors?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Vendor[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/vendors?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: isEdit ? !!editPO : currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Inventory items
  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id, stores.map(s => s.id).join(","), editPO?.storeId],
    queryFn: async () => {
      if (editPO) return (await apiRequest("GET", `/api/inventory?storeId=${editPO.storeId}`)).json();
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/inventory?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Inventory[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: isEdit ? !!editPO : currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Create PO mutation — "draft" just saves it for later editing/review; "ordered"
  // places the order and emails the supplier.
  const createPOMutation = useMutation({
    mutationFn: async (status: "draft" | "ordered") => {
      if (items.length === 0) throw new Error("At least one item is required.");
      if (!vendorId) throw new Error("Please select a vendor.");
      if (items.some((i) => !i.inventoryId)) throw new Error("Choose a product for every line.");
      if (items.some((i) => !(i.quantity > 0))) throw new Error("Enter an order quantity above 0 for every line.");

      if (isEdit) {
        await apiRequest("PUT", `/api/purchase-orders/${editId}`, {
          vendorId,
          poNumber: ownPoNumber ? poNumber.trim() || undefined : undefined,
          supplierRef: supplierRef.trim() || undefined,
          notes: notes.trim() || undefined,
          expectedDelivery: expectedDelivery || null,
          items,
        });
        let supplierEmail: SupplierEmailOutcome;
        if (status === "ordered") {
          const res = await apiRequest("PATCH", `/api/purchase-orders/${editId}/status`, { status: "ordered" });
          supplierEmail = (await res.json()).supplierEmail;
        }
        return { id: editId!, receiptFailed: false, supplierEmail };
      }

      // In "All stores" view the PO belongs to the selected vendor's store.
      const storeId = currentStore?.id === "all"
        ? (vendors.find((v) => v.id === vendorId) as { storeId?: string } | undefined)?.storeId
        : currentStore?.id;
      if (!storeId) throw new Error("Please select a store location.");

      const submission = {
        storeId,
        vendorId,
        poNumber: ownPoNumber ? poNumber.trim() || undefined : undefined,
        supplierRef: supplierRef.trim() || undefined,
        notes: notes.trim() || undefined,
        status,
        expectedDelivery: expectedDelivery || null,
        items,
      };
      const res = await apiRequest("POST", "/api/purchase-orders", submission);
      const created = await res.json();

      // Optional receipt. The PO is already saved, so a failed upload must not
      // look like a failed save - it can be attached later from the PO.
      let receiptFailed = false;
      if (receiptFile && created?.id) {
        try {
          await attachPoReceipt(created.id, receiptFile);
        } catch {
          receiptFailed = true;
        }
      }
      return { id: created.id as string, receiptFailed, supplierEmail: created?.supplierEmail as SupplierEmailOutcome };
    },
    onSuccess: (result, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Success",
        description: (status === "ordered"
            ? placedOrderMessage(result?.supplierEmail, vendors.find((v) => v.id === vendorId)?.name)
            : isEdit ? "Changes saved." : "Purchase order saved as draft.")
          + (result?.receiptFailed ? " The receipt couldn't be uploaded - attach it from the purchase order." : ""),
      });
      setLocation(`/purchase-orders/${result.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save Purchase Order.", variant: "destructive" });
    },
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const invById = new Map<string, Inventory>([
    ...(editPO?.items.map((i) => [i.inventoryId, i.inventory] as const) ?? []),
    ...inventoryItems.map((i) => [i.id, i] as const),
  ]);

  const addInventoryItem = (inv: Inventory) => {
    const existing = items.findIndex((i) => i.inventoryId === inv.id);
    if (existing >= 0) {
      setItems(items.map((it, idx) => (idx === existing ? { ...it, quantity: it.quantity + 1 } : it)));
    } else {
      setItems([...items, { inventoryId: inv.id, quantity: 1, unitCost: Number(inv.costPrice || 0) }]);
    }
    setPickerOpen(false);
    setSearch("");
  };

  const removeItemRow = (index: number) => setItems(items.filter((_, i) => i !== index));

  const updateItemRow = (index: number, field: "quantity" | "unitCost", value: number) =>
    setItems(items.map((it, i) => (i === index ? { ...it, [field]: value } : it)));

  const dateOffset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const poTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const currencySymbol = getCurrencyByCode(storeCurrency)?.symbol ?? storeCurrency;
  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const storeLabel = editPO ? (stores.find((st) => st.id === editPO.storeId)?.name ?? currentStore?.name) : currentStore?.name;
  const pending = createPOMutation.isPending;
  const pickerResults = inventoryItems
    .filter((inv) => {
      const q = search.trim().toLowerCase();
      return !q || inv.name.toLowerCase().includes(q) || inv.id.substring(0, 8).toLowerCase().includes(q);
    })
    .slice(0, 30);
  const unitsText = `${items.length} item${items.length === 1 ? "" : "s"}, ${totalUnits} unit${totalUnits === 1 ? "" : "s"}`;
  const longDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const summaryRows = (
    <>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Vendor</span><span className="font-semibold">{selectedVendor?.name ?? "—"}</span></div>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Items</span><span className="font-semibold">{unitsText}</span></div>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Expected</span><span className="font-semibold">{expectedDelivery ? longDate(expectedDelivery) : "Not set"}</span></div>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(poTotal)}</span></div>
    </>
  );

  return (
    <div className="max-w-6xl mx-auto pb-40 lg:pb-8 animate-in fade-in duration-300">
      {/* Phone header */}
      <div className="lg:hidden sticky top-0 z-20 -mx-4 px-4 py-3 mb-4 bg-background/95 backdrop-blur border-b flex items-center gap-3">
        <IconButton variant="ghost" label="Back" className="h-8 w-8" onClick={() => setLocation(isEdit ? `/purchase-orders/${editId}` : "/purchase-orders")}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm truncate">{isEdit ? `Edit ${editPO?.poNumber ?? "order"}` : "New purchase order"}</h1>
          <p className="text-xs text-muted-foreground truncate">{storeLabel}</p>
        </div>
        <button
          type="button"
          className="text-sm font-semibold text-primary disabled:opacity-50"
          disabled={pending || items.length === 0}
          onClick={() => createPOMutation.mutate("draft")}
        >
          {isEdit ? "Save" : "Save draft"}
        </button>
      </div>

      {/* Desktop header */}
      <div className="hidden lg:block mb-6">
        <PageHeader
          compact
          title={isEdit ? "Edit purchase order" : "New purchase order"}
          description={`For ${storeLabel}. Nothing is sent to the vendor until you place the order.`}
          actions={
            <Button variant="outline" onClick={() => setLocation(isEdit ? `/purchase-orders/${editId}` : "/purchase-orders")}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              {isEdit ? "Back to Purchase Order" : "Back to Purchase Orders"}
            </Button>
          }
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5">
          {/* 1. Vendor */}
          <Section
            n={1}
            title="Vendor"
            hint="Who you are ordering from."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="vendor">Vendor</Label>
                <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setIsQuickVendorOpen(true)}>
                  New vendor
                </button>
              </div>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="vendor" className="h-12">
                  <SelectValue placeholder="Choose a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.companyName ? ` (${v.companyName})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVendor && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                  <span className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center">
                    {selectedVendor.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold truncate">{selectedVendor.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Corporate ID {selectedVendor.id.substring(0, 8).toUpperCase()} · {selectedVendor.phone || "No phone number"}
                      {!selectedVendor.email && " · No email"}
                    </p>
                  </div>
                </div>
              )}
              {selectedVendor && !selectedVendor.email && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This vendor has no email, so placing the order won't notify them - you'd contact them yourself.
                </p>
              )}
            </div>
          </Section>

          {/* 2. Items */}
          <Section
            n={2}
            title={`Items (${items.length})`}
            hint="Pick from inventory. Unit cost starts at the last price paid."
          >
            {items.length > 0 && (
              <div>
                <div className="hidden sm:grid grid-cols-[1fr_150px_130px_110px_32px] gap-3 pb-2 border-b text-xs font-medium text-muted-foreground">
                  <span>Item</span><span className="text-center">Quantity</span><span>Unit cost</span><span className="text-right">Line total</span><span />
                </div>
                {items.map((item, index) => {
                  const inv = invById.get(item.inventoryId);
                  const out = inv ? Number(inv.quantity) <= 0 : false;
                  const frac = !!inv?.allowFractional;
                  return (
                    <div key={item.inventoryId} className="py-3 border-b last:border-b-0 space-y-2 sm:space-y-0 sm:grid sm:grid-cols-[1fr_150px_130px_110px_32px] sm:gap-3 sm:items-center">
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{inv?.name ?? "Item"}</p>
                          <p className="text-xs text-muted-foreground">SKU {item.inventoryId.substring(0, 8).toUpperCase()}</p>
                          {out && <p className="text-xs text-amber-700 dark:text-amber-400">Out of stock</p>}
                        </div>
                        <IconButton variant="ghost" label={`Remove ${inv?.name ?? "item"}`} className="h-8 w-8 sm:hidden" onClick={() => removeItemRow(index)}>
                          <Trash className="h-4 w-4 text-muted-foreground" />
                        </IconButton>
                      </div>
                      <div className="flex items-center gap-2 sm:contents">
                        <div className="flex items-center rounded-lg border h-10 sm:w-full">
                          <button type="button" aria-label="Decrease quantity" className="px-3 h-full text-muted-foreground hover:text-foreground" onClick={() => updateItemRow(index, "quantity", Math.max(0, Number((item.quantity - 1).toFixed(2))))}>
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            type="number"
                            aria-label="Quantity"
                            min={0}
                            step={frac ? "0.01" : "1"}
                            value={item.quantity}
                            onChange={(e) => {
                              const n = frac ? parseFloat(e.target.value) : parseInt(e.target.value);
                              updateItemRow(index, "quantity", Number.isFinite(n) && n >= 0 ? n : 0);
                            }}
                            className="w-full min-w-0 text-center bg-transparent outline-none font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button type="button" aria-label="Increase quantity" className="px-3 h-full text-muted-foreground hover:text-foreground" onClick={() => updateItemRow(index, "quantity", Number((item.quantity + 1).toFixed(2)))}>
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <span className="text-muted-foreground sm:hidden">×</span>
                        <div className="relative sm:w-full flex-1 sm:flex-none">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                          <Input
                            type="number"
                            aria-label="Unit cost"
                            min={0}
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => updateItemRow(index, "unitCost", Math.max(0, Number(e.target.value) || 0))}
                            className="h-10 pl-8 text-right"
                          />
                        </div>
                        <span className="font-semibold text-right sm:block shrink-0">{formatCurrency(item.quantity * item.unitCost)}</span>
                        <IconButton variant="ghost" label={`Remove ${inv?.name ?? "item"}`} className="h-8 w-8 hidden sm:inline-flex" onClick={() => removeItemRow(index)}>
                          <Trash className="h-4 w-4 text-muted-foreground" />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pickerOpen ? (
              <div className="rounded-xl border shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-3 border-b">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search inventory by name or SKU"
                    aria-label="Search inventory"
                    className="flex-1 min-w-0 h-12 bg-transparent outline-none text-sm"
                  />
                  <button type="button" className="text-sm font-semibold" onClick={() => { setPickerOpen(false); setSearch(""); }}>Close</button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {pickerResults.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No inventory matches "{search}".</p>
                  ) : (
                    pickerResults.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => addInventoryItem(inv)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left border-b last:border-b-0 hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold truncate">{inv.name}</span>
                          <span className={`block text-xs ${Number(inv.quantity) <= 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {Number(inv.quantity) <= 0 ? "Out of stock" : `${inv.quantity} ${inv.unit || "pcs"} in stock`}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">Last cost {formatCurrency(Number(inv.costPrice || 0))}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="bg-muted/50 px-4 py-3 text-sm">
                  <a href="/inventory/new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    <span className="text-muted-foreground">Not in inventory?</span>
                    <span className="font-semibold text-primary">Create a new item</span>
                  </a>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full gap-2" onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4" /> Add item
              </Button>
            )}
          </Section>

          {/* 3. Delivery & references */}
          <Section n={3} title="Delivery and references" hint="When you expect it, and how both sides will refer to it.">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Expected arrival</Label>
                <div className="flex flex-wrap gap-2">
                  {[["Today", 0], ["Tomorrow", 1], ["In a week", 7]].map(([label, days]) => {
                    const value = dateOffset(days as number);
                    const active = expectedDelivery === value;
                    return (
                      <button
                        key={label as string}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setExpectedDelivery(value)}
                        className={`rounded-full border px-4 py-2 text-sm font-medium ${active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Input id="expectedDelivery" type="date" aria-label="Expected arrival date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} className="h-12" />
                {expectedDelivery && <p className="text-xs text-muted-foreground">{longDate(expectedDelivery)}</p>}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="poNumber">PO number</Label>
                  {ownPoNumber ? (
                    <div className="flex gap-2">
                      <Input id="poNumber" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-ABC-12" className="h-12 font-mono" autoFocus={!isEdit} />
                      {!isEdit && (
                        <Button type="button" variant="ghost" className="h-12" onClick={() => { setOwnPoNumber(false); setPoNumber(""); }}>Auto</Button>
                      )}
                    </div>
                  ) : (
                    <div className="h-12 rounded-lg border border-dashed flex items-center justify-between px-3 text-sm">
                      <span className="text-muted-foreground">Assigned when you save</span>
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setOwnPoNumber(true)}>Use my own</button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplierRef">Supplier reference <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="supplierRef" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="Their quote or invoice number" className="h-12" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="poNotes">Note to vendor <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <textarea
                  id="poNotes"
                  value={notes}
                  maxLength={1000}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Delivery instructions, brand or size preferences"
                  rows={4}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {!isEdit && (
                <div className="space-y-2">
                  <Label htmlFor="poReceipt">Supplier receipt or invoice <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="poReceipt"
                    type="file"
                    accept={PO_RECEIPT_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) {
                        try { checkPoReceiptFile(f); } catch (err) {
                          toast({ title: "Can't use that file", description: (err as Error).message, variant: "destructive" });
                          e.target.value = "";
                          return;
                        }
                      }
                      setReceiptFile(f);
                    }}
                  />
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Desktop summary */}
        <aside className="hidden lg:block lg:sticky lg:top-4">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h2 className="font-semibold text-lg">Order summary</h2>
            {summaryRows}
            <div className="border-t border-dashed pt-4 flex items-end justify-between">
              <span className="font-semibold">Total</span>
              <span className="text-3xl font-bold tracking-tight">{formatCurrency(poTotal)}</span>
            </div>
            <Button className="w-full h-12 text-base" disabled={pending || items.length === 0} onClick={() => createPOMutation.mutate("ordered")} data-testid="button-place-order">
              {pending ? "Saving…" : "Place order"}
            </Button>
            <Button variant="outline" className="w-full h-11" disabled={pending || items.length === 0} onClick={() => createPOMutation.mutate("draft")} data-testid="button-save-draft">
              {isEdit ? "Save changes" : "Save as draft"}
            </Button>
            <p className="text-xs text-muted-foreground">Stock is added to {storeLabel} when you receive this order.</p>
          </div>
        </aside>
      </div>

      {/* Phone: sticky summary + action */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"} · {totalUnits} unit{totalUnits === 1 ? "" : "s"}</span>
          <span className="text-lg font-bold">{formatCurrency(poTotal)}</span>
        </div>
        <Button className="w-full h-12 text-base" disabled={pending || items.length === 0} onClick={() => createPOMutation.mutate("ordered")}>
          {pending ? "Saving…" : "Place order"}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">Stock is added to {storeLabel} when you receive this order.</p>
      </div>

      {/* Quick Add Vendor Dialog */}
      <Dialog open={isQuickVendorOpen} onOpenChange={setIsQuickVendorOpen}>
        <DialogContent className="max-w-md border border-border bg-background/95 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Plus className="h-5 w-5 text-primary" /> Quick Add Supplier
            </DialogTitle>
            <DialogDescription>
              Create a new supplier / vendor profile to authorize procurement orders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {currentStore?.id === "all" && (
              <div className="space-y-2">
                <Label htmlFor="vendor-store">Target Store Location</Label>
                <Select value={newVendorStoreId} onValueChange={setNewVendorStoreId}>
                  <SelectTrigger id="vendor-store">
                    <SelectValue placeholder="Choose a branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.filter(s => s.id !== "all").map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="vendor-name">Supplier Name</Label>
              <Input
                id="vendor-name"
                placeholder="e.g. Acme Supplies Ltd"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-contact">Contact Person / Organization / Company (Optional)</Label>
              <Input
                id="vendor-contact"
                placeholder="e.g. John Doe or Acme Ltd."
                value={newVendorContact}
                onChange={(e) => setNewVendorContact(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor-email">Email (Optional)</Label>
                <Input
                  id="vendor-email"
                  type="email"
                  placeholder="e.g. acme@example.com"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-phone">Phone (Optional)</Label>
                <Input
                  id="vendor-phone"
                  placeholder="e.g. +234 80 1234 5678"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-address">Address (Optional)</Label>
              <Input
                id="vendor-address"
                placeholder="e.g. 12 Industrial Way, Lagos"
                value={newVendorAddress}
                onChange={(e) => setNewVendorAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-notes">Notes (Optional)</Label>
              <Input
                id="vendor-notes"
                placeholder="Preferred categories, lead times, etc."
                value={newVendorNotes}
                onChange={(e) => setNewVendorNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsQuickVendorOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createVendorMutation.mutate()}
                disabled={createVendorMutation.isPending || !newVendorName.trim() || (currentStore?.id === "all" && !newVendorStoreId)}
                className="px-6"
              >
                {createVendorMutation.isPending ? "Adding..." : "Add Supplier"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
