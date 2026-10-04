import { useEffect, useMemo, useState } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Users, ChevronDown } from "lucide-react";
import type { Staff } from "@shared/schema";
import { formatDurationCompact } from "@/lib/duration-utils";
import { cn } from "@/lib/utils";

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

const PAGE_SIZE = 10; // staff members per page in the on-screen view
const FETCH_PAGE_SIZE = 500; // upper bound for a single request — see AttendanceService.getAttendanceLog

const STATUS_TONE: Record<string, string> = {
  present: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  absent: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  leave: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  holiday: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  off_day: "border-border bg-muted/40 text-muted-foreground",
};
const LATE_TONE = "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";

type StaffGroup = {
  staffId: string;
  staffName: string;
  totals: { present: number; late: number; absent: number; other: number };
  weeks: AttendanceLogGroup[];
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

function timeLine(day: AttendanceLogDay) {
  if (!day.firstClockInAt) return "No clock-in";
  const out = day.lastClockOutAt ? ` – ${format(parseISO(day.lastClockOutAt), "h:mm a")}` : "";
  return `${format(parseISO(day.firstClockInAt), "h:mm a")}${out}`;
}

function DayCell({ staffId, day }: { staffId: string; day: AttendanceLogDay }) {
  const tone = day.isLate ? LATE_TONE : STATUS_TONE[day.status] ?? STATUS_TONE.off_day;
  return (
    <div
      className={cn("flex items-center justify-between gap-2 rounded-md border px-3 py-2 sm:flex-col sm:items-start sm:justify-start sm:gap-0.5", tone)}
      data-testid={`log-day-${staffId}-${day.date}`}
    >
      <p className="text-sm font-medium">{format(parseISO(day.date), "EEE d MMM")}</p>
      <div className="text-right sm:text-left">
        <p className="text-xs font-semibold">
          {STATUS_LABEL[day.status] ?? day.status}
          {day.isLate && ` · Late ${formatDurationCompact(day.lateMinutes ?? 0)}`}
        </p>
        <p className="text-xs opacity-80">{timeLine(day)}</p>
      </div>
    </div>
  );
}

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

  // One full-range request feeds both the on-screen view and the export, so a staff
  // member's weeks are never split across pages — pagination is by staff instead.
  const query = buildQuery(storeId, selectedIds, startDate, endDate, 1, FETCH_PAGE_SIZE);
  const { data, isLoading } = useQuery<AttendanceLogResponse>({
    queryKey: ["/api/attendance/log", storeId, selectedIds.join(","), startDate, endDate],
    queryFn: () => fetchLog(query),
    enabled: !!storeId,
  });

  const staffGroups = useMemo<StaffGroup[]>(() => {
    const byStaff = new Map<string, StaffGroup>();
    for (const g of data?.groups ?? []) {
      let entry = byStaff.get(g.staffId);
      if (!entry) {
        entry = { staffId: g.staffId, staffName: g.staffName, totals: { present: 0, late: 0, absent: 0, other: 0 }, weeks: [] };
        byStaff.set(g.staffId, entry);
      }
      entry.totals.present += g.summary.present;
      entry.totals.late += g.summary.late;
      entry.totals.absent += g.summary.absent;
      entry.totals.other += g.summary.leave + g.summary.holiday + g.summary.offDay;
      entry.weeks.push(g);
    }
    const list = [...byStaff.values()];
    for (const e of list) e.weeks.sort((x, y) => y.weekStart.localeCompare(x.weekStart));
    // Whoever needs attention first: most absences, then most late.
    return list.sort((x, y) => y.totals.absent - x.totals.absent || y.totals.late - x.totals.late || x.staffName.localeCompare(y.staffName));
  }, [data]);

  const totalPages = Math.max(1, Math.ceil(staffGroups.length / PAGE_SIZE));
  const pageStaff = staffGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exportData = data;

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

              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} defaultPreset="30days" compact />
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
          <CardDescription>One card per staff member — open one to see their weeks, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : staffGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No attendance recorded for this selection.</p>
          ) : (
            pageStaff.map((member) => {
              const counted = member.totals.present + member.totals.absent;
              const rate = counted === 0 ? null : Math.round((member.totals.present / counted) * 100);
              return (
                <Collapsible
                  key={member.staffId}
                  defaultOpen={staffGroups.length === 1}
                  className="group rounded-lg border"
                  data-testid={`log-staff-${member.staffId}`}
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40 sm:p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {initials(member.staffName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{member.staffName}</p>
                      {/* Mobile: one compact line of counts under the name */}
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                        {member.totals.present} present · {member.totals.late} late · {member.totals.absent} absent
                      </p>
                    </div>
                    {/* Tablet/desktop: counts as columns, plus a presence bar on desktop */}
                    <div className="hidden items-center gap-6 md:flex">
                      {[
                        ["Present", member.totals.present, ""],
                        ["Late", member.totals.late, member.totals.late > 0 ? "text-amber-600 dark:text-amber-400" : ""],
                        ["Absent", member.totals.absent, member.totals.absent > 0 ? "text-red-600 dark:text-red-400" : ""],
                      ].map(([label, value, tone]) => (
                        <div key={label as string} className="w-12 text-center">
                          <p className={cn("font-mono text-base font-bold", tone as string)}>{value}</p>
                          <p className="text-[11px] text-muted-foreground">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="hidden w-28 lg:block" aria-label={rate === null ? "No attendance rate" : `${rate}% attendance`}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rate ?? 0}%` }} />
                      </div>
                      <p className="mt-1 text-right text-[11px] text-muted-foreground">{rate === null ? "–" : `${rate}% attended`}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="space-y-4 border-t p-3 sm:p-4">
                      {member.weeks.map((week) => (
                        <div key={week.weekStart} data-testid={`log-group-${member.staffId}-${week.weekStart}`}>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                            <p className="text-xs font-medium text-muted-foreground">
                              {format(parseISO(week.weekStart), "d MMM")} – {format(parseISO(week.weekEnd), "d MMM yyyy")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {week.summary.present} present · {week.summary.late} late · {week.summary.absent} absent
                            </p>
                          </div>
                          {/* Mobile: stacked rows · tablet: 2–3 cards across · desktop: a full week across */}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-7">
                            {week.days.map((day) => <DayCell key={day.date} staffId={member.staffId} day={day} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
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
