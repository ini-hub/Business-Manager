import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { handleSessionExpired } from "@/lib/queryClient";
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
  sales:            ["/api/transactions", "/api/dashboard/stats", "/api/profit-loss", "/api/attendance/service-days", "/api/reports/vat-monthly"],
  expense:          ["/api/expenses", "/api/dashboard/stats", "/api/profit-loss"],
  "expense-category": ["/api/expense-categories"],
  customer:         ["/api/customers"],
  staff:            ["/api/staff"],
  attendance:       ["/api/attendance"],
  vendor:           ["/api/vendors"],
  "vendor-bill":    ["/api/vendors"],
  "stock-audit":    ["/api/stock-audits", "/api/inventory", "/api/products", "inventory-detail"],
  "purchase-order": ["/api/purchase-orders"],
  "partner-transfer": ["/api/partner-transfers", "/api/partner-ledger", "/api/inventory", "/api/products", "inventory-detail"],
  "partner": ["/api/partners"],
  "stock-transfer": ["/api/stock-transfers", "/api/inventory", "/api/products", "inventory-detail"],
  quote:            ["/api/quotes"],
  cash:             ["/api/cash-register", "/api/dashboard/stats"],
  payroll:          ["/api/payroll"],
  credit:           ["/api/credit"],
  booking:          ["/api/bookings"],
  support:          ["/api/support/thread", "/api/support/threads"],
  business:         ["/api/business"],
};

const REALTIME_INVALIDATE_DEBOUNCE_MS = 2000;

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
    let attempts = 0;

    // A busy shop broadcasts a change per sale. Refetching the dashboard, transactions and P&L on every one
    // is expensive on the server, so collect the affected prefixes and invalidate once per quiet window.
    const pendingPrefixes = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleInvalidate(prefixes: string[]) {
      prefixes.forEach((p) => pendingPrefixes.add(p));
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = Array.from(pendingPrefixes);
        pendingPrefixes.clear();
        queryClient.invalidateQueries({
          predicate: (query) => {
            const firstKey = query.queryKey[0];
            return typeof firstKey === "string" && batch.some((p) => firstKey.startsWith(p));
          },
        });
      }, REALTIME_INVALIDATE_DEBOUNCE_MS);
    }

    function connect() {
      if (dead) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => { attempts = 0; };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.__msgType === "notification" || !msg.__msgType) {
            queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
            playNotificationSound();
          } else if (msg.__msgType === "data_change") {
            const prefixes = RESOURCE_KEYS[msg.resource as string] ?? [];
            if (prefixes.length > 0) scheduleInvalidate(prefixes);
          }
        } catch {
          // ignore unparseable messages
        }
      };

      ws.onclose = (event) => {
        // 4401: the server revoked this session (logout elsewhere, password change).
        if (event.code === 4401) {
          handleSessionExpired();
          return;
        }
        if (!dead) {
          // Exponential backoff with jitter, capped at 2 min: a proxy that blocks or drops
          // WebSockets (Netskope, corporate gateways) would otherwise be retried every 5s forever.
          // The 5-minute query polling keeps data fresh meanwhile.
          const delay = Math.min(5000 * 2 ** attempts, 120_000) * (0.75 + Math.random() * 0.5);
          attempts += 1;
          reconnectTimeout = setTimeout(connect, delay);
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
      if (flushTimer !== null) clearTimeout(flushTimer);
    };
  }, [user, queryClient]);
}
