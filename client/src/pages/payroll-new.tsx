import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";

type PayrollPeriodType = "weekly" | "biweekly" | "monthly";

function getDefaultDatesForType(type: PayrollPeriodType): { startDate: string; endDate: string } {
  const today = new Date();
  if (type === "monthly") {
    return {
      startDate: format(startOfMonth(today), "yyyy-MM-dd"),
      endDate: format(endOfMonth(today), "yyyy-MM-dd"),
    };
  }
  if (type === "weekly") {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    return {
      startDate: format(weekStart, "yyyy-MM-dd"),
      endDate: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  // biweekly
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  return {
    startDate: format(weekStart, "yyyy-MM-dd"),
    endDate: format(addDays(weekStart, 13), "yyyy-MM-dd"),
  };
}

export default function PayrollNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [periodType, setPeriodType] = useState<PayrollPeriodType>("monthly");
  const initialDates = getDefaultDatesForType("monthly");
  const [startDate, setStartDate] = useState(initialDates.startDate);
  const [endDate, setEndDate] = useState(initialDates.endDate);

  function handlePeriodTypeChange(type: PayrollPeriodType) {
    setPeriodType(type);
    const { startDate: s, endDate: e } = getDefaultDatesForType(type);
    setStartDate(s);
    setEndDate(e);
  }

  const defaultDates = getDefaultDatesForType(periodType);
  const datesAreCustomized =
    startDate !== defaultDates.startDate || endDate !== defaultDates.endDate;

  function resetDates() {
    setStartDate(defaultDates.startDate);
    setEndDate(defaultDates.endDate);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/periods", {
        storeId: currentStore!.id,
        periodType,
        startDate,
        endDate,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to create payroll period");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      toast({ title: "Payroll period created" });
      setLocation("/payroll");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  const canSave = !!startDate && !!endDate && !createMutation.isPending;

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="New Payroll Period"
        description="Set the period type and date range for this payroll cycle."
        actions={
          <Button variant="outline" onClick={() => setLocation("/payroll")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Payroll
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-1.5">
            <Label>Period Type</Label>
            <Select value={periodType} onValueChange={(v) => handlePeriodTypeChange(v as PayrollPeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            {datesAreCustomized && (
              <p className="text-xs text-muted-foreground">
                Dates customized.{" "}
                <button
                  type="button"
                  onClick={resetDates}
                  className="underline font-medium text-foreground hover:text-primary"
                >
                  Reset to {periodType} defaults
                </button>
              </p>
            )}
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/payroll")}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!canSave}>
              {createMutation.isPending ? "Creating…" : "Create Period"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
