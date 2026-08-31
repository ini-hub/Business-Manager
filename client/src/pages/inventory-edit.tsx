import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, AlertCircle, AlertTriangle, Package, Wrench, Droplets, Tag, BarChart2, Layers } from "lucide-react";
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
import { PageHeader } from "@/components/page-header";
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
    queryKey: ["inventory-detail", id],
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

  const isSimpleProduct = item?.isProductGroup && item?.variants && item?.variants.length === 1;
  const primaryVariant = isSimpleProduct ? item.variants[0] : (!item?.isProductGroup ? item : null);
  const showVariantFields = !item?.isProductGroup || isSimpleProduct;

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
          name: item.name || "",
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
    }
  }, [item, primaryVariant, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditFormValues) => {
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
          const invRes = await apiRequest("PATCH", `/api/inventory/${primaryVariant.id}`, {
            name: data.name,
            costPrice: data.costPrice,
            sellingPrice: data.sellingPrice,
            quantity: data.quantity,
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
            throw new Error((err as any).error || "Failed to update variant pricing");
          }
        }
      } else {
        const invRes = await apiRequest("PATCH", `/api/inventory/${id}`, {
          name: data.name,
          type: data.type,
          costPrice: data.costPrice,
          sellingPrice: data.sellingPrice,
          quantity: data.quantity,
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
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item updated successfully" });
      setLocation(`/inventory/${id}`);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;

  const watchType = form.watch("type");
  const watchCost = form.watch("costPrice") ?? 0;
  const watchSelling = form.watch("sellingPrice") ?? 0;
  const watchFractional = form.watch("allowFractional");
  const watchUnit = form.watch("unit");
  const watchOverride = form.watch("commissionSplitOverride");
  const hasZeroMargin = watchCost > 0 && watchSelling === watchCost;
  const profit = watchSelling - watchCost;
  const margin = watchSelling > 0 ? (profit / watchSelling) * 100 : 0;

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

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <PageHeader
        title="Edit Item"
        description={item?.name}
        actions={
          <Button variant="outline" onClick={() => setLocation(`/inventory/${id}`)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        }
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">

          {/* ── Card A: Basics ─────────────────────────────────── */}
          <Card>
            <CardContent className="pt-6 space-y-5">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Basics</span>
              </div>

              {/* Item Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category + Brand — product groups only */}
              {item?.isProductGroup && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="e.g. Bakery" />
                          </FormControl>
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
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="e.g. Local Bakery" />
                          </FormControl>
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
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value || ""}
                            rows={3}
                            placeholder="Add product catalog notes here…"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Type button-grid — editable when showVariantFields */}
              {showVariantFields && (
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {(["product", "service", "supply"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                field.onChange(t);
                                // A supply is never sold - keep it consistent with the create flow.
                                if (t === "supply") form.setValue("sellingPrice", 0);
                              }}
                              className={cn(
                                "flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-all",
                                field.value === t
                                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                  : "hover:border-muted-foreground/40 hover:bg-muted/20"
                              )}
                            >
                              {(() => {
                                const Icon = t === "product" ? Package : t === "service" ? Wrench : Droplets;
                                return (
                                  <Icon
                                    className={cn(
                                      "h-4 w-4",
                                      field.value === t ? "text-primary" : "text-muted-foreground"
                                    )}
                                  />
                                );
                              })()}
                              <span className="font-semibold text-sm capitalize">{t}</span>
                              <span className="text-xs text-muted-foreground leading-tight">
                                {t === "product"
                                  ? "Physical item with tracked stock"
                                  : t === "service"
                                  ? "Non-physical, unlimited supply"
                                  : "Back-bar stock used up delivering services — never sold"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {/* ── Card A2: Variants — cost/selling/quantity live per-variant,
              not here, once an item has more than one variant ─────────── */}
          {item?.isProductGroup && !isSimpleProduct && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">
                    Variants ({item.variants?.length ?? 0})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  This item has more than one variant, so cost price, selling price, and stock
                  quantity are set per-variant rather than here. Open a variant from the item's
                  detail page to edit its pricing or stock.
                </p>
                <div className="rounded-lg border divide-y">
                  {(item.variants || []).map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="truncate">{v.name}</span>
                      <span className="text-muted-foreground font-mono text-xs shrink-0">
                        {sym}{Number(v.costPrice ?? 0).toLocaleString()} → {sym}{Number(v.sellingPrice ?? 0).toLocaleString()} · {v.quantity ?? 0} in stock
                      </span>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation(`/inventory/${id}`)}
                >
                  Manage Variant Pricing &amp; Stock
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Card B: Pricing ────────────────────────────────── */}
          {showVariantFields && (
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Pricing</span>
                </div>

                {/* SKU + Barcode */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SKU Code</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="e.g. SKU-12345" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="barcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barcode</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="e.g. 0123456789" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Cost + Selling Price — a supply is never sold, so it has no selling price */}
                <div className={cn("grid gap-4", watchType === "supply" ? "grid-cols-1" : "sm:grid-cols-2")}>
                  <FormField
                    control={form.control}
                    name="costPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Price ({sym})</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchType !== "supply" && (
                    <FormField
                      control={form.control}
                      name="sellingPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Selling Price ({sym})</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {watchType === "supply" && (
                  <Alert>
                    <Droplets className="h-4 w-4" />
                    <AlertDescription>
                      Supplies are never sold, so they have no selling price. The cost is charged only
                      when a service that uses this supply is delivered.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Profit / margin preview */}
                {watchType !== "supply" && (watchCost > 0 || watchSelling > 0) && (
                  <div className="rounded-lg bg-muted/30 border px-4 py-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <BarChart2 className="h-3.5 w-3.5" />
                      Profit per sale
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "font-semibold font-mono",
                          profit > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : profit < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {sym}{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {watchSelling > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({margin.toFixed(1)}% margin)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Selling < cost alert */}
                {watchType !== "supply" && watchSelling < watchCost && watchCost > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Selling price cannot be less than cost price.</AlertDescription>
                  </Alert>
                )}

                {/* Zero margin warning */}
                {watchType !== "supply" && hasZeroMargin && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 text-xs font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Zero margin — you will break even on every sale.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Card C: Stock ──────────────────────────────────── */}
          {showVariantFields && (watchType === "product" || watchType === "supply") && (
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Stock</span>
                </div>

                {/* Fractional selling toggle */}
                <FormField
                  control={form.control}
                  name="allowFractional"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm font-medium">Sell by fraction</FormLabel>
                        <FormDescription className="text-xs">
                          Allow selling partial quantities (e.g. 0.5 kg, 1.25 litres)
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Unit of measure — conditional */}
                {watchFractional && (
                  <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit of Measure</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g. kg, litre, metre, g"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Shown next to quantity on receipts and in the cart.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* Quantity in stock */}
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Quantity in Stock{watchFractional && watchUnit ? ` (${watchUnit})` : ""}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step={watchFractional ? "0.01" : "1"}
                          min="0"
                          {...field}
                          onChange={(e) =>
                            field.onChange(
                              watchFractional
                                ? parseFloat(e.target.value) || 0
                                : parseInt(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Low-stock alert / reorder point */}
                <FormField
                  control={form.control}
                  name="reorderPoint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Low-Stock Alert{watchUnit ? ` (${watchUnit})` : ""}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step={watchFractional ? "0.01" : "1"}
                          min="0"
                          placeholder="Default (global setting)"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? null
                                : watchFractional
                                ? parseFloat(e.target.value)
                                : parseInt(e.target.value)
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Alert when stock drops to this level. Leave blank to use the store's global threshold.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Decimal stock guard warning */}
                {!watchFractional &&
                  (item?.quantity ?? primaryVariant?.quantity ?? 0) % 1 !== 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-amber-800 dark:text-amber-300 text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Current stock is{" "}
                      <strong>{item?.quantity ?? primaryVariant?.quantity}</strong>
                      {(item?.unit || primaryVariant?.unit) ? ` ${item?.unit || primaryVariant?.unit}` : ""} — a fractional value. Disabling fraction sales won't change the stock number, but the POS will prevent selling in fractions.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Card D: Commission Split ───────────────────────── */}
          {showVariantFields && watchType === "service" && (
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center gap-2 mb-1">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Commission Split</span>
                </div>

                <FormField
                  control={form.control}
                  name="commissionSplitOverride"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm font-medium">Override Commission Split</FormLabel>
                        <FormDescription className="text-xs">
                          Use a custom split for this service
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      </FormControl>
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
                          <FormLabel className="text-xs">Business Share (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              placeholder="80"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="commissionSplitStaffShare"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Staff Share (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              placeholder="20"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Footer ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between pt-2 pb-6">
            <Button type="button" variant="ghost" onClick={() => setLocation(`/inventory/${id}`)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                updateMutation.isPending ||
                (watchType !== "supply" && showVariantFields && watchSelling < watchCost && watchCost > 0)
              }
            >
              {updateMutation.isPending ? "Saving…" : "Update Item"}
            </Button>
          </div>

        </form>
      </Form>
    </div>
  );
}
