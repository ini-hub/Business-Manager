import type { UseMutationResult } from "@tanstack/react-query";
import { FileEdit, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency-utils";

interface Draft {
  id: string;
  name?: string;
  cartData?: Array<{ totalPrice: number }>;
  updatedAt: string;
}

interface DraftsSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drafts: Draft[];
  activeDraftId: string | null;
  onLoadDraft: (draft: Draft) => void;
  deleteDraftMutation: UseMutationResult<unknown, Error, string>;
}

export function DraftsSheet({
  open,
  onOpenChange,
  drafts,
  activeDraftId,
  onLoadDraft,
  deleteDraftMutation,
}: DraftsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <FileEdit className="h-4 w-4" />
            Saved Drafts
          </SheetTitle>
          <SheetDescription className="text-xs">
            Load a saved cart to continue where you left off. Drafts do not affect inventory or financials.
          </SheetDescription>
        </SheetHeader>

        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Clock className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No drafts yet</p>
            <p className="text-xs mt-1">Build a cart and click "Save as Draft" to keep it for later.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => {
              const itemCount = draft.cartData?.length ?? 0;
              const total = draft.cartData?.reduce((s, i) => s + i.totalPrice, 0) ?? 0;
              const isActive = draft.id === activeDraftId;
              return (
                <div
                  key={draft.id}
                  className={cn(
                    "rounded-xl border p-3.5 space-y-2 transition-colors",
                    isActive ? "border-primary/50 bg-primary/5" : "hover:border-primary/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{draft.name || "Untitled Draft"}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {itemCount} item{itemCount !== 1 ? "s" : ""} · {formatCurrency(total)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(draft.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold shrink-0">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => onLoadDraft(draft)}
                      disabled={isActive}
                    >
                      {isActive ? "Loaded" : "Load"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs text-destructive hover:text-destructive hover:border-destructive/50"
                      onClick={() => deleteDraftMutation.mutate(draft.id)}
                      disabled={deleteDraftMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
