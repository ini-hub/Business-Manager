import { useEffect } from "react";
import { getOfflineCheckouts, deleteOfflineCheckout } from "@/lib/offline-db";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { playNotificationSound } from "./notification-sheet";

export function OfflineSyncManager() {
  const { toast } = useToast();

  useEffect(() => {
    async function syncOfflineQueue() {
      if (!navigator.onLine) return;

      try {
        const queued = await getOfflineCheckouts();
        if (queued.length === 0) return;

        let successCount = 0;
        let failCount = 0;

        for (const item of queued) {
          try {
            const response = await apiRequest("POST", "/api/sales/checkout", item.payload);
            if (response.ok) {
              await deleteOfflineCheckout(item.id);
              successCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            failCount++;
            console.error("Failed to sync offline checkout item:", err);
          }
        }

        if (successCount > 0) {
          // Play beautiful synthesized double bell chime
          playNotificationSound();

          // Refresh dashboard, transaction, inventory queries
          queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
          queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });

          toast({
            title: "Offline Sync Complete!",
            description: `Successfully synchronized ${successCount} transaction(s) to the cloud.${
              failCount > 0 ? ` Failed to sync ${failCount} transaction(s).` : ""
            }`,
          });
        }
      } catch (dbError) {
        console.error("Error reading offline queue from IndexedDB:", dbError);
      }
    }

    // Attach online event listeners
    window.addEventListener("online", syncOfflineQueue);

    // Run sync on mount if online
    if (navigator.onLine) {
      syncOfflineQueue();
    }

    return () => {
      window.removeEventListener("online", syncOfflineQueue);
    };
  }, [toast]);

  return null; // Silent global provider
}
