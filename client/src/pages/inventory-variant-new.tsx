import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";

export default function InventoryVariantNewPage() {
  const { parentId } = useParams<{ parentId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [variantName, setVariantName] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [customAttrs, setCustomAttrs] = useState<{ key: string; value: string }[]>([]);
  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);

  const { data: parent } = useQuery<any>({
    queryKey: ["inventory-detail", parentId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/products/${parentId}`);
      return res.json();
    },
    enabled: !!parentId,
  });

  // Auto-generate variant name from attributes
  useEffect(() => {
    if (!parent) return;
    const parts: string[] = [];
    if (size) parts.push(size);
    if (color) parts.push(color);
    customAttrs.forEach((a) => { if (a.value) parts.push(a.value); });
    setVariantName(parts.length > 0 ? `${parent.name} - ${parts.join(" / ")}` : `${parent.name} - `);
  }, [size, color, customAttrs, parent]);

  // Inherit parent prices on load
  useEffect(() => {
    if (parent) {
      setCostPrice(parent.costPrice ?? 0);
      setSellingPrice(parent.sellingPrice ?? 0);
    }
  }, [parent]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!variantName.trim()) throw new Error("Variant name is required.");
      const dims: Record<string, string> = {};
      if (size) dims.size = size;
      if (color) dims.color = color;
      customAttrs.forEach((a) => {
        if (a.key.trim() && a.value.trim()) {
          dims[a.key.trim().toLowerCase()] = a.value.trim();
        }
      });
      const res = await apiRequest("POST", `/api/products/${parentId}/variants`, {
        name: variantName.trim(),
        costPrice,
        sellingPrice,
        quantity,
        variantDimensions: dims,
        sku: `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to create variant");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-variants", parentId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-detail", parentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Variant created" });
      setLocation(`/inventory/${parentId}`);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="Create Product Variant"
        description={parent ? `Add a variant of "${parent.name}"` : "Add a variant"}
        actions={
          <Button variant="outline" onClick={() => setLocation(`/inventory/${parentId}`)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Item
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="vn-name">
              Variant Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vn-name"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              placeholder="e.g. T-Shirt - M / Red"
            />
            <p className="text-xs text-muted-foreground">
              Auto-generates from attributes. Edit manually if needed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vn-size">Size (optional)</Label>
              <Input
                id="vn-size"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. M, L, XL"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vn-color">Color (optional)</Label>
              <Input
                id="vn-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="e.g. Red, Blue"
              />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Custom Attributes
            </Label>
            {customAttrs.length > 0 && (
              <div className="space-y-1.5">
                {customAttrs.map((attr, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/40 px-2.5 py-1.5 rounded-md border text-xs">
                    <span className="font-semibold capitalize text-muted-foreground">{attr.key}:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{attr.value}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-destructive"
                        onClick={() => setCustomAttrs((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Dimension (e.g. Material)"
                value={attrKey}
                onChange={(e) => setAttrKey(e.target.value)}
                className="h-8 text-sm flex-1"
              />
              <Input
                placeholder="Value (e.g. Leather)"
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
                className="h-8 text-sm flex-1"
                disabled={!attrKey.trim()}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3"
                disabled={!attrKey.trim() || !attrValue.trim()}
                onClick={() => {
                  setCustomAttrs((prev) => [
                    ...prev,
                    { key: attrKey.trim().toLowerCase(), value: attrValue.trim() },
                  ]);
                  setAttrKey("");
                  setAttrValue("");
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="vn-cost">Cost Price</Label>
              <Input
                id="vn-cost"
                type="number"
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vn-selling">Selling Price</Label>
              <Input
                id="vn-selling"
                type="number"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vn-qty">Starting Stock Quantity</Label>
            <Input
              id="vn-qty"
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation(`/inventory/${parentId}`)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !variantName.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create Variant"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
