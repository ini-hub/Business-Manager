import { useState } from "react";
import { Search, Package, WifiOff, ChevronDown, Layers, Flame } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Inventory } from "@shared/schema";

// Structural minimum ProductGrid needs from a cart line — satisfied by both
// the POS's CartItem and the quote builder's QuoteCartItem, so either can be
// passed in as `cart` without this component depending on either shape.
interface CartLike {
  inventory: { id: string };
  quantity: number;
}

// Left-edge accent color coding for item type, replacing a text badge that competed with the name for space.
const TYPE_ACCENT: Record<"service" | "product", string> = {
  service: "border-l-violet-500 dark:border-l-violet-400",
  product: "border-l-sky-500 dark:border-l-sky-400",
};

// The strip only earns its space when it actually saves scrolling: a handful of
// ranked items, and a catalogue big enough that they aren't most of it anyway.
const MIN_TOP_SELLERS = 3;
const MIN_CATALOGUE_SURPLUS = 3;

const COLLAPSE_KEY = "pos.topSellers.collapsed";

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
  cart: CartLike[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onAddToCart: (item: Inventory) => void;
  formatCurrency: (value: number) => string;
  isOffline?: boolean;
  /** Product-group ids, best-selling first — from /api/products/top-sellers. */
  topProductIds?: string[];
  /**
   * Skip the stock gate entirely — every product shows, and every variant is
   * pickable, regardless of quantity on hand. Used by pickers (e.g. the quote
   * builder) where "add to the list" doesn't move stock and out-of-stock items
   * still need to be quotable.
   */
  allowOutOfStock?: boolean;
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

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
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
  topProductIds = [],
  allowOutOfStock = false,
}: ProductGridProps) {
  // Keyed by section as well as product: the same group can be rendered twice
  // (once in the strip, once in the full grid) and only the clicked tile's
  // variant popover should open.
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);
  const [topCollapsed, setTopCollapsed] = useState(readCollapsed);

  const available = allowOutOfStock ? products : products.filter(isAvailable);

  const filtered = searchTerm
    ? available.filter((p) => {
        const q = searchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.variants.some((v) => v.name.toLowerCase().includes(q))
        );
      })
    : available;

  // Ranked order comes from the server; the lookup keeps it while dropping
  // anything now out of stock or archived since the ranking was computed.
  const byId = new Map(available.map((p) => [p.id, p]));
  const topSellers = topProductIds
    .map((id) => byId.get(id))
    .filter((p): p is ProductGroup => !!p);

  const showTopSellers =
    !searchTerm &&
    topSellers.length >= MIN_TOP_SELLERS &&
    available.length > topSellers.length + MIN_CATALOGUE_SURPLUS;

  const toggleTopSellers = () => {
    setTopCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* private browsing — the preference just doesn't stick */
      }
      return next;
    });
  };

  const cartCountFor = (product: ProductGroup) =>
    cart
      .filter((c) => product.variants.some((v) => v.id === c.inventory.id))
      .reduce((sum, c) => sum + c.quantity, 0);

  const handleTileClick = (product: ProductGroup, key: string) => {
    if (product.variants.length === 1) {
      onAddToCart(product.variants[0]);
    } else {
      setOpenPopoverKey((prev) => (prev === key ? null : key));
    }
  };

  const renderTile = (product: ProductGroup, section: "top" | "all") => {
    const key = `${section}:${product.id}`;
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
        key={key}
        className={cn(
          "flex items-center justify-between p-4 rounded-lg border border-l-4 hover-elevate cursor-pointer select-none",
          TYPE_ACCENT[product.type]
        )}
        onClick={() => handleTileClick(product, key)}
        data-testid={section === "top" ? `top-item-${product.id}` : `item-${product.id}`}
        title={product.type === "service" ? "Service" : "Product"}
      >
        <div className="flex-1 min-w-0">
          {/* line-clamp-2 + fixed min-h reserves the same vertical space whether the name is 1 or 2 lines, so tiles in the same grid row stay aligned */}
          <p className="font-medium text-sm leading-5 line-clamp-2 min-h-10 mb-1">{product.name}</p>
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs text-muted-foreground truncate min-w-0">{priceLabel}</p>
            {hasMultipleVariants && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70 shrink-0 whitespace-nowrap">
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
                openPopoverKey === key ? "rotate-180" : ""
              }`}
            />
          )}
        </div>
      </div>
    );

    if (!hasMultipleVariants) return tile;

    return (
      <Popover
        key={key}
        open={openPopoverKey === key}
        onOpenChange={(open) => setOpenPopoverKey(open ? key : null)}
      >
        <PopoverTrigger asChild>{tile}</PopoverTrigger>
        <PopoverContent
          className="w-80 max-w-[min(92vw,var(--radix-popover-content-available-width))] max-h-[var(--radix-popover-content-available-height)] p-2 flex flex-col overflow-hidden"
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-2 shrink-0">
            Choose a variant
          </p>
          <div className="space-y-1 max-h-72 overflow-y-auto min-h-0">
            {product.variants.map((variant) => {
              const inCartQty = cart.find((c) => c.inventory.id === variant.id)?.quantity ?? 0;
              const outOfStock =
                !allowOutOfStock && product.type === "product" && variant.quantity <= 0;
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
                    setOpenPopoverKey(null);
                  }}
                  className="w-full flex items-start justify-between rounded-md px-3 py-2.5 text-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left gap-3"
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {dimEntries && dimEntries.length > 1 ? (
                      dimEntries.map(([dimKey, value]) => (
                        <div key={dimKey} className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold shrink-0">
                            {dimKey}:
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
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground -mt-2">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400" />
            Service
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-500 dark:bg-sky-400" />
            Product
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
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
          <>
            {showTopSellers && (
              <div className="space-y-3" data-testid="section-top-sellers">
                <div className="flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Top sellers
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">Last 30 days</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-[11px] text-muted-foreground"
                    onClick={toggleTopSellers}
                    data-testid="button-toggle-top-sellers"
                  >
                    {topCollapsed ? "Show" : "Hide"}
                  </Button>
                </div>
                {!topCollapsed && (
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                    {topSellers.map((product) => renderTile(product, "top"))}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    All items
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </div>
            )}

            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
              {filtered.map((product) => renderTile(product, "all"))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
