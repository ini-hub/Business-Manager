import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ClockInCard } from "@/components/clock-in-card";
import { useStore } from "@/lib/store-context";
import { format, parseISO, subDays } from "date-fns";
import { CalendarClock, CheckCircle2, XCircle, Hourglass } from "lucide-react";
import { formatDurationCompact } from "@/lib/duration-utils";

type AttendanceLogDay = {
  date: string;
  status: string;
  isLate: boolean;
  lateMinutes: number | null;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
};

type AttendanceLogGroup = {
  weekStart: string;
  weekEnd: string;
  summary: { present: number; late: number; absent: number; offDay: number; holiday: number; leave: number };
  days: AttendanceLogDay[];
};

type AttendanceLogResponse = {
  groups: AttendanceLogGroup[];
  page: number;
  pageSize: number;
  totalGroups: number;
};

type RetroRequest = {
  id: string;
  date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  clearsLateFlag: boolean;
  requestedKind: "clock_in" | "clock_out";
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  off_day: "Off day",
  holiday: "Holiday",
  leave: "Leave",
};

const PAGE_SIZE = 6; // weeks per page
const WINDOW_DAYS = 180; // how far back the log goes; pagination makes this cheap to browse

/**
 * The caller's own attendance record — and only their own — for anyone,
 * staff/manager/owner alike, all reached via the single /staff/attendance
 * route (the personal `self=1` request param triggers the self-scoping here).
 * The server forces the "own only" part regardless of what's asked for; see
 * resolveAttendanceStaffScope on the GET /api/attendance/log route.
 *
 * Deliberately shows lateness and its consequence before payday rather than on the
 * payslip: a disputed day is far cheaper to settle on the day it happened.
 */
export default function StaffAttendancePage() {
  const { currentStore } = useStore();
  const [page, setPage] = useState(1);
  const today = new Date();
  const startDate = format(subDays(today, WINDOW_DAYS), "yyyy-MM-dd");
  const endDate = format(today, "yyyy-MM-dd");

  const { data, isLoading } = useQuery<AttendanceLogResponse>({
    queryKey: ["/api/attendance/log", currentStore?.id, startDate, endDate, page],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/log?storeId=${currentStore?.id}&startDate=${startDate}&endDate=${endDate}&page=${page}&pageSize=${PAGE_SIZE}&self=1`,
        { credentials: "include" },
      );
      if (!res.ok) return { groups: [], page: 1, pageSize: PAGE_SIZE, totalGroups: 0 };
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: requests = [] } = useQuery<RetroRequest[]>({
    queryKey: ["/api/attendance/retro-requests", currentStore?.id],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/retro-requests?storeId=${currentStore?.id}&self=1`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const groups = data?.groups ?? [];
  const totalGroups = data?.totalGroups ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Attendance"
        description="Clock in once when you arrive — today only. Your manager can see exactly when you clocked in."
      />

      <ClockInCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your attendance log</CardTitle>
          <CardDescription>Grouped by week, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            groups.map((group) => (
              <div key={group.weekStart} data-testid={`week-${group.weekStart}`}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Week of {format(parseISO(group.weekStart), "d MMM")} – {format(parseISO(group.weekEnd), "d MMM yyyy")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.summary.present} present · {group.summary.late} late · {group.summary.absent} absent
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {group.days.map((row) => (
                    <div
                      key={row.date}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                      data-testid={`row-attendance-${row.date}`}
                    >
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
                            Late {formatDurationCompact(row.lateMinutes ?? 0)}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-disabled={page === 1}
                    className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 py-2 text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={page === totalPages}
                    className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> My attendance requests
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {requests.map((req) => (
              <div key={req.id} className="flex items-start justify-between gap-3 py-2.5" data-testid={`row-retro-${req.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    {format(parseISO(req.date), "EEE d MMM")}
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {req.requestedKind === "clock_out" ? "Clock-out" : "Clock-in"}
                    </Badge>
                  </p>
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
