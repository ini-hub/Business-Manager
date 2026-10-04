import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Card, Money, SaveBar } from "./settings-ui";

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "pidgin", label: "Nigerian Pidgin" },
  { value: "both", label: "English and Pidgin" },
];

type Step = { key: string; title: string; note: string; tone: "grey" | "blue" | "red" };

// Mirrors the reminder schedule the server follows: one before the due date, one on it,
// a first overdue reminder, then a repeat every N days until the stop day.
function buildSchedule(daysBefore: number, onDueDate: boolean, daysAfter: number, repeatDays: number, stopDays: number): Step[] {
  const steps: Step[] = [];
  if (daysBefore > 0) steps.push({ key: "before", title: `${daysBefore} ${daysBefore === 1 ? "day" : "days"} before`, note: "Friendly heads-up", tone: "grey" });
  if (onDueDate) steps.push({ key: "due", title: "Due date", note: "Payment due today", tone: "blue" });
  if (daysAfter > 0 && daysAfter <= stopDays) {
    steps.push({ key: "first", title: `${daysAfter} days late`, note: "First overdue reminder", tone: "red" });
    if (repeatDays > 0) {
      for (let d = daysAfter + repeatDays; d <= stopDays && steps.length < 40; d += repeatDays) {
        steps.push({ key: `late-${d}`, title: `${d} days late`, note: "Follow-up", tone: "red" });
      }
    }
  }
  return steps;
}

const DOT = { grey: "bg-slate-500", blue: "bg-primary", red: "bg-red-700" } as const;

export function BorrowBookSettingsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();

  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/settings", { ...data, storeId: currentStore?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", currentStore?.id] });
      toast({ title: "Credit sales settings updated successfully" });
    },
  });

  const [daysBefore, setDaysBefore] = useState(2);
  const [onDueDate, setOnDueDate] = useState(true);
  const [daysAfter, setDaysAfter] = useState(3);
  const [repeatDays, setRepeatDays] = useState(7);
  const [stopDays, setStopDays] = useState(30);
  const [language, setLanguage] = useState("both");

  useEffect(() => {
    if (settingsData) {
      setDaysBefore(settingsData.borrowBookReminderDaysBefore ?? 2);
      setOnDueDate(settingsData.borrowBookReminderOnDueDate ?? true);
      setDaysAfter(settingsData.borrowBookReminderDaysAfter ?? 3);
      setRepeatDays(settingsData.borrowBookReminderRepeatDays ?? 7);
      setStopDays(settingsData.borrowBookReminderStopDays ?? 30);
      setLanguage(settingsData.borrowBookReminderLanguage ?? "both");
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const steps = buildSchedule(daysBefore, onDueDate, daysAfter, repeatDays, stopDays);

  return (
    <div className="space-y-4">
      <Card title="When reminders go out">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders will be sent with these timings.</p>
        ) : (
          <>
            <div className="flex items-center" aria-hidden>
              {steps.map((s, i) => (
                <div key={s.key} className="flex flex-1 items-center last:flex-none">
                  <span className={cn("h-3 w-3 shrink-0 rounded-full ring-2 ring-background", DOT[s.tone])} />
                  {i < steps.length - 1 && <span className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map((s) => (
                <li key={s.key} className="rounded-lg bg-muted/60 px-3 py-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className={cn("h-2 w-2 rounded-full", DOT[s.tone])} />
                    {s.title}
                  </p>
                  <p className="ml-4 text-sm text-muted-foreground">{s.note}</p>
                </li>
              ))}
            </ol>
            <div>
              <p className="text-sm font-semibold">{steps.length} {steps.length === 1 ? "message" : "messages"} per unpaid credit sale, at most</p>
              <p className="text-sm text-muted-foreground">After {stopDays} days late, reminders stop. The debt stays on the customer's account.</p>
            </div>
          </>
        )}
      </Card>

      <Card title="Timing">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="days-before">Heads-up before the due date</Label>
            <Money id="days-before" prefix="" suffix="days before" value={daysBefore} onChange={(n) => setDaysBefore(Math.floor(n))} />
            <p className="text-xs text-muted-foreground">Set to 0 to skip it.</p>
          </div>
          <div className="flex items-start justify-between gap-4 sm:pt-1">
            <Label htmlFor="on-due-date">Remind on the due date</Label>
            <Switch id="on-due-date" checked={onDueDate} onCheckedChange={setOnDueDate} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="days-after">First overdue reminder</Label>
            <Money id="days-after" prefix="" suffix="days late" value={daysAfter} onChange={(n) => setDaysAfter(Math.floor(n))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repeat-days">Then repeat every</Label>
            <Money id="repeat-days" prefix="" suffix="days" value={repeatDays} onChange={(n) => setRepeatDays(Math.floor(n))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop-days">Stop after</Label>
            <Money id="stop-days" prefix="" suffix="days late" value={stopDays} onChange={(n) => setStopDays(Math.floor(n))} />
          </div>
        </div>
      </Card>

      <Card title="Language" hint="The wording customers receive.">
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Button key={l.value} type="button" size="sm" variant={language === l.value ? "default" : "outline"} aria-pressed={language === l.value} onClick={() => setLanguage(l.value)}>
              {l.label}
            </Button>
          ))}
        </div>
      </Card>

      <SaveBar
        label="Save reminder settings"
        pending={updateSettingsMutation.isPending}
        onSave={() =>
          updateSettingsMutation.mutate({
            borrowBookReminderDaysBefore: daysBefore,
            borrowBookReminderOnDueDate: onDueDate,
            borrowBookReminderDaysAfter: daysAfter,
            borrowBookReminderRepeatDays: repeatDays,
            borrowBookReminderStopDays: stopDays,
            borrowBookReminderLanguage: language,
          })
        }
      />
    </div>
  );
}
