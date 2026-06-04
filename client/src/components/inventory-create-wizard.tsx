import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  Package,
  Wrench,
  Layers,
  AlertTriangle,
  Check,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface Attribute {
  name: string;
  values: string[];
}

interface VariantDetail {
  costPrice: number | "";
  sellingPrice: number | "";
  quantity: number;
}

export interface InventoryCreateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  stores: Array<{ id: string; name: string }>;
  defaultStoreId: string;
  isMultiStore: boolean;
  currencySymbol: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cartesianProduct(attrs: Attribute[]): Record<string, string>[] {
  const valid = attrs.filter((a) => a.name.trim() && a.values.length > 0);
  if (valid.length === 0) return [];
  return valid.reduce<Record<string, string>[]>((acc, attr) => {
    if (acc.length === 0) return attr.values.map((v) => ({ [attr.name]: v }));
    return acc.flatMap((combo) => attr.values.map((v) => ({ ...combo, [attr.name]: v })));
  }, []);
}

function comboKey(dims: Record<string, string>): string {
  return Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

function comboLabel(dims: Record<string, string>): string {
  return Object.values(dims).join(" / ");
}

const PRESET_ATTRS = ["size", "color", "flavor", "material", "style", "weight"];

// ── Component ──────────────────────────────────────────────────────────────

export function InventoryCreateWizard({
  open,
  onOpenChange,
  onSuccess,
  stores,
  defaultStoreId,
  isMultiStore,
  currencySymbol,
}: InventoryCreateWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sym = currencySymbol || "₦";

  // Wizard step
  const [step, setStep] = useState(0);

  // Step 0 — Basics
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [name, setName] = useState("");
  const [type, setType] = useState<"product" | "service" | "">("");
  const [hasVariants, setHasVariants] = useState(false);

  // Pricing (shared for all paths)
  const [costPrice, setCostPrice] = useState<number | "">("");
  const [sellingPrice, setSellingPrice] = useState<number | "">("");
  const [quantity, setQuantity] = useState(0);

  // Service commission
  const [commissionOverride, setCommissionOverride] = useState(false);
  const [bizShare, setBizShare] = useState(80);
  const [staffShare, setStaffShare] = useState(20);

  // Variant builder
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [variantDetails, setVariantDetails] = useState<Record<string, VariantDetail>>({});
  const [newAttrName, setNewAttrName] = useState("");
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({});

  const [saving, setSaving] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────

  const steps = useMemo(() => {
    if (type === "service") return ["Basics", "Pricing", "Review"];
    if (hasVariants) return ["Basics", "Define Variants", "Prices & Stock", "Review"];
    return ["Basics", "Pricing & Stock", "Review"];
  }, [type, hasVariants]);

  const allCombos = useMemo(() => cartesianProduct(attributes), [attributes]);
  const selectedCombos = useMemo(
    () => allCombos.filter((c) => !deselected.has(comboKey(c))),
    [allCombos, deselected]
  );

  const isLastStep = step === steps.length - 1;

  const canProceed = useMemo(() => {
    if (step === 0) {
      return name.trim() !== "" && type !== "" && (!isMultiStore || storeId !== "");
    }
    if (step === 1 && type === "product" && hasVariants) {
      return attributes.some((a) => a.values.length > 0) && selectedCombos.length > 0;
    }
    return true;
  }, [step, name, type, isMultiStore, storeId, hasVariants, attributes, selectedCombos]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = () => {
    setStep(0);
    setStoreId(defaultStoreId);
    setName("");
    setType("");
    setHasVariants(false);
    setCostPrice("");
    setSellingPrice("");
    setQuantity(0);
    setCommissionOverride(false);
    setBizShare(80);
    setStaffShare(20);
    setAttributes([]);
    setDeselected(new Set());
    setVariantDetails({});
    setNewAttrName("");
    setValueInputs({});
    setSaving(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  // ── Attribute helpers ─────────────────────────────────────────────────────

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
    value: number | "" | undefined
  ) => {
    setVariantDetails((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { costPrice: "", sellingPrice: "", quantity: 0 }), [field]: value },
    }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true);
    try {
      const finalCost = costPrice === "" ? 0 : Number(costPrice);
      const finalSelling = sellingPrice === "" ? 0 : Number(sellingPrice);
      const targetStoreId = isMultiStore ? storeId : defaultStoreId;

      const parentRes = await apiRequest("POST", "/api/inventory", {
        storeId: targetStoreId,
        name: name.trim(),
        type,
        costPrice: finalCost,
        sellingPrice: finalSelling,
        quantity: type === "product" && hasVariants ? 0 : quantity,
        commissionSplitOverride: type === "service" ? commissionOverride : false,
        commissionSplitBusinessShare: bizShare,
        commissionSplitStaffShare: staffShare,
      });

      if (!parentRes.ok) {
        const err = await parentRes.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to create item");
      }

      const parent = await parentRes.json();

      if (type === "product" && hasVariants) {
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
          const vQty = detail?.quantity ?? 0;

          await apiRequest("POST", `/api/inventory/${parent.id}/variants`, {
            name: `${name.trim()} - ${comboLabel(combo)}`,
            costPrice: vCost,
            sellingPrice: vSelling,
            quantity: vQty,
            variantDimensions: combo,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "Item added",
        description:
          hasVariants && type === "product"
            ? `"${name}" created with ${selectedCombos.length} variant${selectedCombos.length !== 1 ? "s" : ""}.`
            : `"${name}" has been added to inventory.`,
      });
      onSuccess();
      handleClose();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to add item. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const fmt = (n: number | "") =>
    n === "" || n === 0 ? <span className="text-muted-foreground">not set</span> : `${sym}${Number(n).toLocaleString()}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-xl flex flex-col gap-0 p-0"
        style={{ maxHeight: "88vh" }}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>Add New Inventory Item</DialogTitle>
          <DialogDescription>
            Fill in what you have now — prices and stock can be updated anytime.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="px-6 pb-3 shrink-0 flex items-center gap-0">
          {steps.map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors",
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                      ? "bg-primary text-primary-foreground shadow shadow-primary/30"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "text-[11px] whitespace-nowrap",
                    i === step ? "font-semibold text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "h-px w-4 mx-2 shrink-0 transition-colors",
                    i < step ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <Separator className="shrink-0" />

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">

          {/* ── Step 0: Basics ───────────────────────────────────────── */}
          {step === 0 && (
            <>
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
                <Label htmlFor="wiz-name">
                  Item Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wiz-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Classic T-Shirt"
                  autoFocus
                  data-testid="wiz-input-name"
                  onKeyDown={(e) => e.key === "Enter" && canProceed && setStep(1)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Type <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  {(["product", "service"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setType(t);
                        if (t === "service") setHasVariants(false);
                      }}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-all",
                        type === t
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "hover:border-muted-foreground/40 hover:bg-muted/20"
                      )}
                      data-testid={`wiz-type-${t}`}
                    >
                      {t === "product" ? (
                        <Package
                          className={cn(
                            "h-4 w-4",
                            type === t ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                      ) : (
                        <Wrench
                          className={cn(
                            "h-4 w-4",
                            type === t ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                      )}
                      <div className="font-semibold text-sm capitalize">{t}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight">
                        {t === "product"
                          ? "Physical item with tracked stock"
                          : "Non-physical, unlimited supply"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {type === "product" && (
                <div className="flex items-center justify-between rounded-lg border p-3.5 bg-muted/20">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      Has Variants
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Different sizes, colors, or other attributes
                    </p>
                  </div>
                  <Switch
                    checked={hasVariants}
                    onCheckedChange={setHasVariants}
                    data-testid="wiz-switch-has-variants"
                  />
                </div>
              )}
            </>
          )}

          {/* ── Step 1 (service): Pricing ────────────────────────────── */}
          {step === 1 && type === "service" && (
            <>
              <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                All pricing is optional — you can update it anytime from the item details.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-cost-svc">Cost Price ({sym})</Label>
                  <Input
                    id="wiz-cost-svc"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={costPrice}
                    onChange={(e) =>
                      setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    data-testid="wiz-input-cost"
                  />
                  <p className="text-[10px] text-muted-foreground">Optional</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-selling-svc">Selling Price ({sym})</Label>
                  <Input
                    id="wiz-selling-svc"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={sellingPrice}
                    onChange={(e) =>
                      setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    data-testid="wiz-input-selling"
                  />
                </div>
              </div>

              {Number(sellingPrice) > 0 &&
                Number(costPrice) > 0 &&
                Number(sellingPrice) < Number(costPrice) && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <AlertDescription className="text-xs">
                      Selling price is below cost price.
                    </AlertDescription>
                  </Alert>
                )}

              <div className="rounded-lg border p-3.5 space-y-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Override Commission Split</div>
                    <p className="text-[11px] text-muted-foreground">
                      Customise split for this service only
                    </p>
                  </div>
                  <Switch
                    checked={commissionOverride}
                    onCheckedChange={setCommissionOverride}
                  />
                </div>
                {commissionOverride && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Business Share (%)</Label>
                      <Input
                        type="number"
                        value={bizShare}
                        onChange={(e) => setBizShare(Number(e.target.value))}
                        placeholder="80"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Staff Share (%)</Label>
                      <Input
                        type="number"
                        value={staffShare}
                        onChange={(e) => setStaffShare(Number(e.target.value))}
                        placeholder="20"
                      />
                    </div>
                    {bizShare + staffShare !== 100 && (
                      <p className="col-span-2 text-xs text-destructive">
                        Shares must sum to 100%.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Step 1 (product, no variants): Pricing & Stock ───────── */}
          {step === 1 && type === "product" && !hasVariants && (
            <>
              <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                All fields optional — update prices or add stock anytime.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-cost-prod">Cost Price ({sym})</Label>
                  <Input
                    id="wiz-cost-prod"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={costPrice}
                    onChange={(e) =>
                      setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    data-testid="wiz-input-cost"
                  />
                  <p className="text-[10px] text-muted-foreground">Optional</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-selling-prod">Selling Price ({sym})</Label>
                  <Input
                    id="wiz-selling-prod"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={sellingPrice}
                    onChange={(e) =>
                      setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                    }
                    data-testid="wiz-input-selling"
                  />
                </div>
              </div>

              {Number(sellingPrice) > 0 &&
                Number(costPrice) > 0 &&
                Number(sellingPrice) < Number(costPrice) && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <AlertDescription className="text-xs">
                      Selling price is below cost price.
                    </AlertDescription>
                  </Alert>
                )}

              <div className="space-y-1.5">
                <Label htmlFor="wiz-qty">Opening Stock</Label>
                <Input
                  id="wiz-qty"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                  data-testid="wiz-input-quantity"
                />
                <p className="text-[10px] text-muted-foreground">
                  Defaults to 0 — use Restock to add stock when ready.
                </p>
              </div>
            </>
          )}

          {/* ── Step 1 (product, variants): Define Variants ──────────── */}
          {step === 1 && type === "product" && hasVariants && (
            <>
              <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Add attribute axes (e.g. "size") and their values (e.g. S, M, L). Then deselect
                any combinations that don't exist.
              </p>

              {/* Add new attribute */}
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
                    list="wiz-preset-attrs"
                    className="flex-1"
                    data-testid="wiz-input-attr-name"
                  />
                  <datalist id="wiz-preset-attrs">
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
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Add at least one attribute to generate variant combinations.
                </div>
              )}

              {/* Attribute list */}
              <div className="space-y-3">
                {attributes.map((attr, attrIdx) => (
                  <div
                    key={attrIdx}
                    className="rounded-lg border p-3.5 space-y-2.5 bg-muted/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold capitalize">{attr.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttribute(attrIdx)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                      {attr.values.map((val, vi) => (
                        <Badge
                          key={vi}
                          variant="secondary"
                          className="gap-1 pr-1.5 text-xs font-medium"
                        >
                          {val}
                          <button
                            type="button"
                            onClick={() => removeValue(attrIdx, vi)}
                            className="hover:text-destructive ml-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                      {attr.values.length === 0 && (
                        <span className="text-[11px] text-muted-foreground italic">
                          No values yet
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder={`Add ${attr.name} value…`}
                        value={valueInputs[attrIdx] || ""}
                        onChange={(e) =>
                          setValueInputs((prev) => ({ ...prev, [attrIdx]: e.target.value }))
                        }
                        onKeyDown={(e) =>
                          e.key === "Enter" && (e.preventDefault(), addValue(attrIdx))
                        }
                        className="h-7 text-xs"
                        data-testid={`wiz-input-attr-value-${attrIdx}`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => addValue(attrIdx)}
                        disabled={!valueInputs[attrIdx]?.trim()}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Generated combinations */}
              {allCombos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">
                      Combinations — {allCombos.length} generated
                      {selectedCombos.length < allCombos.length && (
                        <span className="ml-1 text-muted-foreground font-normal">
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

                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                    {allCombos.map((combo) => {
                      const key = comboKey(combo);
                      const checked = !deselected.has(key);
                      return (
                        <div
                          key={key}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer",
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
                          <div className="flex gap-1 shrink-0">
                            {Object.entries(combo).map(([k, v]) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 font-normal"
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
                    <p className="text-xs text-destructive">
                      Select at least one combination to continue.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Step 2 (variant product): Prices & Stock ─────────────── */}
          {step === 2 && type === "product" && hasVariants && (
            <>
              <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Set defaults once and override per variant. All stock starts at 0 — add via
                Restock anytime.
              </p>

              {/* Default prices block */}
              <div className="rounded-lg border p-3.5 bg-muted/10 space-y-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Default Prices (inherited by all variants)
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Default Cost ({sym})</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={costPrice}
                      onChange={(e) =>
                        setCostPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                      }
                      data-testid="wiz-input-cost-default"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Default Selling ({sym})</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={sellingPrice}
                      onChange={(e) =>
                        setSellingPrice(e.target.value === "" ? "" : parseFloat(e.target.value))
                      }
                      data-testid="wiz-input-selling-default"
                    />
                  </div>
                </div>
              </div>

              {/* Per-variant table */}
              <div className="space-y-1.5">
                <div>
                  <Label className="text-sm">Per-Variant Overrides</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Leave blank to use the default prices above.
                  </p>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-[1fr_88px_88px_66px] gap-2 px-3 py-1.5 bg-muted/30 border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    <span>Variant</span>
                    <span>Cost ({sym})</span>
                    <span>Selling ({sym})</span>
                    <span>Stock</span>
                  </div>
                  <div className="divide-y max-h-56 overflow-y-auto">
                    {selectedCombos.map((combo) => {
                      const key = comboKey(combo);
                      const detail = variantDetails[key] || {};
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[1fr_88px_88px_66px] items-center gap-2 px-3 py-1.5"
                        >
                          <span className="text-xs font-medium truncate">
                            {comboLabel(combo)}
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={costPrice !== "" ? String(costPrice) : "0"}
                            value={detail.costPrice ?? ""}
                            onChange={(e) =>
                              updateVariantDetail(
                                key,
                                "costPrice",
                                e.target.value === "" ? "" : parseFloat(e.target.value)
                              )
                            }
                            className="h-7 text-xs px-2"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={sellingPrice !== "" ? String(sellingPrice) : "0"}
                            value={detail.sellingPrice ?? ""}
                            onChange={(e) =>
                              updateVariantDetail(
                                key,
                                "sellingPrice",
                                e.target.value === "" ? "" : parseFloat(e.target.value)
                              )
                            }
                            className="h-7 text-xs px-2"
                          />
                          <Input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={detail.quantity ?? 0}
                            onChange={(e) =>
                              updateVariantDetail(
                                key,
                                "quantity",
                                parseInt(e.target.value) || 0
                              )
                            }
                            className="h-7 text-xs px-2"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Review (last step) ────────────────────────────────────── */}
          {isLastStep && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Summary
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-semibold">{name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="capitalize font-medium">{type}</span>
                  </div>
                  {isMultiStore && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Store</span>
                      <span className="font-medium">
                        {stores.find((s) => s.id === storeId)?.name || storeId}
                      </span>
                    </div>
                  )}
                  {!(type === "product" && hasVariants) && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost Price</span>
                        <span className="font-mono text-sm">{fmt(costPrice)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Selling Price</span>
                        <span className="font-mono text-sm">{fmt(sellingPrice)}</span>
                      </div>
                      {type === "product" && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Opening Stock</span>
                          <span className="font-mono">{quantity}</span>
                        </div>
                      )}
                    </>
                  )}
                  {type === "product" && hasVariants && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Default Cost</span>
                        <span className="font-mono text-sm">{fmt(costPrice)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Default Selling</span>
                        <span className="font-mono text-sm">{fmt(sellingPrice)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Variants</span>
                        <span className="font-semibold">
                          {selectedCombos.length}{" "}
                          {selectedCombos.length === 1 ? "combination" : "combinations"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Variant list */}
              {type === "product" && hasVariants && selectedCombos.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Variants to be created
                  </p>
                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
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
                          className="flex items-center justify-between px-3 py-2 text-xs"
                        >
                          <span className="font-medium">
                            {name} — {comboLabel(combo)}
                          </span>
                          <div className="flex gap-3 text-muted-foreground font-mono shrink-0">
                            <span>
                              {sym}
                              {vc.toLocaleString()}
                            </span>
                            <span>→ {sym}{vs.toLocaleString()}</span>
                            <span className="text-foreground">qty: {vq}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {(sellingPrice === "" || Number(sellingPrice) === 0) && (
                <Alert className="py-2.5 border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-xs text-amber-800 dark:text-amber-200">
                    No selling price set — this item can't be sold yet. You can add it later from
                    item details.
                  </AlertDescription>
                </Alert>
              )}
              {type === "product" && !hasVariants && quantity === 0 && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  Stock is 0. Use the Restock action on this item to add units when ready.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Navigation footer */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === 0 ? handleClose() : setStep((s) => s - 1))}
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
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed}
              data-testid="wiz-btn-next"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
