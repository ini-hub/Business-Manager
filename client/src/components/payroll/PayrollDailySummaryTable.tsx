import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import type { DailySummaryLine } from "@shared/schema";

const PAGE = 15;
const DAY_STYLE: Record<DailySummaryLine["dayType"], string> = {
  Active: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  Passive: "text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
  Absent: "text-muted-foreground bg-muted",
};

/** Day-by-day attendance/transport/revenue-share list behind the pay figures. */
export function PayrollDailySummaryTable({
  dailySummary, isLoading, fmtCur,
}: {
  dailySummary: DailySummaryLine[];
  isLoading: boolean;
  fmtCur: (v: number) => string;
}) {
  const [filter, setFilter] = useState<"All" | DailySummaryLine["dayType"]>("All");
  const [shown, setShown] = useState(PAGE);

  const count = (t: DailySummaryLine["dayType"]) => dailySummary.filter(d => d.dayType === t).length;
  const chips: { key: typeof filter; label: string; n: number }[] = [
    { key: "All", label: "All days", n: dailySummary.length },
    { key: "Active", label: "Active", n: count("Active") },
    { key: "Passive", label: "Passive", n: count("Passive") },
    { key: "Absent", label: "Absent", n: count("Absent") },
  ];
  const rows = filter === "All" ? dailySummary : dailySummary.filter(d => d.dayType === filter);
  const visible = rows.slice(0, shown);
  const money = (v: number) => (v > 0 ? "" : "text-muted-foreground");

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 md:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold">Day by day</h2>
          <p className="text-xs text-muted-foreground max-w-md md:text-right">
            Revenue share is this staff member's slice of each service price, the base for commission. It is not pay.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter days">
          {chips.map(c => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => { setFilter(c.key); setShown(PAGE); }}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${filter === c.key ? "border-foreground bg-foreground text-background" : "hover:bg-muted"}`}
            >
              {c.label} <span className="tabular-nums">{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4 pt-0">{[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No days to show for this filter.</p>
      ) : (
        <>
          {/* md and up: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-5 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left">Day</th>
                  <th className="px-3 py-2.5 text-right">Transport</th>
                  <th className="px-3 py-2.5 text-left">Services</th>
                  <th className="px-5 py-2.5 text-right">Revenue share</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(d => (
                  <tr key={d.date} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5 whitespace-nowrap">{format(parseISO(d.date), "EEE d MMM")}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DAY_STYLE[d.dayType]}`}>{d.dayType}</span></td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${money(d.transport)}`}>{fmtCur(d.transport)}</td>
                    <td className={`px-3 py-2.5 ${d.servicesWorked && d.servicesWorked !== "—" ? "" : "text-muted-foreground"}`}>
                      {d.servicesWorked && d.servicesWorked !== "—" ? d.servicesWorked : "No services"}
                      {d.isLate && <span className="ml-2 text-xs font-medium text-destructive">Late{d.lateDeduction > 0 ? ` (−${fmtCur(d.lateDeduction)})` : ""}</span>}
                    </td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${d.revenueShare > 0 ? "font-semibold" : "text-muted-foreground"}`}>{fmtCur(d.revenueShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* phones: stacked list */}
          <ul className="md:hidden divide-y border-t">
            {visible.map(d => (
              <li key={d.date} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{format(parseISO(d.date), "EEE d MMM")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DAY_STYLE[d.dayType]}`}>{d.dayType}</span>
                  </span>
                  <span className={`tabular-nums ${d.revenueShare > 0 ? "font-semibold" : "text-muted-foreground"}`}>{fmtCur(d.revenueShare)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {d.servicesWorked && d.servicesWorked !== "—" ? d.servicesWorked : "No services"}
                  {d.isLate && <span className="ml-1 font-medium text-destructive">· Late</span>}
                </p>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t px-4 md:px-5 py-3 text-xs text-muted-foreground">
            <span>Showing 1 to {visible.length} of {rows.length}</span>
            {rows.length > visible.length && (
              <Button variant="outline" size="sm" onClick={() => setShown(s => s + PAGE)}>
                Show {Math.min(PAGE, rows.length - visible.length)} more
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
