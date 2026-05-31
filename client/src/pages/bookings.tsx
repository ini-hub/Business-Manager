import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  isToday,
  parseISO
} from "date-fns";
import { Plus, Calendar, List as ListIcon, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { DataTable } from "@/components/data-table";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";

export default function BookingsPage() {
  const { currentStore, stores } = useStore();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ data: any[], pagination: any }>({
    queryKey: ["/api/bookings", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/bookings?storeId=${s.id}&limit=1000`);
              if (!res.ok) return { data: [], pagination: {} };
              const payload = await res.json() as { data: any[], pagination: any };
              const list = payload.data || [];
              return list.map((item: any) => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        const mergedList = responses.flat().sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
        return { data: mergedList, pagination: {} };
      }
      const res = await fetch(`/api/bookings?storeId=${currentStore!.id}&limit=1000`);
      if (!res.ok) throw new Error("Failed to fetch bookings");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400";
      case "confirmed": return "bg-blue-500/20 text-blue-700 dark:text-blue-400";
      case "in_progress": return "bg-purple-500/20 text-purple-700 dark:text-purple-400";
      case "completed": return "bg-green-500/20 text-green-700 dark:text-green-400";
      case "cancelled": return "bg-red-500/20 text-red-700 dark:text-red-400";
      case "no_show": return "bg-orange-500/20 text-orange-700 dark:text-orange-400";
      case "rescheduled": return "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400";
      default: return "bg-gray-500/20 text-gray-700 dark:text-gray-400";
    }
  };

  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (booking: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {booking.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "bookingRef",
      header: "Reference",
      render: (booking: any) => (
        <span className="font-semibold text-foreground">
          {booking.bookingRef}
        </span>
      ),
    },
    {
      key: "typeLabel",
      header: "Type",
      render: (booking: any) => (
        <span className="capitalize">{booking.type}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      render: (booking: any) => {
        const presenter = new CustomerPresenter({
          name: booking.customer?.name,
          customerNumber: booking.customer?.customerNumber || booking.customerId || "—",
          mobileNumber: booking.customer?.mobileNumber,
        });
        return <EntityDisplay presenter={presenter} />;
      },
    },
    {
      key: "scheduledAt",
      header: "Date & Time",
      render: (booking: any) => (
        <div className="flex flex-col">
          <span>{format(new Date(booking.scheduledAt), "MMM d, yyyy")}</span>
          <span className="text-xs text-muted-foreground">{format(new Date(booking.scheduledAt), "h:mm a")}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (booking: any) => (
        <Badge variant="secondary" className={`capitalize font-medium ${getStatusColor(booking.status)} hover:opacity-80`}>
          {booking.status.replace("_", " ")}
        </Badge>
      ),
    },
  ];

  const tableData = (data?.data || []).map((booking: any) => ({
    ...booking,
    customerName: booking.customer?.name || "Unknown",
    typeLabel: booking.type.charAt(0).toUpperCase() + booking.type.slice(1),
    statusLabel: booking.status.replace("_", " ").split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  }));

  const filterConfigs = [
    { key: "typeLabel", label: "Type", type: "select" as const },
    { key: "statusLabel", label: "Status", type: "select" as const },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader 
          title="Bookings & Appointments"
          description="Manage service appointments and product advance orders."
        />
        <Button asChild className="shrink-0 shadow-sm hover:shadow transition-all">
          <Link href="/bookings/new">
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Link>
        </Button>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-medium">Bookings Ledger</CardTitle>
          <Tabs value={view} onValueChange={(v) => setView(v as "list" | "calendar")} className="w-full sm:w-auto">
            <TabsList className="w-full sm:w-auto grid grid-cols-2">
              <TabsTrigger value="list" className="gap-2">
                <ListIcon className="h-4 w-4" />
                <span>List</span>
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-2">
                <Calendar className="h-4 w-4" />
                <span>Calendar</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {view === "list" ? (
            <DataTable
              data={tableData}
              columns={columns}
              searchable
              searchPlaceholder="Search reference, customer, or notes..."
              searchKeys={["bookingRef", "customerName", "notes"]}
              isLoading={isLoading}
              emptyTitle="No Bookings Yet"
              emptyMessage="Schedule your first appointment or order to start managing bookings."
              emptyIcon={<CalendarDays className="h-6 w-6" />}
              emptyAction={
                <Link href="/bookings/new">
                  <Button size="sm" className="gap-2"><Plus className="h-4 w-4" />New Booking</Button>
                </Link>
              }
              filterConfigs={filterConfigs}
              onRowClick={(booking) => setLocation(`/bookings/${booking.id}`)}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{format(currentDate, "MMMM yyyy")}</h2>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-px bg-muted rounded-xl overflow-hidden border border-border">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                  <div key={day} className="bg-muted/50 p-2 text-center text-sm font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
                {eachDayOfInterval({
                  start: startOfWeek(startOfMonth(currentDate)),
                  end: endOfWeek(endOfMonth(currentDate))
                }).map((day, i) => {
                  const dayBookings = (data?.data || []).filter((b: any) => isSameDay(parseISO(b.scheduledAt), day));
                  return (
                    <div 
                      key={i} 
                      className={`min-h-[100px] bg-background p-2 transition-colors ${!isSameMonth(day, currentDate) ? 'opacity-50 bg-muted/20' : ''} ${isToday(day) ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-primary text-primary-foreground' : ''}`}>
                          {format(day, "d")}
                        </span>
                        {dayBookings.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 h-5">{dayBookings.length}</Badge>
                        )}
                      </div>
                      <div className="space-y-1">
                        {dayBookings.slice(0, 3).map((booking: any) => (
                          <div 
                            key={booking.id} 
                            onClick={() => setLocation(`/bookings/${booking.id}`)}
                            className={`text-[10px] p-1 rounded truncate cursor-pointer hover:opacity-80 transition-opacity ${getStatusColor(booking.status)}`}
                            title={`${booking.customer?.name} - ${booking.bookingRef}`}
                          >
                            {format(parseISO(booking.scheduledAt), "HH:mm")} • {booking.customer?.name || booking.bookingRef}
                          </div>
                        ))}
                        {dayBookings.length > 3 && (
                          <div className="text-[10px] text-muted-foreground text-center font-medium">
                            +{dayBookings.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

