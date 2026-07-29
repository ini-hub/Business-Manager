import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { playNotificationSound } from "@/components/notification-sheet";

// Maps a server-broadcast resource name → React Query base key prefixes that should be invalidated.
// Matching is done by string-prefix on the first queryKey element (see predicate below), not
// React Query's own array-element equality matching, since our query keys nest sub-paths like
// ["/api/payroll/periods/entries", periodId] under a resource's base path ("/api/payroll").
const RESOURCE_KEYS: Record<string, string[]> = {
  // "inventory-detail" isn't an /api/... path — it's the client-side cache key
  // (see inventory-details.tsx / inventory-edit.tsx) used for a single item's detail
  // view. It has to be listed explicitly here or realtime broadcasts can never
  // invalidate an open detail page (only the list views would refresh).
  inventory:        ["/api/inventory", "/api/products", "/api/dashboard/stats", "inventory-detail"],
  sales:            ["/api/transactions", "/api/dashboard/stats", "/api/profit-loss"],
  expense:          ["/api/expenses", "/api/dashboard/stats", "/api/profit-loss"],
  "expense-category": ["/api/expense-categories"],
  customer:         ["/api/customers"],
  staff:            ["/api/staff"],
  attendance:       ["/api/attendance"],
  vendor:           ["/api/vendors"],
  "vendor-bill":    ["/api/vendors"],
  "stock-audit":    ["/api/stock-audits", "/api/inventory", "/api/products", "inventory-detail"],
  "purchase-order": ["/api/purchase-orders"],
  "stock-transfer": ["/api/stock-transfers", "/api/inventory", "/api/products", "inventory-detail"],
  quote:            ["/api/quotes"],
  cash:             ["/api/cash-register", "/api/dashboard/stats"],
  payroll:          ["/api/payroll"],
  credit:           ["/api/credit"],
  booking:          ["/api/bookings"],
  support:          ["/api/support/thread", "/api/support/threads"],
};

export function useRealtimeSync(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/notifications`;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    function connect() {
      if (dead) return;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.__msgType === "notification" || !msg.__msgType) {
            queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
            playNotificationSound();
          } else if (msg.__msgType === "data_change") {
            const prefixes = RESOURCE_KEYS[msg.resource as string] ?? [];
            if (prefixes.length > 0) {
              queryClient.invalidateQueries({
                predicate: (query) => {
                  const firstKey = query.queryKey[0];
                  return typeof firstKey === "string" && prefixes.some((p) => firstKey.startsWith(p));
                },
              });
            }
          }
        } catch {
          // ignore unparseable messages
        }
      };

      ws.onclose = () => {
        if (!dead) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      dead = true;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      if (reconnectTimeout !== null) clearTimeout(reconnectTimeout);
    };
  }, [user, queryClient]);
}
