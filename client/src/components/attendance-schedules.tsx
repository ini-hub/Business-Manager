import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, addMonths, parseISO } from "date-fns";
import { CalendarDays, Plus, X } from "lucide-react";
import type { Staff } from "@shared/schema";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SchedulesResponse = {
  defaultWeeklyOffDays: number[];
  schedules: Array<{ staffId: string; weeklyOffDays: number[] }>;
  exceptions: Array<{ id: string; staffId: string; date: string; kind: "off" | "working"; reason: string | null }>;
};

/**
 * Who is off, and when.
 *
 * Replaces the rule the payroll engine used to hardcode — that everyone is off on
 * Sundays — which no salon actually follows. The per-date exceptions matter as much
 * as the weekly pattern: staff swap days constantly, and a weekly pattern alone
 * cannot say "Ada is covering for Chidi this Tuesday".
 */
export function AttendanceSchedules({ storeId, staff }: { storeId: string; staff: Staff[] }) {
  const { toast } = useToast();
  const startDate = format(new Date(), "yyyy-MM-dd");
  const endDate = format(addMonths(new Date(), 2), "yyyy-MM-dd");

  const [newException, setNewException] = useState<{ staffId: string; date: string; kind: "off" | "working" }>({
    staffId: "",
    date: startDate,
    kind: "off",
  });

  const { data, isLoading } = useQuery<SchedulesResponse>({
    queryKey: ["/api/attendance/schedules", storeId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/schedules?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Could not load schedules");
      return res.json();
    },
    enabled: !!storeId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/schedules", storeId, startDate, endDate] });

  const saveSchedule = useMutation({
    mutationFn: async ({ staffId, weeklyOffDays }: { staffId: string; weeklyOffDays: number[] }) =>
      apiRequest("PUT", `/api/attendance/schedules/${staffId}`, { storeId, weeklyOffDays }),
    onSuccess: () => { invalidate(); toast({ title: "Roster updated" }); },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message, variant: "destructive" }),
  });

  const addException = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/attendance/schedule-exceptions", { storeId, ...newException }),
    onSuccess: () => { invalidate(); toast({ title: "Exception added" }); },
    onError: (e: any) => toast({ title: "Could not add", description: e?.message, variant: "destructive" }),
  });

  const removeException = useMutation({
    mutationFn: async ({ staffId, date }: { staffId: string; date: string }) =>
      apiRequest("DELETE", `/api/attendance/schedule-exceptions?storeId=${storeId}&staffId=${staffId}&date=${date}`),
    onSuccess: () => { invalidate(); toast({ title: "Exception removed" }); },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const byStaff = new Map((data?.schedules ?? []).map((s) => [s.staffId, s.weeklyOffDays ?? []]));
  const storeDefault = data?.defaultWeeklyOffDays ?? [0];
  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? "Unknown";

  const toggle = (staffId: string, day: number) => {
    const current = byStaff.get(staffId) ?? storeDefault;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
    saveSchedule.mutate({ staffId, weeklyOffDays: next });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> Weekly off-days
          </CardTitle>
          <CardDescription>
            Tap a day to mark it off. Staff without their own roster fall back to the branch default
            ({storeDefault.length ? storeDefault.map((d) => WEEKDAYS[d]).join(", ") : "none"}).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {staff.map((member) => {
            const own = byStaff.get(member.id);
            const pattern = own ?? storeDefault;
            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div className="min-w-[8rem]">
                  <p className="text-sm font-medium">{member.name}</p>
                  {!own && <p className="text-xs text-muted-foreground">Using branch default</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((label, day) => (
                    <Button
                      key={day}
                      size="sm"
                      variant={pattern.includes(day) ? "default" : "outline"}
                      onClick={() => toggle(member.id, day)}
                      disabled={saveSchedule.isPending}
                      data-testid={`button-roster-${member.id}-${day}`}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Swaps and cover days</CardTitle>
          <CardDescription>A specific date that overrides the weekly pattern, either way.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Staff</Label>
              <Select value={newException.staffId} onValueChange={(v) => setNewException((p) => ({ ...p, staffId: v }))}>
                <SelectTrigger data-testid="select-exception-staff"><SelectValue placeholder="Choose staff" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={newException.date}
                onChange={(e) => setNewException((p) => ({ ...p, date: e.target.value }))}
                data-testid="input-exception-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newException.kind} onValueChange={(v) => setNewException((p) => ({ ...p, kind: v as "off" | "working" }))}>
                <SelectTrigger data-testid="select-exception-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off that day</SelectItem>
                  <SelectItem value="working">Working that day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => addException.mutate()}
            disabled={!newException.staffId || !newException.date || addException.isPending}
            data-testid="button-add-exception"
          >
            <Plus className="mr-2 h-4 w-4" /> Add exception
          </Button>

          {(data?.exceptions ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No upcoming swaps or cover days.</p>
          ) : (
            <div className="divide-y">
              {data!.exceptions.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-exception-${ex.id}`}>
                  <div>
                    <p className="text-sm font-medium">{staffName(ex.staffId)}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(ex.date), "EEE d MMM yyyy")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={ex.kind === "off" ? "secondary" : "outline"}>
                      {ex.kind === "off" ? "Off" : "Working"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeException.mutate({ staffId: ex.staffId, date: ex.date })}
                      data-testid={`button-remove-exception-${ex.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
