import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Card, Money, SaveBar } from "./settings-ui";
import { formatCurrency } from "@/lib/currency-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Renamed from BusinessSettingsSection: despite the old name, everything
// here is store-scoped (receipt prefix override, low-stock threshold,
// payroll defaults, loyalty config - all on the per-store `settings` table),
// not business-wide. See the Settings Screen Restructure requirements plan.
const TABS = [
  { id: "receipts", label: "Receipts and stock" },
  { id: "pay", label: "Pay rules" },
  { id: "loyalty", label: "Loyalty" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const CLOSING_NOTE_MAX = 120;

const PAY_MODELS = [
  { value: "fixed", label: "Fixed salary", desc: "The same amount every month, whatever services they do.", pays: "Base salary" },
  { value: "commission", label: "Commission only", desc: "No base salary. Pay comes from daily transport and commission on services.", pays: "Transport + commission" },
  { value: "hybrid", label: "Salary + commission", desc: "Base salary, daily transport and commission on services.", pays: "Base + transport + commission" },
];

const FORMULAS = [
  { value: "formula_d", label: "Commission on the full service value", desc: "Nothing is taken off first.", eq: "Rate × service revenue" },
  { value: "formula_b", label: "Take off transport, then commission", desc: "Active and passive day transport come off the pool first.", eq: "Rate × (revenue − active transport − passive transport)", recommended: true },
  { value: "formula_a", label: "Take off every present day at the active rate", desc: "Each day present is charged at the active day rate.", eq: "Rate × (revenue − days present × active rate)" },
  { value: "formula_c", label: "Take off transport, leave and holiday pay", desc: "Everything paid for days is taken off the pool first.", eq: "Rate × (revenue − transport − leave − holiday pay)" },
];

function SplitRow({ title, hint, labels, values, onChange }: { title: string; hint: string; labels: string[]; values: number[]; onChange: (i: number, v: number) => void }) {
  const total = values.reduce((a, b) => a + b, 0);
  const ok = total === 100;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", ok ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300")}>{total}% of 100%</span>
      </div>
      <div className={cn("mt-3 grid gap-3", values.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {labels.map((l, i) => (
          <div key={l} className="space-y-1">
            <Label htmlFor={`split-${title}-${i}`} className="text-xs">{l}</Label>
            <div className="flex">
              <Input id={`split-${title}-${i}`} type="number" min={0} max={100} value={values[i]} onChange={(e) => onChange(i, parseInt(e.target.value) || 0)} className="rounded-r-none" />
              <span className="flex items-center rounded-r-md border border-l-0 bg-muted px-2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
        {values.map((v, i) => (
          <div key={i} className={cn("h-full", i === 0 ? "bg-primary" : i === 1 ? "bg-primary/50" : "bg-primary/25")} style={{ width: `${Math.min(v, 100)}%` }} />
        ))}
      </div>
      <p className={cn("mt-2 text-xs font-medium", ok ? "text-green-700 dark:text-green-400" : "text-destructive")}>{ok ? "Adds up to 100%" : `Adds up to ${total}%. It must be 100%.`}</p>
    </div>
  );
}

export function StoreDetailsSection() {
  const { currentStore, business } = useStore();
  const [tab, setTab] = useState<TabId>("receipts");
  const { toast } = useToast();
  
  const { data: settingsData, isLoading } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: inventory = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => (await apiRequest("GET", `/api/inventory?storeId=${currentStore?.id}`)).json(),
    enabled: !!currentStore?.id && currentStore.id !== "all",
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

  const [loyaltyPointsPerCurrency, setLoyaltyPointsPerCurrency] = useState(100);
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(10);

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

      setLoyaltyPointsPerCurrency(settingsData.loyaltyPointsPerCurrency ?? 100);
      setLoyaltyPointValue(settingsData.loyaltyPointValue ?? 10);
    }
  }, [settingsData]);

  if (!currentStore) return null;
  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const currency = currentStore.currency || "NGN";
  const money = (n: number) => formatCurrency(n, currency);
  const year = new Date().getFullYear();
  const split3Total = leadSplit3 + asst1Split3 + asst2Split3;
  const businessRate: number | null = (business as any)?.commissionSplitStaffShare ?? null;
  const splitsOk = leadSplit2 + asstSplit2 === 100 && split3Total === 100;

  const lowItems = inventory
    .filter((i) => i.type !== "service" && i.isActive !== false)
    .filter((i) => Number(i.quantity) < (i.reorderPoint != null ? Number(i.reorderPoint) : lowStockThreshold))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));

  // Worked example shown beside the pay rules. Same arithmetic as before; only the presentation changed.
  const sampleRevenue = 50000;
  const activeTransportPay = activeDayTransport;
  const passiveTransportPay = passiveDayTransport;
  const totalAttendance = activeTransportPay + passiveTransportPay;
  let commissionable = sampleRevenue;
  if (commissionFormula === "formula_b" || commissionFormula === "formula_c") commissionable = Math.max(0, sampleRevenue - totalAttendance);
  else if (commissionFormula === "formula_a") commissionable = Math.max(0, sampleRevenue - 2 * activeDayTransport);
  const commissionEarned = commissionFormula === "formula_f"
    ? commissionFixedAmount * 3
    : commissionType === "percentage" ? (commissionRate / 100) * commissionable : commissionFixedAmount;
  const netPay =
    defaultPaymentMethod === "fixed" ? fixedBaseAmount
    : defaultPaymentMethod === "commission" ? totalAttendance + commissionEarned
    : fixedBaseAmount + totalAttendance + commissionEarned;

  const estimate = (
    <div className="rounded-xl border bg-card p-4 sm:p-5 lg:sticky lg:top-4">
      <h3 className="font-semibold">What a new staff member earns</h3>
      <p className="text-sm text-muted-foreground">Example month: 1 active day, 1 passive day, {money(sampleRevenue)} in services</p>
      <p className="mt-3 text-sm font-medium text-primary">{PAY_MODELS.find((m) => m.value === defaultPaymentMethod)?.label}</p>
      <dl className="mt-2 space-y-2 text-sm">
        {defaultPaymentMethod !== "commission" && <Line label="Base salary" value={money(fixedBaseAmount)} strong />}
        <Line label={`Active day transport, 1 × ${money(activeDayTransport)}`} value={money(activeTransportPay)} strong />
        <Line label={`Passive day transport, 1 × ${money(passiveDayTransport)}`} value={money(passiveTransportPay)} strong />
        {defaultPaymentMethod !== "fixed" && (
          <>
            <Line label="Service revenue" value={money(sampleRevenue)} muted />
            {commissionable < sampleRevenue && <Line label="After taking off transport" value={money(commissionable)} muted />}
            <Line label={`Commission${commissionType === "percentage" ? `, ${commissionRate}%` : ", flat"}`} value={money(commissionEarned)} strong />
          </>
        )}
      </dl>
      <div className="mt-4 flex items-baseline justify-between border-t pt-3">
        <span className="font-semibold">Estimated pay</span>
        <span className="text-lg font-bold" data-testid="text-estimated-pay">{money(netPay)}</span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">An example only. Real pay uses attendance and sales. These are defaults for new staff; each person can be changed on their profile.</p>
    </div>
  );

  const days = [
    { label: "Approved leave", hint: "Sick and annual leave", on: payLeaveDays, setOn: setPayLeaveDays, rate: leaveDayRate, setRate: setLeaveDayRate },
    { label: "Public holidays", hint: "National and public holidays", on: payHolidayDays, setOn: setPayHolidayDays, rate: holidayDayRate, setRate: setHolidayDayRate },
    { label: "Off days", hint: "Rest days. Set which days under Attendance.", on: payOffDays, setOn: setPayOffDays, rate: offDayRate, setRate: setOffDayRate },
  ];

  const pointPct = loyaltyPointsPerCurrency > 0 ? (loyaltyPointValue / loyaltyPointsPerCurrency) * 100 : 0;
  const pctLabel = Number.isInteger(pointPct) ? String(pointPct) : pointPct.toFixed(1);
  const show = (id: TabId) => cn(tab === id ? "block" : "hidden", "space-y-5");
  const sectionHead = (_title: string, hint: string) => <p className="text-sm text-muted-foreground">{hint}</p>;

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b" aria-label="Store details sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* RECEIPTS AND STOCK */}
      <div id="sd-receipts" className={show("receipts")}>
        {sectionHead("Receipts and stock alerts", `What goes on ${currentStore.name} receipts, and when to warn you about stock.`)}
        <Card title="Receipt">
          <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="prefix">Receipt number prefix</Label>
                <Input id="prefix" value={receiptPrefix} maxLength={6} onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                <p className="text-xs text-muted-foreground">Up to 6 letters or numbers. Starts every receipt number from this store.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="thank-you">Closing note</Label>
                <Textarea id="thank-you" placeholder="Thank you for your patronage!" value={thankYouMessage} maxLength={CLOSING_NOTE_MAX} onChange={(e) => setThankYouMessage(e.target.value)} className="min-h-[100px]" />
                <p className="text-xs text-muted-foreground">Printed at the bottom of every receipt. {Math.max(0, CLOSING_NOTE_MAX - thankYouMessage.length)} characters left.</p>
              </div>
            </div>
            <div className="self-start rounded-lg border bg-background p-4 text-center text-xs shadow-sm" aria-label="Receipt preview">
              <p className="text-sm font-semibold">{business?.name}</p>
              <p className="text-muted-foreground">{currentStore.name}</p>
              <p className="mt-2 font-semibold">Receipt {receiptPrefix || "RCP"}-{year}-001</p>
              <div className="my-2 space-y-1 border-y border-dashed py-2 text-left">
                <div className="flex justify-between text-muted-foreground"><span>Hair wash × 1</span><span>{money(5000)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>{money(5000)}</span></div>
              </div>
              {thankYouMessage && <p className="italic">{thankYouMessage}</p>}
              <p className="mt-2 text-[11px] text-muted-foreground">Preview. Number format shown as an example.</p>
            </div>
          </div>
        </Card>
        <Card title="Low stock alert" hint="Applies to every item unless the item has its own reorder point.">
          <div className="flex max-w-xs items-center gap-3">
            <Label htmlFor="lowStock" className="shrink-0">Alert me when an item falls below</Label>
          </div>
          <div className="max-w-[12rem]">
            <Money id="lowStock" prefix="" value={lowStockThreshold} onChange={(n) => setLowStockThreshold(Math.floor(n))} suffix="units" />
          </div>
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            {lowItems.length === 0 ? (
              <p className="text-muted-foreground">Nothing is below {lowStockThreshold} right now.</p>
            ) : (
              <>
                <p className="font-medium">{lowItems.length} {lowItems.length === 1 ? "item is" : "items are"} below {lowStockThreshold} right now</p>
                <ul className="mt-1 space-y-0.5">
                  {lowItems.slice(0, 4).map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span className="truncate">{i.name}</span>
                      <span className={Number(i.quantity) <= 0 ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-amber-700 dark:text-amber-400"}>
                        {Number(i.quantity) <= 0 ? "Out of stock" : `${Number(i.quantity)} left`}
                      </span>
                    </li>
                  ))}
                </ul>
                {lowItems.length > 4 && <p className="mt-1 text-xs text-muted-foreground">and {lowItems.length - 4} more</p>}
              </>
            )}
          </div>
        </Card>
        <SaveBar
          label="Save receipt and stock settings"
          pending={updateSettingsMutation.isPending}
          onSave={() => updateSettingsMutation.mutate({ receiptPrefix, receiptThankYouMessage: thankYouMessage, lowStockThreshold })}
        />
      </div>

      {/* PAY RULES */}
      <div id="sd-pay" className={show("pay")}>
        {sectionHead("Pay rules", `Defaults for working out staff pay at ${currentStore.name}.`)}
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-4">
            <Card title="How new staff are paid" hint="The default for staff added from now on. Existing staff keep their own setup.">
              <div className="grid gap-3 md:grid-cols-3">
                {PAY_MODELS.map((m) => (
                  <button key={m.value} type="button" onClick={() => setDefaultPaymentMethod(m.value)} aria-pressed={defaultPaymentMethod === m.value}
                    className={cn("rounded-xl border-2 p-4 text-left", defaultPaymentMethod === m.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                    <p className="font-semibold">{m.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
                    <p className="mt-2 text-xs font-medium text-primary">Pays: {m.pays}</p>
                  </button>
                ))}
              </div>
            </Card>

            {defaultPaymentMethod !== "commission" && (
              <Card title="Base salary" hint="Paid every month before transport or commission.">
                <div className="max-w-sm"><Money id="fixedBaseAmount" value={fixedBaseAmount} onChange={setFixedBaseAmount} suffix="a month" /></div>
              </Card>
            )}

            {defaultPaymentMethod !== "fixed" && (
              <Card title="Commission" hint="What staff earn from the services they do.">
                <div className="flex flex-wrap gap-2">
                  {[{ v: "percentage", l: "Percentage of the service price" }, { v: "fixed_per_service", l: "Fixed amount per service" }].map((o) => (
                    <Button key={o.v} type="button" size="sm" variant={commissionType === o.v ? "default" : "outline"} onClick={() => setCommissionType(o.v)}>{o.l}</Button>
                  ))}
                </div>
                {commissionType === "percentage" ? (
                  <div className="space-y-2">
                    <Label htmlFor="commissionRate">Rate</Label>
                    <div className="max-w-xs"><Money id="commissionRate" prefix="" value={commissionRate} onChange={(n) => setCommissionRate(Math.min(100, n))} suffix="% of service price" /></div>
                    <p className="text-sm text-muted-foreground">On a {money(10000)} service, staff earn {money(10000 * commissionRate / 100)} before any deductions.</p>
                    {businessRate !== null && businessRate !== commissionRate && (
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        The business default is {businessRate}% (set in <Link href="/settings/business" className="underline">Business profile</Link>). {currentStore.name} overrides it.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="commissionFixedAmount">Amount per service</Label>
                    <div className="max-w-xs"><Money id="commissionFixedAmount" value={commissionFixedAmount} onChange={setCommissionFixedAmount} suffix="a service" /></div>
                    <p className="text-sm text-muted-foreground">Staff earn this for each completed service, whatever the price.</p>
                  </div>
                )}
                {commissionType === "percentage" && (
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">Before working out commission</p>
                      <p className="text-sm text-muted-foreground">Daily pay can be taken off service revenue first, so it isn't paid twice.</p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {FORMULAS.map((f) => (
                        <button key={f.value} type="button" onClick={() => setCommissionFormula(f.value)} aria-pressed={commissionFormula === f.value}
                          className={cn("rounded-lg border p-3 text-left", commissionFormula === f.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40")}>
                          <p className="text-sm font-semibold">{f.label}</p>
                          {f.recommended && <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/20 dark:text-green-300">Recommended for salons</span>}
                          <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{f.eq}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            <Card title="Daily transport" hint="Paid for each day a staff member shows up.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="activeDayTransport">Active day</Label>
                  <Money id="activeDayTransport" value={activeDayTransport} onChange={setActiveDayTransport} suffix="a day" />
                  <p className="text-xs text-muted-foreground">Did at least one service.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passiveDayTransport">Passive day</Label>
                  <Money id="passiveDayTransport" value={passiveDayTransport} onChange={setPassiveDayTransport} suffix="a day" />
                  <p className="text-xs text-muted-foreground">Present, but no services.</p>
                </div>
              </div>
            </Card>

            <Card title="Days not worked" hint="Turn on any you pay for, and set the daily amount.">
              <div className="divide-y">
                {days.map((d) => (
                  <div key={d.label} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{d.label}</p>
                        <p className="text-xs text-muted-foreground">{d.hint}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        {d.on ? "Paid" : "Unpaid"}
                        <Switch checked={d.on} onCheckedChange={d.setOn} aria-label={`Pay for ${d.label.toLowerCase()}`} />
                      </label>
                    </div>
                    {d.on && <div className="max-w-xs"><Money id={`rate-${d.label}`} value={d.rate} onChange={d.setRate} suffix="a day" /></div>}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Shared services" hint="When 2 or 3 people work on one service, its value is split between them before commission.">
              <div className="space-y-3">
                <SplitRow title="2 people" hint="Lead and 1 assistant" labels={["Lead", "Assistant"]} values={[leadSplit2, asstSplit2]}
                  onChange={(i, v) => { if (i === 0) { setLeadSplit2(v); setAsstSplit2(Math.max(0, 100 - v)); } else { setAsstSplit2(v); setLeadSplit2(Math.max(0, 100 - v)); } }} />
                <SplitRow title="3 people" hint="Lead and 2 assistants" labels={["Lead", "Assistant 1", "Assistant 2"]} values={[leadSplit3, asst1Split3, asst2Split3]}
                  onChange={(i, v) => [setLeadSplit3, setAsst1Split3, setAsst2Split3][i](v)} />
              </div>
            </Card>

            <SaveBar
              label="Save pay rules"
              pending={updateSettingsMutation.isPending}
              disabled={!splitsOk}
              note={splitsOk ? undefined : "Shared service splits must add up to 100%."}
              onSave={() => updateSettingsMutation.mutate({
                defaultPaymentMethod, commissionType, commissionFixedAmount, commissionFormula,
                activeDayTransport, passiveDayTransport, commissionRate: commissionRate / 100, fixedBaseAmount,
                leaveDayRate, payLeaveDays, holidayDayRate, payHolidayDays, offDayRate, payOffDays,
                leadSplit2, asstSplit2, leadSplit3, asst1Split3, asst2Split3,
              })}
            />
          </div>
          <aside>{estimate}</aside>
        </div>
      </div>

      {/* LOYALTY */}
      <div id="sd-loyalty" className={show("loyalty")}>
        {sectionHead("Loyalty points", `How ${currentStore.name} customers earn and spend points.`)}
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="loyaltyPointsPerCurrency">Customers earn 1 point for every</Label>
              <Money id="loyaltyPointsPerCurrency" value={loyaltyPointsPerCurrency} onChange={(n) => setLoyaltyPointsPerCurrency(Math.max(1, Math.floor(n) || 1))} suffix="spent" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loyaltyPointValue">Each point is worth</Label>
              <Money id="loyaltyPointValue" value={loyaltyPointValue} onChange={(n) => setLoyaltyPointValue(Math.max(0, n))} suffix="off" />
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 p-4">
            <p className="text-2xl font-bold">{pctLabel}% <span className="text-base font-semibold">back on everything customers buy</span></p>
            <p className="text-sm text-muted-foreground">Customers get back {money(loyaltyPointValue)} for every {money(loyaltyPointsPerCurrency)} they spend.</p>
            <p className="text-sm text-muted-foreground">A {money(3500)} sale earns {Math.floor(3500 / loyaltyPointsPerCurrency)} points, worth {money(Math.floor(3500 / loyaltyPointsPerCurrency) * loyaltyPointValue)} off a later visit.</p>
          </div>
          {pointPct > 5 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              That is a generous rate. If you meant 1 point per {money(loyaltyPointsPerCurrency)} worth {money(1)}, set the value to {money(1)} ({(100 / loyaltyPointsPerCurrency).toFixed(0)}% back).
            </p>
          )}
        </Card>
        <SaveBar
          label="Save loyalty settings"
          pending={updateSettingsMutation.isPending}
          onSave={() => updateSettingsMutation.mutate({ loyaltyPointsPerCurrency, loyaltyPointValue })}
        />
      </div>
    </div>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted && "text-muted-foreground")}>
      <dt className={muted ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("shrink-0", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
