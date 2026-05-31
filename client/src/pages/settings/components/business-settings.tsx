import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Building2, Coins } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function BusinessSettingsSection() {
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
      toast({ title: "Settings updated successfully" });
    },
  });

  const [receiptPrefix, setReceiptPrefix] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState(5);

  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("hybrid");
  const [commissionType, setCommissionType] = useState("percentage");
  const [commissionFixedAmount, setCommissionFixedAmount] = useState(0);
  const [commissionFormula, setCommissionFormula] = useState("formula_b");
  const [activeDayTransport, setActiveDayTransport] = useState(1000);
  const [passiveDayTransport, setPassiveDayTransport] = useState(500);
  const [commissionRate, setCommissionRate] = useState(30);
  const [fixedBaseAmount, setFixedBaseAmount] = useState(30000);
  
  const [leaveDayRate, setLeaveDayRate] = useState(0);
  const [payLeaveDays, setPayLeaveDays] = useState(false);
  const [holidayDayRate, setHolidayDayRate] = useState(0);
  const [payHolidayDays, setPayHolidayDays] = useState(false);
  const [offDayRate, setOffDayRate] = useState(0);
  const [payOffDays, setPayOffDays] = useState(false);
  
  const [leadSplit2, setLeadSplit2] = useState(80);
  const [asstSplit2, setAsstSplit2] = useState(20);
  const [leadSplit3, setLeadSplit3] = useState(60);
  const [asst1Split3, setAsst1Split3] = useState(20);
  const [asst2Split3, setAsst2Split3] = useState(20);

  useEffect(() => {
    if (settingsData) {
      setReceiptPrefix(settingsData.receiptPrefix || "RCP");
      setThankYouMessage(settingsData.receiptThankYouMessage || "");
      setLowStockThreshold(settingsData.lowStockThreshold || 5);
      
      setDefaultPaymentMethod(settingsData.defaultPaymentMethod || "hybrid");
      setCommissionType(settingsData.commissionType || "percentage");
      setCommissionFixedAmount(settingsData.commissionFixedAmount ?? 0);
      setCommissionFormula(settingsData.commissionFormula || "formula_b");
      setActiveDayTransport(settingsData.activeDayTransport ?? 1000);
      setPassiveDayTransport(settingsData.passiveDayTransport ?? 500);
      setCommissionRate(Math.round((settingsData.commissionRate ?? 0.30) * 100));
      setFixedBaseAmount(settingsData.fixedBaseAmount ?? 30000);
      
      setLeaveDayRate(settingsData.leaveDayRate ?? 0);
      setPayLeaveDays(!!settingsData.payLeaveDays);
      setHolidayDayRate(settingsData.holidayDayRate ?? 0);
      setPayHolidayDays(!!settingsData.payHolidayDays);
      setOffDayRate(settingsData.offDayRate ?? 0);
      setPayOffDays(!!settingsData.payOffDays);
      
      setLeadSplit2(settingsData.leadSplit2 ?? 80);
      setAsstSplit2(settingsData.asstSplit2 ?? 20);
      setLeadSplit3(settingsData.leadSplit3 ?? 60);
      setAsst1Split3(settingsData.asst1Split3 ?? 20);
      setAsst2Split3(settingsData.asst2Split3 ?? 20);
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <Card className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></Card>;

  return (
    <div className="space-y-6">
      {/* Receipt Branding Card */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Building2 className="h-6 w-6 text-primary" />
            Store Receipt Branding & Low Stock
          </CardTitle>
          <CardDescription>Configure receipt branding and stock alerts for {currentStore.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prefix" className="text-sm font-semibold">Receipt Number Prefix</Label>
              <Input 
                id="prefix" 
                value={receiptPrefix} 
                onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase())} 
                className="font-mono"
              />
              <p className="text-[10px] text-muted-foreground">E.g. RCP-2024-001</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lowStock" className="text-sm font-semibold">Low Stock Threshold</Label>
              <Input 
                id="lowStock" 
                type="number"
                value={lowStockThreshold} 
                onChange={(e) => setLowStockThreshold(parseInt(e.target.value))} 
              />
              <p className="text-[10px] text-muted-foreground">Alert when stock falls below this number</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="thank-you" className="text-sm font-semibold">Receipt Thank You Message</Label>
            <Textarea 
              id="thank-you" 
              placeholder="Thank you for your patronage!" 
              value={thankYouMessage}
              onChange={(e) => setThankYouMessage(e.target.value)}
              className="min-h-[100px]"
            />
            <p className="text-[10px] text-muted-foreground">This will appear at the bottom of all printed receipts</p>
          </div>
        </CardContent>
        <Separator />
        <CardContent className="pt-6 flex justify-end">
          <Button 
            onClick={() => updateSettingsMutation.mutate({ receiptPrefix, receiptThankYouMessage: thankYouMessage, lowStockThreshold })}
            disabled={updateSettingsMutation.isPending}
            className="gap-2"
          >
            {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Save Branding Settings
          </Button>
        </CardContent>
      </Card>

      {/* Payroll Configuration Defaults Card */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Coins className="h-6 w-6 text-primary" />
            Payroll Configuration & Compensation Defaults
          </CardTitle>
          <CardDescription>Configure store-wide default base salaries, commission formulas, transport rates, and multi-staff split settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ─── STEP 1: PAYMENT MODEL ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
              <h3 className="text-sm font-bold">Choose the Default Payment Model</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              This is the pay structure applied to newly created staff members. Each model determines which fields below are relevant.
            </p>
            <div className="ml-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                {
                  value: "fixed",
                  label: "Fixed Salary",
                  icon: "🏦",
                  desc: "A flat monthly amount regardless of services worked. Commission fields are ignored.",
                  color: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
                  active: "ring-2 ring-blue-500",
                },
                {
                  value: "commission",
                  label: "Commission Only",
                  icon: "💰",
                  desc: "Earnings come purely from service commission splits. No fixed base salary.",
                  color: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
                  active: "ring-2 ring-amber-500",
                },
                {
                  value: "hybrid",
                  label: "Hybrid",
                  icon: "⚡",
                  desc: "Fixed base salary + daily transport/attendance pay + commission on services.",
                  color: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
                  active: "ring-2 ring-emerald-500",
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDefaultPaymentMethod(opt.value)}
                  className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${opt.color} ${defaultPaymentMethod === opt.value ? opt.active : "opacity-70 hover:opacity-100"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{opt.icon}</span>
                    <span className="text-sm font-bold">{opt.label}</span>
                    {defaultPaymentMethod === opt.value && (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary">Selected</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* ─── STEP 2: BASE SALARY ─── */}
          <div className={`space-y-3 transition-opacity duration-300 ${defaultPaymentMethod === "commission" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
              <h3 className="text-sm font-bold">Default Base Salary</h3>
              {defaultPaymentMethod === "commission" && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not used for Commission Only</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              The guaranteed monthly base paid to staff <strong>before</strong> attendance transport or commission is added.
            </p>
            <div className="ml-8 flex items-center gap-3 max-w-xs">
              <span className="text-lg font-bold text-muted-foreground">₦</span>
              <Input
                id="fixedBaseAmount"
                type="number"
                value={fixedBaseAmount}
                onChange={(e) => setFixedBaseAmount(parseFloat(e.target.value) || 0)}
                className="font-mono text-lg h-12"
                placeholder="e.g. 40000"
              />
            </div>
          </div>

          <Separator />

          {/* ─── STEP 3: COMMISSION SETUP ─── */}
          <div className={`space-y-4 transition-opacity duration-300 ${defaultPaymentMethod === "fixed" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
              <h3 className="text-sm font-bold">Commission Setup</h3>
              {defaultPaymentMethod === "fixed" && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not used for Fixed Salary</span>
              )}
            </div>
            <div className="ml-8 grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl">
              {[
                { value: "percentage", label: "Percentage of Service Value", icon: "%", desc: "Staff earns a % of the service sale price." },
                { value: "fixed_per_service", label: "Flat Amount per Service", icon: "₦", desc: "Staff earns a fixed naira amount for each service worked — regardless of price." },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCommissionType(opt.value)}
                  className={`rounded-lg border-2 p-3 text-left transition-all duration-200 ${commissionType === opt.value ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{opt.icon}</span>
                    <span className="text-xs font-bold">{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
            <div className="ml-8 max-w-2xl">
              {commissionType === "percentage" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="commissionRate" className="text-xs font-semibold">Default Commission Rate</Label>
                  <div className="flex items-center gap-2">
                    <Input id="commissionRate" type="number" min={0} max={100} value={commissionRate} onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)} className="font-mono h-10 max-w-[100px]" />
                    <span className="text-sm font-bold text-muted-foreground">% of service value</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">e.g. enter 30 for 30% commission on each service.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="commissionFixedAmount" className="text-xs font-semibold">Flat Amount Per Service (₦)</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-muted-foreground">₦</span>
                    <Input id="commissionFixedAmount" type="number" value={commissionFixedAmount} onChange={(e) => setCommissionFixedAmount(parseFloat(e.target.value) || 0)} className="font-mono h-10 max-w-[150px]" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Staff earns this fixed amount for each completed service.</p>
                </div>
              )}
            </div>
            {commissionType === "percentage" && (
              <div className="ml-8 space-y-3 max-w-2xl">
                <div>
                  <Label className="text-xs font-semibold">Commission Formula</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Determines how attendance transport costs interact with the commissionable service revenue pool before your commission rate is applied.</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { value: "formula_d", label: "Formula D — Pure Commission", badge: "Simplest", eq: "Commission = Rate% × Total Service Revenue", desc: "No transport costs are deducted. Staff earns their full percentage of every service they worked on.", badgeColor: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300" },
                    { value: "formula_b", label: "Formula B — Active & Passive Deduction", badge: "Recommended", eq: "Commission = Rate% × (Revenue − Active Transport − Passive Transport)", desc: "Active and passive day transport pay is subtracted from the pool before commission is calculated. Most balanced for salons.", badgeColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
                    { value: "formula_a", label: "Formula A — Total Attendance Deduction", badge: "Most conservative", eq: "Commission = Rate% × (Revenue − All Attendance Pay incl. Leaves & Holidays)", desc: "All attendance entitlements (including paid leaves and holidays) are deducted from the revenue pool before commission.", badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
                    { value: "formula_c", label: "Formula C — Active Days Only Deduction", badge: "Focused", eq: "Commission = Rate% × (Revenue − Active Transport Only)", desc: "Only active day transport is deducted. Passive, leave, and holiday days are not deducted.", badgeColor: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
                  ].map((formula) => (
                    <button key={formula.value} type="button" onClick={() => setCommissionFormula(formula.value)}
                      className={`rounded-lg border-2 p-3 text-left transition-all duration-200 ${commissionFormula === formula.value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40"}`}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-bold">{formula.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${formula.badgeColor}`}>{formula.badge}</span>
                        {commissionFormula === formula.value && <span className="ml-auto text-[10px] font-bold text-primary uppercase">Active</span>}
                      </div>
                      <code className="block text-[10px] font-mono bg-muted/50 rounded px-2 py-1 mb-1.5 text-muted-foreground">{formula.eq}</code>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{formula.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* ─── STEP 4: ATTENDANCE TRANSPORT RATES ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">4</span>
              <h3 className="text-sm font-bold">Daily Attendance Transport Rates</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Transport is paid every day a staff member shows up — regardless of commission. An <strong>Active day</strong> means they worked at least one service. A <strong>Passive day</strong> means they were present but no services were assigned to them.
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <Label htmlFor="activeDayTransport" className="text-xs font-bold">Active Day Rate (₦)</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Paid when staff works at least 1 service</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground font-mono">₦</span>
                  <Input id="activeDayTransport" type="number" value={activeDayTransport} onChange={(e) => setActiveDayTransport(parseFloat(e.target.value) || 0)} className="font-mono h-10" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ day</span>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <Label htmlFor="passiveDayTransport" className="text-xs font-bold">Passive Day Rate (₦)</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Paid when present but no service assigned</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground font-mono">₦</span>
                  <Input id="passiveDayTransport" type="number" value={passiveDayTransport} onChange={(e) => setPassiveDayTransport(parseFloat(e.target.value) || 0)} className="font-mono h-10" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ day</span>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* ─── STEP 5: LEAVES & SPECIAL DAYS ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">5</span>
              <h3 className="text-sm font-bold">Leaves & Special Day Pay Policy</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              Toggle whether these day categories earn pay. When enabled, set the daily rate. When disabled, staff receive ₦0 for those days.
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payLeaveDays ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">📋 Approved Leaves</p><p className="text-[10px] text-muted-foreground">Sick, annual leave</p></div>
                  <Switch id="payLeaveDays" checked={payLeaveDays} onCheckedChange={setPayLeaveDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payLeaveDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="leaveDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="leaveDayRate" type="number" disabled={!payLeaveDays} value={leaveDayRate} onChange={(e) => setLeaveDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payLeaveDays && <p className="text-[10px] text-blue-600 dark:text-blue-400">✓ Paid at ₦{leaveDayRate.toLocaleString()}/day</p>}
                </div>
                {!payLeaveDays && <p className="text-[10px] text-muted-foreground">Leaves are currently <strong>unpaid</strong></p>}
              </div>
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payHolidayDays ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">🎉 Public Holidays</p><p className="text-[10px] text-muted-foreground">National & public holidays</p></div>
                  <Switch id="payHolidayDays" checked={payHolidayDays} onCheckedChange={setPayHolidayDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payHolidayDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="holidayDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="holidayDayRate" type="number" disabled={!payHolidayDays} value={holidayDayRate} onChange={(e) => setHolidayDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payHolidayDays && <p className="text-[10px] text-violet-600 dark:text-violet-400">✓ Paid at ₦{holidayDayRate.toLocaleString()}/day</p>}
                </div>
                {!payHolidayDays && <p className="text-[10px] text-muted-foreground">Holidays are currently <strong>unpaid</strong></p>}
              </div>
              <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${payOffDays ? "border-rose-400 bg-rose-50/50 dark:bg-rose-950/20" : "border-border bg-muted/20 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold">🌙 Sundays / Off Days</p><p className="text-[10px] text-muted-foreground">Rest days & scheduled off</p></div>
                  <Switch id="payOffDays" checked={payOffDays} onCheckedChange={setPayOffDays} />
                </div>
                <div className={`space-y-1 transition-opacity ${payOffDays ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                  <Label htmlFor="offDayRate" className="text-[10px] font-semibold text-muted-foreground">Daily Rate (₦)</Label>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">₦</span><Input id="offDayRate" type="number" disabled={!payOffDays} value={offDayRate} onChange={(e) => setOffDayRate(parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono" /></div>
                  {payOffDays && <p className="text-[10px] text-rose-600 dark:text-rose-400">✓ Paid at ₦{offDayRate.toLocaleString()}/day</p>}
                </div>
                {!payOffDays && <p className="text-[10px] text-muted-foreground">Off days are currently <strong>unpaid</strong></p>}
              </div>
            </div>
          </div>

          <Separator />

          {/* ─── STEP 6: MULTI-STAFF SPLITS ─── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">6</span>
              <h3 className="text-sm font-bold">Multi-Staff Service Revenue Splits</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-8">
              When two or three staff members collaborate on a single service, the service revenue pool is split between them before commission rates are applied. <strong>Splits must add up to exactly 100%.</strong>
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div className="rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">👥 2-Staff Session</p><p className="text-[10px] text-muted-foreground">Lead + 1 assistant</p></div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${leadSplit2 + asstSplit2 === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"}`}>{leadSplit2 + asstSplit2}% total</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="leadSplit2" className="text-[10px] font-semibold">Lead Staff %</Label>
                    <Input id="leadSplit2" type="number" min={0} max={100} value={leadSplit2} onChange={(e) => { const v = parseInt(e.target.value) || 0; setLeadSplit2(v); setAsstSplit2(Math.max(0, 100 - v)); }} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asstSplit2" className="text-[10px] font-semibold">Assistant %</Label>
                    <Input id="asstSplit2" type="number" min={0} max={100} value={asstSplit2} onChange={(e) => { const v = parseInt(e.target.value) || 0; setAsstSplit2(v); setLeadSplit2(Math.max(0, 100 - v)); }} className="h-8 text-sm font-mono" />
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${leadSplit2}%` }} />
                  <div className="bg-indigo-200 dark:bg-indigo-700 h-full transition-all duration-300" style={{ width: `${asstSplit2}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>Lead: {leadSplit2}%</span><span>Asst: {asstSplit2}%</span></div>
              </div>
              <div className="rounded-xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div><p className="text-xs font-bold text-purple-700 dark:text-purple-300">👥👥 3-Staff Session</p><p className="text-[10px] text-muted-foreground">Lead + 2 assistants</p></div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${leadSplit3 + asst1Split3 + asst2Split3 === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"}`}>{leadSplit3 + asst1Split3 + asst2Split3}% total</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="leadSplit3" className="text-[10px] font-semibold">Lead %</Label>
                    <Input id="leadSplit3" type="number" min={0} max={100} value={leadSplit3} onChange={(e) => setLeadSplit3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asst1Split3" className="text-[10px] font-semibold">Asst #1 %</Label>
                    <Input id="asst1Split3" type="number" min={0} max={100} value={asst1Split3} onChange={(e) => setAsst1Split3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asst2Split3" className="text-[10px] font-semibold">Asst #2 %</Label>
                    <Input id="asst2Split3" type="number" min={0} max={100} value={asst2Split3} onChange={(e) => setAsst2Split3(parseInt(e.target.value) || 0)} className="h-8 text-sm font-mono" />
                  </div>
                </div>
                {/* Visual split bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${leadSplit3}%` }} />
                  <div className="bg-purple-300 dark:bg-purple-600 h-full transition-all duration-300" style={{ width: `${asst1Split3}%` }} />
                  <div className="bg-purple-200 dark:bg-purple-800 h-full transition-all duration-300" style={{ width: `${asst2Split3}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Lead: {leadSplit3}%</span>
                  <span>A1: {asst1Split3}%</span>
                  <span>A2: {asst2Split3}%</span>
                </div>
                {leadSplit3 + asst1Split3 + asst2Split3 !== 100 && (
                  <p className="text-[10px] text-red-500 font-medium">
                    ⚠ Total is {leadSplit3 + asst1Split3 + asst2Split3}% — must be exactly 100%
                  </p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* ─────────────────────────────────────────────────────────
              LIVE PAY PREVIEW
          ───────────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">✓</span>
              <h3 className="text-sm font-bold">Live Pay Preview</h3>
              <span className="text-[10px] text-muted-foreground">(sample: 1 active day + 1 passive day + ₦50,000 service revenue)</span>
            </div>
            <div className="ml-8 max-w-2xl">
              {(() => {
                const sampleRevenue = 50000;
                const sampleActiveDays = 1;
                const samplePassiveDays = 1;
                const activeTransportPay = sampleActiveDays * activeDayTransport;
                const passiveTransportPay = samplePassiveDays * passiveDayTransport;
                const totalAttendance = activeTransportPay + passiveTransportPay;

                let commissionable = sampleRevenue;
                if (commissionFormula === "formula_b") commissionable = Math.max(0, sampleRevenue - activeTransportPay - passiveTransportPay);
                else if (commissionFormula === "formula_a") commissionable = Math.max(0, sampleRevenue - totalAttendance);
                else if (commissionFormula === "formula_c") commissionable = Math.max(0, sampleRevenue - activeTransportPay);

                const commissionEarned = commissionType === "percentage"
                  ? (commissionRate / 100) * commissionable
                  : commissionFixedAmount;

                let netPay = 0;
                if (defaultPaymentMethod === "fixed") {
                  netPay = fixedBaseAmount;
                } else if (defaultPaymentMethod === "commission") {
                  netPay = totalAttendance + commissionEarned;
                } else {
                  netPay = fixedBaseAmount + totalAttendance + commissionEarned;
                }

                const fmt = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

                return (
                  <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
                    <div className="space-y-1.5 text-xs">
                      {defaultPaymentMethod !== "commission" && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Base Salary</span>
                          <span className="font-mono font-semibold">{fmt(fixedBaseAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active Day Transport ({sampleActiveDays} day × {fmt(activeDayTransport)})</span>
                        <span className="font-mono font-semibold">{fmt(activeTransportPay)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Passive Day Transport ({samplePassiveDays} day × {fmt(passiveDayTransport)})</span>
                        <span className="font-mono font-semibold">{fmt(passiveTransportPay)}</span>
                      </div>
                      {defaultPaymentMethod !== "fixed" && (
                        <>
                          <div className="flex justify-between text-muted-foreground/70 text-[10px]">
                            <span>Service Revenue Pool</span>
                            <span className="font-mono">{fmt(sampleRevenue)}</span>
                          </div>
                          {commissionable < sampleRevenue && (
                            <div className="flex justify-between text-muted-foreground/70 text-[10px]">
                              <span>After Formula Deductions</span>
                              <span className="font-mono">{fmt(commissionable)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Commission{commissionType === "percentage" ? ` (${commissionRate}%)` : " (flat)"}
                            </span>
                            <span className="font-mono font-semibold">{fmt(commissionEarned)}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold">Estimated Net Pay</span>
                      <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">{fmt(netPay)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">This is a sample calculation based on your current settings. Actual payroll reflects real attendance logs and service transactions.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </CardContent>
        <Separator />
        <CardContent className="pt-6 flex justify-end">
          <Button 
            onClick={() => updateSettingsMutation.mutate({
              defaultPaymentMethod,
              commissionType,
              commissionFixedAmount,
              commissionFormula,
              activeDayTransport,
              passiveDayTransport,
              commissionRate: commissionRate / 100,
              fixedBaseAmount,
              leaveDayRate,
              payLeaveDays,
              holidayDayRate,
              payHolidayDays,
              offDayRate,
              payOffDays,
              leadSplit2,
              asstSplit2,
              leadSplit3,
              asst1Split3,
              asst2Split3,
            })}
            disabled={updateSettingsMutation.isPending}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
          >
            {updateSettingsMutation.isPending && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Save Payroll Configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
