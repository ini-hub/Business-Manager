import { useState, useMemo, useEffect } from "react";
import { Plus, X, Check, Info, AlertTriangle, Layers, Package, Wrench, Archive, Lock } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { cartesianProduct, comboKey, comboLabel } from "@/lib/variant-combos";
import { MAX_VARIANTS_PER_PRODUCT } from "@shared/constants";

// ── Types ──────────────────────────────────────────────────────────────────

interface Attribute {
  name: string;
  values: string[];
  /** true = axis already exists in the DB; name and existing values cannot be removed */
  fromDB: boolean;
  /** subset of values that are already in DB (non-removable) */
  dbValues: Set<string>;
}

interface VariantDetail {
  costPrice: number | "";
  sellingPrice: number | "";
  quantity: number;
  allowFractional: boolean;
  unit: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
  parentName: string;
  parentType: "product" | "service";
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRESET_ATTRS = [
  "size", "color", "flavor", "material", "style",
  "weight", "duration", "level", "package", "scent", "volume",
];

function hasNoDimensions(v: any): boolean {
  const d = v.variantDimensions;
  return !d || Object.keys(d).length === 0;
}

/**
 * Reconstruct the attribute matrix from existing variants' variantDimensions.
 * Returns Attribute[] with fromDB=true and dbValues populated.
 */
function reconstructFromVariants(variants: any[]): Attribute[] {
  const axisMap = new Map<string, Set<string>>();
  for (const v of variants) {
    const dims = v.variantDimensions as Record<string, string> | null;
    if (!dims) continue;
    for (const [key, val] of Object.entries(dims)) {
      if (!axisMap.has(key)) axisMap.set(key, new Set());
      axisMap.get(key)!.add(String(val));
    }
  }
  return Array.from(axisMap.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values),
    fromDB: true,
    dbValues: new Set(values),
  }));
}

// ── Component ──────────────────────────────────────────────────────────────

export function AddVariantsSheet({
  open,
  onOpenChange,
  parentId,
  parentName,
  parentType,
}: Props) {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });
  const sym: string =
    settingsData?.currency?.symbol || currentStore?.currency || "₦";

  // Existing variants fetched from the product
  const { data: parentProduct, isLoading: loadingParent } = useQuery<any>({
    queryKey: ["inventory-detail", parentId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/products/${parentId}`);
      if (!res.ok) throw new Error("Failed to load product");
      return res.json();
    },
    enabled: open && !!parentId,
  });

  const existingVariants: any[] = parentProduct?.variants ?? [];
  const properVariants = existingVariants.filter((v) => !hasNoDimensions(v));
  const baseItem = existingVariants.find(
    (v) =>
      hasNoDimensions(v) &&
      v.name.toLowerCase() === parentName.toLowerCase()
  );

  // Existing combo keys (for "already exists" detection)
  const existingComboKeys = useMemo(
    () =>
      new Set(
        properVariants.map((v) =>
          comboKey(v.variantDimensions as Record<string, string>)
        )
      ),
    [properVariants]
  );

  // ── Steps ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // ── Cleanup options ───────────────────────────────────────────────────
  const [archiveBaseItem, setArchiveBaseItem] = useState(true);
  const [archiveIncomplete, setArchiveIncomplete] = useState(true);

  // ── Attributes ────────────────────────────────────────────────────────
  const [attributes, setAttributes] = useState<Attribute[]>([]);

  // Variants that are dimensionally incomplete relative to the current attribute matrix.
  // Example: existing {size: big} becomes incomplete when user adds a "weight" axis,
  // because the new matrix requires {size, weight} and the old entry only has {size}.
  const incompleteVariants = useMemo(() => {
    if (attributes.length === 0) return [];
    const currentAxes = attributes.map((a) => a.name);
    return properVariants.filter((v) => {
      const dims = v.variantDimensions as Record<string, string>;
      return !currentAxes.every((axis) => axis in dims);
    });
  }, [properVariants, attributes]);
  const [newAttrName, setNewAttrName] = useState("");
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({});
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  // ── Pricing ───────────────────────────────────────────────────────────
  const [defaultCost, setDefaultCost] = useState<number | "">("");
  const [defaultSelling, setDefaultSelling] = useState<number | "">("");
  const [variantDetails, setVariantDetails] = useState<
    Record<string, VariantDetail>
  >({});

  // ── Commission ────────────────────────────────────────────────────────
  const [commissionOverride, setCommissionOverride] = useState(false);
  const [bizShare, setBizShare] = useState(80);
  const [staffShare, setStaffShare] = useState(20);

  // ── One-time initialisation from DB when sheet opens ──────────────────
  useEffect(() => {
    if (!open || !parentProduct || hasInitialized) return;

    if (properVariants.length > 0) {
      // Reconstruct attribute axes from existing proper variants
      const reconstructed = reconstructFromVariants(properVariants);
      setAttributes(reconstructed);
      // Pre-deselect every combo that already exists in the DB
      setDeselected(new Set(existingComboKeys));
    }

    // Pre-fill default prices from the first proper variant (or base item)
    const priceSource = properVariants[0] ?? baseItem;
    if (priceSource) {
      if (priceSource.costPrice > 0)
        setDefaultCost(Number(priceSource.costPrice));
      if (priceSource.sellingPrice > 0)
        setDefaultSelling(Number(priceSource.sellingPrice));
    }

    setHasInitialized(true);
  }, [open, parentProduct, hasInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset on close ────────────────────────────────────────────────────
  const reset = () => {
    setStep(0);
    setShowErrors(false);
    setHasInitialized(false);
    setArchiveBaseItem(true);
    setArchiveIncomplete(true);
    setAttributes([]);
    setNewAttrName("");
    setValueInputs({});
    setDeselected(new Set());
    setDefaultCost("");
    setDefaultSelling("");
    setVariantDetails({});
    setCommissionOverride(false);
    setBizShare(80);
    setStaffShare(20);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const allCombos = useMemo(() => cartesianProduct(attributes), [attributes]);

  // Combos that don't yet exist in the DB and are user-selected
  const newCombos = useMemo(
    () =>
      allCombos.filter(
        (c) => !existingComboKeys.has(comboKey(c)) && !deselected.has(comboKey(c))
      ),
    [allCombos, existingComboKeys, deselected]
  );

  // All combos the user hasn't manually deselected (used for the grid)
  const selectedCombos = useMemo(
    () => allCombos.filter((c) => !deselected.has(comboKey(c))),
    [allCombos, deselected]
  );

  const pricingValid = useMemo(() => {
    const cost = Number(defaultCost);
    const sell = Number(defaultSelling);
    const costOk = defaultCost !== "" && cost > 0;
    const sellOk = defaultSelling !== "" && sell > 0;
    return {
      costOk,
      sellOk,
      noInversion: sell >= cost,
      all: costOk && sellOk && sell >= cost,
    };
  }, [defaultCost, defaultSelling]);

  const wouldExceedCap = existingVariants.length + newCombos.length > MAX_VARIANTS_PER_PRODUCT;

  const canAdvance = useMemo(() => {
    if (step === 0)
      return (
        attributes.some((a) => a.values.length > 0) &&
        newCombos.length > 0 &&
        !wouldExceedCap
      );
    if (step === 1) return pricingValid.all;
    return true;
  }, [step, attributes, newCombos, pricingValid, wouldExceedCap]);

  // ── Attribute helpers ─────────────────────────────────────────────────
  const addAttribute = () => {
    const n = newAttrName.trim().toLowerCase();
    if (!n || attributes.some((a) => a.name === n)) return;
    setAttributes((prev) => [
      ...prev,
      { name: n, values: [], fromDB: false, dbValues: new Set() },
    ]);
    setNewAttrName("");
  };

  const removeAttribute = (i: number) => {
    if (attributes[i].fromDB) return; // can't remove DB axes
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
          ? {
              ...a,
              values: a.values.includes(val)
                ? a.values
                : [...a.values, val],
            }
          : a
      )
    );
    setValueInputs((prev) => ({ ...prev, [attrIdx]: "" }));
  };

  const removeValue = (attrIdx: number, valIdx: number) => {
    const attr = attributes[attrIdx];
    const val = attr.values[valIdx];
    if (attr.dbValues.has(val)) return; // can't remove values that exist in DB
    setAttributes((prev) =>
      prev.map((a, i) =>
        i === attrIdx
          ? { ...a, values: a.values.filter((_, vi) => vi !== valIdx) }
          : a
      )
    );
  };

  const toggleCombo = (key: string) => {
    if (existingComboKeys.has(key)) return; // can't toggle existing combos
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateDetail = (
    key: string,
    field: keyof VariantDetail,
    value: any
  ) => {
    setVariantDetails((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {
          costPrice: "",
          sellingPrice: "",
          quantity: 0,
          allowFractional: false,
          unit: "",
        }),
        [field]: value,
      },
    }));
  };

  // ── Save ──────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    const finalCost = defaultCost === "" ? 0 : Number(defaultCost);
    const finalSelling = defaultSelling === "" ? 0 : Number(defaultSelling);
    let successCount = 0;
    const errors: string[] = [];

    try {
      for (const combo of newCombos) {
        const key = comboKey(combo);
        const detail = variantDetails[key];
        const vCost =
          detail?.costPrice !== "" && detail?.costPrice !== undefined
            ? Number(detail.costPrice)
            : finalCost;
        const vSell =
          detail?.sellingPrice !== "" && detail?.sellingPrice !== undefined
            ? Number(detail.sellingPrice)
            : finalSelling;
        const vQty = parentType === "product" ? (detail?.quantity ?? 0) : 0;
        const vFrac =
          parentType === "product" ? (detail?.allowFractional ?? false) : false;
        const vUnit = vFrac ? detail?.unit?.trim() || null : null;

        const res = await apiRequest(
          "POST",
          `/api/products/${parentId}/variants`,
          {
            name: `${parentName} - ${comboLabel(combo)}`,
            costPrice: vCost,
            sellingPrice: vSell,
            quantity: vQty,
            variantDimensions: combo,
            sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            allowFractional: vFrac,
            unit: vUnit,
            commissionSplitOverride:
              parentType === "service" ? commissionOverride : false,
            commissionSplitBusinessShare: bizShare,
            commissionSplitStaffShare: staffShare,
          }
        );

        if (res.ok) {
          successCount++;
        } else {
          const err = await res.json().catch(() => ({}));
          errors.push(
            `${comboLabel(combo)}: ${(err as any).error?.message || (err as any).error || "Failed"}`
          );
        }
      }

      // Archive the base item if opted in
      if (successCount > 0 && archiveBaseItem && baseItem) {
        await apiRequest("POST", `/api/inventory/${baseItem.id}/archive`).catch(() => null);
      }

      // Archive dimensionally-incomplete variants if opted in
      if (successCount > 0 && archiveIncomplete && incompleteVariants.length > 0) {
        await Promise.all(
          incompleteVariants.map((v) =>
            apiRequest("POST", `/api/inventory/${v.id}/archive`).catch(() => null)
          )
        );
      }

      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({
        queryKey: ["inventory-detail", parentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["inventory-variants", parentId],
      });

      if (successCount > 0) {
        const archivedCount =
          (archiveBaseItem && baseItem ? 1 : 0) +
          (archiveIncomplete ? incompleteVariants.length : 0);
        const parts: string[] = [];
        if (errors.length) parts.push(`${errors.length} failed`);
        if (archivedCount > 0)
          parts.push(
            `${archivedCount} old variant${archivedCount !== 1 ? "s" : ""} archived`
          );
        toast({
          title: `${successCount} variant${successCount !== 1 ? "s" : ""} added`,
          description: parts.length ? parts.join(", ") : undefined,
        });
        handleOpenChange(false);
      } else {
        toast({
          title: "No variants were created",
          description: errors[0] ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const Icon = parentType === "service" ? Wrench : Package;
  const hasProperVariants = properVariants.length > 0;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col p-0"
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <SheetTitle className="text-base">Add Variants</SheetTitle>
          </div>
          <SheetDescription className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>
              Adding variants to{" "}
              <span className="font-medium text-foreground">{parentName}</span>
            </span>
          </SheetDescription>
          {/* Step pills */}
          <div className="flex items-center gap-2 pt-1">
            {["Define", "Prices"].map((label, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
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
                    "text-xs",
                    i === step ? "font-semibold" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
                {i < 1 && (
                  <div
                    className={cn(
                      "h-px w-4 mx-1",
                      i < step ? "bg-primary" : "bg-border"
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </SheetHeader>

        {/* ── Scrollable body ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loadingParent && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading…
            </div>
          )}

          {!loadingParent && (
            <>
              {/* ── Existing variants summary (step 0 only) ───────────── */}
              {step === 0 && existingVariants.length > 0 && (
                <div className="rounded-lg border bg-muted/10 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Existing variants ({existingVariants.length})
                    </span>
                  </div>
                  <div className="divide-y max-h-40 overflow-y-auto">
                    {existingVariants.map((v) => {
                      const isBase =
                        hasNoDimensions(v) &&
                        v.name.toLowerCase() === parentName.toLowerCase();
                      const dims =
                        v.variantDimensions &&
                        Object.keys(v.variantDimensions).length > 0
                          ? (Object.entries(
                              v.variantDimensions as Record<string, string>
                            ))
                          : null;
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between px-4 py-2 text-sm gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              {v.name}
                            </span>
                            {isBase && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 h-4 shrink-0 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20"
                              >
                                base
                              </Badge>
                            )}
                            {dims && (
                              <div className="flex gap-1 flex-wrap">
                                {dims.map(([k, val]) => (
                                  <Badge
                                    key={k}
                                    variant="secondary"
                                    className="text-[10px] py-0 h-4 font-normal"
                                  >
                                    {k}: {val}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground font-mono">
                            {parentType === "product" && (
                              <span>
                                {Number(v.quantity).toLocaleString()}{" "}
                                {v.unit || "units"}
                              </span>
                            )}
                            <span>
                              {sym}
                              {Number(v.sellingPrice).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Base item warning ───────────────────────────────────── */}
              {step === 0 && baseItem && (
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="space-y-3">
                    {!hasProperVariants ? (
                      /* Case A: no proper variants yet — converting for the first time */
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        <span className="font-semibold">"{baseItem.name}"</span>{" "}
                        is currently a simple item
                        {parentType === "product" &&
                        Number(baseItem.quantity) > 0
                          ? ` with ${Number(baseItem.quantity).toLocaleString()} ${baseItem.unit || "units"} in stock`
                          : ""}
                        . Adding variants will convert it to a variant product.
                        The original entry will become redundant — you should
                        archive it and enter stock per new variant instead.
                      </p>
                    ) : (
                      /* Case B: proper variants already exist + base item still present */
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        <span className="font-semibold">"{baseItem.name}"</span>{" "}
                        is an unspecified base entry that exists alongside your
                        variants
                        {parentType === "product" &&
                        Number(baseItem.quantity) > 0
                          ? ` (${Number(baseItem.quantity).toLocaleString()} ${baseItem.unit || "units"})`
                          : ""}
                        . Archive it to keep your inventory clean.
                      </p>
                    )}
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={archiveBaseItem}
                        onCheckedChange={(v) => setArchiveBaseItem(!!v)}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                        <Archive className="h-3 w-3 inline mr-1" />
                        Archive{" "}
                        <span className="font-semibold">
                          "{baseItem.name}"
                        </span>{" "}
                        after adding new variants
                      </span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {/* ── Incomplete variants warning ─────────────────────────── */}
              {step === 0 && incompleteVariants.length > 0 && (
                <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="space-y-3">
                    <p className="text-sm text-orange-800 dark:text-orange-200">
                      Adding the{" "}
                      <span className="font-semibold">
                        {attributes
                          .filter(
                            (a) =>
                              !incompleteVariants.every(
                                (v) =>
                                  a.name in
                                  (v.variantDimensions as Record<string, string>)
                              )
                          )
                          .map((a) => `"${a.name}"`)
                          .join(", ")}
                      </span>{" "}
                      axis will make{" "}
                      <span className="font-semibold">
                        {incompleteVariants.length} existing variant
                        {incompleteVariants.length !== 1 ? "s" : ""}
                      </span>{" "}
                      dimensionally incomplete — they only have part of the
                      attribute matrix:
                    </p>
                    <ul className="space-y-1">
                      {incompleteVariants.map((v) => (
                        <li
                          key={v.id}
                          className="flex items-center gap-2 text-xs text-orange-800 dark:text-orange-200"
                        >
                          <span className="font-medium">{v.name}</span>
                          {v.variantDimensions &&
                            Object.entries(
                              v.variantDimensions as Record<string, string>
                            ).map(([k, val]) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="text-[10px] h-4 py-0 border-orange-300 text-orange-700"
                              >
                                {k}: {val}
                              </Badge>
                            ))}
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={archiveIncomplete}
                        onCheckedChange={(v) => setArchiveIncomplete(!!v)}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-xs text-orange-800 dark:text-orange-200 leading-relaxed">
                        <Archive className="h-3 w-3 inline mr-1" />
                        Archive these{" "}
                        <span className="font-semibold">
                          {incompleteVariants.length} incomplete variant
                          {incompleteVariants.length !== 1 ? "s" : ""}
                        </span>{" "}
                        after adding the new cross-product variants
                      </span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {/* ── Step 0 — Define attributes ─────────────────────────── */}
              {step === 0 && (
                <>
                  {hasProperVariants && (
                    <p className="text-sm text-muted-foreground flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                      The attribute axes below are pre-filled from your existing
                      variants. Add new values to an existing axis, or add an
                      entirely new axis to generate a cross-product of
                      combinations.
                    </p>
                  )}
                  {!hasProperVariants && (
                    <p className="text-sm text-muted-foreground flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      Add attribute axes then their values. The system generates
                      every combination.
                    </p>
                  )}

                  {/* Add attribute input */}
                  <div className="space-y-1.5">
                    <Label>Add Attribute Axis</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. size, duration, scent…"
                        value={newAttrName}
                        onChange={(e) => setNewAttrName(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          (e.preventDefault(), addAttribute())
                        }
                        list="avs-preset-attrs"
                        className="flex-1"
                        autoFocus
                      />
                      <datalist id="avs-preset-attrs">
                        {PRESET_ATTRS.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addAttribute}
                        disabled={
                          !newAttrName.trim() ||
                          attributes.some(
                            (a) =>
                              a.name === newAttrName.trim().toLowerCase()
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {attributes.length === 0 ? (
                    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                      No attributes yet. Add at least one axis to generate
                      combinations.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {attributes.map((attr, attrIdx) => (
                        <div
                          key={attrIdx}
                          className={cn(
                            "rounded-lg border p-4 space-y-3",
                            attr.fromDB ? "bg-primary/5 border-primary/20" : "bg-muted/10"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold capitalize">
                                {attr.name}
                              </span>
                              {attr.fromDB && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] h-4 py-0 gap-1 text-primary border-primary/30 bg-primary/5"
                                >
                                  <Lock className="h-2.5 w-2.5" />
                                  existing
                                </Badge>
                              )}
                            </div>
                            {!attr.fromDB && (
                              <button
                                type="button"
                                onClick={() => removeAttribute(attrIdx)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 min-h-[24px]">
                            {attr.values.map((val, vi) => {
                              const isDBVal = attr.dbValues.has(val);
                              return (
                                <Badge
                                  key={vi}
                                  variant={isDBVal ? "secondary" : "outline"}
                                  className={cn(
                                    "gap-1.5 text-xs font-medium",
                                    isDBVal
                                      ? "opacity-70 pr-2"
                                      : "pr-1.5"
                                  )}
                                >
                                  {isDBVal && (
                                    <Lock className="h-2.5 w-2.5 shrink-0" />
                                  )}
                                  {val}
                                  {!isDBVal && (
                                    <button
                                      type="button"
                                      onClick={() => removeValue(attrIdx, vi)}
                                      className="hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </Badge>
                              );
                            })}
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
                                e.key === "Enter" &&
                                (e.preventDefault(), addValue(attrIdx))
                              }
                              className="h-8 text-sm"
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
                  )}

                  {/* ── Combination grid ──────────────────────────────── */}
                  {allCombos.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>
                          {allCombos.length} combination
                          {allCombos.length !== 1 ? "s" : ""} total
                          {newCombos.length < allCombos.length && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {newCombos.length} new
                            </span>
                          )}
                        </Label>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() =>
                              setDeselected(new Set(existingComboKeys))
                            }
                          >
                            Select all new
                          </button>
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:underline"
                            onClick={() =>
                              setDeselected(
                                new Set(allCombos.map(comboKey))
                              )
                            }
                          >
                            Deselect all
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
                        {allCombos.map((combo) => {
                          const key = comboKey(combo);
                          const alreadyExists = existingComboKeys.has(key);
                          const selected = !deselected.has(key);
                          return (
                            <div
                              key={key}
                              className={cn(
                                "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors select-none",
                                alreadyExists
                                  ? "opacity-50 cursor-not-allowed bg-muted/20"
                                  : "cursor-pointer hover:bg-muted/30",
                                !selected && !alreadyExists && "opacity-40"
                              )}
                              onClick={() => !alreadyExists && toggleCombo(key)}
                            >
                              <Checkbox
                                checked={selected}
                                disabled={alreadyExists}
                                onCheckedChange={() =>
                                  !alreadyExists && toggleCombo(key)
                                }
                                className="shrink-0"
                              />
                              <span className="font-medium flex-1">
                                {parentName} — {comboLabel(combo)}
                              </span>
                              <div className="flex gap-1.5 shrink-0 items-center">
                                {alreadyExists ? (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] h-4 px-1.5 py-0 text-muted-foreground"
                                  >
                                    exists
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] h-4 px-1.5 py-0 text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20"
                                  >
                                    new
                                  </Badge>
                                )}
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
                      {showErrors && newCombos.length === 0 && (
                        <p className="text-sm text-destructive">
                          No new combinations to create. Add new attribute
                          values to proceed.
                        </p>
                      )}
                      {wouldExceedCap && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            This product would have {existingVariants.length + newCombos.length} variants,
                            over the {MAX_VARIANTS_PER_PRODUCT}-variant limit per product.
                            Deselect some combinations or reduce attribute values to continue.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ── Step 1 — Prices ───────────────────────────────────── */}
              {step === 1 && (
                <>
                  <div className="rounded-lg border p-4 bg-muted/10 space-y-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Default Prices{" "}
                      <span className="text-destructive normal-case font-normal">
                        *
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>
                          Cost ({sym}){" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="0.00"
                          value={defaultCost}
                          onChange={(e) =>
                            setDefaultCost(
                              e.target.value === ""
                                ? ""
                                : parseFloat(e.target.value)
                            )
                          }
                          className={
                            showErrors && !pricingValid.costOk
                              ? "border-destructive"
                              : ""
                          }
                          autoFocus
                        />
                        {showErrors && !pricingValid.costOk && (
                          <p className="text-xs text-destructive">
                            Required, must be &gt; 0
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>
                          Selling ({sym}){" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="0.00"
                          value={defaultSelling}
                          onChange={(e) =>
                            setDefaultSelling(
                              e.target.value === ""
                                ? ""
                                : parseFloat(e.target.value)
                            )
                          }
                          className={
                            showErrors && !pricingValid.sellOk
                              ? "border-destructive"
                              : ""
                          }
                        />
                        {showErrors && !pricingValid.sellOk && (
                          <p className="text-xs text-destructive">
                            Required, must be &gt; 0
                          </p>
                        )}
                      </div>
                    </div>
                    {pricingValid.costOk &&
                      pricingValid.sellOk &&
                      !pricingValid.noInversion && (
                        <p className="text-xs text-destructive">
                          Selling price cannot be less than cost.
                        </p>
                      )}
                  </div>

                  {parentType === "service" && (
                    <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">
                            Override Commission Split
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Applies to all new variants
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
                              onChange={(e) =>
                                setBizShare(Number(e.target.value))
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Staff Share (%)</Label>
                            <Input
                              type="number"
                              value={staffShare}
                              onChange={(e) =>
                                setStaffShare(Number(e.target.value))
                              }
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

                  {/* Per-variant overrides */}
                  <div className="space-y-2">
                    <div>
                      <Label>Per-Variant Overrides</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Leave blank to inherit the defaults above.
                      </p>
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      {parentType === "product" ? (
                        <>
                          <div className="grid grid-cols-[1fr_80px_80px_60px_48px_64px] gap-2 px-4 py-2 bg-muted/30 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            <span>Variant</span>
                            <span>Cost</span>
                            <span>Sell</span>
                            <span>Stock</span>
                            <span>Frac?</span>
                            <span>Unit</span>
                          </div>
                          <div className="divide-y max-h-64 overflow-y-auto">
                            {newCombos.map((combo) => {
                              const key = comboKey(combo);
                              const d = variantDetails[key] || {
                                costPrice: "",
                                sellingPrice: "",
                                quantity: 0,
                                allowFractional: false,
                                unit: "",
                              };
                              return (
                                <div
                                  key={key}
                                  className="grid grid-cols-[1fr_80px_80px_60px_48px_64px] items-center gap-2 px-4 py-2"
                                >
                                  <span className="text-sm font-medium truncate">
                                    {comboLabel(combo)}
                                  </span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={
                                      defaultCost !== ""
                                        ? String(defaultCost)
                                        : "0"
                                    }
                                    value={d.costPrice ?? ""}
                                    onChange={(e) =>
                                      updateDetail(
                                        key,
                                        "costPrice",
                                        e.target.value === ""
                                          ? ""
                                          : parseFloat(e.target.value)
                                      )
                                    }
                                    className="h-8 text-sm px-2"
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={
                                      defaultSelling !== ""
                                        ? String(defaultSelling)
                                        : "0"
                                    }
                                    value={d.sellingPrice ?? ""}
                                    onChange={(e) =>
                                      updateDetail(
                                        key,
                                        "sellingPrice",
                                        e.target.value === ""
                                          ? ""
                                          : parseFloat(e.target.value)
                                      )
                                    }
                                    className="h-8 text-sm px-2"
                                  />
                                  <Input
                                    type="number"
                                    min="0"
                                    step={
                                      d.allowFractional ? "0.01" : "1"
                                    }
                                    placeholder="0"
                                    value={d.quantity ?? 0}
                                    onChange={(e) =>
                                      updateDetail(
                                        key,
                                        "quantity",
                                        d.allowFractional
                                          ? parseFloat(e.target.value) || 0
                                          : parseInt(e.target.value) || 0
                                      )
                                    }
                                    className="h-8 text-sm px-2"
                                  />
                                  <div className="flex justify-center">
                                    <Switch
                                      checked={d.allowFractional ?? false}
                                      onCheckedChange={(v) =>
                                        updateDetail(
                                          key,
                                          "allowFractional",
                                          v
                                        )
                                      }
                                      className="scale-75"
                                    />
                                  </div>
                                  <Input
                                    placeholder="kg"
                                    value={d.unit ?? ""}
                                    disabled={!d.allowFractional}
                                    onChange={(e) =>
                                      updateDetail(key, "unit", e.target.value)
                                    }
                                    className="h-8 text-xs px-2"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-[1fr_88px_88px] gap-2 px-4 py-2 bg-muted/30 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            <span>Variant</span>
                            <span>Cost ({sym})</span>
                            <span>Selling ({sym})</span>
                          </div>
                          <div className="divide-y max-h-64 overflow-y-auto">
                            {newCombos.map((combo) => {
                              const key = comboKey(combo);
                              const d = variantDetails[key] || {
                                costPrice: "",
                                sellingPrice: "",
                                quantity: 0,
                                allowFractional: false,
                                unit: "",
                              };
                              return (
                                <div
                                  key={key}
                                  className="grid grid-cols-[1fr_88px_88px] items-center gap-2 px-4 py-2"
                                >
                                  <span className="text-sm font-medium truncate">
                                    {comboLabel(combo)}
                                  </span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={
                                      defaultCost !== ""
                                        ? String(defaultCost)
                                        : "0"
                                    }
                                    value={d.costPrice ?? ""}
                                    onChange={(e) =>
                                      updateDetail(
                                        key,
                                        "costPrice",
                                        e.target.value === ""
                                          ? ""
                                          : parseFloat(e.target.value)
                                      )
                                    }
                                    className="h-8 text-sm px-2"
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={
                                      defaultSelling !== ""
                                        ? String(defaultSelling)
                                        : "0"
                                    }
                                    value={d.sellingPrice ?? ""}
                                    onChange={(e) =>
                                      updateDetail(
                                        key,
                                        "sellingPrice",
                                        e.target.value === ""
                                          ? ""
                                          : parseFloat(e.target.value)
                                      )
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

                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {newCombos.length} new variant
                    {newCombos.length !== 1 ? "s" : ""} will be created.
                    {archiveBaseItem && baseItem &&
                      ` Original "${parentName}" base entry will be archived.`}
                    {archiveIncomplete && incompleteVariants.length > 0 &&
                      ` ${incompleteVariants.length} incomplete variant${incompleteVariants.length !== 1 ? "s" : ""} will be archived.`}
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 bg-background">
          {step === 0 ? (
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setShowErrors(false);
                setStep(0);
              }}
            >
              Back
            </Button>
          )}

          {step === 0 ? (
            <Button
              onClick={() => {
                if (!canAdvance) {
                  setShowErrors(true);
                  return;
                }
                setShowErrors(false);
                setStep(1);
              }}
              disabled={loadingParent}
            >
              Next — Set Prices
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (!canAdvance) {
                  setShowErrors(true);
                  return;
                }
                save();
              }}
              disabled={saving}
            >
              {saving
                ? "Adding…"
                : `Add ${newCombos.length} Variant${newCombos.length !== 1 ? "s" : ""}`}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
