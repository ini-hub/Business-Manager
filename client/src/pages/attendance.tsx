import { useState, useMemo } from "react";
import type { TransactionWithRelations } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO, startOfWeek, getDay, addMonths, subMonths } from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Coffee,
  Umbrella,
  Users,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { AttendanceSchedules } from "@/components/attendance-schedules";
import { AttendanceExceptions } from "@/components/attendance-exceptions";
import type { Staff, AttendanceRecord, AttendanceStatus } from "@shared/schema";

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  present:  { label: "Present",  color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800",  icon: CheckCircle2 },
  absent:   { label: "Absent",   color: "text-red-700 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",                  icon: XCircle },
  off_day:  { label: "Off Day",  color: "text-slate-600 dark:text-slate-400",     bg: "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700",          icon: Coffee },
  holiday:  { label: "Holiday",  color: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800",          icon: Umbrella },
  leave:    { label: "Leave",    color: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800",              icon: BookOpen },
};

const STATUS_DOT: Record<AttendanceStatus, string> = {
  present: "bg-emerald-500",
  absent:  "bg-red-500",
  off_day: "bg-slate-400",
  holiday: "bg-amber-400",
  leave:   "bg-blue-400",
};

function LateBadge({ lateMinutes }: { lateMinutes?: number | null }) {
  return (
    <Badge variant="outline" className="gap-1 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 border">
      <AlertCircle className="h-3 w-3" />
      Late{lateMinutes ? ` by ${lateMinutes} min` : ""}
    </Badge>
  );
}

function StatusBadge({ status, isActive, isLate, lateMinutes }: { status: AttendanceStatus; isActive?: boolean; isLate?: boolean; lateMinutes?: number | null }) {
  if (status === "present") {
    if (isActive) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 border">
            <CheckCircle2 className="h-3 w-3" />
            Present (Active)
          </Badge>
          {isLate && <LateBadge lateMinutes={lateMinutes} />}
        </div>
      );
    } else {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="gap-1 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 border-violet-200 dark:border-violet-800 border">
            <CheckCircle2 className="h-3 w-3" />
            Present (Passive)
          </Badge>
          {isLate && <LateBadge lateMinutes={lateMinutes} />}
        </div>
      );
    }
  }
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={`gap-1 ${cfg.color} ${cfg.bg} border`}>
        <Icon className="h-3 w-3" />
        {cfg.label}
      </Badge>
      {isLate && <LateBadge lateMinutes={lateMinutes} />}
    </div>
  );
}

export default function AttendancePage() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const userRole = user?.role || "staff";
  const canEdit = userRole === "manager" || userRole === "owner";

  const [view, setView] = useState<"daily" | "monthly" | "sixmonth" | "yearly" | "schedules" | "exceptions">("daily");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");

  const today = format(new Date(), "yyyy-MM-dd");
  const dailyDate = format(currentDate, "yyyy-MM-dd");

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const activeStaff = staffList.filter(s => !s.isArchived);

  // Date ranges per view
  const { startDate, endDate } = useMemo(() => {
    if (view === "daily") {
      return { startDate: dailyDate, endDate: dailyDate };
    } else if (view === "monthly") {
      const s = startOfMonth(currentDate);
      const e = endOfMonth(currentDate);
      return { startDate: format(s, "yyyy-MM-dd"), endDate: format(e, "yyyy-MM-dd") };
    } else if (view === "sixmonth") {
      const s = startOfMonth(subMonths(currentDate, 5));
      const e = endOfMonth(currentDate);
      return { startDate: format(s, "yyyy-MM-dd"), endDate: format(e, "yyyy-MM-dd") };
    } else {
      const s = new Date(currentDate.getFullYear(), 0, 1);
      const e = new Date(currentDate.getFullYear(), 11, 31);
      return { startDate: format(s, "yyyy-MM-dd"), endDate: format(e, "yyyy-MM-dd") };
    }
  }, [view, currentDate, dailyDate]);

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance", currentStore?.id, startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/attendance?storeId=${currentStore?.id}&startDate=${startDate}&endDate=${endDate}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Fetch transactions to resolve active vs passive status dynamically
  const { data: transactions = [] } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/transactions?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Lookup set of staff members assigned to service line items per day: "staffId:yyyy-MM-dd"
  const activeStaffDays = useMemo(() => {
    const s = new Set<string>();
    for (const tx of transactions) {
      if ((tx.inventory?.type === "service" || tx.inventory?.type === "mixed") && tx.checkout) {
        const dateStr = new Date(tx.transactionDate as unknown as string).toISOString().split("T")[0];

        // For multi-service receipts, serviceStaffIds carries every distinct staff
        // member across all line items (a single leadStaffId/assistingStaffXId pair
        // can only represent one service's staff and would drop the others).
        const staffIds = tx.checkout.serviceStaffIds?.length
          ? tx.checkout.serviceStaffIds
          : [tx.checkout.leadStaffId, tx.checkout.assistingStaff1Id, tx.checkout.assistingStaff2Id].filter(Boolean);
        for (const staffId of staffIds) s.add(`${staffId}:${dateStr}`);
      }
    }
    return s;
  }, [transactions]);

  // Build a lookup: staffId + date → record
  const recordMap = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const r of records) m.set(`${r.staffId}:${r.date}`, r);
    return m;
  }, [records]);

  const markMutation = useMutation({
    mutationFn: async ({ staffId, date, status }: { staffId: string; date: string; status: AttendanceStatus }) => {
      const res = await apiRequest("POST", "/api/attendance", {
        storeId: currentStore?.id,
        staffId,
        date,
        status,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance", currentStore?.id] });
      queryClient.refetchQueries({ queryKey: ["/api/attendance", currentStore?.id] });
    },
    onError: () => toast({ title: "Couldn't save attendance", variant: "destructive" }),
  });

  const bulkMarkMutation = useMutation({
    mutationFn: async () => {
      const staffIds = activeStaff.map(s => s.id);
      const res = await apiRequest("POST", "/api/attendance/bulk", {
        storeId: currentStore?.id,
        date: dailyDate,
        status: bulkStatus,
        staffIds,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance", currentStore?.id] });
      queryClient.refetchQueries({ queryKey: ["/api/attendance", currentStore?.id] });
      toast({ title: `Marked all staff as ${bulkStatus.replace("_", " ")} for ${format(currentDate, "MMM d")}` });
    },
    onError: () => toast({ title: "Couldn't bulk mark attendance", variant: "destructive" }),
  });

  const navPrev = () => {
    if (view === "daily") setCurrentDate(d => { const n = new Date(d); n.setDate(d.getDate() - 1); return n; });
    else if (view === "monthly") setCurrentDate(d => subMonths(d, 1));
    else if (view === "sixmonth") setCurrentDate(d => subMonths(d, 6));
    else setCurrentDate(d => new Date(d.getFullYear() - 1, d.getMonth(), 1));
  };

  const navNext = () => {
    if (view === "daily") setCurrentDate(d => { const n = new Date(d); n.setDate(d.getDate() + 1); return n; });
    else if (view === "monthly") setCurrentDate(d => addMonths(d, 1));
    else if (view === "sixmonth") setCurrentDate(d => addMonths(d, 6));
    else setCurrentDate(d => new Date(d.getFullYear() + 1, d.getMonth(), 1));
  };

  const periodLabel = useMemo(() => {
    if (view === "daily") return format(currentDate, "EEEE, MMMM d, yyyy");
    if (view === "monthly") return format(currentDate, "MMMM yyyy");
    if (view === "sixmonth") return `${format(subMonths(currentDate, 5), "MMM yyyy")} – ${format(currentDate, "MMM yyyy")}`;
    return currentDate.getFullYear().toString();
  }, [view, currentDate]);

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Attendance" description="Track staff attendance" />
        <StoreRequiredAlert title="Store Required for Attendance" />
      </div>
    );
  }

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Attendance"
          description="Track staff attendance"
        />
        <ConsolidatedFallbackAlert pageTitle="Staff Attendance" />
      </div>
    );
  }

  // ─── Summary counts for a staff member in the current period ────────────────
  function getSummary(staffId: string) {
    let active = 0, passive = 0, absent = 0, offDay = 0, holiday = 0, leave = 0;
    recordMap.forEach((r, key) => {
      if (!key.startsWith(staffId + ":")) return;
      const dateStr = key.split(":")[1];
      if (r.status === "present") {
        if (activeStaffDays.has(`${staffId}:${dateStr}`)) active++;
        else passive++;
      }
      else if (r.status === "absent") absent++;
      else if (r.status === "off_day") offDay++;
      else if (r.status === "holiday") holiday++;
      else if (r.status === "leave") leave++;
    });
    return { active, passive, absent, offDay, holiday, leave };
  }

  // ─── Daily View ─────────────────────────────────────────────────────────────
  function DailyView() {
    return (
      <div className="space-y-4">
        {canEdit && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">Bulk mark all staff:</span>
                <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as AttendanceStatus)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkMarkMutation.mutate()}
                  disabled={bulkMarkMutation.isPending || activeStaff.length === 0}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Apply to All ({activeStaff.length})
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : activeStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No active staff members found.</p>
            ) : (
              <div className="space-y-2">
                {activeStaff.map(s => {
                  const rec = recordMap.get(`${s.id}:${dailyDate}`);
                  const status = rec?.status as AttendanceStatus | undefined;
                  const isActive = activeStaffDays.has(`${s.id}:${dailyDate}`);
                  return (
                    <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center text-sm font-semibold text-primary">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <EntityLink href={`/staff/${s.id}/edit`} className="font-medium text-sm truncate">
                            {s.name}
                          </EntityLink>
                          <p className="text-xs text-muted-foreground font-mono truncate">{s.staffNumber}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full sm:w-auto border-t sm:border-0 pt-2 sm:pt-0">
                        {status ? <StatusBadge status={status} isActive={isActive} isLate={rec?.isLate} lateMinutes={rec?.lateMinutes} /> : (
                          <span className="text-xs text-muted-foreground italic">Not marked</span>
                        )}
                        {canEdit && (
                          <div className="flex gap-1">
                            {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(st => {
                              const cfg = STATUS_CONFIG[st];
                              const Icon = cfg.icon;
                              return (
                                <Button
                                  key={st}
                                  variant={status === st ? "default" : "ghost"}
                                  size="icon"
                                  className={`h-7 w-7 ${status !== st ? cfg.color : ""}`}
                                  title={cfg.label}
                                  onClick={() => markMutation.mutate({ staffId: s.id, date: dailyDate, status: st })}
                                  disabled={markMutation.isPending}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </Button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Monthly View ────────────────────────────────────────────────────────────
  function MonthlyView() {
    const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div className="space-y-6">
        {activeStaff.map(s => {
          const summary = getSummary(s.id);
          return (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {s.name.charAt(0)}
                    </div>
                    <EntityLink href={`/staff/${s.id}/edit`}>{s.name}</EntityLink>
                    <span className="font-mono text-xs text-muted-foreground">{s.staffNumber}</span>
                  </CardTitle>
                  <div className="flex flex-wrap gap-2.5 text-xs font-medium">
                    <span className="text-emerald-600 dark:text-emerald-400">Active: {summary.active}</span>
                    <span className="text-violet-600 dark:text-violet-400">Passive: {summary.passive}</span>
                    <span className="text-red-600 dark:text-red-400">Absent: {summary.absent}</span>
                    <span className="text-slate-500 dark:text-slate-400">Off: {summary.offDay}</span>
                    <span className="text-amber-700 dark:text-amber-400">Holiday: {summary.holiday}</span>
                    <span className="text-blue-600 dark:text-blue-400">Leave: {summary.leave}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {dayLabels.map(d => (
                    <div key={d} className="text-xs text-muted-foreground font-medium py-1">{d}</div>
                  ))}
                  {/* Offset for first day of month */}
                  {Array.from({ length: getDay(days[0]) }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {days.map(day => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const rec = recordMap.get(`${s.id}:${dateStr}`);
                    const status = rec?.status as AttendanceStatus | undefined;
                    const isActive = activeStaffDays.has(`${s.id}:${dateStr}`);
                    
                    let bgClass = "hover:bg-muted";
                    let titleStr = "Not marked";
                    let dotClass = "";

                    if (status) {
                      if (status === "present") {
                        if (isActive) {
                          bgClass = "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400";
                          titleStr = "Present (Active)";
                          dotClass = "bg-emerald-500";
                        } else {
                          bgClass = "bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-400";
                          titleStr = "Present (Passive)";
                          dotClass = "bg-violet-500";
                        }
                      } else {
                        bgClass = `${STATUS_CONFIG[status].bg} ${STATUS_CONFIG[status].color}`;
                        titleStr = STATUS_CONFIG[status].label;
                        dotClass = STATUS_DOT[status];
                      }
                    }

                    return (
                      <div
                        key={dateStr}
                        className={`
                          relative rounded-md py-1 px-0.5 text-xs font-medium cursor-pointer transition-all
                          ${isToday(day) ? "ring-2 ring-primary ring-offset-1" : ""}
                          ${bgClass}
                        `}
                        title={titleStr}
                        onClick={() => {
                          if (!canEdit) return;
                          const statuses: AttendanceStatus[] = ["present", "absent", "off_day", "holiday", "leave"];
                          const nextIdx = status ? (statuses.indexOf(status) + 1) % statuses.length : 0;
                          markMutation.mutate({ staffId: s.id, date: dateStr, status: statuses[nextIdx] });
                        }}
                      >
                        {format(day, "d")}
                        {status && (
                          <div className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full ${dotClass}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                {canEdit && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">Click a date to cycle: Present → Absent → Off-Day → Holiday → Leave</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // ─── Summary View (6-month / yearly) ────────────────────────────────────────
  function SummaryView() {
    return (
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium">Staff Member</th>
                  <th className="text-center py-2 px-3 font-medium text-emerald-700 dark:text-emerald-400">Active</th>
                  <th className="text-center py-2 px-3 font-medium text-violet-700 dark:text-violet-400">Passive</th>
                  <th className="text-center py-2 px-3 font-medium text-red-700 dark:text-red-400">Absent</th>
                  <th className="text-center py-2 px-3 font-medium text-slate-600 dark:text-slate-400">Off-Day</th>
                  <th className="text-center py-2 px-3 font-medium text-amber-700 dark:text-amber-400">Holiday</th>
                  <th className="text-center py-2 px-3 font-medium text-blue-700 dark:text-blue-400">Leave</th>
                  <th className="text-left py-2 pl-4 font-medium">Discrete Summary String</th>
                </tr>
              </thead>
              <tbody>
                {activeStaff.map(s => {
                  const { active, passive, absent, offDay, holiday, leave } = getSummary(s.id);
                  return (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <EntityLink href={`/staff/${s.id}/edit`} className="font-medium">
                              {s.name}
                            </EntityLink>
                            <p className="text-xs text-muted-foreground font-mono">{s.staffNumber}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-3 font-mono text-emerald-700 dark:text-emerald-400 font-semibold">{active}</td>
                      <td className="text-center py-2.5 px-3 font-mono text-violet-700 dark:text-violet-400 font-semibold">{passive}</td>
                      <td className="text-center py-2.5 px-3 font-mono text-red-700 dark:text-red-400 font-semibold">{absent}</td>
                      <td className="text-center py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{offDay}</td>
                      <td className="text-center py-2.5 px-3 font-mono text-amber-700 dark:text-amber-400">{holiday}</td>
                      <td className="text-center py-2.5 px-3 font-mono text-blue-700 dark:text-blue-400">{leave}</td>
                      <td className="py-2.5 pl-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        Active: {active} | Passive: {passive} | Absent: {absent} | Off: {offDay} | Holiday: {holiday} | Leave: {leave}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {activeStaff.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">No active staff members found.</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={`Staff attendance tracking for ${currentStore.name}`}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-3 w-3" />
          Present (Active)
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800">
          <CheckCircle2 className="h-3 w-3" />
          Present (Passive)
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
          <XCircle className="h-3 w-3" />
          Absent
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
          <Coffee className="h-3 w-3" />
          Off Day
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
          <Umbrella className="h-3 w-3" />
          Holiday
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
          <BookOpen className="h-3 w-3" />
          Leave
        </div>
        {!canEdit && (
          <span className="text-xs text-muted-foreground italic ml-2 self-center">View only – only managers/owners can mark attendance</span>
        )}
      </div>

      {/* View selector + navigation */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="max-w-full overflow-x-auto">
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="sixmonth">6-Month</TabsTrigger>
            <TabsTrigger value="yearly">Yearly</TabsTrigger>
            <TabsTrigger value="schedules" data-testid="tab-schedules">Schedules</TabsTrigger>
            <TabsTrigger value="exceptions" data-testid="tab-exceptions">Clock-In</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={navPrev}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-0 sm:min-w-[200px] text-center">{periodLabel}</span>
          <Button variant="outline" size="icon" onClick={navNext}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
        </div>
      </div>

      {/* View content */}
      {view === "daily" && DailyView()}
      {view === "monthly" && MonthlyView()}
      {(view === "sixmonth" || view === "yearly") && SummaryView()}
      {view === "schedules" && <AttendanceSchedules storeId={currentStore.id} staff={activeStaff} />}
      {view === "exceptions" && <AttendanceExceptions storeId={currentStore.id} staff={activeStaff} />}
    </div>
  );
}
