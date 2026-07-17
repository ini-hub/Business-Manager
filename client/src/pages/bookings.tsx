import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Plus, Calendar, List as ListIcon, CalendarDays, CheckCircle, XCircle, CalendarCheck2, CalendarX2 } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { MetricCard } from "@/components/metric-card";
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
import { useAuth } from "@/hooks/useAuth";
import { DataTable } from "@/components/data-table";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { BulkOperations } from "@/components/bulk-operations";
import { BOOKING_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getStatusColor } from "@/lib/booking-status";
import { BookingCalendarView } from "@/components/booking-calendar/BookingCalendarView";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";

export default function BookingsPage() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [, setLocation] = useLocation();
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "issues">("all");
  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";
  const ISSUE_STATUSES = ["no_show", "cancelled", "rescheduled"];

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

  const totalBookingsCount = tableData.length;
  const completedBookingsCount = tableData.filter((b: any) => b.status === "completed").length;
  const issueBookingsCount = tableData.filter((b: any) => ISSUE_STATUSES.includes(b.status)).length;

  const filteredTableData = tableData.filter((b: any) => {
    if (statusFilter === "completed") return b.status === "completed";
    if (statusFilter === "issues") return ISSUE_STATUSES.includes(b.status);
    return true;
  });

  const filterConfigs: TableFilterConfig[] = [
    { key: "typeLabel", label: "Type", type: "select" },
    { key: "statusLabel", label: "Status", type: "select" },
    { key: "scheduledAt", label: "Appointment Date", type: "date-range" },
  ];

  const exportColumns = [
    { key: "bookingRef", header: "Reference" },
    { key: "typeLabel", header: "Type" },
    { key: "customerName", header: "Customer" },
    { key: "scheduledAt", header: "Date & Time" },
    { key: "statusLabel", header: "Status" },
    { key: "totalPrice", header: "Total Price" },
  ];

  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/bookings/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      setSelectedIds([]);
      const cancelled = counts.cancelled ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${cancelled} booking${cancelled !== 1 ? "s" : ""} cancelled` }
          : { title: `${cancelled} cancelled, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk cancel failed", variant: "destructive" }),
  });

  const bulkConfirmMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/bookings/${id}/status`, { status: "confirmed" });
        if (!res.ok) throw new Error("confirm failed");
        return "confirmed" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      setSelectedIds([]);
      const confirmed = counts.confirmed ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${confirmed} booking${confirmed !== 1 ? "s" : ""} confirmed` }
          : { title: `${confirmed} confirmed, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk confirm failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Bookings & Appointments"
          description="Manage service appointments and product advance orders."
        />
        <div className="flex items-center gap-2">
          <BulkOperations
            entityConfig={BOOKING_BULK_CONFIG}
            data={tableData as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            isLoading={isLoading}
            storeId={currentStore?.id}
            pdfTitle="Bookings Report"
            showImportOption={isManagerOrOwner}
          />
          <Button asChild className="shrink-0 shadow-sm hover:shadow transition-all">
            <Link href="/bookings/new">
              <Plus className="mr-2 h-4 w-4" />
              New Booking
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          title="Total Bookings"
          value={totalBookingsCount}
          icon={<CalendarDays className="h-4 w-4" />}
          isLoading={isLoading}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <MetricCard
          title="Completed"
          value={completedBookingsCount}
          icon={<CalendarCheck2 className="h-4 w-4" />}
          isLoading={isLoading}
          active={statusFilter === "completed"}
          onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
        />
        <MetricCard
          title="No Show + Cancelled + Rescheduled"
          value={issueBookingsCount}
          icon={<CalendarX2 className="h-4 w-4" />}
          isLoading={isLoading}
          active={statusFilter === "issues"}
          onClick={() => setStatusFilter(statusFilter === "issues" ? "all" : "issues")}
        />
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
            <div className="space-y-3">
              {isManagerOrOwner && (
                <BulkSelectionActionBar
                  count={selectedIds.length}
                  unitLabel="booking"
                  onClear={() => setSelectedIds([])}
                  actions={[
                    {
                      key: "confirm",
                      label: "Confirm Selected",
                      pendingLabel: "Confirming…",
                      icon: <CheckCircle className="h-3.5 w-3.5" />,
                      pending: bulkConfirmMutation.isPending,
                      onClick: () => bulkConfirmMutation.mutate(selectedIds as string[]),
                    },
                    {
                      key: "cancel",
                      label: "Cancel Selected",
                      pendingLabel: "Cancelling…",
                      icon: <XCircle className="h-3.5 w-3.5" />,
                      tone: "warning",
                      pending: bulkCancelMutation.isPending,
                      onClick: () => bulkCancelMutation.mutate(selectedIds as string[]),
                    },
                  ]}
                />
              )}
              <DataTable
                data={filteredTableData}
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
                multiselect={isManagerOrOwner}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
              />
            </div>
          ) : (
            <BookingCalendarView />
          )}
        </CardContent>
      </Card>

      <SpeedDialFAB
        actions={[
          {
            label: "New Booking",
            icon: <Calendar className="h-5 w-5" />,
            onClick: () => setLocation("/bookings/new"),
            testId: "fab-new-booking",
          },
        ]}
      />
    </div>
  );
}

