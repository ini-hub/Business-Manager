import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useGeofence, type GeofenceCentre } from "@/hooks/useGeofence";
import { getDeviceId, newPunchId } from "@/lib/device-id";
import { saveOfflinePunch } from "@/lib/offline-db";
import { CheckCircle2, Clock, LogOut, MapPin, Loader2, TriangleAlert, CalendarClock } from "lucide-react";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

type TodayContext = {
  localDate: string;
  timezone: string;
  clockInEnabled: boolean;
  openingTime: string | null;
  graceMinutes: number;
  geofence: GeofenceCentre & { label: string | null } | null;
  scheduledOff: boolean;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  isLate: boolean;
  lateMinutes: number | null;
  status: string | null;
};

type PunchOutcome = { isLate: boolean; lateMinutes: number; localDate: string };

export function ClockInCard() {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<PunchOutcome | null>(null);
  const [denial, setDenial] = useState<{ message: string; code: string } | null>(null);
  const [retroReason, setRetroReason] = useState("");

  const { data: today, isLoading } = useQuery<TodayContext>({
    queryKey: ["/api/attendance/today"],
    refetchOnWindowFocus: true,
  });

  const centre = useMemo<GeofenceCentre | null>(
    () => (today?.geofence
      ? {
          latitude: today.geofence.latitude,
          longitude: today.geofence.longitude,
          radiusMeters: today.geofence.radiusMeters,
          maxAccuracyMeters: today.geofence.maxAccuracyMeters,
        }
      : null),
    [today?.geofence],
  );

  const notYetClockedIn = !!today?.clockInEnabled && !today?.clockedInAt;
  const fence = useGeofence(centre, notYetClockedIn);

  const punchMutation = useMutation({
    mutationFn: async (kind: "clock_in" | "clock_out") => {
      const payload = {
        kind,
        latitude: fence.latitude,
        longitude: fence.longitude,
        accuracyMeters: fence.accuracyMeters,
        deviceId: getDeviceId(),
        clientPunchId: newPunchId(),
        clientCapturedAt: new Date().toISOString(),
      };

      // GPS works without a network, so the fence has already been checked on the
      // device by the time the button was enabled. Queue rather than lose the
      // punch; the server re-verifies the coordinates and decides for itself
      // whether to honour the phone's clock.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await saveOfflinePunch(payload);
        return { queued: true, isLate: false, lateMinutes: 0, localDate: today?.localDate };
      }

      try {
        const res = await apiRequest("POST", "/api/attendance/punch", payload);
        return res.json();
      } catch (err: any) {
        // A refusal from the server is a real answer and must not be queued —
        // only a failure to reach it at all.
        if (err?.code || err?.message?.includes("HTTP")) throw err;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          await saveOfflinePunch(payload);
          return { queued: true, isLate: false, lateMinutes: 0, localDate: today?.localDate };
        }
        throw err;
      }
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/today"] });
      if (result?.queued) {
        toast({
          title: "Saved — no data connection",
          description: "Your clock-in will be sent as soon as you're back online.",
        });
        return;
      }
      if (result?.punch?.kind === "clock_out") {
        toast({ title: "Clocked out", description: "Have a good evening." });
        return;
      }
      setOutcome({
        isLate: !!result?.isLate,
        lateMinutes: result?.lateMinutes ?? 0,
        localDate: result?.localDate,
      });
    },
    onError: (err: any) => {
      const code = err?.code ?? "";
      const message = err?.message ?? "Could not record your clock-in.";
      // A hard block needs a way forward, not just a red toast — otherwise a flat
      // battery or a bad fix costs somebody a day's transport with no recourse.
      if (code === "outside_fence" || code === "weak_gps" || code === "fence_not_configured") {
        setDenial({ message, code });
        return;
      }
      toast({ title: "Could not clock in", description: message, variant: "destructive" });
    },
  });

  const retroMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/attendance/retro-requests", {
        date: today?.localDate,
        requestedKind: "clock_in",
        requestedAt: new Date().toISOString(),
        reason: retroReason,
      });
      return res.json();
    },
    onSuccess: () => {
      setDenial(null);
      setRetroReason("");
      toast({ title: "Sent to your manager", description: "You'll see the outcome on this page." });
    },
    onError: (err: any) => {
      toast({
        title: "Could not send the request",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !today || !today.clockInEnabled) return null;

  const alreadyIn = !!today.clockedInAt;
  const alreadyOut = !!today.clockedOutAt;

  const fenceLabel = (): { text: string; tone: "ok" | "warn" | "bad" } => {
    switch (fence.state) {
      case "inside":
        return { text: "You're at the branch", tone: "ok" };
      case "outside":
        return {
          text: fence.distanceMeters
            ? `About ${Math.round(fence.distanceMeters)} m away — move closer to clock in`
            : "You're outside the clock-in area",
          tone: "bad",
        };
      case "weak":
        return { text: "Weak GPS signal — move near a window or step outside", tone: "warn" };
      case "denied":
        return { text: "Location is off. Turn it on for this site to clock in.", tone: "bad" };
      case "insecure":
        return { text: "Clocking in needs a secure (https) connection.", tone: "bad" };
      case "unsupported":
        return { text: "This browser cannot report your location.", tone: "bad" };
      case "locating":
        return { text: "Finding your location…", tone: "warn" };
      default:
        return { text: "No branch location set yet — ask your manager.", tone: "warn" };
    }
  };

  const status = fenceLabel();
  const canClockIn = fence.state === "inside" && !punchMutation.isPending;

  return (
    <>
      <Card data-testid="card-clock-in">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" /> Attendance
              </CardTitle>
              <CardDescription>
                {today.openingTime ? `Branch opens at ${today.openingTime}` : "Clock in when you arrive"}
                {today.scheduledOff && " · today is your day off"}
              </CardDescription>
            </div>
            {alreadyIn && (
              <Badge variant={today.isLate ? "destructive" : "secondary"} data-testid="badge-clock-in-status">
                {today.isLate ? `Late by ${today.lateMinutes ?? 0} min` : "On time"}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {alreadyIn ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>
                  Clocked in at{" "}
                  <span className="font-medium">{formatInTimeZone(parseISO(today.clockedInAt!), today.timezone, "h:mm a")}</span>
                </span>
              </div>

              {alreadyOut ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LogOut className="h-4 w-4" />
                  Clocked out at {formatInTimeZone(parseISO(today.clockedOutAt!), today.timezone, "h:mm a")}
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => punchMutation.mutate("clock_out")}
                  disabled={punchMutation.isPending}
                  data-testid="button-clock-out"
                >
                  {punchMutation.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <LogOut className="mr-2 h-4 w-4" />}
                  Clock out
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Clocking out is optional.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className={
                  "flex items-center gap-2 text-sm " +
                  (status.tone === "ok" ? "text-emerald-600"
                    : status.tone === "bad" ? "text-destructive"
                    : "text-amber-600")
                }
                data-testid="text-geofence-status"
              >
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{status.text}</span>
              </div>

              <Button
                className="w-full"
                onClick={() => punchMutation.mutate("clock_in")}
                disabled={!canClockIn}
                data-testid="button-clock-in"
              >
                {punchMutation.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Clock className="mr-2 h-4 w-4" />}
                Clock in
              </Button>

              {(fence.state === "weak" || fence.state === "outside") && (
                <Button variant="ghost" size="sm" className="w-full" onClick={fence.refresh} data-testid="button-retry-location">
                  Try my location again
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Colour carries the verdict before the words are read. */}
      <Dialog open={!!outcome} onOpenChange={(open) => !open && setOutcome(null)}>
        <DialogContent
          className={outcome?.isLate
            ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30"
            : "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30"}
          data-testid={outcome?.isLate ? "dialog-clocked-in-late" : "dialog-clocked-in-on-time"}
        >
          <DialogHeader>
            <DialogTitle className={outcome?.isLate ? "text-amber-900 dark:text-amber-200" : "text-emerald-900 dark:text-emerald-200"}>
              {outcome?.isLate ? "Clocked in — late" : "Clocked in — on time"}
            </DialogTitle>
            <DialogDescription className={outcome?.isLate ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"}>
              {outcome?.isLate
                ? `You arrived ${outcome.lateMinutes} minute${outcome.lateMinutes === 1 ? "" : "s"} after opening time. If that was outside your control, ask your manager to review it.`
                : "You're recorded as present for today."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOutcome(null)} data-testid="button-close-clock-in-result">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The escape hatch, offered at the moment of refusal rather than buried. */}
      <Dialog open={!!denial} onOpenChange={(open) => !open && setDenial(null)}>
        <DialogContent data-testid="dialog-clock-in-denied">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-destructive" /> Couldn't clock you in
            </DialogTitle>
            <DialogDescription>{denial?.message}</DialogDescription>
          </DialogHeader>

          <Alert>
            <CalendarClock className="h-4 w-4" />
            <AlertDescription>
              If you're at work and this is wrong, tell your manager what happened and they can record
              today for you.
            </AlertDescription>
          </Alert>

          <div className="space-y-1.5">
            <Label htmlFor="retro-reason">What happened?</Label>
            <Textarea
              id="retro-reason"
              data-testid="input-retro-reason"
              placeholder="e.g. My phone battery died on the way in."
              value={retroReason}
              onChange={(e) => setRetroReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDenial(null)}>Close</Button>
            <Button
              onClick={() => retroMutation.mutate()}
              disabled={retroReason.trim().length === 0 || retroMutation.isPending}
              data-testid="button-submit-retro-request"
            >
              {retroMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ask my manager
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
