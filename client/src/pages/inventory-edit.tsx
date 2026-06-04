import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useQuery as useSettingsQuery } from "@tanstack/react-query";
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
      // First try to fetch as a product group
      const prodRes = await fetch(`/api/products/${id}`);
      if (prodRes.ok) {
        const prod = await prodRes.json();
        return { isProductGroup: true, ...prod };
      }
      // If product not found, try to fetch as a variant (inventory item)
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
        // 1. Update Product metadata
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

        // 2. If it's a simple product, update its variant
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
        // Update variant details directly
        const invRes = await apiRequest("PATCH", `/api/inventory/${id}`, {
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
  const hasZeroMargin = watchCost > 0 && watchSelling === watchCost;

  const handleFormSubmit = (data: EditFormValues) => {
    if (showVariantFields && data.sellingPrice !== undefined && data.costPrice !== undefined) {
      if (data.sellingPrice < data.costPrice) {
        form.setError("sellingPrice", { type: "manual", message: "Selling price cannot be less than cost price." });
        return;
      }
    }
    updateMutation.mutate(data);
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
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
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Name</FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus />
                    </FormControl>
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
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
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
                            <Input {...field} value={field.value || ""} />
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
                          <Textarea {...field} value={field.value || ""} rows={3} placeholder="Add product catalog notes here..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {showVariantFields && (
                <>
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="product">Product</SelectItem>
                            <SelectItem value="service">Service</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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

                  <div className="grid gap-4 sm:grid-cols-2">
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
                  </div>

                  {watchType === "product" && (
                    <>
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

                      {form.watch("allowFractional") && (
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

                      <FormField
                        control={form.control}
                        name="quantity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Quantity in Stock{form.watch("allowFractional") && form.watch("unit") ? ` (${form.watch("unit")})` : ""}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step={form.watch("allowFractional") ? "0.01" : "1"}
                                min="0"
                                {...field}
                                onChange={(e) =>
                                  field.onChange(
                                    form.watch("allowFractional")
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
                      {/* Reorder point — per-item low-stock threshold */}
                      <FormField
                        control={form.control}
                        name="reorderPoint"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Low-Stock Alert{form.watch("unit") ? ` (${form.watch("unit")})` : ""}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step={form.watch("allowFractional") ? "0.01" : "1"}
                                min="0"
                                placeholder={`Default (global setting)`}
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(
                                    e.target.value === "" ? null :
                                    form.watch("allowFractional")
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

                      {/* Guard: warn when turning off fractional with decimal stock */}
                      {!form.watch("allowFractional") &&
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
                    </>
                  )}

                  {watchType === "service" && (
                    <div className="border rounded-lg p-4 bg-muted/10 space-y-4">
                      <FormField
                        control={form.control}
                        name="commissionSplitOverride"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-3 bg-background">
                            <div className="space-y-0.5">
                              <FormLabel className="text-sm font-semibold">Override Commission Split</FormLabel>
                              <FormDescription className="text-xs">
                                Custom split for this service
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      {form.watch("commissionSplitOverride") && (
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
                    </div>
                  )}

                  {watchSelling < watchCost && watchCost > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>Selling price cannot be less than cost price.</AlertDescription>
                    </Alert>
                  )}
                  {hasZeroMargin && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 text-xs font-medium">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Zero margin — you will break even on every sale.</span>
                    </div>
                  )}
                </>
              )}

              <Separator />
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => setLocation(`/inventory/${id}`)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending || (showVariantFields && watchSelling < watchCost && watchCost > 0)}
                >
                  {updateMutation.isPending ? "Saving…" : "Update Item"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
