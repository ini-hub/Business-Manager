import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { buildSlug } from "@/lib/slug";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Plus,
  X,
  ChevronLeft,
  Package,
  Wrench,
  Droplets,
  AlertTriangle,
  Info,
  Save,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { cartesianProduct, comboKey, comboLabel } from "@/lib/variant-combos";
import { MAX_VARIANTS_PER_PRODUCT } from "@shared/constants";

// ── Types ──────────────────────────────────────────────────────────────────

type ItemType = "product" | "service" | "supply";

interface Attribute {
  name: string;
  values: string[];
}

// Per-variant overrides. A blank price inherits the item default.
interface VariantDetail {
  costPrice: number | "";
  sellingPrice: number | "";
  quantity: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRESET_ATTRS = ["Size", "Color", "Flavor", "Material", "Style", "Weight"];

const TYPE_OPTIONS: { value: ItemType; label: string; hint: string; icon: typeof Package }[] = [
  { value: "product", label: "Product", hint: "Sold to customers, stock is tracked", icon: Package },
  { value: "service", label: "Service", hint: "Work you perform, no stock", icon: Wrench },
  { value: "supply", label: "Supply", hint: "Used up during services, never sold", icon: Droplets },
];

const numberOrBlank = (v: string): number | "" => (v === "" ? "" : parseFloat(v));

function SectionCard({
  n,
  title,
  description,
  children,
}: {
  n: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
            {n}
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-destructive">{children}</p>;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function InventoryNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const queryClient = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);

  const isMultiStore = currentStore?.id === "all";
  const defaultStoreId = isMultiStore ? "" : (currentStore?.id || "");

  // ── Form state ────────────────────────────────────────────────────────

  const [storeId, setStoreId] = useState(defaultStoreId);
  const targetStoreId = isMultiStore ? storeId : defaultStoreId;
  const storeName = stores.find((s) => s.id === targetStoreId)?.name || currentStore?.name || "";

  // Currency from the selected/current store's settings
  const settingsStoreId = isMultiStore ? (storeId || stores[0]?.id) : currentStore?.id;
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings", settingsStoreId],
    enabled: !!settingsStoreId,
  });
  const sym: string = settingsData?.currency?.symbol || currentStore?.currency || "₦";

  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("product");
  const [hasVariants, setHasVariants] = useState(false);

  const [costPrice, setCostPrice] = useState<number | "">("");
  const [sellingPrice, setSellingPrice] = useState<number | "">("");
  const [quantity, setQuantity] = useState(0);

  // Item-level: every variant is counted the same way as the item itself.
  const [allowFractional, setAllowFractional] = useState(false);
  const [unit, setUnit] = useState("");

  const [commissionOverride, setCommissionOverride] = useState(false);
  const [bizShare, setBizShare] = useState(80);
  const [staffShare, setStaffShare] = useState(20);

  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [variantDetails, setVariantDetails] = useState<Record<string, VariantDetail>>({});
  const [newAttrName, setNewAttrName] = useState("");
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({});

  const [saving, setSaving] = useState(false);
  // Errors only show after the first failed submit, so a fresh form isn't covered in red.
  const [showErrors, setShowErrors] = useState(false);


  const isService = type === "service";
  const isSupply = type === "supply";
  const canHaveVariants = !isSupply;
  const usesVariants = hasVariants && canHaveVariants;
  const tracksStock = !isService;
  const sellsItem = !isSupply;

  // ── Drafts ────────────────────────────────────────────────────────────
  // Saved server-side (inventory_drafts), so a half-filled item survives a device
  // change. A draft is form state only — it is not an inventory item.

  const draftParam = new URLSearchParams(useSearch()).get("draft");
  const [draftId, setDraftId] = useState<string | null>(draftParam);
  const [savingDraft, setSavingDraft] = useState(false);
  const hydrated = useRef(false);

  const { data: loadedDraft, isError: draftMissing } = useQuery<any>({
    queryKey: ["/api/inventory-drafts", draftParam],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-drafts/${draftParam}`);
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
    if (f.storeId) setStoreId(f.storeId);
    setName(f.name ?? "");
    setType(f.type || "product");
    setHasVariants(!!f.hasVariants);
    setCostPrice(f.costPrice ?? "");
    setSellingPrice(f.sellingPrice ?? "");
    setQuantity(f.quantity ?? 0);
    setAllowFractional(!!f.allowFractional);
    setUnit(f.unit ?? "");
    setCommissionOverride(!!f.commissionOverride);
    setBizShare(f.bizShare ?? 80);
    setStaffShare(f.staffShare ?? 20);
    setAttributes(f.attributes ?? []);
    setDeselected(new Set(f.deselected ?? []));
    setVariantDetails(f.variantDetails ?? {});
  }, [loadedDraft]);

  useEffect(() => {
    if (draftMissing) {
      toast({ title: "Draft not found", description: "It may have been discarded or finished.", variant: "destructive" });
      setDraftId(null);
    }
  }, [draftMissing, toast]);

  const saveDraft = async () => {
    if (!targetStoreId) {
      toast({ title: "Pick a store first", description: "A draft has to belong to a store.", variant: "destructive" });
      return;
    }
    setSavingDraft(true);
    try {
      const payload = {
        storeId: targetStoreId,
        name: name.trim() || null,
        type: type || null,
        step: "0",
        formData: {
          storeId: targetStoreId, name, type, hasVariants, costPrice, sellingPrice, quantity,
          allowFractional, unit, commissionOverride, bizShare, staffShare,
          attributes, deselected: Array.from(deselected), variantDetails,
        },
      };
      const res = draftId
        ? await apiRequest("PUT", `/api/inventory-drafts/${draftId}`, payload)
        : await apiRequest("POST", "/api/inventory-drafts", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save draft");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-drafts"] });
      toast({ title: "Draft saved", description: "Find it under Drafts on the Inventory page." });
      setLocation("/inventory");
    } catch (err: any) {
      toast({ title: "Couldn't save draft", description: err.message, variant: "destructive" });
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Duplicate name check ──────────────────────────────────────────────
  // Mirrors the server rule: same store, same type, case-insensitive name.

  const { data: existingItems = [] } = useQuery<any[]>({
    queryKey: ["/api/products", targetStoreId, "with-supplies"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/products?storeId=${targetStoreId}&include=supplies`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!targetStoreId,
  });

  const duplicate = useMemo(() => {
    const n = name.trim().toLowerCase();
    if (!n) return undefined;
    return existingItems.find((p: any) => p.type === type && String(p.name).trim().toLowerCase() === n);
  }, [existingItems, name, type]);

  // ── Derived ───────────────────────────────────────────────────────────

  const allCombos = useMemo(() => cartesianProduct(attributes), [attributes]);
  const selectedCombos = useMemo(
    () => allCombos.filter((c) => !deselected.has(comboKey(c))),
    [allCombos, deselected]
  );

  const defaultCost = costPrice === "" ? 0 : Number(costPrice);
  const defaultSell = isSupply ? 0 : sellingPrice === "" ? 0 : Number(sellingPrice);

  const effective = (key: string) => {
    const d = variantDetails[key];
    return {
      cost: d?.costPrice !== "" && d?.costPrice !== undefined ? Number(d.costPrice) : defaultCost,
      sell: isSupply ? 0 : d?.sellingPrice !== "" && d?.sellingPrice !== undefined ? Number(d.sellingPrice) : defaultSell,
      qty: d?.quantity ?? 0,
    };
  };

  const costOk = costPrice !== "" && Number(costPrice) > 0;
  const sellOk = !sellsItem || (sellingPrice !== "" && Number(sellingPrice) > 0);
  const inverted = sellsItem && costOk && sellOk && Number(sellingPrice) < Number(costPrice);
  const variantInverted = useMemo(
    () => usesVariants && sellsItem && selectedCombos.some((c) => {
      const e = effective(comboKey(c));
      return e.sell < e.cost;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usesVariants, sellsItem, selectedCombos, variantDetails, costPrice, sellingPrice]
  );

  const splitOk = !isService || !commissionOverride || bizShare + staffShare === 100;

  // The first thing blocking submission, in reading order. Shown under the button.
  const blocker: string | null = (() => {
    if (isMultiStore && !storeId) return "Choose a store to add this to.";
    if (!name.trim()) return "Give the item a name.";
    if (duplicate) return "To add this, choose a different name.";
    if (usesVariants && !attributes.some((a) => a.values.length > 0)) return "Add at least one option value.";
    if (usesVariants && selectedCombos.length === 0) return "Tick at least one variant.";
    if (usesVariants && selectedCombos.length > MAX_VARIANTS_PER_PRODUCT) return `Keep it to ${MAX_VARIANTS_PER_PRODUCT} variants or fewer.`;
    if (!costOk) return "Enter a cost price above 0.";
    if (!sellOk) return "Enter a selling price above 0.";
    if (inverted || variantInverted) return "Selling price can't be lower than cost.";
    if (!splitOk) return "Commission shares must add up to 100%.";
    return null;
  })();

  const itemCount = usesVariants ? selectedCombos.length : 1;
  const totalUnits = !tracksStock
    ? 0
    : usesVariants
    ? selectedCombos.reduce((sum, c) => sum + effective(comboKey(c)).qty, 0)
    : quantity;
  const stockValue = !tracksStock
    ? 0
    : usesVariants
    ? selectedCombos.reduce((sum, c) => {
        const e = effective(comboKey(c));
        return sum + e.qty * e.cost;
      }, 0)
    : quantity * defaultCost;

  const money = (n: number) => `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const margin = (cost: number, sell: number) => (sell > 0 ? Math.round(((sell - cost) / sell) * 100) : null);
  const unitWord = allowFractional && unit.trim() ? unit.trim() : totalUnits === 1 ? "unit" : "units";

  // ── Option helpers ────────────────────────────────────────────────────

  const addAttribute = (raw?: string) => {
    const n = (raw ?? newAttrName).trim().toLowerCase();
    if (!n || attributes.some((a) => a.name === n)) return;
    setAttributes((prev) => [...prev, { name: n, values: [] }]);
    setNewAttrName("");
  };

  const removeAttribute = (i: number) => {
    setAttributes((prev) => prev.filter((_, idx) => idx !== i));
    setValueInputs({});
  };

  const addValue = (attrIdx: number) => {
    const val = (valueInputs[attrIdx] || "").trim();
    if (!val) return;
    setAttributes((prev) =>
      prev.map((a, i) =>
        i === attrIdx ? { ...a, values: a.values.includes(val) ? a.values : [...a.values, val] } : a
      )
    );
    setValueInputs((prev) => ({ ...prev, [attrIdx]: "" }));
  };

  const removeValue = (attrIdx: number, valIdx: number) => {
    setAttributes((prev) =>
      prev.map((a, i) => (i === attrIdx ? { ...a, values: a.values.filter((_, vi) => vi !== valIdx) } : a))
    );
  };

  const toggleCombo = (key: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateVariantDetail = (key: string, field: keyof VariantDetail, value: number | "") => {
    setVariantDetails((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { costPrice: "", sellingPrice: "", quantity: 0 }), [field]: value },
    }));
  };

  const chooseType = (t: ItemType) => {
    setType(t);
    // Supplies are single SKUs: "500ml Shampoo" and "1L Shampoo" are separate
    // supplies with separate costs, not variants.
    if (t === "supply") setHasVariants(false);
    if (t === "service") setAllowFractional(false);
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const save = async () => {
    if (blocker) {
      setShowErrors(true);
      if (!name.trim() || duplicate) nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const fractional = tracksStock && allowFractional;
      const fractionalUnit = fractional && unit.trim() ? unit.trim() : null;

      // 1. Create the product grouping
      const parentRes = await apiRequest("POST", "/api/products", {
        storeId: targetStoreId,
        name: name.trim(),
        type,
      });
      if (!parentRes.ok) {
        const err = await parentRes.json().catch(() => ({}));
        throw new Error((err as any).error?.message || (err as any).error || "Failed to create product");
      }
      const product = await parentRes.json();

      // 2. Create its variants (a simple item is a single variant under the hood)
      if (usesVariants) {
        for (const combo of selectedCombos) {
          const e = effective(comboKey(combo));
          const varRes = await apiRequest("POST", `/api/products/${product.id}/variants`, {
            name: `${name.trim()} - ${comboLabel(combo)}`,
            costPrice: e.cost,
            sellingPrice: e.sell,
            quantity: tracksStock ? e.qty : 0,
            variantDimensions: combo,
            sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            allowFractional: fractional,
            unit: fractionalUnit,
            commissionSplitOverride: isService ? commissionOverride : false,
            commissionSplitBusinessShare: bizShare,
            commissionSplitStaffShare: staffShare,
          });
          if (!varRes.ok) {
            const err = await varRes.json().catch(() => ({}));
            throw new Error((err as any).error?.message || (err as any).error || `Failed to create variant ${comboLabel(combo)}`);
          }
        }
      } else {
        const varRes = await apiRequest("POST", `/api/products/${product.id}/variants`, {
          name: name.trim(),
          costPrice: defaultCost,
          sellingPrice: defaultSell,
          // Services are the only stockless type — supplies carry real stock.
          quantity: tracksStock ? quantity : 0,
          commissionSplitOverride: isService ? commissionOverride : false,
          commissionSplitBusinessShare: bizShare,
          commissionSplitStaffShare: staffShare,
          sku: `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          allowFractional: fractional,
          unit: fractionalUnit,
        });
        if (!varRes.ok) {
          const err = await varRes.json().catch(() => ({}));
          throw new Error((err as any).error?.message || (err as any).error || "Failed to create variant item");
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      if (draftId) {
        // The item now exists, so the draft is spent. A failed cleanup must not undo the save.
        await apiRequest("DELETE", `/api/inventory-drafts/${draftId}`).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/inventory-drafts"] });
      }
      toast({
        title: "Item added",
        description: usesVariants
          ? `"${name}" created with ${selectedCombos.length} variant${selectedCombos.length !== 1 ? "s" : ""}.`
          : `"${name}" has been added to inventory.`,
      });
      setLocation(`/inventory/${buildSlug(name.trim(), product.id)}`);
    } catch (err: any) {
      const msg: string = err.message ?? "";
      if (msg.startsWith("archived:")) {
        toast({
          title: "Item Is Archived",
          description: msg.replace("archived:", "").trim() + " Switch to the Archived tab to restore it.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't Add Item",
          description: msg || "Failed to add item. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Guard ─────────────────────────────────────────────────────────────

  if (!currentStore) return <StoreRequiredAlert />;

  const busy = saving || savingDraft;
  // Currency symbols range from "₦" to "NGN", so the input padding follows the symbol width.
  const symPad = { paddingLeft: `${0.75 + sym.length * 0.6 + 0.5}rem` };
  const invalid = (bad: boolean) => showErrors && bad;
  const errInput = "border-destructive focus-visible:ring-destructive";
  const summaryRows: [string, React.ReactNode][] = [
    ["Name", name.trim() ? <span className={cn(duplicate && "text-destructive")}>{name.trim()}</span> : <span className="text-muted-foreground">Not set</span>],
    ["Type", <span className="capitalize">{type}</span>],
    ...(isMultiStore && storeName ? [["Store", storeName] as [string, React.ReactNode]] : []),
    ...(sellsItem
      ? [[usesVariants ? "Default price" : "Selling price", defaultSell > 0 ? money(defaultSell) : <span className="text-muted-foreground">Not set</span>] as [string, React.ReactNode]]
      : []),
    ["Will create", `${itemCount} ${itemCount === 1 ? "item" : "items"}`],
    ...(tracksStock
      ? [
          ["Opening stock", `${totalUnits.toLocaleString()} ${unitWord}`] as [string, React.ReactNode],
          ["Stock value at cost", money(stockValue)] as [string, React.ReactNode],
        ]
      : []),
  ];

  const unitSelect = (
    <div className="space-y-2">
      <Label>Sold and counted in</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          value={allowFractional ? "fraction" : "whole"}
          onValueChange={(v) => {
            setAllowFractional(v === "fraction");
            if (v !== "fraction") setUnit("");
          }}
        >
          <SelectTrigger data-testid="wiz-select-count-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="whole">Whole units</SelectItem>
            <SelectItem value="fraction">Parts, like 0.5 kg or 1.25 litres</SelectItem>
          </SelectContent>
        </Select>
        {allowFractional && (
          <Input
            placeholder="Unit, e.g. kg, litre, g"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            data-testid="wiz-input-unit"
          />
        )}
      </div>
      {allowFractional && (
        <p className="text-xs text-muted-foreground">Shown next to quantity on receipts and in the cart.</p>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-28 lg:pb-6">
      <PageHeader
        title="New item"
        description={`Add a product, service or supply${storeName ? ` to ${storeName} inventory` : ""}. Everything can be changed later.`}
        compact
        actions={
          <Button variant="outline" onClick={() => setLocation("/inventory")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Inventory
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="space-y-6 min-w-0">
          {/* ── 1. What are you adding ─────────────────────────────── */}
          <SectionCard n={1} title="What are you adding?" description="Name and type decide which fields you need below.">
            {isMultiStore && (
              <div className="space-y-2">
                <Label>Store</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger className={invalid(!storeId) ? errInput : ""} data-testid="wiz-select-store">
                    <SelectValue placeholder="Select a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="inv-name">Item name</Label>
              <Input
                id="inv-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Classic T-Shirt"
                autoFocus
                aria-invalid={!!duplicate}
                className={cn(duplicate && errInput)}
                data-testid="wiz-input-name"
              />
              {duplicate && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-destructive">
                      “{duplicate.name}” is already in {storeName || "this store's"} inventory.
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Open it to add stock or a new variant, or give this item a different name.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/inventory/${buildSlug(duplicate.name, duplicate.id)}`}>
                        Open “{duplicate.name}”
                        <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        nameRef.current?.focus();
                        nameRef.current?.select();
                      }}
                    >
                      Use a different name
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Item type">
              {TYPE_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => chooseType(value)}
                  className={cn(
                    "flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 rounded-lg border p-4 text-left transition-all",
                    type === value
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "hover:border-muted-foreground/40 hover:bg-muted/20"
                  )}
                  data-testid={`wiz-type-${value}`}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", type === value ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground leading-snug">{hint}</div>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* ── 2. Options ─────────────────────────────────────────── */}
          {canHaveVariants && (
            <SectionCard
              n={2}
              title="Options"
              description={
                isService
                  ? "Durations, packages or tiers of this service."
                  : "Sizes, colours, flavours or anything that makes versions of this item different."
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">This item comes in options</div>
                  <p className="text-xs text-muted-foreground">
                    Each combination becomes its own item with its own price and stock.
                  </p>
                </div>
                <Switch
                  checked={hasVariants}
                  onCheckedChange={setHasVariants}
                  data-testid="wiz-switch-has-variants"
                />
              </div>

              {usesVariants && (
                <div className="space-y-3">
                  {attributes.map((attr, attrIdx) => (
                    <div key={attrIdx} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold capitalize">{attr.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttribute(attrIdx)}
                          aria-label={`Remove ${attr.name}`}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {attr.values.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {attr.values.map((val, vi) => (
                            <span
                              key={vi}
                              className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary text-xs font-medium pl-3 pr-2 py-1"
                            >
                              {val}
                              <button
                                type="button"
                                onClick={() => removeValue(attrIdx, vi)}
                                aria-label={`Remove ${val}`}
                                className="hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Input
                          placeholder={`Add a ${attr.name} value, for example ${attr.name === "size" ? "Large" : "Red"}`}
                          value={valueInputs[attrIdx] || ""}
                          onChange={(e) => setValueInputs((prev) => ({ ...prev, [attrIdx]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addValue(attrIdx))}
                          data-testid={`wiz-input-attr-value-${attrIdx}`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => addValue(attrIdx)}
                          disabled={!valueInputs[attrIdx]?.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  ))}

                  {attributes.length === 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Start with</span>
                      {PRESET_ATTRS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => addAttribute(p)}
                          className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted/40 transition-colors"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      placeholder={attributes.length ? "Add another option, for example Size" : "Or name your own option, for example Pack size"}
                      value={newAttrName}
                      onChange={(e) => setNewAttrName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAttribute())}
                      data-testid="wiz-input-attr-name"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="border-dashed text-primary shrink-0"
                      onClick={() => addAttribute()}
                      disabled={!newAttrName.trim()}
                      data-testid="wiz-btn-add-attr"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Option
                    </Button>
                  </div>

                  {invalid(!attributes.some((a) => a.values.length > 0)) && (
                    <FieldError>Add at least one value to an option, for example Small, Medium, Large.</FieldError>
                  )}
                </div>
              )}
            </SectionCard>
          )}

          {/* ── 3. Prices and stock ────────────────────────────────── */}
          <SectionCard
            n={canHaveVariants ? 3 : 2}
            title={tracksStock ? "Prices and stock" : "Prices"}
            description={
              usesVariants
                ? "Set default prices once. Variants use them unless you type a different price."
                : isSupply
                ? "What you pay and how much you have. Supplies are never sold."
                : undefined
            }
          >
            <div className={cn("grid gap-4", sellsItem ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
              <div className="space-y-2">
                <Label htmlFor="inv-cost">{usesVariants ? "Default cost price" : "Cost price"}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">{sym}</span>
                  <Input
                    id="inv-cost"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className={cn(invalid(!costOk) && errInput)}
                    style={symPad}
                    value={costPrice}
                    onChange={(e) => setCostPrice(numberOrBlank(e.target.value))}
                    data-testid="wiz-input-cost"
                  />
                </div>
                {invalid(!costOk) ? (
                  <FieldError>Enter a cost price above 0.</FieldError>
                ) : (
                  <p className="text-xs text-muted-foreground">What you pay the vendor</p>
                )}
              </div>
              {sellsItem && (
                <div className="space-y-2">
                  <Label htmlFor="inv-selling">{usesVariants ? "Default selling price" : "Selling price"}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">{sym}</span>
                    <Input
                      id="inv-selling"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      className={cn((invalid(!sellOk) || inverted) && errInput)}
                      style={symPad}
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(numberOrBlank(e.target.value))}
                      data-testid="wiz-input-selling"
                    />
                  </div>
                  {invalid(!sellOk) ? (
                    <FieldError>Enter a selling price above 0.</FieldError>
                  ) : (
                    <p className="text-xs text-muted-foreground">What the customer pays</p>
                  )}
                </div>
              )}
            </div>

            {sellsItem && costOk && sellOk && (
              inverted ? (
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Selling price is lower than cost. You would lose {money(Number(costPrice) - Number(sellingPrice))} per sale.
                </p>
              ) : (
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Profit {money(Number(sellingPrice) - Number(costPrice))} per sale, {margin(Number(costPrice), Number(sellingPrice))}% margin
                </p>
              )
            )}

            {isSupply && (
              <Alert>
                <Droplets className="h-4 w-4" />
                <AlertDescription>
                  Buying a supply adds to stock without touching your Profit &amp; Loss. The cost is charged
                  only when a service that uses it is delivered. Count it in the smallest unit you measure
                  (ml, g, each) rather than whole bottles.
                </AlertDescription>
              </Alert>
            )}

            {tracksStock && unitSelect}

            {tracksStock && !usesVariants && (
              <div className="space-y-2 sm:max-w-[calc(50%-0.5rem)]">
                <Label htmlFor="inv-qty">Opening stock{allowFractional && unit.trim() ? ` (${unit.trim()})` : ""}</Label>
                <Input
                  id="inv-qty"
                  type="number"
                  inputMode={allowFractional ? "decimal" : "numeric"}
                  min="0"
                  step={allowFractional ? "0.01" : "1"}
                  placeholder="0"
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(allowFractional ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)
                  }
                  data-testid="wiz-input-quantity"
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {quantity === 0 && <Info className="h-3 w-3 shrink-0" />}
                  {quantity === 0
                    ? "Starting at 0. Use Restock to add units when ready."
                    : `${quantity} ${unitWord} will be added on creation.`}
                </p>
              </div>
            )}

            {isService && (
              <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">Override commission split</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {usesVariants ? "Applies to all variants of this service" : "Customise the split for this service only"}
                    </p>
                  </div>
                  <Switch checked={commissionOverride} onCheckedChange={setCommissionOverride} />
                </div>
                {commissionOverride && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Business share (%)</Label>
                      <Input type="number" value={bizShare} onChange={(e) => setBizShare(Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Staff share (%)</Label>
                      <Input type="number" value={staffShare} onChange={(e) => setStaffShare(Number(e.target.value))} />
                    </div>
                    {!splitOk && <p className="col-span-2 text-sm text-destructive">Shares must add up to 100%.</p>}
                  </div>
                )}
              </div>
            )}

            {/* Variants table */}
            {usesVariants && (
              <div className="space-y-3 border-t pt-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold">Variants</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                      {selectedCombos.length} of {allCombos.length} from your options
                    </span>
                    {allCombos.length > 0 && (
                      <>
                        <button type="button" className="text-primary hover:underline" onClick={() => setDeselected(new Set())}>
                          Select all
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:underline"
                          onClick={() => setDeselected(new Set(allCombos.map(comboKey)))}
                        >
                          Clear all
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {allCombos.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Add option values above and your variants will appear here.
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <div
                      className={cn(
                        "hidden md:grid gap-3 px-4 py-2 bg-muted/40 border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                        tracksStock && sellsItem && "grid-cols-[24px_minmax(0,1fr)_110px_110px_90px_56px]",
                        tracksStock && !sellsItem && "grid-cols-[24px_minmax(0,1fr)_120px_90px]",
                        !tracksStock && "grid-cols-[24px_minmax(0,1fr)_120px_120px_56px]"
                      )}
                    >
                      <span />
                      <span>Variant</span>
                      <span>Cost</span>
                      {sellsItem && <span>Selling price</span>}
                      {tracksStock && <span>Opening stock</span>}
                      {sellsItem && <span className="text-right">Margin</span>}
                    </div>
                    <div className="divide-y max-h-[28rem] overflow-y-auto">
                      {allCombos.map((combo) => {
                        const key = comboKey(combo);
                        const checked = !deselected.has(key);
                        const d = variantDetails[key];
                        const e = effective(key);
                        const m = margin(e.cost, e.sell);
                        const usesDefaults = d?.costPrice === "" || d?.costPrice === undefined
                          ? d?.sellingPrice === "" || d?.sellingPrice === undefined
                          : false;
                        const bad = checked && sellsItem && e.sell < e.cost;
                        return (
                          <div
                            key={key}
                            className={cn(
                              "grid gap-x-3 gap-y-2 px-4 py-3 items-center",
                              "grid-cols-[24px_minmax(0,1fr)_auto]",
                              tracksStock && sellsItem && "md:grid-cols-[24px_minmax(0,1fr)_110px_110px_90px_56px]",
                              tracksStock && !sellsItem && "md:grid-cols-[24px_minmax(0,1fr)_120px_90px]",
                              !tracksStock && "md:grid-cols-[24px_minmax(0,1fr)_120px_120px_56px]",
                              !checked && "opacity-50"
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleCombo(key)}
                              aria-label={`Include ${comboLabel(combo)}`}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{comboLabel(combo)}</div>
                              <div className="text-xs text-muted-foreground">
                                {usesDefaults ? "Uses default prices" : "Custom prices"}
                              </div>
                            </div>
                            {/* Mobile margin badge sits beside the name */}
                            {sellsItem && (
                              <span
                                className={cn(
                                  "md:hidden text-xs font-semibold justify-self-end",
                                  bad ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
                                )}
                              >
                                {m === null ? "" : `${m}%`}
                              </span>
                            )}
                            {checked && (
                              <div
                                className={cn(
                                  "col-span-3 md:col-span-4 grid gap-2 md:contents",
                                  tracksStock && sellsItem ? "grid-cols-3" : "grid-cols-2"
                                )}
                              >
                                <div className="space-y-1 md:space-y-0">
                                  <span className="md:hidden text-[11px] text-muted-foreground">Cost</span>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    placeholder={costPrice !== "" ? String(costPrice) : "0"}
                                    value={d?.costPrice ?? ""}
                                    onChange={(ev) => updateVariantDetail(key, "costPrice", numberOrBlank(ev.target.value))}
                                    className="h-10 text-sm"
                                  />
                                </div>
                                {sellsItem && (
                                  <div className="space-y-1 md:space-y-0">
                                    <span className="md:hidden text-[11px] text-muted-foreground">Selling</span>
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      min="0"
                                      placeholder={sellingPrice !== "" ? String(sellingPrice) : "0"}
                                      value={d?.sellingPrice ?? ""}
                                      onChange={(ev) => updateVariantDetail(key, "sellingPrice", numberOrBlank(ev.target.value))}
                                      className={cn("h-10 text-sm", bad && errInput)}
                                    />
                                  </div>
                                )}
                                {tracksStock && (
                                  <div className="space-y-1 md:space-y-0">
                                    <span className="md:hidden text-[11px] text-muted-foreground">Stock</span>
                                    <Input
                                      type="number"
                                      inputMode={allowFractional ? "decimal" : "numeric"}
                                      min="0"
                                      step={allowFractional ? "0.01" : "1"}
                                      placeholder="0"
                                      value={d?.quantity ?? 0}
                                      onChange={(ev) =>
                                        updateVariantDetail(
                                          key,
                                          "quantity",
                                          allowFractional ? parseFloat(ev.target.value) || 0 : parseInt(ev.target.value) || 0
                                        )
                                      }
                                      className="h-10 text-sm"
                                    />
                                  </div>
                                )}
                                {sellsItem && (
                                  <span
                                    className={cn(
                                      "hidden md:block text-right text-sm font-semibold",
                                      bad ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
                                    )}
                                  >
                                    {m === null ? "–" : `${m}%`}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedCombos.length > MAX_VARIANTS_PER_PRODUCT && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {selectedCombos.length} variants ticked, over the limit of {MAX_VARIANTS_PER_PRODUCT} per item.
                      Untick some or remove option values.
                    </AlertDescription>
                  </Alert>
                )}
                {variantInverted && !inverted && (
                  <p className="text-sm font-medium text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    A variant sells for less than it costs. Check the rows marked in red.
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Summary (desktop) ──────────────────────────────────── */}
        <aside className="hidden lg:block lg:sticky lg:top-20">
          <Card>
            <CardContent className="pt-6 space-y-5">
              <h2 className="text-base font-semibold">Summary</h2>
              <dl className="space-y-3 text-sm">
                {summaryRows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium text-right truncate">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={save}
                  disabled={busy || !!duplicate}
                  data-testid="wiz-btn-save"
                >
                  {saving ? "Adding…" : "Add to inventory"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={saveDraft}
                  disabled={busy || name.trim() === ""}
                  data-testid="wiz-btn-save-draft"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {savingDraft ? "Saving…" : "Save as draft"}
                </Button>
              </div>
              {blocker && <p className="text-xs text-amber-700 dark:text-amber-400">{blocker}</p>}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ── Action bar (mobile) ──────────────────────────────────── */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur px-4 pt-3 pb-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {itemCount} {itemCount === 1 ? "item" : "items"}
            {tracksStock && ` · ${totalUnits.toLocaleString()} ${unitWord}`}
          </span>
          {tracksStock && <span className="font-medium text-foreground">{money(stockValue)}</span>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={saveDraft}
            disabled={busy || name.trim() === ""}
            aria-label="Save as draft"
          >
            <Save className="h-4 w-4" />
          </Button>
          <Button className="flex-1" onClick={save} disabled={busy || !!duplicate} data-testid="wiz-btn-save-mobile">
            {saving ? "Adding…" : "Add to inventory"}
          </Button>
        </div>
        {blocker && <p className="text-xs text-center text-amber-700 dark:text-amber-400">{blocker}</p>}
      </div>
    </div>
  );
}
