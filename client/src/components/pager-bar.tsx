import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Pagination } from "@/lib/paginated";

/** Previous / next controls for a paginated list. Renders nothing when everything fits on one page. */
export function PagerBar({
  pagination,
  onPage,
  busy = false,
  noun = "items",
}: {
  pagination?: Pagination;
  onPage: (page: number) => void;
  busy?: boolean;
  noun?: string;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground" data-testid="pager-bar">
      <span>{total.toLocaleString()} {noun}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={!pagination.hasMore || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
