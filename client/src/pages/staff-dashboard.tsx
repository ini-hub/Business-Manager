import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  CalendarCheck,
  CalendarDays,
  TrendingUp,
  Clock,
  ChevronRight,
  Bus,
  Plus,
  Receipt,
  ShieldCheck,
  Trophy,
  Flame,
} from "lucide-react";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { commissionHeadline } from "@shared/commission-explainer";
import { MetricGrid } from "@/components/metric-grid";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { ClockInCard } from "@/components/clock-in-card";
import { Link } from "wouter";

export default function StaffDashboard() {
  const { user } = useAuth();
  const { currentStore } = useStore();
  const currency = currentStore?.currency || "NGN";

  // storeId matters here, not just for reads: the same login can be linked to
  // a staff row in more than one store, so it disambiguates which one's
  // payroll is being asked for — see getStaffByUserId server-side.
  const { data: summary, isLoading: isSummaryLoading } = useQuery<any>({
    queryKey: ["/api/payroll/my-summary", currentStore?.id],
    enabled: !!user && !!currentStore?.id,
  });

  const { data: history = [], isLoading: isHistoryLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll/my-history", currentStore?.id],
    enabled: !!user && !!currentStore?.id,
  });

  const { data: bookingsData, isLoading: isBookingsLoading } = useQuery<any>({
    queryKey: ["/api/bookings", currentStore?.id, "upcoming"],
    queryFn: async () => {
      const res = await fetch(`/api/bookings?storeId=${currentStore?.id}&status=confirmed,in_progress`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: !!user && !!currentStore?.id,
  });
  const upcomingBookings = bookingsData?.data || [];

  const { data: gamification } = useQuery<any>({
    queryKey: ["/api/gamification/me", currentStore?.id],
    enabled: !!user && !!currentStore?.id,
  });

  const formatCurrency = (val: number) => formatCurrencyUtil(val, currency);
  
  if (isSummaryLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-40 w-full" /><MetricGrid><Skeleton className="h-24 sm:h-32" /><Skeleton className="h-24 sm:h-32" /></MetricGrid></div>;
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user?.name || user?.email?.split("@")[0] || "Staff";
  const hasPeriod = !!summary?.period;
  const takeHome = summary?.takeHomePay ?? summary?.earnings ?? 0;
  const present = summary?.attendance?.present || 0;
  const workingDays = summary?.attendance?.workingDays ?? summary?.attendance?.total ?? 0;

  const accountRows = [
    { label: "My payroll details", href: "/staff/payroll", desktopOnly: false },
    { label: "Bank account for salary", href: "/staff/hr-profile", desktopOnly: true },
    { label: "Profile and password", href: "/profile", desktopOnly: false },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <span className="md:hidden">{format(now, "EEEE, d MMMM")}</span>
            <span className="hidden md:inline">{format(now, "EEEE, d MMMM yyyy")}</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl" data-testid="text-greeting">
            {greeting}, {name}
          </h1>
        </div>
        <div className="hidden gap-2 md:flex">
          <Button variant="outline" asChild>
            <Link href="/staff/attendance"><CalendarDays className="mr-2 h-4 w-4" /> Attendance log</Link>
          </Button>
          <Button asChild>
            <Link href="/sales/new"><Plus className="mr-2 h-4 w-4" /> New sale</Link>
          </Button>
        </div>
      </div>

      <ClockInCard variant="hero" />

      {/* This pay period */}
      <section className="space-y-3">
        <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between">
          <h2 className="text-base font-semibold">This pay period</h2>
          <p className="text-xs text-muted-foreground md:text-sm">
            {hasPeriod ? summary.period.label : (
              <>
                <span className="md:hidden">No pay period open yet</span>
                <span className="hidden md:inline">No pay period is open yet. Figures update once your manager starts one.</span>
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4">
          {/* Take-home, not gross: showing the pre-deduction figure here made
              staff expect more than they were handed on payday. */}
          <Link
            href={summary?.period?.id ? `/staff/payroll/${summary.period.id}` : "/staff/payroll"}
            className="col-span-3 rounded-xl bg-primary p-4 text-primary-foreground md:col-span-1 md:p-5"
            data-testid="card-take-home"
          >
            <div className="flex items-start justify-between">
              <p className="text-xs opacity-80 md:text-sm">Est. take-home pay</p>
              <Wallet className="hidden h-4 w-4 opacity-70 md:block" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold md:text-2xl">{formatCurrency(takeHome)}</p>
            <p className="mt-2 text-xs opacity-80">
              {(summary?.deductionsTotal ?? 0) > 0
                ? `Gross ${formatCurrency(summary.grossPay)} − deductions ${formatCurrency(summary.deductionsTotal)}`
                : "Salary + commission + allowance"}
            </p>
          </Link>

          <div className="rounded-xl border bg-card p-3 md:p-5" data-testid="card-commission">
            <div className="flex items-start justify-between">
              <p className="text-xs text-muted-foreground md:text-sm">
                <span className="md:hidden">Commission</span>
                <span className="hidden md:inline">Commission earned</span>
              </p>
              <TrendingUp className="hidden h-4 w-4 text-muted-foreground md:block" />
            </div>
            <p className="mt-2 font-mono text-sm font-bold md:text-2xl">{formatCurrency(summary?.commission || 0)}</p>
            {/* A zero here is usually correct — transport already paid is an
                advance against commission — but only if it says so. */}
            <p className="mt-2 hidden text-xs text-muted-foreground md:block">
              {summary?.commissionExplanation
                ? commissionHeadline(summary.commissionExplanation, formatCurrency)
                : `${summary?.servicesCount ?? 0} services rendered`}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-3 md:p-5" data-testid="card-transport">
            <div className="flex items-start justify-between">
              <p className="text-xs text-muted-foreground md:text-sm">
                <span className="md:hidden">Transport</span>
                <span className="hidden md:inline">Transport allowance</span>
              </p>
              <Bus className="hidden h-4 w-4 text-muted-foreground md:block" />
            </div>
            <p className="mt-2 font-mono text-sm font-bold md:text-2xl">{formatCurrency(summary?.transport || 0)}</p>
            <p className="mt-2 hidden text-xs text-muted-foreground md:block">Paid per present day</p>
          </div>

          <div className="rounded-xl border bg-card p-3 md:p-5" data-testid="card-days-present">
            <div className="flex items-start justify-between">
              <p className="text-xs text-muted-foreground md:text-sm">Days present</p>
              <CalendarCheck className="hidden h-4 w-4 text-muted-foreground md:block" />
            </div>
            <p className="mt-2 font-mono text-sm font-bold md:text-2xl">
              {present}
              <span className="ml-2 hidden font-sans text-sm font-normal text-muted-foreground md:inline">of {workingDays} working days</span>
            </p>
            <p className="mt-2 hidden text-xs text-muted-foreground md:block">{summary?.attendance?.absent || 0} absences</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        {/* Payment History */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Payment history</CardTitle>
              <CardDescription className="hidden md:block">Salaries paid to you</CardDescription>
            </div>
            <Link href="/staff/payroll" className="text-sm font-semibold text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                </span>
                <p className="text-sm font-semibold">No payments yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Your payslips will appear here after your first payroll run.</p>
              </div>
            ) : (
              <div className="divide-y">
                {history.map((item: any) => (
                  <Link key={item.id} href={`/staff/payroll/${item.id}`}>
                    <div className="py-4 flex items-center justify-between group hover:bg-muted/50 transition-colors px-2 rounded-lg cursor-pointer">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{item.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(parseISO(item.startDate), "MMM d")} - {format(parseISO(item.endDate), "MMM d, yyyy")}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          {/* What was actually paid out on the day. */}
                          <div className="font-bold text-sm">{formatCurrency(item.takeHomePay ?? item.netPay)}</div>
                          {(item.deductionsTotal ?? 0) > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              gross {formatCurrency(item.grossPay ?? item.netPay)} − {formatCurrency(item.deductionsTotal)}
                            </div>
                          )}
                          <span className="text-[10px] text-green-600 font-medium">PAID</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Your account */}
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 md:h-11 md:w-11">
                  <ShieldCheck className="h-4 w-4 text-green-700" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Verified account</p>
                  <p className="hidden text-xs text-muted-foreground md:block">Login active</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-green-700 md:hidden">Active</span>
            </div>
            {accountRows.map((row) => (
              <Link
                key={row.href}
                href={row.href}
                className={"items-center justify-between border-t py-3 text-sm " + (row.desktopOnly ? "hidden md:flex" : "flex")}
              >
                {row.label}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Kept from the previous dashboard, below the redesigned sections. */}
      <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                My Achievements
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                <Link href="/leaderboard">Leaderboard</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Points</span>
                <span className="font-bold text-sm">{gamification?.points ?? 0}</span>
              </div>
              {gamification?.streak?.currentCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-orange-600">
                  <Flame className="h-3.5 w-3.5" />
                  {gamification.streak.currentCount} on-time shifts in a row
                </div>
              )}
              {gamification?.badges?.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {gamification.badges.map((b: any) => (
                    <Badge key={b.key} variant="secondary" className="text-[10px]" title={b.description}>
                      {b.label}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No badges yet — keep selling and stay on time to earn your first one.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <Clock className="h-6 w-6 mx-auto text-muted-foreground opacity-50" />
                <h4 className="text-xs font-semibold">Shift Schedule</h4>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Your shifts are managed by the store manager. Please contact them for schedule changes.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Bookings */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                Upcoming Bookings
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                <Link href="/bookings">View All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isBookingsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : upcomingBookings.length === 0 ? (
                <div className="text-center py-4 border rounded bg-muted/20 border-dashed">
                  <p className="text-xs text-muted-foreground">No upcoming bookings assigned.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingBookings.slice(0, 3).map((booking: any) => (
                    <div key={booking.id} className="flex items-center justify-between p-3 border rounded-md bg-card">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{booking.customer?.name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(booking.scheduledAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                      <Badge variant="secondary" className="capitalize text-[10px]">
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
      </div>
    </div>
  );
}
