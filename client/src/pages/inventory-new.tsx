import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { buildSlug } from "@/lib/slug";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  Package,
  Wrench,
  Droplets,
  Layers,
  AlertTriangle,
  Check,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { cartesianProduct, comboKey, comboLabel } from "@/lib/variant-combos";
import { MAX_VARIANTS_PER_PRODUCT } from "@shared/constants";

// ── Types ──────────────────────────────────────────────────────────────────

interface Attribute {
  name: string;
  values: string[];
}

interface VariantDetail {
  costPrice: number | "";
  sellingPrice: number | "";
  quantity: number;
  allowFractional: boolean;
  unit: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRESET_ATTRS = ["size", "color", "flavor", "material", "style", "weight"];

// ── Step progress bar ──────────────────────────────────────────────────────

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold transition-colors",
                i < current
                  ? "bg-primary text-primary-foreground"
                  : i === current
                  ? "bg-primary text-primary-foreground shadow shadow-primary/30"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i < current ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                i === current ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "h-px w-6 mx-2 shrink-0 transition-colors",
                i < current ? "bg-primary" : "bg-border"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function InventoryNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const queryClient = useQueryClient();

  const isMultiStore = currentStore?.id === "all";
  const defaultStoreId = isMultiStore ? "" : (currentStore?.id || "");

  // ── Step ──────────────────────────────────────────────────────────────

  const [step, setStep] = useState(0);

  // ── Step 0 — Basics ───────────────────────────────────────────────────

  const [storeId, setStoreId] = useState(defaultStoreId);

  // Currency from the selected/current store's settings
  const settingsStoreId = isMultiStore ? (storeId || stores[0]?.id) : currentStore?.id;
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings", settingsStoreId],
    enabled: !!settingsStoreId,
  });
  const sym: string = settingsData?.currency?.symbol || currentStore?.currency || "₦";
  const [name, setName] = useState("");
  const [type, setType] = useState<"product" | "service" | "supply" | "">("");
  const [hasVariants, setHasVariants] = useState(false);

  // ── Pricing ───────────────────────────────────────────────────────────

  const [costPrice, setCostPrice] = useState<number | "">("");
  const [sellingPrice, setSellingPrice] = useState<number | "">("");
  const [quantity, setQuantity] = useState(0);

  // ── Fractional selling ────────────────────────────────────────────────

  const [allowFractional, setAllowFractional] = useState(false);
  const [unit, setUnit] = useState("");

  // ── Service commission ────────────────────────────────────────────────

  const [commissionOverride, setCommissionOverride] = useState(false);
  const [bizShare, setBizShare] = useState(80);
  const [staffShare, setStaffShare] = useState(20);

  // ── Variant builder ───────────────────────────────────────────────────

  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [variantDetails, setVariantDetails] = useState<Record<string, VariantDetail>>({});
  const [newAttrName, setNewAttrName] = useState("");
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({});

  const [saving, setSaving] = useState(false);
  // Tracks whether the user has attempted to advance past the current step,
  // so validation errors are only shown after the first failed Next click.
  const [showErrors, setShowErrors] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────

  const steps = useMemo(() => {
    if (type === "service" && hasVariants) return ["Basics", "Define Variants", "Prices", "Review"];
    if (type === "service") return ["Basics", "Pricing", "Review"];
    // A supply is never sold, so there is no selling price to collect.
    if (type === "supply") return ["Basics", "Cost & Stock", "Review"];
    if (hasVariants) return ["Basics", "Define Variants", "Prices & Stock", "Review"];
    return ["Basics", "Pricing & Stock", "Review"];
  }, [type, hasVariants]);

  const allCombos = useMemo(() => cartesianProduct(attributes), [attributes]);
  const selectedCombos = useMemo(
    () => allCombos.filter((c) => !deselected.has(comboKey(c))),
    [allCombos, deselected]
  );

  const isLastStep = step === steps.length - 1;

  const pricingValid = useMemo(() => {
    const cost = Number(costPrice);
    const sell = Number(sellingPrice);
    const costOk = costPrice !== "" && cost > 0;
    // Supplies have no selling price and therefore no margin to invert.
    if (type === "supply") {
      return { costOk, sellOk: true, noInversion: true, all: costOk };
    }
    const sellOk = sellingPrice !== "" && sell > 0;
    const noInversion = sell >= cost;
    return { costOk, sellOk, noInversion, all: costOk && sellOk && noInversion };
  }, [costPrice, sellingPrice, type]);

  const canProceed = useMemo(() => {
    if (step === 0) {
      return name.trim() !== "" && type !== "" && (!isMultiStore || storeId !== "");
    }
    // Simple pricing (no variants)
    if (step === 1 && !hasVariants) {
      return pricingValid.all;
    }
    // Variant attribute setup (product or service)
    if (step === 1 && hasVariants) {
      return (
        attributes.some((a) => a.values.length > 0) &&
        selectedCombos.length > 0 &&
        selectedCombos.length <= MAX_VARIANTS_PER_PRODUCT
      );
    }
    // Variant default pricing (product or service)
    if (step === 2 && hasVariants) {
      return pricingValid.all;
    }
    return true;
  }, [step, name, type, isMultiStore, storeId, hasVariants, attributes, selectedCombos, pricingValid]);

  // ── Attribute helpers ─────────────────────────────────────────────────

  const addAttribute = () => {
    const n = newAttrName.trim().toLowerCase();
    if (!n || attributes.some((a) => a.name === n)) return;
    setAttributes((prev) => [...prev, { name: n, values: [] }]);
    setNewAttrName("");
  };

  const removeAttribute = (i: number) => {
    setAttributes((prev) => prev.filter((_, idx) => idx !== i));
    setValueInputs((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
  };

  const addValue = (attrIdx: number) => {
    const val = (valueInputs[attrIdx] || "").trim();
    if (!val) return;
    setAttributes((prev) =>
      prev.map((a, i) =>
        i === attrIdx
          ? { ...a, values: a.values.includes(val) ? a.values : [...a.values, val] }
          : a
      )
    );
    setValueInputs((prev) => ({ ...prev, [attrIdx]: "" }));
  };

  const removeValue = (attrIdx: number, valIdx: number) => {
    setAttributes((prev) =>
      prev.map((a, i) =>
        i === attrIdx ? { ...a, values: a.values.filter((_, vi) => vi !== valIdx) } : a
      )
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

  const updateVariantDetail = (
    key: string,
    field: keyof VariantDetail,
    value: number | "" | undefined | boolean | string
  ) => {
    setVariantDetails((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { costPrice: "", sellingPrice: "", quantity: 0 }),
        [field]: value,
      },
    }));
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true);
    try {
      const finalCost = costPrice === "" ? 0 : Number(costPrice);
      // Supplies are never sold, so any selling price left in state is discarded.
      const finalSelling = type === "supply" ? 0 : (sellingPrice === "" ? 0 : Number(sellingPrice));
      const targetStoreId = isMultiStore ? storeId : defaultStoreId;

      // 1. Create the Product Grouping
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

      // 2. Add Variants
      if (hasVariants) {
        for (const combo of selectedCombos) {
          const key = comboKey(combo);
          const detail = variantDetails[key];
          const vCost =
            detail?.costPrice !== "" && detail?.costPrice !== undefined
              ? Number(detail.costPrice)
              : finalCost;
          const vSelling =
            detail?.sellingPrice !== "" && detail?.sellingPrice !== undefined
              ? Number(detail.sellingPrice)
              : finalSelling;
          const vQty = type === "product" ? (detail?.quantity ?? 0) : 0;
          const vFractional = type === "product" ? (detail?.allowFractional ?? false) : false;
          const vUnit = type === "product" && (detail?.allowFractional ?? false) ? detail?.unit?.trim() || null : null;

          const varRes = await apiRequest("POST", `/api/products/${product.id}/variants`, {
            name: `${name.trim()} - ${comboLabel(combo)}`,
            costPrice: vCost,
            sellingPrice: vSelling,
            quantity: vQty,
            variantDimensions: combo,
            sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            allowFractional: vFractional,
            unit: vFractional ? vUnit : null,
            commissionSplitOverride: type === "service" ? commissionOverride : false,
            commissionSplitBusinessShare: bizShare,
            commissionSplitStaffShare: staffShare,
          });
          if (!varRes.ok) {
            const err = await varRes.json().catch(() => ({}));
            throw new Error((err as any).error?.message || (err as any).error || `Failed to create variant ${comboLabel(combo)}`);
          }
        }
      } else {
        // Simple product or service (which is a single variant under the hood)
        const varRes = await apiRequest("POST", `/api/products/${product.id}/variants`, {
          name: name.trim(),
          costPrice: finalCost,
          sellingPrice: finalSelling,
          // Services are the only stockless type — supplies carry real stock.
          quantity: type === "service" ? 0 : quantity,
          commissionSplitOverride: type === "service" ? commissionOverride : false,
          commissionSplitBusinessShare: bizShare,
          commissionSplitStaffShare: staffShare,
          sku: `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          allowFractional: type === "service" ? false : allowFractional,
          unit: type !== "service" && allowFractional && unit.trim() ? unit.trim() : null,
        });
        if (!varRes.ok) {
          const err = await varRes.json().catch(() => ({}));
          throw new Error((err as any).error?.message || (err as any).error || "Failed to create variant item");
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Item added",
        description: hasVariants
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

  // ── Layout helpers ─────────────────────────────────────────────────────

  const fmt = (n: number | "") =>
    n === "" || n === 0 ? (
      <span className="text-muted-foreground">not set</span>
    ) : (
      `${sym}${Number(n).toLocaleString()}`
    );

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        title="Add New Item"
        description="Fill in what you have now — prices and stock can be updated anytime."
        actions={
          <Button variant="outline" onClick={() => setLocation("/inventory")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Inventory
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Step bar */}
          <StepBar steps={steps} current={step} />
          <Separator />

          {/* ── Step 0: Basics ───────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-5">
              {isMultiStore && (
                <div className="space-y-1.5">
                  <Label>
                    Store <span className="text-destructive">*</span>
                  </Label>
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger data-testid="wiz-select-store">
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

              <div className="space-y-1.5">
                <Label htmlFor="inv-name">
                  Item Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="inv-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Classic T-Shirt"
                  autoFocus
                  data-testid="wiz-input-name"
                  onKeyDown={(e) =>
                    e.key === "Enter" && canProceed && setStep(1)
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Type <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(["product", "service", "supply"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setType(t);
                        // Supplies are single SKUs: "500ml Shampoo" and "1L Shampoo"
                        // are separate supplies with separate costs, not variants.
                        if (t === "supply") setHasVariants(false);
                        setShowErrors(false);
                      }}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-all",
                        type === t
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/40 hover:bg-muted/20"
                      )}
                      data-testid={`wiz-type-${t}`}
                    >
                      {(() => {
                        const Icon = t === "product" ? Package : t === "service" ? Wrench : Droplets;
                        return (
                          <Icon
                            className={cn(
                              "h-4 w-4",
                              type === t ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                        );
                      })()}
                      <div className="font-semibold text-sm capitalize">{t}</div>
                      <div className="text-xs text-muted-foreground leading-tight">
                        {t === "product"
                          ? "Physical item you sell, with tracked stock"
                          : t === "service"
                          ? "Work you perform, no stock"
                          : "Back-bar stock used up delivering services — never sold"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {type !== "" && type !== "supply" && (
                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      Has Variants
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {type === "service"
                        ? "Different durations, packages, or tiers"
                        : "Different sizes, colors, or other attributes"}
                    </p>
                  </div>
                  <Switch
                    checked={hasVariants}
                    onCheckedChange={setHasVariants}
                    data-testid="wiz-switch-has-variants"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Step 1 (service, no variants): Pricing ───────────────── */}
          {step === 1 && type === "service" && !hasVariants && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-cost-svc">
                    Cost Price ({sym}) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="inv-cost-svc"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={costPrice}
                    onChange={(e) => {
                      setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value));
                    }}
                    className={showErrors && !pricingValid.costOk ? "border-destructive focus-visible:ring-destructive" : ""}
                    data-testid="wiz-input-cost"
                  />
                  {showErrors && !pricingValid.costOk && (
                    <p className="text-xs text-destructive">Cost price is required and must be greater than 0.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-selling-svc">
                    Selling Price ({sym}) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="inv-selling-svc"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={sellingPrice}
                    onChange={(e) =>
                      setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className={showErrors && !pricingValid.sellOk ? "border-destructive focus-visible:ring-destructive" : ""}
                    data-testid="wiz-input-selling"
                  />
                  {showErrors && !pricingValid.sellOk && (
                    <p className="text-xs text-destructive">Selling price is required and must be greater than 0.</p>
                  )}
                </div>
              </div>

              {pricingValid.costOk && pricingValid.sellOk && !pricingValid.noInversion && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Selling price cannot be less than cost price.</AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Override Commission Split</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Customise split for this service only
                    </p>
                  </div>
                  <Switch
                    checked={commissionOverride}
                    onCheckedChange={setCommissionOverride}
                  />
                </div>
                {commissionOverride && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Business Share (%)</Label>
                      <Input
                        type="number"
                        value={bizShare}
                        onChange={(e) => setBizShare(Number(e.target.value))}
                        placeholder="80"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Staff Share (%)</Label>
                      <Input
                        type="number"
                        value={staffShare}
                        onChange={(e) => setStaffShare(Number(e.target.value))}
                        placeholder="20"
                      />
                    </div>
                    {bizShare + staffShare !== 100 && (
                      <p className="col-span-2 text-sm text-destructive">
                        Shares must sum to 100%.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 1 (product, no variants): Pricing & Stock ───────── */}
          {step === 1 && (type === "product" || type === "supply") && !hasVariants && (
            <div className="space-y-5">
              <div className={type === "supply" ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"}>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-cost-prod">
                    Cost Price ({sym}) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="inv-cost-prod"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={costPrice}
                    onChange={(e) =>
                      setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    className={showErrors && !pricingValid.costOk ? "border-destructive focus-visible:ring-destructive" : ""}
                    data-testid="wiz-input-cost"
                  />
                  {showErrors && !pricingValid.costOk && (
                    <p className="text-xs text-destructive">Cost price is required and must be greater than 0.</p>
                  )}
                </div>
                {type !== "supply" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-selling-prod">
                      Selling Price ({sym}) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="inv-selling-prod"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={sellingPrice}
                      onChange={(e) =>
                        setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                      }
                      className={showErrors && !pricingValid.sellOk ? "border-destructive focus-visible:ring-destructive" : ""}
                      data-testid="wiz-input-selling"
                    />
                    {showErrors && !pricingValid.sellOk && (
                      <p className="text-xs text-destructive">Selling price is required and must be greater than 0.</p>
                    )}
                  </div>
                )}
              </div>

              {type === "supply" && (
                <Alert>
                  <Droplets className="h-4 w-4" />
                  <AlertDescription>
                    Supplies are never sold, so they have no selling price. Buying one adds to stock
                    without touching your Profit &amp; Loss — the cost is charged only when a service
                    that uses it is delivered. Stock this in the smallest unit you measure it in
                    (ml, g, each) rather than whole bottles.
                  </AlertDescription>
                </Alert>
              )}

              {pricingValid.costOk && pricingValid.sellOk && !pricingValid.noInversion && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Selling price cannot be less than cost price.</AlertDescription>
                </Alert>
              )}

              {/* ── Fractional selling toggle ── */}
              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Sell by fraction</div>
                  <p className="text-xs text-muted-foreground">
                    Enable to sell partial quantities (e.g. 0.5 kg, 1.25 litres)
                  </p>
                </div>
                <Switch
                  checked={allowFractional}
                  onCheckedChange={(v) => { setAllowFractional(v); if (!v) setUnit(""); }}
                  data-testid="wiz-switch-fractional"
                />
              </div>

              {allowFractional && (
                <div className="space-y-1.5">
                  <Label htmlFor="inv-unit">Unit of Measure</Label>
                  <Input
                    id="inv-unit"
                    placeholder="e.g. kg, litre, metre, g"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    data-testid="wiz-input-unit"
                  />
                  <p className="text-xs text-muted-foreground">Shown next to quantity on receipts and in the cart.</p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="inv-qty">Opening Stock{allowFractional && unit ? ` (${unit})` : ""}</Label>
                <Input
                  id="inv-qty"
                  type="number"
                  min="0"
                  step={allowFractional ? "0.01" : "1"}
                  placeholder="0"
                  value={quantity}
                  onChange={(e) => setQuantity(allowFractional ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0))}
                  data-testid="wiz-input-quantity"
                />
                {quantity === 0 ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" />
                    Opening stock is 0 — use Restock to add units when ready.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {quantity}{unit ? ` ${unit}` : ` unit${quantity !== 1 ? "s" : ""}`} will be added on creation.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 1 (variants): Define Variants ───────────────────── */}
          {step === 1 && hasVariants && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                Add attribute axes (e.g. "size") then their values (e.g. S, M, L). Deselect any
                combinations that don't exist in your catalogue.
              </p>

              <div className="space-y-1.5">
                <Label>Add Attribute</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. size, color, flavor…"
                    value={newAttrName}
                    onChange={(e) => setNewAttrName(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addAttribute())
                    }
                    list="inv-preset-attrs"
                    className="flex-1"
                    data-testid="wiz-input-attr-name"
                  />
                  <datalist id="inv-preset-attrs">
                    {PRESET_ATTRS.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addAttribute}
                    disabled={!newAttrName.trim()}
                    data-testid="wiz-btn-add-attr"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {attributes.length === 0 && (
                <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                  No attributes yet. Add at least one to generate combinations.
                </div>
              )}

              <div className="space-y-3">
                {attributes.map((attr, attrIdx) => (
                  <div
                    key={attrIdx}
                    className="rounded-lg border p-4 space-y-3 bg-muted/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold capitalize">{attr.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttribute(attrIdx)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 min-h-[24px]">
                      {attr.values.map((val, vi) => (
                        <Badge
                          key={vi}
                          variant="secondary"
                          className="gap-1.5 pr-1.5 text-xs font-medium"
                        >
                          {val}
                          <button
                            type="button"
                            onClick={() => removeValue(attrIdx, vi)}
                            className="hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      {attr.values.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">
                          No values yet
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder={`Add ${attr.name} value…`}
                        value={valueInputs[attrIdx] || ""}
                        onChange={(e) =>
                          setValueInputs((prev) => ({
                            ...prev,
                            [attrIdx]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) =>
                          e.key === "Enter" && (e.preventDefault(), addValue(attrIdx))
                        }
                        className="h-8 text-sm"
                        data-testid={`wiz-input-attr-value-${attrIdx}`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3"
                        onClick={() => addValue(attrIdx)}
                        disabled={!valueInputs[attrIdx]?.trim()}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {allCombos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      Combinations — {allCombos.length} generated
                      {selectedCombos.length < allCombos.length && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          ({selectedCombos.length} selected)
                        </span>
                      )}
                    </Label>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setDeselected(new Set())}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => setDeselected(new Set(allCombos.map(comboKey)))}
                      >
                        Clear all
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                    {allCombos.map((combo) => {
                      const key = comboKey(combo);
                      const checked = !deselected.has(key);
                      return (
                        <div
                          key={key}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer",
                            "hover:bg-muted/30 transition-colors select-none",
                            !checked && "opacity-40"
                          )}
                          onClick={() => toggleCombo(key)}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleCombo(key)}
                            className="shrink-0"
                          />
                          <span className="font-medium flex-1">
                            {name} — {comboLabel(combo)}
                          </span>
                          <div className="flex gap-1.5 shrink-0">
                            {Object.entries(combo).map(([k, v]) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="text-xs px-1.5 py-0 font-normal"
                              >
                                {k}: {v}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedCombos.length === 0 && (
                    <p className="text-sm text-destructive">
                      Select at least one combination to continue.
                    </p>
                  )}

                  {selectedCombos.length > MAX_VARIANTS_PER_PRODUCT && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {selectedCombos.length} combinations selected, which is over the {MAX_VARIANTS_PER_PRODUCT}-variant limit per product.
                        Deselect some combinations or reduce attribute values to continue.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2 (variants): Prices ────────────────────────────── */}
          {step === 2 && hasVariants && (
            <div className="space-y-5">
              <div className="rounded-lg border p-4 bg-muted/10 space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Default Prices — inherited by all variants unless overridden <span className="text-destructive normal-case font-normal">*</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>
                      Default Cost ({sym}) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={costPrice}
                      onChange={(e) =>
                        setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                      }
                      className={showErrors && !pricingValid.costOk ? "border-destructive focus-visible:ring-destructive" : ""}
                      data-testid="wiz-input-cost-default"
                    />
                    {showErrors && !pricingValid.costOk && (
                      <p className="text-xs text-destructive">Default cost price is required and must be greater than 0.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Default Selling ({sym}) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={sellingPrice}
                      onChange={(e) =>
                        setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                      }
                      className={showErrors && !pricingValid.sellOk ? "border-destructive focus-visible:ring-destructive" : ""}
                      data-testid="wiz-input-selling-default"
                    />
                    {showErrors && !pricingValid.sellOk && (
                      <p className="text-xs text-destructive">Default selling price is required and must be greater than 0.</p>
                    )}
                  </div>
                </div>
                {pricingValid.costOk && pricingValid.sellOk && !pricingValid.noInversion && (
                  <p className="text-xs text-destructive">Selling price cannot be less than cost price.</p>
                )}
              </div>

              {/* Commission override — services only */}
              {type === "service" && (
                <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Override Commission Split</div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Applies to all variants of this service
                      </p>
                    </div>
                    <Switch
                      checked={commissionOverride}
                      onCheckedChange={setCommissionOverride}
                    />
                  </div>
                  {commissionOverride && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Business Share (%)</Label>
                        <Input
                          type="number"
                          value={bizShare}
                          onChange={(e) => setBizShare(Number(e.target.value))}
                          placeholder="80"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Staff Share (%)</Label>
                        <Input
                          type="number"
                          value={staffShare}
                          onChange={(e) => setStaffShare(Number(e.target.value))}
                          placeholder="20"
                        />
                      </div>
                      {bizShare + staffShare !== 100 && (
                        <p className="col-span-2 text-sm text-destructive">
                          Shares must sum to 100%.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div>
                  <Label>Per-Variant Overrides</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Leave blank to inherit the defaults above.
                  </p>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  {type === "product" ? (
                    <>
                      <div className="grid grid-cols-[1fr_90px_90px_60px_56px_72px] gap-2 px-4 py-2 bg-muted/30 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <span>Variant</span>
                        <span>Cost ({sym})</span>
                        <span>Selling ({sym})</span>
                        <span>Stock</span>
                        <span>Frac?</span>
                        <span>Unit</span>
                      </div>
                      <div className="divide-y max-h-72 overflow-y-auto">
                        {selectedCombos.map((combo) => {
                          const key = comboKey(combo);
                          const detail = variantDetails[key] || { costPrice: "", sellingPrice: "", quantity: 0, allowFractional: false, unit: "" };
                          return (
                            <div
                              key={key}
                              className="grid grid-cols-[1fr_90px_90px_60px_56px_72px] items-center gap-2 px-4 py-2"
                            >
                              <span className="text-sm font-medium truncate">
                                {comboLabel(combo)}
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={costPrice !== "" ? String(costPrice) : "0"}
                                value={detail.costPrice ?? ""}
                                onChange={(e) =>
                                  updateVariantDetail(key, "costPrice", e.target.value === "" ? "" : parseFloat(e.target.value))
                                }
                                className="h-8 text-sm px-2"
                              />
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={sellingPrice !== "" ? String(sellingPrice) : "0"}
                                value={detail.sellingPrice ?? ""}
                                onChange={(e) =>
                                  updateVariantDetail(key, "sellingPrice", e.target.value === "" ? "" : parseFloat(e.target.value))
                                }
                                className="h-8 text-sm px-2"
                              />
                              <Input
                                type="number"
                                min="0"
                                step={detail.allowFractional ? "0.01" : "1"}
                                placeholder="0"
                                value={detail.quantity ?? 0}
                                onChange={(e) =>
                                  updateVariantDetail(key, "quantity", detail.allowFractional ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)
                                }
                                className="h-8 text-sm px-2"
                              />
                              <div className="flex justify-center">
                                <Switch
                                  checked={detail.allowFractional ?? false}
                                  onCheckedChange={(v) => updateVariantDetail(key, "allowFractional", v)}
                                  className="scale-75"
                                />
                              </div>
                              <Input
                                placeholder="kg"
                                value={detail.unit ?? ""}
                                disabled={!detail.allowFractional}
                                onChange={(e) => updateVariantDetail(key, "unit", e.target.value)}
                                className="h-8 text-xs px-2"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-4 py-2 bg-muted/30 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <span>Variant</span>
                        <span>Cost ({sym})</span>
                        <span>Selling ({sym})</span>
                      </div>
                      <div className="divide-y max-h-72 overflow-y-auto">
                        {selectedCombos.map((combo) => {
                          const key = comboKey(combo);
                          const detail = variantDetails[key] || { costPrice: "", sellingPrice: "", quantity: 0, allowFractional: false, unit: "" };
                          return (
                            <div
                              key={key}
                              className="grid grid-cols-[1fr_100px_100px] items-center gap-2 px-4 py-2"
                            >
                              <span className="text-sm font-medium truncate">
                                {comboLabel(combo)}
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={costPrice !== "" ? String(costPrice) : "0"}
                                value={detail.costPrice ?? ""}
                                onChange={(e) =>
                                  updateVariantDetail(key, "costPrice", e.target.value === "" ? "" : parseFloat(e.target.value))
                                }
                                className="h-8 text-sm px-2"
                              />
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={sellingPrice !== "" ? String(sellingPrice) : "0"}
                                value={detail.sellingPrice ?? ""}
                                onChange={(e) =>
                                  updateVariantDetail(key, "sellingPrice", e.target.value === "" ? "" : parseFloat(e.target.value))
                                }
                                className="h-8 text-sm px-2"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Review (last step) ────────────────────────────────────── */}
          {isLastStep && (
            <div className="space-y-5">
              <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Summary
                </p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-semibold">{name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="capitalize font-medium">{type}</dd>
                  </div>
                  {isMultiStore && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Store</dt>
                      <dd className="font-medium">
                        {stores.find((s) => s.id === storeId)?.name || storeId}
                      </dd>
                    </div>
                  )}
                  {!hasVariants && (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Cost Price</dt>
                        <dd className="font-mono">{fmt(costPrice)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Selling Price</dt>
                        <dd className="font-mono">{fmt(sellingPrice)}</dd>
                      </div>
                      {type === "product" && (
                        <>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">Opening Stock</dt>
                            <dd className="font-mono">{quantity}{unit ? ` ${unit}` : ""}</dd>
                          </div>
                          {allowFractional && (
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Fractional selling</dt>
                              <dd className="font-medium text-primary">Enabled{unit ? ` · ${unit}` : ""}</dd>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {hasVariants && (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Default Cost</dt>
                        <dd className="font-mono">{fmt(costPrice)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Default Selling</dt>
                        <dd className="font-mono">{fmt(sellingPrice)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Variants</dt>
                        <dd className="font-semibold">
                          {selectedCombos.length}{" "}
                          {selectedCombos.length === 1 ? "combination" : "combinations"}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>

              {hasVariants && selectedCombos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Variants to be created
                  </p>
                  <div className="rounded-lg border divide-y max-h-60 overflow-y-auto">
                    {selectedCombos.map((combo) => {
                      const key = comboKey(combo);
                      const detail = variantDetails[key];
                      const vc =
                        detail?.costPrice !== "" && detail?.costPrice !== undefined
                          ? Number(detail.costPrice)
                          : costPrice === ""
                          ? 0
                          : Number(costPrice);
                      const vs =
                        detail?.sellingPrice !== "" && detail?.sellingPrice !== undefined
                          ? Number(detail.sellingPrice)
                          : sellingPrice === ""
                          ? 0
                          : Number(sellingPrice);
                      const vq = detail?.quantity ?? 0;
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between px-4 py-2.5 text-sm"
                        >
                          <span className="font-medium">
                            {name} — {comboLabel(combo)}
                          </span>
                          <div className="flex gap-4 text-muted-foreground font-mono text-xs shrink-0">
                            <span>
                              {sym}
                              {vc.toLocaleString()} cost
                            </span>
                            <span>
                              {sym}
                              {vs.toLocaleString()} sell
                            </span>
                            <span className="text-foreground">qty: {vq}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {type === "product" && !hasVariants && quantity === 0 && (
                <p className="text-sm text-muted-foreground flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  Opening stock is 0. Use the Restock action on this item to add units when ready.
                </p>
              )}
            </div>
          )}

          {/* ── Navigation ───────────────────────────────────────────── */}
          <Separator />
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (step === 0) {
                  setLocation("/inventory");
                } else {
                  setShowErrors(false);
                  setStep((s) => s - 1);
                }
              }}
              disabled={saving}
            >
              {step === 0 ? (
                "Cancel"
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </>
              )}
            </Button>

            {isLastStep ? (
              <Button onClick={save} disabled={saving} data-testid="wiz-btn-save">
                {saving ? "Adding…" : "Add to Inventory"}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (!canProceed) {
                    setShowErrors(true);
                    return;
                  }
                  setShowErrors(false);
                  setStep((s) => s + 1);
                }}
                data-testid="wiz-btn-next"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
