import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { X, MoreHorizontal, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** How a bulk action is allowed to behave — see BulkActionsBar's module doc. */
export type BulkActionKind = "safe" | "reversible" | "destructive";

export interface BulkActionSelection<T> {
  mode: "page" | "all";
  /** Explicit ids — meaningful in "page" mode. In "all" mode this is the current page's ids only, for reference. */
  ids: (string | number)[];
  /** The actual row objects for ids the table has loaded (page mode: all of them; all mode: just the current page's). */
  items: T[];
  /** Total count the action applies to — the current page's selection size, or the full filtered count in "all" mode. */
  count: number;
  /**
   * Snapshotted filter/search state at the moment "Select all" was chosen, present only in "all" mode.
   * Snapshotted rather than re-evaluated at execution time: re-evaluating could silently grow or shrink
   * who a destructive action applies to between selection and confirmation, which is worse than acting on
   * a slightly stale view the user explicitly saw when they chose "Select all {total}".
   */
  filterQuery?: Record<string, unknown>;
}

export interface BulkActionPrecheck {
  ineligibleCount: number;
  /** Why those records are ineligible, and/or what happens to them instead — shown in the confirm dialog. */
  reason: string;
}

export interface BulkActionResult {
  succeeded: number;
  failed: number;
  failedIds?: (string | number)[];
}

export interface BulkAction<T> {
  id: string;
  label: string;
  icon: React.ReactNode;
  kind: BulkActionKind;
  /** Omit the action entirely (e.g. the caller's role check failed) rather than rendering it disabled. */
  hidden?: boolean;
  precheck?: (
    selection: BulkActionSelection<T>,
  ) => Promise<BulkActionPrecheck | null> | BulkActionPrecheck | null;
  /** Required unless `onOpen` is set — an `onOpen` action drives its own mutation(s) instead. */
  onExecute?: (selection: BulkActionSelection<T>) => Promise<BulkActionResult>;
  /** Reversible only — called if the user taps "Undo" on the success toast. */
  onUndo?: (result: BulkActionResult) => Promise<void>;
  /** Extra confirmation copy for a destructive action, before the count line. */
  destructiveDescription?: string;
  /**
   * For actions that need to collect input before running (e.g. a quantity, a
   * new category, a price-change mode) instead of running immediately. When
   * set, the bar calls this on click instead of `onExecute` (or the destructive
   * confirm dialog) and does nothing else — the action owns its own dialog and
   * is responsible for calling its own mutation(s) and clearing selection.
   */
  onOpen?: (selection: BulkActionSelection<T>) => void;
}

interface BulkActionsBarProps<T> {
  selection: BulkActionSelection<T>;
  entityNoun: { singular: string; plural: string };
  actions: BulkAction<T>[];
  onClear: () => void;
  /** Called after a successful (or partially successful) action, to clear selection per spec 2.4. */
  onActionSettled?: (result: BulkActionResult, hadFailures: boolean) => void;
  /** Renders the failed-records filter link in the partial-failure toast. */
  onViewFailed?: (failedIds: (string | number)[]) => void;
}

export function pluralize(count: number, noun: { singular: string; plural: string }): string {
  return count === 1 ? noun.singular : noun.plural;
}

/**
 * Sticky bottom-of-viewport bulk action bar, driven by typed BulkAction
 * definitions instead of each page hand-building its own icon-button row.
 * Renders null when nothing is selected, so callers can mount it
 * unconditionally.
 *
 * Kind behavior (spec 2.4):
 * - safe: executes immediately, no confirmation.
 * - reversible: executes immediately, success toast offers "Undo".
 * - destructive: never rendered directly in the bar — always routed through
 *   the "More" menu, confirmed via a dialog that requires typing the exact
 *   count when it exceeds 5.
 */
export function BulkActionsBar<T>({
  selection,
  entityNoun,
  actions,
  onClear,
  onActionSettled,
  onViewFailed,
}: BulkActionsBarProps<T>) {
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<BulkAction<T> | null>(null);
  const [precheck, setPrecheck] = useState<BulkActionPrecheck | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [typedCount, setTypedCount] = useState("");

  if (selection.count === 0) return null;

  const visible = actions.filter((a) => !a.hidden);
  const safeActions = visible.filter((a) => a.kind !== "destructive");
  const destructiveActions = visible.filter((a) => a.kind === "destructive");
  const overflowSafe = safeActions.slice(4);
  const hasMore = overflowSafe.length > 0 || destructiveActions.length > 0;

  const requiresTypedCount = selection.count > 5;
  const typedCountValid = !requiresTypedCount || typedCount.trim() === String(selection.count);

  const runAction = async (action: BulkAction<T>) => {
    if (!action.onExecute) return;
    setPendingId(action.id);
    try {
      const result = await action.onExecute(selection);
      const noun = pluralize(result.succeeded, entityNoun);
      const hadFailures = result.failed > 0;

      if (!hadFailures) {
        toast({
          title: `${result.succeeded} ${noun} ${action.kind === "destructive" ? "affected" : "updated"}`,
          action:
            action.kind === "reversible" && action.onUndo ? (
              <ToastAction
                altText="Undo"
                onClick={async () => {
                  await action.onUndo!(result);
                }}
              >
                Undo
              </ToastAction>
            ) : undefined,
        });
      } else {
        toast({
          title: `${result.succeeded} updated, ${result.failed} failed`,
          description: "Some records couldn't be updated.",
          variant: "destructive",
          action:
            onViewFailed && result.failedIds?.length ? (
              <ToastAction altText="View failed" onClick={() => onViewFailed(result.failedIds!)}>
                View failed
              </ToastAction>
            ) : undefined,
        });
      }
      onActionSettled?.(result, hadFailures);
      if (!hadFailures) onClear();
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  const openDestructiveConfirm = async (action: BulkAction<T>) => {
    setConfirmAction(action);
    setTypedCount("");
    setPrecheck(null);
    if (action.precheck) {
      setPrecheckLoading(true);
      try {
        setPrecheck(await action.precheck(selection));
      } finally {
        setPrecheckLoading(false);
      }
    }
  };

  const confirmDestructive = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    await runAction(action);
  };

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm shadow-[0_-2px_12px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="region"
        aria-label="Bulk actions"
      >
        <div className="flex items-center gap-2 px-4 py-2.5 max-w-full overflow-x-auto">
          <IconButton
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={onClear}
            label="Clear selection"
            data-testid="button-bulk-clear"
          >
            <X className="h-4 w-4" />
          </IconButton>

          <span className="text-sm font-medium mr-auto shrink-0" aria-live="polite">
            {selection.count} {pluralize(selection.count, entityNoun)} selected
          </span>

          {safeActions.slice(0, 4).map((action, i) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              className={cn("shrink-0", i >= 2 && "hidden lg:inline-flex")}
              disabled={pendingId !== null}
              onClick={() => (action.onOpen ? action.onOpen(selection) : runAction(action))}
              aria-label={action.label}
              title={action.label}
              data-testid={`button-bulk-${action.id}`}
            >
              {action.icon}
              <span className={i < 2 ? "hidden md:inline ml-1.5" : "ml-1.5"}>
                {pendingId === action.id ? "Working…" : action.label}
              </span>
            </Button>
          ))}

          {hasMore && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0" aria-label="More actions" data-testid="button-bulk-more">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="hidden lg:inline ml-1.5">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflowSafe.map((action) => (
                  <DropdownMenuItem key={action.id} onClick={() => (action.onOpen ? action.onOpen(selection) : runAction(action))} data-testid={`menu-bulk-${action.id}`}>
                    {action.icon}
                    <span className="ml-2">{action.label}</span>
                  </DropdownMenuItem>
                ))}
                {overflowSafe.length > 0 && destructiveActions.length > 0 && <DropdownMenuSeparator />}
                {destructiveActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    onClick={() => openDestructiveConfirm(action)}
                    className="text-destructive focus:text-destructive"
                    data-testid={`menu-bulk-${action.id}`}
                  >
                    {action.icon}
                    <span className="ml-2">{action.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[440px]">
          {confirmAction && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <DialogTitle className="text-lg font-bold">
                    {confirmAction.label} {selection.count} {pluralize(selection.count, entityNoun)}?
                  </DialogTitle>
                </div>
                <DialogDescription className="pt-2 text-sm text-muted-foreground leading-relaxed space-y-2">
                  {confirmAction.destructiveDescription && <p>{confirmAction.destructiveDescription}</p>}
                  {precheckLoading && <p>Checking eligibility…</p>}
                  {precheck && precheck.ineligibleCount > 0 && (
                    <p className="text-amber-600 dark:text-amber-400 font-medium">
                      {precheck.ineligibleCount} {pluralize(precheck.ineligibleCount, entityNoun)} {precheck.reason}
                    </p>
                  )}
                </DialogDescription>
              </DialogHeader>

              {requiresTypedCount && (
                <div className="space-y-1.5">
                  <label htmlFor="bulk-confirm-count" className="text-xs text-muted-foreground">
                    Type {selection.count} to confirm
                  </label>
                  <Input
                    id="bulk-confirm-count"
                    value={typedCount}
                    onChange={(e) => setTypedCount(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    data-testid="input-bulk-confirm-count"
                  />
                </div>
              )}

              <DialogFooter className="mt-2 gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={pendingId !== null}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDestructive}
                  disabled={!typedCountValid || pendingId !== null || precheckLoading}
                  data-testid="button-bulk-confirm-destructive"
                >
                  {pendingId !== null ? "Processing…" : confirmAction.label}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
