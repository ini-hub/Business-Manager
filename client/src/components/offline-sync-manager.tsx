import { useEffect, useState, useCallback, useRef } from "react";
import {
  getOfflineCheckouts,
  deleteOfflineCheckout,
  updateOfflineCheckout,
  clearDoneCheckouts,
  nextRetryDelay,
  MAX_AUTO_RETRIES,
  type OfflineCheckout,
} from "@/lib/offline-db";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { playNotificationSound } from "./notification-sheet";
import {
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronUp,
  ChevronDown,
  Receipt,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReceiptModal } from "@/components/receipt-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

function friendlyError(raw: string): string {
  if (raw.includes("cash drawer is currently closed") || raw.includes("bad_request:Cannot complete sale"))
    return "Cash drawer closed — open the register before retrying.";
  if (raw.includes("Insufficient stock") || raw.includes("not enough"))
    return "Insufficient stock — item quantity changed while offline.";
  if (raw.includes("no longer available"))
    return "An item in this sale is no longer available.";
  if (raw.includes("valid customer"))
    return "Customer not found — they may have been removed.";
  if (raw.includes("valid staff"))
    return "Staff member not found — they may have been removed.";
  return raw.length > 120 ? raw.slice(0, 117) + "…" : raw;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatItemSummary(payload: any): string {
  try {
    const items: any[] = payload.items ?? [];
    const names = items.slice(0, 2).map((i: any) => `${i.quantity}×${i.inventoryId?.slice(0, 6)}`);
    const extra = items.length > 2 ? ` +${items.length - 2} more` : "";
    const total = payload.totalCharged ?? payload.balanceCollectedToday ?? 0;
    return `${names.join(", ")}${extra} · ₦${Number(total).toLocaleString()}`;
  } catch {
    return "Offline sale";
  }
}

export function OfflineSyncManager() {
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<OfflineCheckout[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const syncLock = useRef(false);

  const refreshQueue = useCallback(async () => {
    try {
      const items = await getOfflineCheckouts();
      setQueue(items);
    } catch {
      // IndexedDB unavailable
    }
  }, []);

  // ── Core sync logic ────────────────────────────────────────────────────────
  const syncOfflineQueue = useCallback(async (force = false) => {
    if (!navigator.onLine) return;
    if (syncLock.current) return;
    syncLock.current = true;
    setIsSyncing(true);

    try {
      const items = await getOfflineCheckouts();
      const now = Date.now();
      const due = force
        ? items.filter(i => i.status !== "done")
        : items.filter(i =>
            i.status === "pending" &&
            (i.nextRetryAt === null || i.nextRetryAt <= now)
          );

      let successCount = 0;
      let failCount = 0;
      const newReceiptIds: string[] = [];

      for (const item of due) {
        // Mark as syncing
        await updateOfflineCheckout(item.id, { status: "syncing", lastAttemptAt: now });

        try {
          const response = await apiRequest("POST", "/api/sales/checkout", item.payload);

          if (response.ok) {
            const data = await response.json();
            const checkoutIds: string[] = data.checkoutIds ?? [];
            await updateOfflineCheckout(item.id, {
              status: "done",
              syncedCheckoutIds: checkoutIds,
              lastError: null,
            });
            if (checkoutIds.length > 0) newReceiptIds.push(...checkoutIds);
            successCount++;
          } else {
            // Server returned a business error (4xx/5xx)
            let errMsg = "Server error";
            try {
              const errBody = await response.json();
              errMsg = errBody.error?.message ?? errBody.error ?? errMsg;
              if (typeof errMsg !== "string") errMsg = "Server error";
            } catch { /* ignore parse error */ }

            const newAttempts = item.attempts + 1;
            const exceeded = newAttempts >= MAX_AUTO_RETRIES;
            await updateOfflineCheckout(item.id, {
              status: exceeded ? "failed" : "pending",
              attempts: newAttempts,
              lastError: errMsg,
              nextRetryAt: exceeded ? null : now + nextRetryDelay(newAttempts),
            });
            failCount++;
          }
        } catch (err) {
          // Network-level error — will retry
          const newAttempts = item.attempts + 1;
          const exceeded = newAttempts >= MAX_AUTO_RETRIES;
          await updateOfflineCheckout(item.id, {
            status: exceeded ? "failed" : "pending",
            attempts: newAttempts,
            lastError: err instanceof Error ? err.message : "Network error",
            nextRetryAt: exceeded ? null : now + nextRetryDelay(newAttempts),
          });
          failCount++;
        }
      }

      await clearDoneCheckouts();
      await refreshQueue();

      if (successCount > 0) {
        playNotificationSound();
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });

        toast({
          title: "Offline Sales Synced",
          description: `${successCount} sale${successCount !== 1 ? "s" : ""} synced.${failCount > 0 ? ` ${failCount} failed — see queue.` : ""}`,
          action: newReceiptIds.length > 0
            ? undefined  // receipt button shown inline in panel
            : undefined,
        });

        // Auto-open panel if there were failures
        if (failCount > 0) setPanelOpen(true);
      }

      // Notify if any items newly failed
      if (failCount > 0 && successCount === 0) {
        toast({
          title: "Sync failed",
          description: `${failCount} sale${failCount !== 1 ? "s" : ""} could not be synced. Tap the banner to view details.`,
          variant: "destructive",
        });
      }
    } finally {
      syncLock.current = false;
      setIsSyncing(false);
    }
  }, [toast, refreshQueue]);

  // ── Mount + event listeners ───────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); syncOfflineQueue(); };
    const handleOffline = () => { setIsOnline(false); refreshQueue(); };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    refreshQueue();
    if (navigator.onLine) syncOfflineQueue();

    // Periodic retry every 5 minutes
    const interval = setInterval(() => {
      if (navigator.onLine) syncOfflineQueue();
    }, 5 * 60 * 1000);

    // Listen for background sync completion triggered by service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "SYNC_COMPLETE") {
          refreshQueue();
          queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        }
      });
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [syncOfflineQueue, refreshQueue]);

  // ── Cancel / delete a queued item ────────────────────────────────────────
  const cancelItem = useCallback(async (id: string) => {
    await deleteOfflineCheckout(id);
    await refreshQueue();
    toast({ title: "Sale removed from queue." });
  }, [refreshQueue, toast]);

  // ── Retry a specific failed item ─────────────────────────────────────────
  const retryItem = useCallback(async (item: OfflineCheckout) => {
    await updateOfflineCheckout(item.id, { status: "pending", nextRetryAt: Date.now(), attempts: 0, lastError: null });
    await refreshQueue();
    syncOfflineQueue(true);
  }, [refreshQueue, syncOfflineQueue]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const pending = queue.filter(i => i.status === "pending" || i.status === "syncing");
  const failed = queue.filter(i => i.status === "failed");
  const totalCount = queue.length;

  // Hide banner entirely when online and nothing queued
  if (isOnline && totalCount === 0) return null;

  const bannerBg = !isOnline
    ? "bg-destructive text-destructive-foreground"
    : failed.length > 0
    ? "bg-rose-600 text-white"
    : "bg-amber-500 text-white";

  return (
    <>
      {/* ── Bottom banner ────────────────────────────────────────────────── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium shadow-lg transition-all ${bannerBg}`}
      >
        <button
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setPanelOpen(true)}
        >
          {!isOnline ? (
            <WifiOff className="h-4 w-4 shrink-0" />
          ) : failed.length > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>
            {!isOnline
              ? `You're offline${totalCount > 0 ? ` · ${totalCount} sale${totalCount !== 1 ? "s" : ""} queued` : ""}`
              : failed.length > 0
              ? `${failed.length} sale${failed.length !== 1 ? "s" : ""} failed — tap to review`
              : `${pending.length} offline sale${pending.length !== 1 ? "s" : ""} pending sync`}
          </span>
          <ChevronUp className="h-3.5 w-3.5 ml-auto shrink-0" />
        </button>

        {isOnline && pending.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={isSyncing}
            onClick={() => syncOfflineQueue(true)}
            aria-label="Sync offline sales now"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
        )}
      </div>

      {/* ── Queue management panel ───────────────────────────────────────── */}
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              Offline Sale Queue
              {totalCount > 0 && (
                <Badge variant={failed.length > 0 ? "destructive" : "secondary"} className="ml-1">
                  {totalCount}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription>
              {isOnline
                ? "Connected. Sales below will be synced to the server."
                : "No connection. Sales are saved locally until you're back online."}
            </SheetDescription>
          </SheetHeader>

          {totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 text-emerald-500" />
              <p className="text-sm font-medium">All sales synced</p>
            </div>
          ) : (
            <div className="space-y-3 pt-4">
              {/* Sync all button */}
              {isOnline && (pending.length > 0 || failed.length > 0) && (
                <Button
                  className="w-full gap-2"
                  onClick={() => syncOfflineQueue(true)}
                  disabled={isSyncing}
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing all…" : `Sync all ${totalCount} sale${totalCount !== 1 ? "s" : ""}`}
                </Button>
              )}

              {/* Individual items */}
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 space-y-2 text-sm ${
                    item.status === "failed"
                      ? "border-destructive/40 bg-destructive/5"
                      : item.status === "syncing"
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={item.status} />
                        {item.attempts > 0 && item.status !== "failed" && (
                          <span className="text-[10px] text-muted-foreground">
                            attempt {item.attempts + 1}
                          </span>
                        )}
                        {item.status === "failed" && item.attempts > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            failed after {item.attempts} attempt{item.attempts !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {formatItemSummary(item.payload)}
                      </p>
                      {item.createdAt && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          Captured {timeAgo(item.createdAt)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* View receipt (only for items that already synced successfully before being moved to failed — edge case) */}
                      {item.syncedCheckoutIds && item.syncedCheckoutIds.length > 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="View receipt"
                          onClick={() => { setReceiptId(item.syncedCheckoutIds![0]); setPanelOpen(false); }}
                        >
                          <Receipt className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {/* Retry failed item */}
                      {item.status === "failed" && isOnline && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => retryItem(item)}
                        >
                          Retry
                        </Button>
                      )}
                      {/* Cancel / remove */}
                      {item.status !== "syncing" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Remove from queue"
                          onClick={() => cancelItem(item.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Error message */}
                  {item.lastError && (
                    <div className="rounded bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-xs text-destructive leading-snug">
                      <AlertTriangle className="h-3 w-3 inline mr-1 shrink-0" />
                      {friendlyError(item.lastError)}
                    </div>
                  )}

                  {/* Next retry time */}
                  {item.status === "pending" && item.nextRetryAt && item.nextRetryAt > Date.now() && (
                    <p className="text-[10px] text-muted-foreground">
                      Auto-retry in {Math.ceil((item.nextRetryAt - Date.now()) / 60_000)} min
                    </p>
                  )}
                </div>
              ))}

              {/* Receipt viewer for recently synced items */}
              {queue.filter(i => i.syncedCheckoutIds?.length).length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Recently synced receipts</p>
                  <div className="flex flex-wrap gap-2">
                    {queue.filter(i => i.syncedCheckoutIds?.length).map(item =>
                      item.syncedCheckoutIds!.map(cid => (
                        <Button
                          key={cid}
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => { setReceiptId(cid); setPanelOpen(false); }}
                        >
                          <Receipt className="h-3 w-3" />
                          Receipt
                        </Button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Receipt modal triggered from panel ───────────────────────────── */}
      <ReceiptModal
        checkoutId={receiptId}
        open={!!receiptId}
        onClose={() => setReceiptId(null)}
      />
    </>
  );
}

function StatusBadge({ status }: { status: OfflineCheckout["status"] }) {
  if (status === "failed")
    return <Badge variant="destructive" className="text-[10px] h-4 py-0">Failed</Badge>;
  if (status === "syncing")
    return <Badge variant="secondary" className="text-[10px] h-4 py-0 animate-pulse">Syncing…</Badge>;
  return <Badge variant="outline" className="text-[10px] h-4 py-0 text-amber-600 border-amber-300">Queued</Badge>;
}
