import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO, subDays } from "date-fns";
import { Smartphone, TriangleAlert, UserCheck, Clock, ShieldAlert } from "lucide-react";
import type { Staff } from "@shared/schema";

type Punch = {
  id: string;
  staffId: string;
  localDate: string;
  kind: string;
  source: string;
  effectiveAt: string;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  deviceId: string | null;
  deviceTrusted: boolean;
  sharedDeviceFlagged: boolean;
  timeDivergenceFlagged: boolean;
  reason: string | null;
};

type RetroRequest = {
  id: string;
  staffId: string;
  date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  requestedKind: "clock_in" | "clock_out";
};

type Device = {
  id: string;
  staffId: string;
  deviceId: string;
  lastSeenAt: string;
  punchCount: number;
  approvedAt: string | null;
  revokedAt: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  self: "Self",
  manager_proxy: "Manager",
  retro_approved: "Approved request",
  offline_replay: "Offline",
};

export function AttendanceExceptions({ storeId, staff }: { storeId: string; staff: Staff[] }) {
  const { toast } = useToast();
  const endDate = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), 14), "yyyy-MM-dd");

  const [decision, setDecision] = useState<{ request: RetroRequest; approve: boolean } | null>(null);
  const [clearsLate, setClearsLate] = useState(false);
  const [note, setNote] = useState("");
  const [proxy, setProxy] = useState<{ staffId: string; reason: string } | null>(null);

  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? "Unknown";

  const { data: punches = [], isLoading } = useQuery<Punch[]>({
    queryKey: ["/api/attendance/punches", storeId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/punches?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!storeId,
  });

  const { data: requests = [] } = useQuery<RetroRequest[]>({
    queryKey: ["/api/attendance/retro-requests", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/retro-requests?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!storeId,
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ["/api/attendance/devices", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/devices?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!storeId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches", storeId, startDate, endDate] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/retro-requests", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/devices", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
  };

  const decide = useMutation({
    mutationFn: async () => {
      const { request, approve } = decision!;
      return apiRequest("POST", `/api/attendance/retro-requests/${request.id}/${approve ? "approve" : "reject"}`,
        approve ? { clearsLateFlag: clearsLate, note } : { note });
    },
    onSuccess: () => {
      setDecision(null); setNote(""); setClearsLate(false); refresh();
      toast({ title: "Request updated" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message, variant: "destructive" }),
  });

  const proxyPunch = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/attendance/punch/proxy", {
        storeId, staffId: proxy!.staffId, kind: "clock_in", reason: proxy!.reason,
      }),
    onSuccess: () => {
      setProxy(null);
      // A plain clock-in never touches retro-requests or devices — only its own
      // punch and the day-status it projects onto — so this refetches just those
      // two instead of reusing refresh()'s full four-query sweep.
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches", storeId, startDate, endDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      toast({ title: "Clock-in recorded" });
    },
    onError: (e: any) => toast({ title: "Could not record", description: e?.message, variant: "destructive" }),
  });

  const setDevice = useMutation({
    mutationFn: async ({ id, revoke }: { id: string; revoke: boolean }) =>
      apiRequest("POST", `/api/attendance/devices/${id}/${revoke ? "revoke" : "approve"}`),
    onSuccess: () => { refresh(); toast({ title: "Device updated" }); },
  });

  const pending = requests.filter((r) => r.status === "pending");
  const sharedFlagged = punches.filter((p) => p.sharedDeviceFlagged);

  return (
    <div className="space-y-6">
      {sharedFlagged.length > 0 && (
        <Alert variant="destructive" data-testid="alert-shared-device">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            {sharedFlagged.length} clock-in{sharedFlagged.length === 1 ? " was" : "s were"} made from a device
            that clocked in more than one staff member. A geofence cannot catch this — everybody involved
            really is at the branch — so it needs your eyes. See the log below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4" /> Attendance requests
            </CardTitle>
            <CardDescription>{pending.length} waiting for a decision</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setProxy({ staffId: "", reason: "" })} data-testid="button-open-proxy">
            Clock someone in
          </Button>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No requests.</p>
          ) : (
            <div className="divide-y">
              {requests.map((req) => (
                <div key={req.id} className="flex items-start justify-between gap-3 py-3" data-testid={`row-request-${req.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {name(req.staffId)} · {format(parseISO(req.date), "EEE d MMM")}
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {req.requestedKind === "clock_out" ? "Clock-out" : "Clock-in"}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{req.reason}</p>
                  </div>
                  {req.status === "pending" ? (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDecision({ request: req, approve: false })} data-testid={`button-reject-${req.id}`}>Reject</Button>
                      <Button size="sm" onClick={() => setDecision({ request: req, approve: true })} data-testid={`button-approve-${req.id}`}>Approve</Button>
                    </div>
                  ) : (
                    <Badge variant={req.status === "approved" ? "secondary" : "destructive"} className="shrink-0">{req.status}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Clock-in log</CardTitle>
          <CardDescription>Last 14 days</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32 w-full" /> : punches.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No clock-ins recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Staff</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Distance</th>
                    <th className="py-2 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {punches.map((p) => (
                    <tr key={p.id} className="border-b last:border-0" data-testid={`row-punch-${p.id}`}>
                      <td className="py-2 pr-3">{name(p.staffId)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {format(parseISO(p.effectiveAt), "d MMM, h:mm a")}
                      </td>
                      <td className="py-2 pr-3">{p.kind === "clock_in" ? "In" : "Out"}</td>
                      <td className="py-2 pr-3">{SOURCE_LABEL[p.source] ?? p.source}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {p.distanceMeters !== null ? `${Math.round(Number(p.distanceMeters))} m` : "—"}
                        {p.accuracyMeters !== null && (
                          <span className="text-xs text-muted-foreground"> ±{Math.round(Number(p.accuracyMeters))}</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {p.sharedDeviceFlagged && <Badge variant="destructive" className="text-xs">Shared device</Badge>}
                          {p.timeDivergenceFlagged && <Badge variant="destructive" className="text-xs">Clock mismatch</Badge>}
                          {p.deviceId && !p.deviceTrusted && <Badge variant="outline" className="text-xs">New device</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Devices</CardTitle>
          <CardDescription>Phones staff have clocked in from.</CardDescription>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No devices seen yet.</p>
          ) : (
            <div className="divide-y">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-device-${d.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{name(d.staffId)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.punchCount} clock-in{d.punchCount === 1 ? "" : "s"} · last seen {format(parseISO(d.lastSeenAt), "d MMM, h:mm a")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {d.revokedAt ? <Badge variant="destructive">Revoked</Badge>
                      : d.approvedAt ? <Badge variant="secondary">Approved</Badge>
                      : <Badge variant="outline">Unreviewed</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setDevice.mutate({ id: d.id, revoke: !d.revokedAt })} data-testid={`button-device-${d.id}`}>
                      {d.revokedAt ? "Restore" : "Revoke"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approving restores the day; forgiving the lateness is a separate call,
          because a dead battery and a genuinely late arrival arrive identically. */}
      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent data-testid="dialog-decide-request">
          <DialogHeader>
            <DialogTitle>{decision?.approve ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>
              {decision && `${name(decision.request.staffId)} · ${format(parseISO(decision.request.date), "EEE d MMM")} — "${decision.request.reason}"`}
            </DialogDescription>
          </DialogHeader>

          {decision?.approve && decision.request.requestedKind !== "clock_out" && (
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox
                id="clears-late"
                checked={clearsLate}
                onCheckedChange={(v) => setClearsLate(!!v)}
                data-testid="checkbox-clears-late"
              />
              <div>
                <Label htmlFor="clears-late" className="cursor-pointer">Count as on time</Label>
                <p className="text-xs text-muted-foreground">
                  Leave this off to restore the day but keep the late arrival — and its deduction.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="decision-note">{decision?.approve ? "Note (optional)" : "Reason"}</Label>
            <Textarea id="decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-decision-note" />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              onClick={() => decide.mutate()}
              disabled={decide.isPending || (!decision?.approve && note.trim().length === 0)}
              data-testid="button-confirm-decision"
            >
              {decision?.approve ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!proxy} onOpenChange={(o) => !o && setProxy(null)}>
        <DialogContent data-testid="dialog-proxy-punch">
          <DialogHeader>
            <DialogTitle>Clock someone in</DialogTitle>
            <DialogDescription>
              For a staff member who cannot clock themselves in — a dead phone, no data, no smartphone.
              The reason is recorded against the punch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Staff</Label>
              <Select value={proxy?.staffId ?? ""} onValueChange={(v) => setProxy((p) => ({ ...p!, staffId: v }))}>
                <SelectTrigger data-testid="select-proxy-staff"><SelectValue placeholder="Choose staff" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-reason">Reason</Label>
              <Textarea
                id="proxy-reason"
                rows={2}
                placeholder="e.g. Phone battery died on the way in."
                value={proxy?.reason ?? ""}
                onChange={(e) => setProxy((p) => ({ ...p!, reason: e.target.value }))}
                data-testid="input-proxy-reason"
              />
            </div>
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This skips the location check, so it is recorded as a manager entry rather than a self clock-in.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setProxy(null)}>Cancel</Button>
            <Button
              onClick={() => proxyPunch.mutate()}
              disabled={!proxy?.staffId || !proxy?.reason.trim() || proxyPunch.isPending}
              data-testid="button-confirm-proxy"
            >
              Record clock-in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
