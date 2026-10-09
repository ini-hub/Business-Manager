import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PagerBar } from "@/components/pager-bar";
import { Spinner } from "@/components/ui/loader";
import type { Paginated } from "@/lib/paginated";
import { formatHistory, type HistoryEntry } from "./historyFormat";
import type { FeatureDetailData } from "./detailTypes";

export function HistoryTab({ data }: { data: FeatureDetailData }) {
  const [page, setPage] = useState(1);
  const id = data.feature.id;
  const { data: result, isLoading, isFetching, error, refetch } = useQuery<Paginated<HistoryEntry>>({
    queryKey: ["/api/admin/feature-catalog", "history", id, page],
    queryFn: async () => (await apiRequest("GET", `/api/admin/feature-catalog/${id}/history?page=${page}&limit=20`)).json(),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) return <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">Couldn't load the history. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  const rows = result?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No changes recorded for this feature yet.</p>;

  return (
    <div className="space-y-2">
      <ol className="rounded-2xl border border-border/80 bg-card/40 divide-y divide-border overflow-hidden" aria-label="Change history">
        {rows.map((e) => {
          const line = formatHistory(e);
          return (
            <li key={e.id} className="px-4 py-3 space-y-0.5" data-testid="history-entry">
              <p className="text-sm font-bold text-foreground">{line.title}</p>
              {line.detail && <p className="text-sm text-foreground break-words">{line.detail}</p>}
              <p className="text-xs text-muted-foreground">
                {e.adminEmail} · <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              </p>
            </li>
          );
        })}
      </ol>
      <PagerBar pagination={result?.pagination} onPage={setPage} busy={isFetching} noun="changes" />
    </div>
  );
}
