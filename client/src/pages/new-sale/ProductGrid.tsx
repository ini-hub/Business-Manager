import { useState } from "react";
import { Search, Package, WifiOff, ChevronDown, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Inventory } from "@shared/schema";
import type { CartItem } from "./types";

// Shape returned by /api/products
interface ProductGroup {
  id: string;
  name: string;
  type: "product" | "service";
  variants: Inventory[];
}

interface ProductGridProps {
  products: ProductGroup[];
  isLoading: boolean;
  cart: CartItem[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onAddToCart: (item: Inventory) => void;
  formatCurrency: (value: number) => string;
  isOffline?: boolean;
}

// Strip parent-name prefix from a variant name and fall back to variantDimensions values.
function variantLabel(variant: Inventory, parentName: string): string {
  const dims = (variant as any).variantDimensions as Record<string, string> | null;
  if (dims && Object.keys(dims).length > 0) {
    return Object.values(dims).join(" / ");
  }
  const prefix = `${parentName} - `;
  if (variant.name.startsWith(prefix)) return variant.name.slice(prefix.length);
  return variant.name;
}

// A product is available for sale if it's a service (unlimited) or has at least one in-stock variant.
function isAvailable(product: ProductGroup): boolean {
  if (product.type === "service") return true;
  return product.variants.some((v) => v.quantity > 0);
}

export function ProductGrid({
  products,
  isLoading,
  cart,
  searchTerm,
  onSearchChange,
  onAddToCart,
  formatCurrency,
  isOffline = false,
}: ProductGridProps) {
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);

  const available = products.filter(isAvailable);

  const filtered = searchTerm
    ? available.filter((p) => {
        const q = searchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.variants.some((v) => v.name.toLowerCase().includes(q))
        );
      })
    : available;

  const cartCountFor = (product: ProductGroup) =>
    cart
      .filter((c) => product.variants.some((v) => v.id === c.inventory.id))
      .reduce((sum, c) => sum + c.quantity, 0);

  const handleTileClick = (product: ProductGroup) => {
    if (product.variants.length === 1) {
      onAddToCart(product.variants[0]);
    } else {
      setOpenPopoverId((prev) => (prev === product.id ? null : product.id));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Package className="h-4 w-4" />
          Select Items
          {isOffline && (
            <span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3 w-3" />
              Cached data
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products and services..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search-items"
          />
        </div>

        {isLoading ? (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-4 rounded-lg border animate-pulse">
                <div className="h-4 w-32 bg-muted rounded mb-2" />
                <div className="h-3 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchTerm ? "No items found" : "No items available for sale"}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            {filtered.map((product) => {
              const cartQty = cartCountFor(product);
              const hasMultipleVariants = product.variants.length > 1;
              // Price range display
              const prices = product.variants.map((v) => v.sellingPrice);
              const minPrice = Math.min(...prices);
              const maxPrice = Math.max(...prices);
              const priceLabel =
                minPrice === maxPrice
                  ? formatCurrency(minPrice)
                  : `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`;

              const tile = (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer select-none"
                  onClick={() => handleTileClick(product)}
                  data-testid={`item-${product.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{product.name}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 py-0 capitalize shrink-0 ${
                          product.type === "service"
                            ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
                            : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"
                        }`}
                      >
                        {product.type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{priceLabel}</p>
                      {hasMultipleVariants && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                          <Layers className="h-2.5 w-2.5" />
                          {product.variants.length} options
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {cartQty > 0 && (
                      <Badge variant="secondary">×{cartQty}</Badge>
                    )}
                    {hasMultipleVariants && (
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform duration-150 ${
                          openPopoverId === product.id ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </div>
                </div>
              );

              if (!hasMultipleVariants) return tile;

              return (
                <Popover
                  key={product.id}
                  open={openPopoverId === product.id}
                  onOpenChange={(open) => setOpenPopoverId(open ? product.id : null)}
                >
                  <PopoverTrigger asChild>{tile}</PopoverTrigger>
                  <PopoverContent
                    className="w-80 max-w-[92vw] p-2"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                  >
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-2">
                      Choose a variant
                    </p>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {product.variants.map((variant) => {
                        const inCartQty = cart.find((c) => c.inventory.id === variant.id)?.quantity ?? 0;
                        const outOfStock =
                          product.type === "product" && variant.quantity <= 0;
                        const label = variantLabel(variant, product.name);
                        const dims = (variant as any).variantDimensions as Record<string, string> | null;
                        const dimEntries = dims ? Object.entries(dims) : null;
                        return (
                          <button
                            key={variant.id}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => {
                              onAddToCart(variant);
                              setOpenPopoverId(null);
                            }}
                            className="w-full flex items-start justify-between rounded-md px-3 py-2.5 text-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left gap-3"
                          >
                            <div className="flex-1 min-w-0 space-y-0.5">
                              {dimEntries && dimEntries.length > 1 ? (
                                dimEntries.map(([key, value]) => (
                                  <div key={key} className="flex items-baseline gap-1.5 flex-wrap">
                                    <span className="text-[10px] text-muted-foreground uppercase font-semibold shrink-0">
                                      {key}:
                                    </span>
                                    <span className="font-medium text-sm break-words">{value}</span>
                                  </div>
                                ))
                              ) : (
                                <span className="font-medium break-words leading-snug">{label}</span>
                              )}
                              {outOfStock && (
                                <span className="text-[10px] text-destructive block">Out of stock</span>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                {formatCurrency(variant.sellingPrice)}
                              </span>
                              {inCartQty > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                  ×{inCartQty}
                                </Badge>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
