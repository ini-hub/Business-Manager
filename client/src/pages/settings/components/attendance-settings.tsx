import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, MapPin, TriangleAlert, CalendarDays, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LocationPicker, type PickedLocation } from "@/components/location-picker";
import { formatCurrency } from "@/lib/currency-utils";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function AttendanceSettingsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const currency = currentStore?.currency || "NGN";

  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/settings", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", currentStore?.id] });
      toast({ title: "Attendance settings updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not save",
        description: err?.message || "Check the values and try again.",
        variant: "destructive",
      });
    },
  });

  const [clockInEnabled, setClockInEnabled] = useState(false);
  const [location, setLocation] = useState<PickedLocation>({ latitude: null, longitude: null, label: null });
  const [radiusMeters, setRadiusMeters] = useState(50);
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState(100);
  const [openingTime, setOpeningTime] = useState("09:00");
  const [graceMinutes, setGraceMinutes] = useState(0);
  const [lateDeductionEnabled, setLateDeductionEnabled] = useState(false);
  const [lateDeductionAmount, setLateDeductionAmount] = useState(0);
  const [maxOfflineAgeMinutes, setMaxOfflineAgeMinutes] = useState(720);
  const [retroMaxAgeDays, setRetroMaxAgeDays] = useState(7);
  const [weeklyOffDays, setWeeklyOffDays] = useState<number[]>([0]);

  useEffect(() => {
    if (!settingsData) return;
    setClockInEnabled(!!settingsData.clockInEnabled);
    setLocation({
      latitude: settingsData.geofenceLatitude ?? null,
      longitude: settingsData.geofenceLongitude ?? null,
      label: settingsData.geofencePlaceLabel ?? null,
    });
    setRadiusMeters(settingsData.geofenceRadiusMeters ?? 50);
    setMaxAccuracyMeters(settingsData.geofenceMaxAccuracyMeters ?? 100);
    setOpeningTime(settingsData.openingTime || "09:00");
    setGraceMinutes(settingsData.lateGraceMinutes ?? 0);
    setLateDeductionEnabled(!!settingsData.lateDeductionEnabled);
    setLateDeductionAmount(settingsData.lateDeductionAmount ?? 0);
    setMaxOfflineAgeMinutes(settingsData.maxOfflinePunchAgeMinutes ?? 720);
    setRetroMaxAgeDays(settingsData.retroRequestMaxAgeDays ?? 7);
    setWeeklyOffDays(Array.isArray(settingsData.defaultWeeklyOffDays) ? settingsData.defaultWeeklyOffDays : [0]);
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) {
    return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;
  }

  const activeDayTransport = settingsData?.activeDayTransport ?? 0;
  // Not a validation error — the owner chose an uncapped deduction — but it does
  // mean a five-minute lateness can cost more than the whole day was worth, so it
  // is worth seeing at the moment of configuring it.
  const deductionExceedsTransport =
    lateDeductionEnabled && activeDayTransport > 0 && lateDeductionAmount > activeDayTransport;

  const fenceIncomplete =
    clockInEnabled && (location.latitude === null || location.longitude === null);

  const toggleWeekday = (day: number) => {
    setWeeklyOffDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  };

  const handleSave = () => {
    updateSettingsMutation.mutate({
      clockInEnabled,
      geofenceLatitude: location.latitude,
      geofenceLongitude: location.longitude,
      geofencePlaceLabel: location.label,
      geofenceRadiusMeters: radiusMeters,
      geofenceMaxAccuracyMeters: maxAccuracyMeters,
      openingTime,
      lateGraceMinutes: graceMinutes,
      lateDeductionEnabled,
      lateDeductionAmount,
      maxOfflinePunchAgeMinutes: maxOfflineAgeMinutes,
      retroRequestMaxAgeDays: retroMaxAgeDays,
      defaultWeeklyOffDays: weeklyOffDays,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Self-Service Clock-In</CardTitle>
          <CardDescription>
            Let staff clock themselves in from their own phone, only while they are at the branch.
            While this is off, attendance stays entirely manager-marked and nothing below applies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="clock-in-enabled">Enable clock-in for this branch</Label>
              <p className="text-sm text-muted-foreground">
                Staff with no clock-in on a working day are recorded as absent.
              </p>
            </div>
            <Switch
              id="clock-in-enabled"
              data-testid="switch-clock-in-enabled"
              checked={clockInEnabled}
              onCheckedChange={setClockInEnabled}
            />
          </div>

          {fenceIncomplete && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                Set the branch location below before turning clock-in on, or nobody will be able to punch in.
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Branch location</Label>
              <p className="text-sm text-muted-foreground">
                The centre of the clock-in area. Most accurate if you stand in the salon and capture it from your device.
              </p>
            </div>

            <LocationPicker
              value={location}
              radiusMeters={radiusMeters}
              onChange={setLocation}
              disabled={updateSettingsMutation.isPending}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="radius">Clock-in radius (metres)</Label>
                <Input
                  id="radius"
                  data-testid="input-geofence-radius"
                  type="number"
                  min={10}
                  max={5000}
                  value={radiusMeters}
                  onChange={(e) => setRadiusMeters(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-accuracy">Reject GPS worse than (metres)</Label>
                <Input
                  id="max-accuracy"
                  data-testid="input-geofence-max-accuracy"
                  type="number"
                  min={10}
                  max={1000}
                  value={maxAccuracyMeters}
                  onChange={(e) => setMaxAccuracyMeters(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  A reading with more error than this cannot prove the radius either way, so staff are
                  asked to retry rather than being told they are outside.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Opening Time & Lateness</CardTitle>
          <CardDescription>
            Transport allowance itself is unchanged. A late arrival is charged as a separate line on the payslip.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opening-time">Opening time</Label>
              <Input
                id="opening-time"
                data-testid="input-opening-time"
                type="time"
                value={openingTime}
                onChange={(e) => setOpeningTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grace">Grace period (minutes)</Label>
              <Input
                id="grace"
                data-testid="input-late-grace"
                type="number"
                min={0}
                max={720}
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(Number(e.target.value))}
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="late-deduction-enabled">Charge for late arrival</Label>
              <p className="text-sm text-muted-foreground">
                A flat amount per late day, applied as a deduction the staff member can see.
              </p>
            </div>
            <Switch
              id="late-deduction-enabled"
              data-testid="switch-late-deduction-enabled"
              checked={lateDeductionEnabled}
              onCheckedChange={setLateDeductionEnabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="late-amount">Amount per late day</Label>
            <Input
              id="late-amount"
              data-testid="input-late-deduction-amount"
              type="number"
              min={0}
              value={lateDeductionAmount}
              onChange={(e) => setLateDeductionAmount(Number(e.target.value))}
              disabled={!lateDeductionEnabled}
            />
          </div>

          {deductionExceedsTransport && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                This is more than a day's active transport ({formatCurrency(activeDayTransport, currency)}),
                so arriving a few minutes late will cost more than not coming at all. Where the charge is
                larger than a period's pay, the balance carries forward to the next payroll period.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Default Off-Days</CardTitle>
          <CardDescription>
            Applies to any staff member without their own roster. Staff who come in on an off-day can still clock in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <Button
                key={day.value}
                type="button"
                size="sm"
                variant={weeklyOffDays.includes(day.value) ? "default" : "outline"}
                onClick={() => toggleWeekday(day.value)}
                data-testid={`button-weekday-${day.value}`}
              >
                {day.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {weeklyOffDays.length === 0
              ? "No default off-days — every unmarked day counts as a working day."
              : `Off by default: ${weeklyOffDays.map((d) => WEEKDAYS[d].label).join(", ")}`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Exceptions & Safeguards</CardTitle>
          <CardDescription>
            What happens when a phone dies, the data drops, or one device tries to clock in the whole salon.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* "Require a clock-in PIN" is intentionally not exposed here yet: the
              setting, punch_pin_hash column and pin_required rejection code exist
              server-side, but nothing sets or verifies a PIN, so surfacing the
              toggle would tell a manager it protects clock-in when it does not.
              Re-add once server/services/AttendanceService.ts actually checks a
              PIN in recordPunch(). */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="offline-age">Accept offline clock-ins up to (minutes old)</Label>
              <Input
                id="offline-age"
                data-testid="input-max-offline-age"
                type="number"
                min={0}
                max={10080}
                value={maxOfflineAgeMinutes}
                onChange={(e) => setMaxOfflineAgeMinutes(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                A punch saved without data keeps the time the phone recorded. Older than this and the
                server's own clock is used instead, and the punch is flagged for review.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="retro-age">Allow missed clock-in requests for (days back)</Label>
              <Input
                id="retro-age"
                data-testid="input-retro-max-age"
                type="number"
                min={0}
                max={90}
                value={retroMaxAgeDays}
                onChange={(e) => setRetroMaxAgeDays(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateSettingsMutation.isPending}
          data-testid="button-save-attendance-settings"
        >
          {updateSettingsMutation.isPending ? "Saving..." : "Save Attendance Settings"}
        </Button>
      </div>
    </div>
  );
}
