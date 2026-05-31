import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
      toast({ title: "Credit Sales settings updated successfully" });
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
  if (isLoading) return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <BookOpen className="h-6 w-6 text-amber-500" />
          Credit Sales Reminder Settings
        </CardTitle>
        <CardDescription>Configure automated WhatsApp & SMS notifications to gently remind customers of their outstanding balance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="days-before" className="text-sm font-semibold">Days Before Due Date</Label>
            <Input 
              id="days-before" 
              type="number"
              value={daysBefore} 
              onChange={(e) => setDaysBefore(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Send first gentle warning reminder N days before due date</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language" className="text-sm font-semibold">Reminder Language Dialect</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="english">Standard English Dialect</SelectItem>
                <SelectItem value="pidgin">Nigerian Pidgin Dialect</SelectItem>
                <SelectItem value="both">Bilingual (English + Pidgin)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Select dialect style for messaging templates</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/40 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="on-due-date" className="text-sm font-semibold">Reminder On Due Date</Label>
            <p className="text-[10px] text-muted-foreground">Send an urgent collection notification exactly on the expected due date</p>
          </div>
          <Switch 
            id="on-due-date" 
            checked={onDueDate} 
            onCheckedChange={setOnDueDate} 
          />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="days-after" className="text-sm font-semibold">First Overdue Delay (Days)</Label>
            <Input 
              id="days-after" 
              type="number"
              value={daysAfter} 
              onChange={(e) => setDaysAfter(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Days after due date before sending first overdue reminder</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repeat-days" className="text-sm font-semibold">Follow-Up Frequency (Days)</Label>
            <Input 
              id="repeat-days" 
              type="number"
              value={repeatDays} 
              onChange={(e) => setRepeatDays(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Interval in days between repeat overdue notifications</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stop-days" className="text-sm font-semibold">Auto-Silence Threshold (Days)</Label>
            <Input 
              id="stop-days" 
              type="number"
              value={stopDays} 
              onChange={(e) => setStopDays(parseInt(e.target.value) || 0)} 
            />
            <p className="text-[10px] text-muted-foreground">Stop sending automated reminders after N days from due date</p>
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardContent className="pt-6 flex justify-end">
        <Button 
          onClick={() => updateSettingsMutation.mutate({ 
            borrowBookReminderDaysBefore: daysBefore, 
            borrowBookReminderOnDueDate: onDueDate, 
            borrowBookReminderDaysAfter: daysAfter, 
            borrowBookReminderRepeatDays: repeatDays, 
            borrowBookReminderStopDays: stopDays, 
            borrowBookReminderLanguage: language 
          })}
          disabled={updateSettingsMutation.isPending}
          className="gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
        >
          {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
          Save Ledger Settings
        </Button>
      </CardContent>
    </Card>
  );
}
