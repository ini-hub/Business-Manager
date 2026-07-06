import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { playNotificationSound } from "@/components/notification-sheet";

// Maps a server-broadcast resource name → all React Query base keys that should be invalidated.
// React Query does prefix matching, so invalidating "/api/inventory" also invalidates
// ["/api/inventory", storeId], ["/api/inventory", storeId, "..."], etc.
const RESOURCE_KEYS: Record<string, string[]> = {
  inventory:        ["/api/inventory", "/api/products", "/api/dashboard/stats"],
  sales:            ["/api/transactions", "/api/dashboard/stats", "/api/profit-loss"],
  expense:          ["/api/expenses", "/api/dashboard/stats", "/api/profit-loss"],
  "expense-category": ["/api/expense-categories"],
  customer:         ["/api/customers"],
  staff:            ["/api/staff"],
  attendance:       ["/api/attendance"],
  vendor:           ["/api/vendors"],
  "vendor-bill":    ["/api/vendors"],
  "stock-audit":    ["/api/stock-audits", "/api/inventory", "/api/products"],
  "purchase-order": ["/api/purchase-orders"],
  "stock-transfer": ["/api/stock-transfers", "/api/inventory", "/api/products"],
  quote:            ["/api/quotes"],
  cash:             ["/api/cash-register", "/api/dashboard/stats"],
  payroll:          ["/api/payroll"],
  credit:           ["/api/credit"],
  booking:          ["/api/bookings"],
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
            const keys = RESOURCE_KEYS[msg.resource as string] ?? [];
            keys.forEach((key) => {
              queryClient.invalidateQueries({ queryKey: [key] });
            });
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
