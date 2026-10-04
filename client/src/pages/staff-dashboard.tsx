import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ShoppingCart,
  ShieldCheck,
  Trophy,
  Flame,
} from "lucide-react";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { ClockInCard } from "@/components/clock-in-card";
import { Link } from "wouter";
import { useAttendanceTracked } from "@/hooks/useAttendanceTracked";

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

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/payroll/my-history", currentStore?.id],
    enabled: !!user && !!currentStore?.id,
  });

  const { data: bookingsData, isLoading: isBookingsLoading } = useQuery<any>({
    queryKey: ["/api/bookings", currentStore?.id, "upcoming"],
    queryFn: async () => {
      const res = await fetch(`/api/bookings?storeId=${currentStore?.id}&status=pending,confirmed,in_progress&limit=100`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: !!user && !!currentStore?.id,
  });
  const upcomingBookings = ((bookingsData?.data || []) as any[])
    .filter((b) => new Date(b.scheduledAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const { data: gamification } = useQuery<any>({
    queryKey: ["/api/gamification/me", currentStore?.id],
    enabled: !!user && !!currentStore?.id,
  });

  const { tracked: attendanceTracked } = useAttendanceTracked();

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
  const lastPaid = [...history].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())[0];

  const accountRows = [
    { label: "Bank account for salary", href: "/staff/hr-profile", desktopOnly: true },
    { label: "Profile and password", href: "/profile", desktopOnly: false },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Greeting */}
      <div>
        <p className="text-sm text-muted-foreground">
          <span className="md:hidden">{format(now, "EEEE, d MMMM")}</span>
          <span className="hidden md:inline">{format(now, "EEEE, d MMMM yyyy")}</span>
        </p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl" data-testid="text-greeting">
          {greeting}, {name}
        </h1>
      </div>

      <ClockInCard variant="hero" />

      {/* What a shift is made of: selling, bookings, and the attendance record. */}
      <div className={"grid gap-3 md:gap-4 " + (attendanceTracked ? "grid-cols-3" : "grid-cols-2")} data-testid="quick-actions">
        <Link
          href="/sales/new"
          className="flex flex-col justify-between gap-6 rounded-xl bg-primary p-3 text-primary-foreground md:flex-row md:items-center md:gap-3 md:p-5"
          data-testid="action-new-sale"
        >
          <ShoppingCart className="h-5 w-5" />
          <div>
            <p className="text-sm font-semibold md:text-base">New sale</p>
            <p className="hidden text-xs opacity-80 md:block">Ring up a customer</p>
          </div>
        </Link>
        <Link
          href="/bookings"
          className="flex flex-col justify-between gap-6 rounded-xl border bg-card p-3 hover:bg-muted/50 md:flex-row md:items-center md:gap-3 md:p-5"
          data-testid="action-bookings"
        >
          <CalendarCheck className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold md:text-base">Bookings</p>
            <p className="text-xs text-muted-foreground">
              {isBookingsLoading ? "…" : `${upcomingBookings.length} upcoming`}
            </p>
          </div>
        </Link>
        {attendanceTracked && <Link
          href="/staff/attendance"
          className="flex flex-col justify-between gap-6 rounded-xl border bg-card p-3 hover:bg-muted/50 md:flex-row md:items-center md:gap-3 md:p-5"
          data-testid="action-attendance"
        >
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold md:text-base">Attendance</p>
            <p className="text-xs text-muted-foreground">
              {hasPeriod ? `${present} of ${workingDays} days` : "View log"}
            </p>
          </div>
        </Link>}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        {/* Upcoming bookings */}
        <Card className="self-start">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Upcoming bookings</CardTitle>
              <CardDescription className="hidden md:block">Next up first</CardDescription>
            </div>
            <Link href="/bookings" className="text-sm font-semibold text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {isBookingsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : upcomingBookings.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <CalendarCheck className="h-5 w-5 text-muted-foreground" />
                </span>
                <p className="text-sm font-semibold">No upcoming bookings</p>
                <p className="mt-1 text-sm text-muted-foreground">New bookings will show up here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingBookings.slice(0, 5).map((booking: any, i: number) => (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <div
                      className={"flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 " + (i === 0 ? "border-primary/40 bg-primary/5" : "bg-card")}
                      data-testid={`row-booking-${booking.id}`}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold">{booking.customer?.name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(booking.scheduledAt), "EEE d MMM, h:mm a")}
                        </span>
                      </div>
                      <Badge variant="secondary" className="shrink-0 capitalize text-[10px]">
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 self-start">
          {/* Pay is a door into the payroll module, not the point of the page. */}
          <Card data-testid="card-pay">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-muted-foreground" /> Pay
              </CardTitle>
              <Link href="/staff/payroll" className="text-sm font-semibold text-primary hover:underline" data-testid="link-payment-history">
                Payment history
              </Link>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3" data-testid="card-take-home">
                <span className="text-muted-foreground">{hasPeriod ? "Est. this period" : "No open period"}</span>
                {hasPeriod && <span className="font-mono font-semibold">{formatCurrency(takeHome)}</span>}
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Last paid</span>
                <span className="font-mono font-semibold">
                  {lastPaid ? formatCurrency(lastPaid.takeHomePay ?? lastPaid.netPay) : "—"}
                </span>
              </div>
              {lastPaid?.paidAt && (
                <p className="text-right text-xs text-muted-foreground">{format(new Date(lastPaid.paidAt), "d MMM yyyy")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 text-amber-500" /> Achievements
              </CardTitle>
              <Link href="/leaderboard" className="text-sm font-semibold text-primary hover:underline">Leaderboard</Link>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Points</span>
                <span className="font-bold">{gamification?.points ?? 0}</span>
              </div>
              {gamification?.streak?.currentCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-orange-600">
                  <Flame className="h-3.5 w-3.5" />
                  {gamification.streak.currentCount} on-time shifts in a row
                </div>
              )}
              {gamification?.badges?.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {gamification.badges.map((b: any) => (
                    <Badge key={b.key} variant="secondary" className="text-[10px]" title={b.description}>
                      {b.label}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No badges yet — keep selling and stay on time to earn your first one.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1 pt-4">
              <div className="flex items-center gap-3 pb-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100">
                  <ShieldCheck className="h-4 w-4 text-green-700" />
                </span>
                <p className="text-sm font-semibold">Verified account</p>
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
      </div>
    </div>
  );
}
