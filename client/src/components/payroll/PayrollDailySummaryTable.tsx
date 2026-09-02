import { format, parseISO } from "date-fns";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DailySummaryLine } from "@shared/schema";

/** Day-by-day attendance/transport/revenue-share table behind the pay figures. */
export function PayrollDailySummaryTable({
  dailySummary, isLoading, fmtCur,
}: {
  dailySummary: DailySummaryLine[];
  isLoading: boolean;
  fmtCur: (v: number) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Daily Summary Breakdown
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Revenue share is this staff member's slice of each service price — the base the
          commission formula runs on, not commission itself.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : dailySummary.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No daily summary records found for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground font-medium">
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-center py-2 px-3">Day Type</th>
                  <th className="text-right py-2 px-3">Transport</th>
                  <th className="text-left py-2 px-3">Services Rendered</th>
                  <th className="text-right py-2 pl-3">Revenue Share</th>
                </tr>
              </thead>
              <tbody>
                {dailySummary.map((d, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 pr-4 whitespace-nowrap text-xs text-muted-foreground font-medium">
                      {format(parseISO(d.date), "EEE, MMM d, yyyy")}
                    </td>
                    <td className="text-center py-2.5 px-3 whitespace-nowrap">
                      <Badge variant="outline" className={
                        d.dayType === "Active"
                          ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200"
                          : "text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200"
                      }>
                        {d.dayType}
                      </Badge>
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-xs">{fmtCur(d.transport)}</td>
                    <td className="text-left py-2.5 px-3 text-xs max-w-xs truncate" title={d.servicesWorked}>
                      {d.servicesWorked}
                    </td>
                    <td className="text-right py-2.5 pl-3 font-mono text-xs font-semibold">{fmtCur(d.revenueShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
