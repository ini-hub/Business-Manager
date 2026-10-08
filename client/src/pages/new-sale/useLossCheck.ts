import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CartItem } from "./types";

export type LossLine = { belowCost: boolean; lossAmount: number };

/**
 * Asks the server which cart lines are priced below full cost (item cost + consumables).
 * The server returns only the shortfall, so staff who cannot see cost prices still get the warning.
 * Selling below cost is never blocked; this only drives the visual signal.
 */
export function useLossCheck(storeId: string | undefined, cart: CartItem[]) {
  const items = useMemo(
    () => cart.map((c) => ({ inventoryId: c.inventory.id, quantity: c.quantity, unitPrice: c.customPrice })),
    [cart],
  );
  const key = JSON.stringify(items);
  const [debouncedKey, setDebouncedKey] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(key), 300);
    return () => clearTimeout(t);
  }, [key]);

  const { data } = useQuery<{ lines: Array<{ inventoryId: string } & LossLine> }>({
    queryKey: ["/api/sales/loss-check", storeId, debouncedKey],
    enabled: !!storeId && items.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/sales/loss-check", { storeId, items: JSON.parse(debouncedKey) });
      return res.json();
    },
  });

  const byItem = useMemo(() => {
    const map = new Map<string, LossLine>();
    for (const l of data?.lines ?? []) {
      if (l.belowCost) map.set(l.inventoryId, { belowCost: true, lossAmount: l.lossAmount });
    }
    return map;
  }, [data]);

  // Offline or still loading: no signal rather than a wrong one.
  const totalLoss = useMemo(() => Array.from(byItem.values()).reduce((s, l) => s + l.lossAmount, 0), [byItem]);
  return { byItem, totalLoss, hasLoss: byItem.size > 0 };
}
