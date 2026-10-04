import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, AlertTriangle, Package, Wrench, Droplets, Plus, X, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useQuery as useSettingsQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { z } from "zod";

const editFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  type: z.string().optional(),
  costPrice: z.number().min(0, "Cost price cannot be negative").optional(),
  sellingPrice: z.number().min(0, "Selling price cannot be negative").optional(),
  quantity: z.number().min(0, "Quantity cannot be negative").optional(),
  commissionSplitOverride: z.boolean().optional(),
  commissionSplitBusinessShare: z.number().min(0).max(100).optional(),
  commissionSplitStaffShare: z.number().min(0).max(100).optional(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  allowFractional: z.boolean().optional(),
  unit: z.string().optional().nullable(),
  reorderPoint: z.number().min(0).nullable().optional(),
});

type EditFormValues = z.infer<typeof editFormSchema>;

export default function InventoryEditPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const { data: settingsData } = useSettingsQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && currentStore.id !== "all",
  });
  const sym = settingsData?.currency?.symbol || "₦";

  const { data: item, isLoading } = useQuery<any>({
    // Not "inventory-detail": the details page caches that key with the raw product
    // (no isProductGroup flag), and reusing it made this page treat a product as a
    // legacy flat item — so cost, price and attributes all loaded as empty.
    queryKey: ["inventory-edit-item", id],
    gcTime: 0,
    queryFn: async () => {
      const prodRes = await fetch(`/api/products/${id}`);
      if (prodRes.ok) {
        const prod = await prodRes.json();
        return { isProductGroup: true, ...prod };
      }
      const invRes = await fetch(`/api/inventory/${id}`);
      if (invRes.ok) {
        const inv = await invRes.json();
        return { isProductGroup: false, ...inv };
      }
      throw new Error("Item not found");
    },
    enabled: !!id,
  });

  const variantParam = new URLSearchParams(useSearch()).get("variant");

  // A dimensionless row beside dimensioned siblings is a leftover base item, not a variant.
  const realVariants: any[] = (() => {
    const all: any[] = item?.variants ?? [];
    const hasDims = (v: any) => !!v.variantDimensions && Object.keys(v.variantDimensions).length > 0;
    return all.some(hasDims) ? all.filter(hasDims) : all;
  })();
  const isSimpleProduct = !!item?.isProductGroup && realVariants.length === 1;
  const isMultiVariant = !!item?.isProductGroup && realVariants.length > 1;
  const selectedVariant = isMultiVariant ? realVariants.find((v) => v.id === variantParam) ?? null : null;
  // Editing one specific variant of a multi-variant product.
  const variantMode = !!selectedVariant;
  // Multi-variant product with no variant chosen: only product-level details are editable.
  const pickerMode = isMultiVariant && !variantMode;
  const primaryVariant = isSimpleProduct ? realVariants[0] : variantMode ? selectedVariant : (!item?.isProductGroup ? item : null);
  const showVariantFields = !item?.isProductGroup || isSimpleProduct || variantMode;
  // Attributes belong to a variant: editable when one is picked, or on a single-variant
  // product that already carries some.
  const hasInitialDims = Object.keys((primaryVariant?.variantDimensions ?? {}) as object).length > 0;
  const showAttributes = !!item?.isProductGroup && (variantMode || (isSimpleProduct && hasInitialDims));
  const canEditAttributes = showAttributes;

  // Attributes of the variant being edited, as editable rows.
  // The form is only shown once it has been filled from the loaded item, so the
  // empty defaults are never displayed first.
  const [formReady, setFormReady] = useState(false);
  const [attrRows, setAttrRows] = useState<{ key: string; value: string }[]>([]);
  useEffect(() => {
    const dims = (primaryVariant?.variantDimensions ?? {}) as Record<string, string>;
    setAttrRows(Object.entries(dims).map(([key, value]) => ({ key, value: String(value) })));
  }, [primaryVariant?.id, primaryVariant?.variantDimensions]);

  const initialAttrJson = JSON.stringify(
    Object.entries((primaryVariant?.variantDimensions ?? {}) as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }))
  );
  const attrsDirty = JSON.stringify(attrRows) !== initialAttrJson;

  // A variant's name is "<product> - <value / value>" unless the owner overrides it.
  const autoName = (rows: { key: string; value: string }[]) => {
    const values = rows.map((r) => r.value.trim()).filter(Boolean);
    return values.length ? `${item?.name} - ${values.join(" / ")}` : null;
  };
  const [nameManual, setNameManual] = useState(false);
  useEffect(() => {
    if (!variantMode || !primaryVariant) return;
    const initialRows = Object.entries((primaryVariant.variantDimensions ?? {}) as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }));
    setNameManual(primaryVariant.name !== autoName(initialRows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantMode, primaryVariant?.id]);
  useEffect(() => {
    if (!variantMode || nameManual || !formReady) return;
    const next = autoName(attrRows);
    if (next && next !== form.getValues("name")) form.setValue("name", next, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrRows, nameManual, variantMode, formReady]);

  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canViewActivity = user?.role === "owner" || user?.role === "manager";
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: "",
      category: "",
      brand: "",
      description: "",
      type: "product",
      costPrice: 0,
      sellingPrice: 0,
      quantity: 0,
      commissionSplitOverride: false,
      commissionSplitBusinessShare: 80,
      commissionSplitStaffShare: 20,
      sku: "",
      barcode: "",
      allowFractional: false,
      unit: "",
      reorderPoint: null,
    },
  });

  useEffect(() => {
    if (item) {
      if (item.isProductGroup) {
        form.reset({
          name: (variantMode ? primaryVariant?.name : item.name) || "",
          category: item.category || "",
          brand: item.brand || "",
          description: item.description || "",
          type: item.type || "product",
          costPrice: primaryVariant?.costPrice ?? 0,
          sellingPrice: primaryVariant?.sellingPrice ?? 0,
          quantity: primaryVariant?.quantity ?? 0,
          commissionSplitOverride: primaryVariant?.commissionSplitOverride ?? false,
          commissionSplitBusinessShare: primaryVariant?.commissionSplitBusinessShare ?? 80,
          commissionSplitStaffShare: primaryVariant?.commissionSplitStaffShare ?? 20,
          sku: primaryVariant?.sku || "",
          barcode: primaryVariant?.barcode || "",
          allowFractional: primaryVariant?.allowFractional ?? false,
          unit: primaryVariant?.unit || "",
          reorderPoint: primaryVariant?.reorderPoint ?? null,
        });
      } else {
        form.reset({
          name: item.name || "",
          category: "",
          brand: "",
          description: "",
          type: item.type || "product",
          costPrice: item.costPrice ?? 0,
          sellingPrice: item.sellingPrice ?? 0,
          quantity: item.quantity ?? 0,
          commissionSplitOverride: item.commissionSplitOverride ?? false,
          commissionSplitBusinessShare: item.commissionSplitBusinessShare ?? 80,
          commissionSplitStaffShare: item.commissionSplitStaffShare ?? 20,
          sku: item.sku || "",
          barcode: item.barcode || "",
          allowFractional: item.allowFractional ?? false,
          unit: item.unit || "",
          reorderPoint: item.reorderPoint ?? null,
        });
      }
      setFormReady(true);
    }
  }, [item, primaryVariant, variantMode, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditFormValues) => {
      const cleanRows = attrRows.map((r) => ({ key: r.key.trim(), value: r.value.trim() })).filter((r) => r.key || r.value);
      if (cleanRows.some((r) => !r.key || !r.value)) throw new Error("Every attribute needs both a name and a value.");
      const keys = cleanRows.map((r) => r.key.toLowerCase());
      if (new Set(keys).size !== keys.length) throw new Error("Attribute names must be unique.");
      const variantDimensions = cleanRows.length ? Object.fromEntries(cleanRows.map((r) => [r.key, r.value])) : null;
      const variantPayload = {
        name: data.name,
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
        // quantity is deliberately not sent: stock changes go through Adjust stock, and a
        // value loaded when this page opened would overwrite sales made since.
        commissionSplitOverride: data.commissionSplitOverride,
        commissionSplitBusinessShare: data.commissionSplitBusinessShare,
        commissionSplitStaffShare: data.commissionSplitStaffShare,
        sku: data.sku || null,
        barcode: data.barcode || null,
        allowFractional: data.allowFractional ?? false,
        unit: data.unit || null,
        reorderPoint: data.reorderPoint ?? null,
        ...(canEditAttributes ? { variantDimensions } : {}),
      };
      if (variantMode && primaryVariant) {
        const invRes = await apiRequest("PATCH", `/api/inventory/${primaryVariant.id}`, variantPayload);
        if (!invRes.ok) {
          const err = await invRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to update variant");
        }
        return;
      }
      if (item.isProductGroup) {
        const prodRes = await apiRequest("PATCH", `/api/products/${id}`, {
          name: data.name,
          category: data.category || null,
          brand: data.brand || null,
          description: data.description || null,
          type: data.type,
        });
        if (!prodRes.ok) {
          const err = await prodRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to update product details");
        }
        if (isSimpleProduct && primaryVariant) {
          const invRes = await apiRequest("PATCH", `/api/inventory/${primaryVariant.id}`, variantPayload);
          if (!invRes.ok) {
            const err = await invRes.json().catch(() => ({}));
            throw new Error((err as any).error || "Failed to update variant pricing");
          }
        }
      } else {
        const invRes = await apiRequest("PATCH", `/api/inventory/${id}`, {
          name: data.name,
          type: data.type,
          costPrice: data.costPrice,
          sellingPrice: data.sellingPrice,
          commissionSplitOverride: data.commissionSplitOverride,
          commissionSplitBusinessShare: data.commissionSplitBusinessShare,
          commissionSplitStaffShare: data.commissionSplitStaffShare,
          sku: data.sku || null,
          barcode: data.barcode || null,
          allowFractional: data.allowFractional ?? false,
          unit: data.unit || null,
          reorderPoint: data.reorderPoint ?? null,
        });
        if (!invRes.ok) {
          const err = await invRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to update variant details");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-edit-item"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item updated successfully" });
      setLocation(`/inventory/${id}`);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: activityData } = useQuery<{ logs: any[] }>({
    queryKey: ["/api/inventory", primaryVariant?.id, "activity"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory/${primaryVariant!.id}/activity`);
      return res.json();
    },
    enabled: !!primaryVariant?.id && canViewActivity && showVariantFields && (primaryVariant?.type ?? item?.type) !== "service",
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const target = variantMode ? primaryVariant?.id : id;
      const res = await apiRequest("POST", `/api/inventory/${target}/archive`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to archive");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-detail"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-edit-item"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/archived"] });
      setArchiveOpen(false);
      toast({ title: variantMode ? "Variant archived" : "Item archived" });
      setLocation(variantMode ? `/inventory/${id}` : "/inventory");
    },
    onError: (e: Error) => toast({ title: "Couldn't archive", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (isLoading || (item && !formReady)) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;

  const watchType = form.watch("type");
  const watchCost = form.watch("costPrice") ?? 0;
  const watchSelling = form.watch("sellingPrice") ?? 0;
  const watchFractional = form.watch("allowFractional");
  const watchUnit = form.watch("unit");
  const watchOverride = form.watch("commissionSplitOverride");
  const watchReorder = form.watch("reorderPoint");
  const watchName = form.watch("name");
  const hasZeroMargin = watchCost > 0 && watchSelling === watchCost;
  const profit = watchSelling - watchCost;
  const margin = watchSelling > 0 ? (profit / watchSelling) * 100 : 0;
  const isSupply = watchType === "supply";
  const isService = watchType === "service";
  const isDirty = form.formState.isDirty || attrsDirty;
  const goBack = () => setLocation(`/inventory/${id}`);

  const handleFormSubmit = (data: EditFormValues) => {
    if (data.type !== "supply" && showVariantFields && data.sellingPrice !== undefined && data.costPrice !== undefined) {
      if (data.sellingPrice < data.costPrice) {
        form.setError("sellingPrice", { type: "manual", message: "Selling price cannot be less than cost price." });
        return;
      }
    }
    // A supply is never sold - keep it consistent with the create flow regardless
    // of what the (hidden) selling price field was last set to.
    updateMutation.mutate(data.type === "supply" ? { ...data, sellingPrice: 0 } : data);
  };

  // ── Shared bits ─────────────────────────────────────────────────────────
  const cardTitle = (title: string, hint?: string) => (
    <div className="space-y-0.5">
      <h2 className="text-base font-semibold leading-tight">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );

  const typeLabel = variantMode
    ? `${isService ? "Service" : isSupply ? "Supply" : "Product"} variant`
    : isService ? "Service" : isSupply ? "Supply" : "Product";

  // ── Cards ───────────────────────────────────────────────────────────────

  // Product-level details: shown when editing the product itself (single-variant or
  // picker mode), never while editing one variant of a multi-variant product.
  const itemDetailsCard = !variantMode && (
    <Card key="item">
      <CardContent className="pt-6 space-y-5">
        {cardTitle("Item details", "Name and catalog information.")}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Item name <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {item?.isProductGroup && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Bakery" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Local Bakery" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea {...field} value={field.value || ""} rows={3} placeholder="Add product catalog notes here…" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
        {showVariantFields && (
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["product", "service", "supply"] as const).map((t) => {
                      const Icon = t === "product" ? Package : t === "service" ? Wrench : Droplets;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            field.onChange(t);
                            if (t === "supply") form.setValue("sellingPrice", 0, { shouldDirty: true });
                          }}
                          className={cn(
                            "flex flex-col gap-2 rounded-lg border p-4 text-left transition-all",
                            field.value === t
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : "hover:border-muted-foreground/40 hover:bg-muted/20"
                          )}
                        >
                          <Icon className={cn("h-4 w-4", field.value === t ? "text-primary" : "text-muted-foreground")} />
                          <span className="font-semibold text-sm capitalize">{t}</span>
                          <span className="text-xs text-muted-foreground leading-tight">
                            {t === "product"
                              ? "Physical item with tracked stock"
                              : t === "service"
                              ? "Non-physical, unlimited supply"
                              : "Back-bar stock used up delivering services — never sold"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </CardContent>
    </Card>
  );

  // Multi-variant product with no variant chosen.
  const variantPickerCard = pickerMode && (
    <Card key="picker">
      <CardContent className="pt-6 space-y-4">
        {cardTitle(`Variants (${realVariants.length})`, "Pricing, stock and attributes are edited per variant. Pick one to edit.")}
        <div className="rounded-lg border divide-y">
          {realVariants.map((v: any) => (
            <button
              type="button"
              key={v.id}
              onClick={() => setLocation(`/inventory/${id}/edit?variant=${v.id}`)}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-sm text-left hover:bg-muted/40"
            >
              <span className="truncate font-medium">{v.name}</span>
              <span className="text-muted-foreground font-mono text-xs shrink-0">
                {sym}{Number(v.costPrice ?? 0).toLocaleString()} → {sym}{Number(v.sellingPrice ?? 0).toLocaleString()} · {v.quantity ?? 0} in stock
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  // Attributes + auto-built variant name.
  const variantDetailsCard = showAttributes && (
    <Card key="variant">
      <CardContent className="pt-6 space-y-4">
        {cardTitle("Variant details", `What makes this variant different from the others of ${item?.name}.`)}
        <div className="space-y-2">
          {attrRows.length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_2.25rem] gap-2 text-sm font-medium">
              <span>Attribute</span><span>Value</span><span />
            </div>
          )}
          {attrRows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-2">
              <Input
                placeholder="e.g. size"
                value={row.key}
                onChange={(e) => setAttrRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              />
              <Input
                placeholder="e.g. Large"
                value={row.value}
                onChange={(e) => setAttrRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove attribute"
                onClick={() => setAttrRows((rows) => rows.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="border-dashed text-primary"
            onClick={() => setAttrRows((rows) => [...rows, { key: "", value: "" }])}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add attribute
          </Button>
          <p className="text-xs text-muted-foreground">Each combination must be unique within {item?.name}.</p>
        </div>

        {variantMode && (
          <div className="border-t pt-4 space-y-2">
            <Label className="text-sm font-medium">Variant name</Label>
            {nameManual ? (
              <div className="space-y-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <button type="button" className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setNameManual(false)}>
                  Use the automatic name
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{watchName}</p>
                  <p className="text-xs text-muted-foreground">Built from the product name and values</p>
                </div>
                <button type="button" className="text-sm font-medium text-primary hover:underline shrink-0"
                  onClick={() => setNameManual(true)}>
                  Edit name
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const pricingCard = showVariantFields && (
    <Card key="pricing">
      <CardContent className="pt-6 space-y-4">
        {cardTitle("Pricing")}
        <div className={cn("grid gap-4", isSupply ? "grid-cols-1" : "grid-cols-2")}>
          <FormField
            control={form.control}
            name="costPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cost price</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{sym}</span>
                    <Input type="number" step="0.01" className="pl-8" {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                  </div>
                </FormControl>
                <FormDescription className="text-xs">What you pay the vendor per unit</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {!isSupply && (
            <FormField
              control={form.control}
              name="sellingPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Selling price</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{sym}</span>
                      <Input type="number" step="0.01" className="pl-8" {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                    </div>
                  </FormControl>
                  <FormDescription className="text-xs">What the customer pays</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {isSupply && (
          <Alert>
            <Droplets className="h-4 w-4" />
            <AlertDescription>
              Supplies are never sold, so they have no selling price. The cost is charged only
              when a service that uses this supply is delivered.
            </AlertDescription>
          </Alert>
        )}

        {!isSupply && (watchCost > 0 || watchSelling > 0) && (
          <div className={cn(
            "rounded-lg px-4 py-3 flex items-center justify-between text-sm",
            profit > 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : profit < 0 ? "bg-destructive/10" : "bg-muted/40"
          )}>
            <span className={cn("font-medium", profit > 0 ? "text-emerald-800 dark:text-emerald-300" : profit < 0 ? "text-destructive" : "text-muted-foreground")}>
              Profit per sale
            </span>
            <div className="flex items-baseline gap-2">
              <span className={cn("font-semibold font-mono text-base",
                profit > 0 ? "text-emerald-700 dark:text-emerald-400" : profit < 0 ? "text-destructive" : "text-muted-foreground")}>
                {sym}{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {watchSelling > 0 && <span className="text-xs text-muted-foreground">{margin.toFixed(1)}% margin</span>}
            </div>
          </div>
        )}

        {!isSupply && watchSelling < watchCost && watchCost > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Selling price cannot be less than cost price.</AlertDescription>
          </Alert>
        )}
        {!isSupply && hasZeroMargin && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 text-xs font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Zero margin — you will break even on every sale.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const identifiersCard = showVariantFields && (
    <Card key="identifiers">
      <CardContent className="pt-6 space-y-4">
        {cardTitle("Identifiers", "Used for search, scanning at checkout and stock counts.")}
        <FormField
          control={form.control}
          name="sku"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU</FormLabel>
              <div className="flex gap-2">
                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. SKU-12345" /></FormControl>
                <Button type="button" variant="outline" className="shrink-0"
                  onClick={() => form.setValue("sku", `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, { shouldDirty: true })}>
                  Shorter SKU
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="barcode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Barcode <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
              <div className="flex gap-2">
                <FormControl>
                  <Input {...field} ref={(el) => { field.ref(el); barcodeRef.current = el; }} value={field.value || ""}
                    placeholder="Type or scan the number on the pack" />
                </FormControl>
                <Button type="button" variant="outline" className="shrink-0"
                  onClick={() => {
                    barcodeRef.current?.focus();
                    toast({ title: "Ready to scan", description: "Scan the pack with your barcode scanner — the number will fill in." });
                  }}>
                  <ScanLine className="h-4 w-4 mr-1.5" /> Scan
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );

  const howSoldCard = showVariantFields && !isService && (
    <Card key="sold">
      <CardContent className="pt-6 space-y-4">
        {cardTitle("How it is sold")}
        <FormField
          control={form.control}
          name="allowFractional"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 space-y-0">
              <div className="space-y-0.5">
                <FormLabel className="text-sm font-medium">Sell in part quantities</FormLabel>
                <FormDescription className="text-xs">
                  For items sold by weight, length or volume, such as 0.5 kg or 1.25 litres
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        {watchFractional ? (
          <FormField
            control={form.control}
            name="unit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unit of measure</FormLabel>
                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. kg, litre, metre, g" /></FormControl>
                <FormDescription className="text-xs">Shown next to quantity on receipts and in the cart.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Sold and counted in whole units.</p>
        )}
        {!watchFractional && (primaryVariant?.quantity ?? 0) % 1 !== 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-amber-800 dark:text-amber-300 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Current stock is <strong>{primaryVariant?.quantity}</strong>
              {primaryVariant?.unit ? ` ${primaryVariant.unit}` : ""} — a fractional value. Turning this off won't change the stock number, but the POS will stop selling fractions.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const commissionCard = showVariantFields && isService && (
    <Card key="commission">
      <CardContent className="pt-6 space-y-4">
        {cardTitle("Commission split")}
        <FormField
          control={form.control}
          name="commissionSplitOverride"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 space-y-0">
              <div className="space-y-0.5">
                <FormLabel className="text-sm font-medium">Override commission split</FormLabel>
                <FormDescription className="text-xs">Use a custom split for this service</FormDescription>
              </div>
              <FormControl><Switch checked={field.value ?? false} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )}
        />
        {watchOverride && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="commissionSplitBusinessShare"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Business share (%)</FormLabel>
                  <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} placeholder="80" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="commissionSplitStaffShare"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Staff share (%)</FormLabel>
                  <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} placeholder="20" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Stock summary + low-stock alert. Quantity is changed through Adjust stock (which is
  // logged), not typed here: a typed number would silently overwrite sales made since
  // this page loaded.
  const stockQty = Number(primaryVariant?.quantity ?? 0);
  const customAlert = watchReorder !== null && watchReorder !== undefined;
  const stockUnit = watchUnit ? ` ${watchUnit}` : "";
  const stockCard = showVariantFields && !isService && primaryVariant && (
    <Card key="stock">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          {cardTitle(`Stock in ${currentStore.name}`)}
          {stockQty === 0 ? (
            <Badge variant="destructive" className="shrink-0">Out of stock</Badge>
          ) : customAlert && stockQty <= Number(watchReorder) ? (
            <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">Low stock</Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">In stock</Badge>
          )}
        </div>
        <div>
          <p className="text-4xl font-bold leading-none">
            {parseFloat(stockQty.toFixed(4))}
            <span className="ml-2 text-base font-normal text-muted-foreground">{watchUnit ? `${watchUnit} in stock` : "in stock"}</span>
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {sym}{Number(watchCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at cost
            {!isSupply && <> · {sym}{Number(watchSelling).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at selling price</>}
          </p>
        </div>
        <Button type="button" variant="outline" className="w-full"
          onClick={() => setLocation(`/inventory/${primaryVariant.id}/restock`)}>
          Adjust stock
        </Button>
        <p className="text-xs text-muted-foreground">
          Stock changes are logged with a reason. Received purchase orders and sales update it automatically.
        </p>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Low-stock alert</span>
            <span className="text-xs text-muted-foreground">{customAlert ? `Alert at ${watchReorder}${stockUnit}` : "Using the store default"}</span>
          </div>
          <label className="flex items-center gap-3 text-sm cursor-pointer">
            <input type="radio" name="reorder-mode" className="accent-primary h-4 w-4" checked={!customAlert}
              onChange={() => form.setValue("reorderPoint", null, { shouldDirty: true })} />
            Use the store default
          </label>
          <label className="flex items-center gap-3 text-sm cursor-pointer">
            <input type="radio" name="reorder-mode" className="accent-primary h-4 w-4" checked={customAlert}
              onChange={() => form.setValue("reorderPoint", 5, { shouldDirty: true })} />
            Set a level for this variant
          </label>
          {customAlert && (
            <Input
              type="number"
              min="0"
              step={watchFractional ? "0.01" : "1"}
              aria-label="Low-stock level"
              value={watchReorder ?? ""}
              onChange={(e) =>
                form.setValue("reorderPoint", e.target.value === "" ? 0 : watchFractional ? parseFloat(e.target.value) : parseInt(e.target.value), { shouldDirty: true })
              }
            />
          )}
        </div>
      </CardContent>
    </Card>
  );

  const logs = (activityData?.logs ?? []).slice(0, 5);
  const historyCard = showVariantFields && !isService && primaryVariant && canViewActivity && (
    <Card key="history">
      <CardContent className="pt-6 space-y-3">
        {cardTitle("Stock history")}
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adjustments yet. Sales, received orders and adjustments will be listed here.</p>
        ) : (
          <ul className="divide-y">
            {logs.map((log: any) => {
              const d = log.quantityDelta;
              return (
                <li key={`${log.type}-${log.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{log.label}</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</p>
                  </div>
                  <span className={cn("font-mono font-semibold shrink-0",
                    d > 0 ? "text-emerald-600 dark:text-emerald-400" : d < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                    {d === null || d === undefined ? "—" : `${d > 0 ? "+" : ""}${d}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={goBack}>
          See full history
        </button>
      </CardContent>
    </Card>
  );

  const archiveTarget = variantMode ? primaryVariant?.id : id;
  const archiveCard = !pickerMode && archiveTarget && (
    <Card key="archive">
      <CardContent className="pt-6 space-y-3">
        {cardTitle(variantMode ? "Archive this variant" : "Archive this item",
          `Hides it from sales and stock lists. History is kept and you can restore it.`)}
        <Button type="button" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive"
          onClick={() => setArchiveOpen(true)}>
          {variantMode ? "Archive variant" : "Archive item"}
        </Button>
      </CardContent>
    </Card>
  );

  // Desktop: main column + stock column. Mobile: stock first, then the rest.
  const mainCards = [itemDetailsCard, variantPickerCard, variantDetailsCard, pricingCard, identifiersCard, howSoldCard, commissionCard];
  const sideCards = [stockCard, historyCard];
  const columns = isMobile ? (
    <div className="space-y-4">{[stockCard, ...mainCards, historyCard, archiveCard]}</div>
  ) : (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      <div className="space-y-4">{[...mainCards, archiveCard]}</div>
      <div className="space-y-4">{sideCards}</div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="space-y-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink asChild><Link href="/inventory">Inventory</Link></BreadcrumbLink></BreadcrumbItem>
            {(variantMode || pickerMode || isSimpleProduct) && item?.isProductGroup && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbLink asChild><Link href={`/inventory/${id}`}>{item?.name}</Link></BreadcrumbLink></BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{variantMode ? "Edit variant" : "Edit item"}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold leading-tight">{variantMode ? primaryVariant?.name : item?.name}</h1>
            <Badge variant="secondary">{typeLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {variantMode && (
              <>Variant of <Link href={`/inventory/${id}`} className="font-medium text-primary hover:underline">{item?.name}</Link> · </>
            )}
            {currentStore.name}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-5">
          {columns}

          {/* ── Sticky action bar ─────────────────────────────── */}
          <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
            <Button type="button" variant="outline" onClick={goBack} className={isMobile ? "flex-1" : ""}>
              {isMobile ? "Discard" : "Discard changes"}
            </Button>
            <Button
              type="submit"
              className={isMobile ? "flex-1" : ""}
              disabled={
                !isDirty ||
                updateMutation.isPending ||
                (!isSupply && showVariantFields && watchSelling < watchCost && watchCost > 0)
              }
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Form>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={variantMode ? "Archive this variant?" : "Archive this item?"}
        description={`"${variantMode ? primaryVariant?.name : item?.name}" will be hidden from sales and stock lists. History is kept and you can restore it from the Archived tab.`}
        confirmText="Archive"
        isDestructive
        isLoading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}
