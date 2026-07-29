import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Wallet, 
  CalendarCheck, 
  TrendingUp, 
  Clock, 
  ChevronRight,
  UserCheck,
  UserX,
  History,
  AlertCircle
} from "lucide-react";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

export default function StaffDashboard() {
  const { user } = useAuth();
  const { currentStore } = useStore();
  const currency = currentStore?.currency || "NGN";

  const { data: summary, isLoading: isSummaryLoading } = useQuery<any>({
    queryKey: ["/api/payroll/my-summary"],
    enabled: !!user,
  });

  const { data: history = [], isLoading: isHistoryLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll/my-history"],
    enabled: !!user,
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

  const formatCurrency = (val: number) => formatCurrencyUtil(val, currency);
  const formatCompact = (val: number) => formatCurrencyCompact(val, currency);

  if (isSummaryLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-40 w-full" /><MetricGrid><Skeleton className="h-24 sm:h-32" /><Skeleton className="h-24 sm:h-32" /></MetricGrid></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title={`Welcome, ${user?.name || user?.email?.split('@')[0] || "Staff"}`} 
        description="Here's your performance and earnings summary"
      />

      {/* Current Earnings Overview */}
      <MetricGrid>
        <MetricCard
          title="Est. Net Pay"
          value={formatCurrency(summary?.earnings || 0)}
          compactValue={formatCompact(summary?.earnings || 0)}
          icon={<Wallet className="h-4 w-4 opacity-70" />}
          description={`Current Period: ${summary?.period?.label || "None"}`}
          className="bg-primary text-primary-foreground [&_p]:text-primary-foreground/70 [&_.text-muted-foreground]:text-primary-foreground/70"
        />
        <MetricCard
          title="Commission Earned"
          value={formatCurrency(summary?.commission || 0)}
          compactValue={formatCompact(summary?.commission || 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          description="From services & products"
        />
        <MetricCard
          title="Transport Allowance"
          value={formatCurrency(summary?.transport || 0)}
          compactValue={formatCompact(summary?.transport || 0)}
          icon={<Clock className="h-4 w-4" />}
          description="Based on present days"
        />
        <MetricCard
          title="Attendance (Present)"
          value={summary?.attendance?.present || 0}
          icon={<CalendarCheck className="h-4 w-4" />}
          description={`${summary?.attendance?.absent || 0} absent this period`}
        />
      </MetricGrid>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        {/* Payment History */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Payment History
                </CardTitle>
                <CardDescription>Records of your past paid salaries</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>No payment records found yet.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {history.map((item: any) => (
                    <div key={item.id} className="py-4 flex items-center justify-between group hover:bg-muted/50 transition-colors px-2 rounded-lg">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{item.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(parseISO(item.startDate), "MMM d")} - {format(parseISO(item.endDate), "MMM d, yyyy")}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-bold text-sm">{formatCurrency(item.netPay)}</div>
                          <span className="text-[10px] text-green-600 font-medium">PAID</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Links / Status */}
        <div className="space-y-6">
          <Card className="border-primary/20 shadow-sm overflow-hidden">
            <div className="h-1 bg-primary" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Account Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                  <UserCheck className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold">Verified Account</span>
                  <span className="text-[10px] text-muted-foreground">Login active</span>
                </div>
              </div>
              <Separator />
              <Button variant="outline" className="w-full justify-start text-xs h-9" asChild>
                <Link href="/profile">
                  <UserCheck className="mr-2 h-3 w-3" /> Edit Profile
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start text-xs h-9" asChild>
                <Link href="/profile#security">
                  <History className="mr-2 h-3 w-3" /> Security Settings
                </Link>
              </Button>
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
    </div>
  );
}
