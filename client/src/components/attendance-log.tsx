import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { ExportToolbar } from "@/components/export-toolbar";
import { format, parseISO, subDays } from "date-fns";
import { Users, ChevronDown } from "lucide-react";
import type { Staff } from "@shared/schema";
import { formatDurationCompact } from "@/lib/duration-utils";

type AttendanceLogPunch = {
  id: string;
  kind: "clock_in" | "clock_out";
  source: string;
  effectiveAt: string;
  distanceMeters: number | null;
  withinGeofence: boolean | null;
  deviceTrusted: boolean;
  sharedDeviceFlagged: boolean;
  timeDivergenceFlagged: boolean;
  reason: string | null;
};

type AttendanceLogDay = {
  date: string;
  status: string;
  isLate: boolean;
  lateMinutes: number | null;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  punches: AttendanceLogPunch[];
};

type AttendanceLogGroup = {
  staffId: string;
  staffName: string;
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

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  off_day: "Off day",
  holiday: "Holiday",
  leave: "Leave",
};

const SOURCE_LABEL: Record<string, string> = {
  self: "Self",
  manager_proxy: "Manager",
  retro_approved: "Approved request",
  offline_replay: "Offline",
};

const PAGE_SIZE = 8; // (staff × week) groups per page in the on-screen view
const EXPORT_PAGE_SIZE = 500; // upper bound for a single export request — see AttendanceService.getAttendanceLog

function buildQuery(storeId: string, staffIds: string[], startDate: string, endDate: string, page: number, pageSize: number) {
  const params = new URLSearchParams({ storeId, startDate, endDate, page: String(page), pageSize: String(pageSize) });
  for (const id of staffIds) params.append("staffId", id);
  return params.toString();
}

async function fetchLog(query: string): Promise<AttendanceLogResponse> {
  const res = await fetch(`/api/attendance/log?${query}`, { credentials: "include" });
  if (!res.ok) return { groups: [], page: 1, pageSize: PAGE_SIZE, totalGroups: 0 };
  return res.json();
}

/**
 * The manager's view of the raw attendance log — one person, a chosen group, or the
 * whole store — grouped by week the same way the staff member's own "My Attendance"
 * page is, so a dispute can be settled by looking at the same shape of record from
 * both sides.
 */
export function AttendanceLog({ storeId, staff }: { storeId: string; staff: Staff[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ from: subDays(new Date(), 29), to: new Date() });
  const [page, setPage] = useState(1);

  const startDate = format(dateRange.from ?? subDays(new Date(), 729), "yyyy-MM-dd");
  const endDate = format(dateRange.to ?? new Date(), "yyyy-MM-dd");

  useEffect(() => setPage(1), [selectedIds.join(","), startDate, endDate]);

  const viewQuery = buildQuery(storeId, selectedIds, startDate, endDate, page, PAGE_SIZE);
  const { data, isLoading } = useQuery<AttendanceLogResponse>({
    queryKey: ["/api/attendance/log", "view", storeId, selectedIds.join(","), startDate, endDate, page],
    queryFn: () => fetchLog(viewQuery),
    enabled: !!storeId,
  });

  // Kept separate from the paginated view above so "export" always covers the whole
  // filtered range/selection, not just whatever page happens to be on screen.
  const exportQuery = buildQuery(storeId, selectedIds, startDate, endDate, 1, EXPORT_PAGE_SIZE);
  const { data: exportData } = useQuery<AttendanceLogResponse>({
    queryKey: ["/api/attendance/log", "export", storeId, selectedIds.join(","), startDate, endDate],
    queryFn: () => fetchLog(exportQuery),
    enabled: !!storeId,
  });

  const groups = data?.groups ?? [];
  const totalGroups = data?.totalGroups ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));

  const exportRows = (exportData?.groups ?? []).flatMap((group) =>
    group.days.map((day) => {
      const firstIn = day.punches.find((p) => p.kind === "clock_in");
      return {
        staffName: group.staffName,
        date: day.date,
        status: STATUS_LABEL[day.status] ?? day.status,
        late: day.isLate ? `Yes (${formatDurationCompact(day.lateMinutes ?? 0)})` : "No",
        clockIn: day.firstClockInAt ? format(parseISO(day.firstClockInAt), "yyyy-MM-dd HH:mm") : "",
        clockOut: day.lastClockOutAt ? format(parseISO(day.lastClockOutAt), "yyyy-MM-dd HH:mm") : "",
        recordedVia: firstIn ? (SOURCE_LABEL[firstIn.source] ?? firstIn.source) : "",
      };
    }),
  );

  const toggleStaff = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));

  const staffFilterLabel =
    selectedIds.length === 0 ? "All staff" : selectedIds.length === 1
      ? staff.find((s) => s.id === selectedIds[0])?.name ?? "1 selected"
      : `${selectedIds.length} selected`;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" data-testid="button-staff-filter">
                    <Users className="h-4 w-4" />
                    {staffFilterLabel}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {selectedIds.length === 0 ? "Whole store" : `${selectedIds.length} of ${staff.length}`}
                    </span>
                    {selectedIds.length > 0 && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedIds([])}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {staff.map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-sm hover:bg-muted"
                        data-testid={`option-staff-${s.id}`}
                      >
                        <Checkbox checked={selectedIds.includes(s.id)} onCheckedChange={() => toggleStaff(s.id)} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} defaultPreset="30days" />
            </div>

            <ExportToolbar
              data={exportRows}
              columns={[
                { key: "staffName", header: "Staff" },
                { key: "date", header: "Date" },
                { key: "status", header: "Status" },
                { key: "late", header: "Late" },
                { key: "clockIn", header: "Clock in" },
                { key: "clockOut", header: "Clock out" },
                { key: "recordedVia", header: "Recorded via" },
              ]}
              filename={`attendance-log_${startDate}_${endDate}`}
              title="Attendance Log"
              disabled={exportRows.length === 0}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Attendance log</CardTitle>
          <CardDescription>Grouped by week per staff member, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No attendance recorded for this selection.</p>
          ) : (
            groups.map((group) => (
              <div key={`${group.staffId}-${group.weekStart}`} data-testid={`log-group-${group.staffId}-${group.weekStart}`}>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium">
                    {group.staffName}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Week of {format(parseISO(group.weekStart), "d MMM")} – {format(parseISO(group.weekEnd), "d MMM yyyy")}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.summary.present} present · {group.summary.late} late · {group.summary.absent} absent
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {group.days.map((day) => (
                    <div
                      key={day.date}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                      data-testid={`log-day-${group.staffId}-${day.date}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{format(parseISO(day.date), "EEE d MMM")}</p>
                        <p className="text-xs text-muted-foreground">
                          {day.firstClockInAt
                            ? `In ${format(parseISO(day.firstClockInAt), "h:mm a")}${
                                day.lastClockOutAt ? ` · Out ${format(parseISO(day.lastClockOutAt), "h:mm a")}` : ""
                              }`
                            : "No clock-in"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {day.isLate && (
                          <Badge variant="destructive" className="text-xs">
                            Late {formatDurationCompact(day.lateMinutes ?? 0)}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {STATUS_LABEL[day.status] ?? day.status}
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
    </div>
  );
}
