import { Search, Package, WifiOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Inventory } from "@shared/schema";
import type { CartItem } from "./types";

interface ProductGridProps {
  inventory: Inventory[];
  isLoading: boolean;
  cart: CartItem[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onAddToCart: (item: Inventory) => void;
  formatCurrency: (value: number) => string;
  isOffline?: boolean;
}

export function ProductGrid({
  inventory,
  isLoading,
  cart,
  searchTerm,
  onSearchChange,
  onAddToCart,
  formatCurrency,
  isOffline = false,
}: ProductGridProps) {
  const filtered = searchTerm
    ? inventory.filter((item) => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : inventory;

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
          <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((item) => {
              const inCart = cart.find((c) => c.inventory.id === item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                  onClick={() => onAddToCart(item)}
                  data-testid={`item-${item.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <Badge variant="outline" className={`text-[10px] h-5 py-0 capitalize shrink-0 ${
                        item.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
                        : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"}`}>
                        {item.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.sellingPrice)}
                      {item.type === "product" && (
                        <span className="ml-2 text-muted-foreground/70">
                          {item.quantity} in stock
                        </span>
                      )}
                    </p>
                  </div>
                  {inCart && (
                    <Badge variant="secondary" className="ml-2 shrink-0">
                      ×{inCart.quantity}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
