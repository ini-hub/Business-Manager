/** Days worked, by kind, behind the attendance pay. Reads the snapshot taken at calculation. */
export function PayrollAttendanceCard({
  entry, periodDays,
}: {
  entry: { activeDays?: number; passiveDays?: number; calculationDetails?: any } | null | undefined;
  periodDays: number | null;
}) {
  if (!entry) return null;
  const d = entry.calculationDetails ?? {};
  const tiles = [
    { label: "Active", days: entry.activeDays ?? d.activeDays ?? 0, sub: "Present with services", tone: "text-emerald-700 dark:text-emerald-400" },
    { label: "Passive", days: entry.passiveDays ?? d.passiveDays ?? 0, sub: "Present, no service", tone: "text-amber-700 dark:text-amber-400" },
    { label: "Off", days: d.offDays ?? 0, sub: d.payOffDays === false || d.offDayPay === 0 ? "Unpaid" : "Off days", tone: "" },
    { label: "Leave and holiday", days: (d.leaveDays ?? 0) + (d.holidayDays ?? 0), sub: "Taken", tone: "" },
  ];
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Attendance</h2>
        {periodDays != null && <span className="text-xs text-muted-foreground">{periodDays} days in period</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${t.tone}`}>{t.days} day{t.days === 1 ? "" : "s"}</p>
            <p className="text-xs text-muted-foreground">{t.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
