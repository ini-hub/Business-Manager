import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LocationPicker, type PickedLocation } from "@/components/location-picker";
import { formatCurrency } from "@/lib/currency-utils";
import { Card, Money, SaveBar } from "./settings-ui";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

/** The first minute that counts as late: opening time plus the grace period, plus one. */
function firstLateTime(opening: string, graceMinutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(opening);
  if (!m) return null;
  const total = (Number(m[1]) * 60 + Number(m[2]) + (graceMinutes || 0) + 1) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type SettingsSave = { section: "attendance" | "receipts" | "stock" | "loyalty" | "reminders" | "payroll"; body: Record<string, unknown> };

export function AttendanceSettingsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const currency = currentStore?.currency || "NGN";

  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (saves: SettingsSave | SettingsSave[]) => {
      const results = await Promise.all([saves].flat().map(async ({ section, body }) =>
        (await apiRequest("PUT", `/api/settings/${section}`, { ...body, storeId: currentStore?.id })).json()));
      return Object.assign({}, ...results);
    },
    onSuccess: (updated: any) => {
      // The PUT echoes only the fields it wrote; merge them instead of refetching the whole row.
      queryClient.setQueryData(["/api/settings", currentStore?.id], (old: any) => (old ? { ...old, ...updated } : old));
      toast({ title: "Attendance settings updated" });
    },
    onError: (err: any) => {
      toast({ title: "Could not save", description: err?.message || "Check the values and try again.", variant: "destructive" });
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
  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const activeDayTransport = settingsData?.activeDayTransport ?? 0;
  // Not a validation error (the owner chose an uncapped deduction), but a five-minute
  // lateness can then cost more than the day was worth, so it is worth seeing here.
  const deductionExceedsTransport = lateDeductionEnabled && activeDayTransport > 0 && lateDeductionAmount > activeDayTransport;
  const fenceIncomplete = clockInEnabled && (location.latitude === null || location.longitude === null);
  const lateFrom = firstLateTime(openingTime, graceMinutes);
  const offDaysPaid = !!settingsData?.payOffDays;

  const toggleWeekday = (day: number) =>
    setWeeklyOffDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  const handleSave = () =>
    updateSettingsMutation.mutate({ section: "attendance", body: {
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
    } });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="clock-in-enabled" className="text-base font-semibold">Staff clock in from their phones</Label>
            <p className="text-sm text-muted-foreground">
              Only while they're at the salon. Anyone with no clock-in on a working day is marked absent.
            </p>
          </div>
          <Switch id="clock-in-enabled" data-testid="switch-clock-in-enabled" checked={clockInEnabled} onCheckedChange={setClockInEnabled} />
        </div>
        {fenceIncomplete && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>Set where staff can clock in below before turning this on, or nobody will be able to clock in.</AlertDescription>
          </Alert>
        )}
      </Card>

      <Card title="Where staff can clock in" hint="Most accurate if you stand inside the salon and use your phone's location.">
        <LocationPicker value={location} radiusMeters={radiusMeters} onChange={setLocation} disabled={updateSettingsMutation.isPending} />
        <p className="text-sm font-medium">Staff must be within {radiusMeters} m of the salon to clock in.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="radius">Clock-in radius</Label>
            <Money id="radius" prefix="" suffix="metres" value={radiusMeters} onChange={setRadiusMeters} testId="input-geofence-radius" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-accuracy">Reject readings less precise than</Label>
            <Money id="max-accuracy" prefix="" suffix="metres" value={maxAccuracyMeters} onChange={setMaxAccuracyMeters} testId="input-geofence-max-accuracy" />
            <p className="text-xs text-muted-foreground">Staff are asked to try again instead of being told they're outside.</p>
          </div>
        </div>
      </Card>

      <Card title="Opening time and lateness">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="opening-time">Opens at</Label>
            <Input id="opening-time" data-testid="input-opening-time" type="time" value={openingTime} onChange={(e) => setOpeningTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grace">Grace period</Label>
            <Money id="grace" prefix="" suffix="minutes" value={graceMinutes} onChange={setGraceMinutes} testId="input-late-grace" />
          </div>
        </div>
        {lateFrom && <p className="text-sm font-medium">Clocking in at {lateFrom} or later counts as late.</p>}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="late-deduction-enabled">Take money off for late days</Label>
            <p className="text-sm text-muted-foreground">A fixed amount per late day, shown as its own line on the payslip. Transport is unchanged.</p>
          </div>
          <Switch id="late-deduction-enabled" data-testid="switch-late-deduction-enabled" checked={lateDeductionEnabled} onCheckedChange={setLateDeductionEnabled} />
        </div>
        {lateDeductionEnabled ? (
          <div className="space-y-2">
            <Label htmlFor="late-amount">Amount per late day</Label>
            <div className="max-w-xs"><Money id="late-amount" suffix="a late day" value={lateDeductionAmount} onChange={setLateDeductionAmount} testId="input-late-deduction-amount" /></div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Late days are recorded but nothing comes off pay.</p>
        )}
        {deductionExceedsTransport && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              This is more than a day's active transport ({formatCurrency(activeDayTransport, currency)}), so arriving a few minutes late
              costs more than not coming at all. Where the charge is larger than a period's pay, the balance carries forward to the next payroll period.
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Card title="Closed days" hint="For staff without their own roster. Tap a day to change it.">
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <Button
              key={day.value}
              type="button"
              size="sm"
              variant={weeklyOffDays.includes(day.value) ? "default" : "outline"}
              aria-pressed={weeklyOffDays.includes(day.value)}
              onClick={() => toggleWeekday(day.value)}
              data-testid={`button-weekday-${day.value}`}
            >
              {day.label}
            </Button>
          ))}
        </div>
        <p className="text-sm">
          {weeklyOffDays.length === 0
            ? "No closed days. Every day counts as a working day."
            : `Closed on ${weeklyOffDays.map((d) => WEEKDAYS[d].label).join(", ")}. Staff who come in anyway can still clock in.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Off days are {offDaysPaid ? "paid" : "unpaid"} under Pay rules.{" "}
          <Link href="/settings/store-details" className="font-medium text-primary underline">Change</Link>
        </p>
      </Card>

      <Card title="When something goes wrong" hint="A dead phone, no data, or a missed clock-in.">
        {/* "Require a clock-in PIN" is deliberately not offered: the setting and column exist
            server-side but nothing sets or checks a PIN yet, so a toggle would promise protection
            it doesn't give. Re-add once AttendanceService.recordPunch() verifies one. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="offline-age">Accept offline clock-ins up to</Label>
            <Money id="offline-age" prefix="" suffix="minutes old" value={maxOfflineAgeMinutes} onChange={setMaxOfflineAgeMinutes} testId="input-max-offline-age" />
            <p className="text-xs text-muted-foreground">
              That is {maxOfflineAgeMinutes % 60 === 0 ? `${maxOfflineAgeMinutes / 60} hours` : `${maxOfflineAgeMinutes} minutes`}.
              Older ones use the server's time and are flagged for review.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retro-age">Staff can ask to fix a missed clock-in up to</Label>
            <Money id="retro-age" prefix="" suffix="days back" value={retroMaxAgeDays} onChange={setRetroMaxAgeDays} testId="input-retro-max-age" />
          </div>
        </div>
      </Card>

      <SaveBar label="Save attendance settings" pending={updateSettingsMutation.isPending} onSave={handleSave} />
    </div>
  );
}
