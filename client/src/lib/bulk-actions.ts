/**
 * Fans a bulk action out across a list of ids, one request per id, and buckets the
 * outcomes by whatever label each successful run reports (e.g. "archived" vs "deleted"),
 * with every rejected promise automatically bucketed under "failed". This is the same
 * shape Inventory's existing bulk archive/delete already used ad hoc — pulled out so new
 * bulk actions on other entities don't reimplement the aggregation.
 *
 * Generates one batchId (uuid) shared across every request in the fan-out and passes it
 * to `run` so callers can forward it as the `X-Batch-Id` header — the server correlates
 * all resulting audit_logs rows under one audit_log_batches record, so a reviewer can see
 * "these N deletes were one bulk action by user X" instead of N unrelated log rows.
 */
export async function runBulkFanOut<TId, TOutcome extends string>(
  ids: TId[],
  run: (id: TId, batchId: string) => Promise<TOutcome>
): Promise<{
  counts: Partial<Record<TOutcome | "failed", number>>;
  byOutcome: Partial<Record<TOutcome | "failed", TId[]>>;
  batchId: string;
}> {
  const batchId = crypto.randomUUID();
  const settled = await Promise.allSettled(ids.map((id) => run(id, batchId)));
  const byOutcome: Partial<Record<TOutcome | "failed", TId[]>> = {};
  const counts: Partial<Record<TOutcome | "failed", number>> = {};

  settled.forEach((res, i) => {
    const outcome: TOutcome | "failed" = res.status === "fulfilled" ? res.value : "failed";
    (byOutcome[outcome] ??= []).push(ids[i]);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  });

  return { counts, byOutcome, batchId };
}
