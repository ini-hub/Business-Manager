import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClockInCard } from "@/components/clock-in-card";
import { useStore } from "@/lib/store-context";
import { format, parseISO, subDays } from "date-fns";
import { CalendarClock, CheckCircle2, XCircle, Hourglass } from "lucide-react";

type AttendanceRow = {
  date: string;
  status: string;
  isLate: boolean;
  lateMinutes: number | null;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
};

type RetroRequest = {
  id: string;
  date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  clearsLateFlag: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  off_day: "Off day",
  holiday: "Holiday",
  leave: "Leave",
};

/**
 * A staff member's own attendance record.
 *
 * Deliberately shows lateness and its consequence before payday rather than on the
 * payslip: a disputed day is far cheaper to settle on the day it happened.
 */
export default function StaffAttendancePage() {
  const { currentStore } = useStore();
  const today = new Date();
  const startDate = format(subDays(today, 30), "yyyy-MM-dd");
  const endDate = format(today, "yyyy-MM-dd");

  const { data: records = [], isLoading } = useQuery<AttendanceRow[]>({
    queryKey: ["/api/attendance", currentStore?.id, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance?storeId=${currentStore?.id}&startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: requests = [] } = useQuery<RetroRequest[]>({
    queryKey: ["/api/attendance/retro-requests"],
  });

  const lateDays = records.filter((r) => r.isLate).length;
  const presentDays = records.filter((r) => r.status === "present").length;
  const absentDays = records.filter((r) => r.status === "absent").length;

  return (
    <div className="space-y-6">
      <PageHeader title="My Attendance" description="Clock in when you arrive, and check your own record" />

      <ClockInCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Last 30 days</CardTitle>
          <CardDescription>
            {presentDays} present · {lateDays} late · {absentDays} absent
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : records.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            <div className="divide-y">
              {[...records].reverse().map((row) => (
                <div key={row.date} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-attendance-${row.date}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{format(parseISO(row.date), "EEE d MMM")}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.firstClockInAt
                        ? `In ${format(parseISO(row.firstClockInAt), "h:mm a")}${
                            row.lastClockOutAt ? ` · Out ${format(parseISO(row.lastClockOutAt), "h:mm a")}` : ""
                          }`
                        : "No clock-in"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.isLate && (
                      <Badge variant="destructive" className="text-xs">
                        Late {row.lateMinutes ?? 0}m
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> My missed clock-in requests
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {requests.map((req) => (
              <div key={req.id} className="flex items-start justify-between gap-3 py-2.5" data-testid={`row-retro-${req.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{format(parseISO(req.date), "EEE d MMM")}</p>
                  <p className="text-xs text-muted-foreground">{req.reason}</p>
                  {req.decisionNote && (
                    <p className="mt-1 text-xs italic text-muted-foreground">Manager: {req.decisionNote}</p>
                  )}
                </div>
                <Badge
                  variant={req.status === "approved" ? "secondary" : req.status === "rejected" ? "destructive" : "outline"}
                  className="shrink-0 gap-1 text-xs"
                >
                  {req.status === "approved" && <CheckCircle2 className="h-3 w-3" />}
                  {req.status === "rejected" && <XCircle className="h-3 w-3" />}
                  {req.status === "pending" && <Hourglass className="h-3 w-3" />}
                  {req.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
