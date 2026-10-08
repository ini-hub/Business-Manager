import { fetchAllPages } from "@/lib/paginated";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams, useSearch, Link } from "wouter";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import {
  ArrowLeft, AlertCircle, Mail, Phone, Building2, MoreVertical, Edit, Archive, RotateCcw, Send,
  Coins, CalendarCheck, ChevronRight, Wallet, Scissors, Package, FileSignature, Users, UserSquare2, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { StaffGamificationCard } from "@/components/gamification/StaffGamificationCard";
import { PersonalTab } from "@/components/hr/PersonalTab";
import { JobTab } from "@/components/hr/JobTab";
import { TimeOffTab } from "@/components/hr/TimeOffTab";
import { EmergencyContactsTab } from "@/components/hr/EmergencyContactsTab";
import { DocumentsTab } from "@/components/hr/DocumentsTab";
import { BenefitsTab } from "@/components/hr/BenefitsTab";
import { DisciplinaryTab } from "@/components/hr/DisciplinaryTab";
import { GuarantorTab } from "@/components/hr/GuarantorTab";
import { useStore } from "@/lib/store-context";
import { useHasPermission } from "@/lib/permissions";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { useReturnTo, appendReturnTo } from "@/lib/return-to";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency-utils";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { getCustomerInitials, formatRelativeDate } from "@/lib/customer-detail-utils";
import { cn } from "@/lib/utils";
import type { Staff, StaffContractStatus, StaffInviteStatus } from "@shared/schema";

type StaffDetail = Staff & { inviteStatus?: StaffInviteStatus; contractStatus?: StaffContractStatus };
type BreakdownEntry = { inventoryName: string; receiptNumber: string | null; transactionId: string | null; date: string; revenue: number; role: string; quantity?: number };
type AttendanceRow = { id: string; date: string; status: string; isLate: boolean; lateMinutes: number | null; firstClockInAt: string | null; lastClockOutAt: string | null; notes: string | null };
type PayrollPeriod = { id: string; periodType: string; startDate: string; endDate: string; status: string };
type Advance = { id: string; amount: number; date: string; outstandingBalance: number; status: string; recoveryStatus: string; notes: string | null };
type ContractDetail = {
  contractStatus: StaffContractStatus;
  contractType?: string;
  contentText?: string;
  fileOriginalName?: string;
  signedGetUrl?: string;
  declinedReason?: string;
  signature?: { typedFullName: string; signedAt: string; ipAddress: string };
};
interface SectionConfig { section: string; isEnabled: boolean }

const HR_TABS = [
  { section: "personal", label: "Personal" },
  { section: "job", label: "Job" },
  { section: "time_off", label: "Time Off" },
  { section: "emergency", label: "Emergency" },
  { section: "documents", label: "Documents" },
  { section: "benefits", label: "Benefits" },
  { section: "disciplinary", label: "Disciplinary" },
  { section: "guarantor", label: "Guarantor" },
] as const;

const contractLabel: Record<string, string> = {
  signed: "Contract signed",
  pending_signature: "Awaiting signature",
  declined: "Contract declined",
  none: "No contract",
};

function RowsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

function EmptyRows({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
      {icon}
      {message}
    </div>
  );
}

export default function StaffDetails({ view = "overview" }: { view?: "overview" | "logs" }) {
  const isLogs = view === "logs";
  const { id: staffId } = useParams<{ id: string }>();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { backHref } = useReturnTo("/staffs");
  const { currentStore } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission: canManageHr } = useHasPermission("Staff & Payroll");
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);

  const tabParam = new URLSearchParams(search).get("tab") || "sales";
  const setTab = (tab: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", tab);
    setLocation(`${location}?${params.toString()}`, { replace: true });
  };

  const { data: staff, isLoading: staffLoading } = useQuery<StaffDetail>({
    queryKey: [`/api/staff/${staffId}`],
    enabled: !!staffId,
  });
  // The staff member's own branch decides every sub-query, not the (possibly "all") selected store.
  const storeId = staff?.storeId;
  const currency = currentStore?.currency || "NGN";

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "staff_details_date_range",
    () =>
      readPersistedRange("staff_details_date_range") ?? {
        from: startOfDay(subDays(new Date(), 29)),
        to: endOfDay(new Date()),
      },
  );
  // "All time" leaves a bound undefined: fall back to a wide window the endpoints require.
  const rangeFrom = format(dateRange.from ?? new Date(2000, 0, 1), "yyyy-MM-dd");
  const rangeTo = format(dateRange.to ?? new Date(), "yyyy-MM-dd");

  const { data: breakdown, isLoading: salesLoading } = useQuery<{ services: BreakdownEntry[]; products: BreakdownEntry[] }>({
    queryKey: ["/api/reports/staff-performance", staffId, "breakdown", storeId, rangeFrom, rangeTo],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/staff-performance/${staffId}/breakdown?storeId=${storeId}&startDate=${rangeFrom}&endDate=${rangeTo}`);
      return res.json();
    },
    enabled: !!staffId && !!storeId,
  });

  const { data: attendance = [], isLoading: attendanceLoading } = useQuery<AttendanceRow[]>({
    // Whole attendance history: the tab is a month-by-month summary and its counts are lifetime totals, so the date filter doesn't apply.
    queryKey: ["/api/attendance", staffId, storeId],
    queryFn: () => fetchAllPages<AttendanceRow>(`/api/attendance?storeId=${storeId}&staffId=${staffId}`),
    enabled: !!staffId && !!storeId,
  });

  const { data: periods = [], isLoading: periodsLoading } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", storeId],
    queryFn: async () => (await apiRequest("GET", `/api/payroll/periods?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const { data: advances = [], isLoading: advancesLoading } = useQuery<Advance[]>({
    queryKey: ["/api/payroll/advances", storeId, staffId],
    queryFn: () => fetchAllPages<Advance>(`/api/payroll/advances?storeId=${storeId}&staffId=${staffId}`),
    enabled: !!storeId && !!staffId,
  });

  const { data: contract, isLoading: contractLoading } = useQuery<ContractDetail>({
    queryKey: [`/api/staff/${staffId}/contract`],
    enabled: !!staffId,
  });

  const { data: hrSections = [] } = useQuery<SectionConfig[]>({
    queryKey: ["/api/hr/sections"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/sections")).json(),
  });
  const hrEnabled = (section: string) => hrSections.find((s) => s.section === section)?.isEnabled ?? true;

  const invalidateStaff = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/staff/${staffId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
  };

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/staff/${staffId}`),
    onSuccess: () => {
      invalidateStaff();
      toast({ title: "Staff member archived successfully" });
      setIsArchiveConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Archive Staff Member", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/staff/${staffId}/restore`),
    onSuccess: () => {
      invalidateStaff();
      toast({ title: "Staff member restored successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Restore Staff Member", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/staff/${staffId}/resend-invite`),
    onSuccess: () => {
      invalidateStaff();
      toast({ title: "Invite re-sent", description: `A fresh activation code is on its way to ${staff?.email}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Resend Invite", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const sales = useMemo(() => {
    const lines = [...(breakdown?.services ?? []), ...(breakdown?.products ?? [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { lines, total: lines.reduce((sum, l) => sum + (l.revenue ?? 0), 0) };
  }, [breakdown]);

  const attendanceByMonth = useMemo(() => {
    const byMonth = new Map<string, { key: string; present: number; absent: number; late: number }>();
    for (const a of attendance) {
      const key = a.date.slice(0, 7);
      const m = byMonth.get(key) ?? { key, present: 0, absent: 0, late: 0 };
      if (a.status === "present") m.present++;
      if (a.status === "absent") m.absent++;
      if (a.isLate) m.late++;
      byMonth.set(key, m);
    }
    return Array.from(byMonth.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [attendance]);
  const presentDays = attendance.filter((a) => a.status === "present").length;
  const absentDays = attendance.filter((a) => a.status === "absent").length;
  const lateDays = attendance.filter((a) => a.isLate).length;
  const lastSeen = attendance
    .filter((a) => a.status === "present")
    .reduce<Date | null>((latest, a) => {
      const d = new Date(a.firstClockInAt ?? `${a.date}T00:00:00`);
      return !latest || d > latest ? d : latest;
    }, null);

  const backButton = (
    <Button variant="outline" onClick={() => setLocation(backHref)} data-testid="button-back">
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to Staff
    </Button>
  );

  if (staffLoading) {
    return (
      <div className="space-y-4 p-6">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff Details" description="View a staff member's profile and activity" compact actions={backButton} />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Staff member not found. They may have been deleted.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const hrTabItems: TabItem[] = HR_TABS
    .filter((t) => hrEnabled(t.section))
    .map((t) => ({ value: `hr-${t.section}`, label: t.label, icon: <UserSquare2 className="h-3.5 w-3.5" /> }));

  const detailTabItems: TabItem[] = [
    {
      value: "sales",
      label: "Sales",
      icon: <Scissors className="h-3.5 w-3.5" />,
      badge: sales.lines.length > 0 ? sales.lines.length : undefined,
    },
    {
      value: "attendance",
      label: "Attendance",
      icon: <CalendarCheck className="h-3.5 w-3.5 text-blue-500" />,
      badge: presentDays > 0 ? presentDays : undefined,
    },
    {
      value: "payroll",
      label: "Payroll",
      icon: <Wallet className="h-3.5 w-3.5 text-amber-500" />,
      badge: advances.length > 0 ? advances.length : undefined,
    },
    { value: "contract", label: "Contract", icon: <FileSignature className="h-3.5 w-3.5" /> },
    ...hrTabItems,
  ];
  const activeTab = detailTabItems.some((t) => t.value === tabParam) ? tabParam : "sales";

  const contractStatus = contract?.contractStatus ?? staff.contractStatus ?? "none";
  const fullName = staff.name || [staff.firstName, staff.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLocation(backHref)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          {isLogs ? fullName : "Staff"}
        </button>
        <div className="flex items-center gap-1">
        {!isLogs && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setLocation(appendReturnTo(`/staffs/${staff.id}/activity`, location, search))}
            data-testid="button-staff-logs"
          >
            <Users className="mr-2 h-4 w-4" />
            Logs & Activities
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Staff menu" aria-label="Staff menu" data-testid="button-staff-menu">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLocation(`/staffs/${staff.id}/edit`)} data-testid="menu-edit-staff">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {!staff.isArchived && staff.email && staff.inviteStatus && staff.inviteStatus !== "active" && (
              <DropdownMenuItem onClick={() => resendInviteMutation.mutate()} data-testid="menu-resend-invite">
                <Send className="mr-2 h-4 w-4" />
                Resend invite
              </DropdownMenuItem>
            )}
            {staff.isArchived ? (
              <DropdownMenuItem onClick={() => restoreMutation.mutate()} data-testid="menu-restore-staff">
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setIsArchiveConfirmOpen(true)}
                className="text-destructive focus:text-destructive"
                data-testid="menu-archive-staff"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-base font-semibold">
              {getCustomerInitials(fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight truncate">{fullName}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {staff.staffNumber} · <span className="capitalize">{staff.role || "Staff"}</span> · Joined{" "}
              {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(staff.createdAt))}
            </p>
          </div>
        </div>
        <Badge
          variant={staff.isArchived ? "secondary" : "default"}
          className={cn("shrink-0", !staff.isArchived && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300")}
        >
          {staff.isArchived ? "Archived" : "Active"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {staff.mobileNumber && (
          <span className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" />
            {formatPhoneDisplay(staff.mobileNumber, staff.countryCode || "")}
          </span>
        )}
        {staff.email && (
          <span className="flex items-center gap-2 min-w-0">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{staff.email}</span>
          </span>
        )}
        <span className="flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          {currentStore?.id === staff.storeId ? currentStore.name : "Assigned branch"}
        </span>
      </div>

      {!isLogs && (<>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{contractLabel[contractStatus] ?? contractStatus}</Badge>
        {staff.inviteStatus && staff.inviteStatus !== "none" && (
          <Badge variant="outline" className="capitalize">Account {staff.inviteStatus.replace(/_/g, " ")}</Badge>
        )}
        {staff.paymentMethod && <Badge variant="outline" className="capitalize">Paid by {staff.paymentMethod.replace(/_/g, " ")}</Badge>}
      </div>

      <MetricGrid>
        <MetricCard
          title="Sales handled"
          value={formatCurrency(sales.total, currency)}
          compactValue={formatCurrencyCompact(sales.total, currency)}
          icon={<Coins className="h-4 w-4" />}
        />
        <MetricCard title="Days present" value={presentDays} icon={<CalendarCheck className="h-4 w-4" />} />
        <MetricCard
          title="Pay per month"
          value={formatCurrency(staff.payPerMonth ?? 0, currency)}
          compactValue={formatCurrencyCompact(staff.payPerMonth ?? 0, currency)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Last seen"
          value={lastSeen ? formatRelativeDate(lastSeen) ?? "-" : "-"}
          icon={<ClipboardList className="h-4 w-4" />}
        />
      </MetricGrid>

      {storeId && <StaffGamificationCard storeId={storeId} staffId={staff.id} />}
      </>)}

      {isLogs && (
      <Card className="glassmorphism border border-border/80">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
            <Users className="h-4 w-4 text-primary" />
            Staff Logs & Activities
          </CardTitle>
          <div className="pt-2">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              defaultPreset="30days"
              timezone={currentStore?.timezone}
              compact
            />
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setTab} className="w-full">
            <PolymorphicTabsList tabs={detailTabItems} variant="default" className="mb-6" />

            <TabsContent value="sales" className="space-y-4">
              {salesLoading ? <RowsSkeleton /> : sales.lines.length === 0 ? (
                <EmptyRows icon={<Scissors className="h-6 w-6" />} message="No sales credited to this staff member in this period." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.lines.map((l, i) => (
                      <TableRow key={`${l.transactionId ?? l.receiptNumber ?? "line"}-${i}`}>
                        <TableCell className="whitespace-nowrap">{format(new Date(l.date), "dd MMM yyyy")}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            {l.quantity !== undefined && <Package className="h-3.5 w-3.5 text-muted-foreground" />}
                            {l.transactionId ? (
                              <Link href={appendReturnTo(`/transactions/${l.transactionId}`, location, search)} className="hover:underline">
                                {l.inventoryName}
                              </Link>
                            ) : l.inventoryName}
                            {l.quantity !== undefined && l.quantity > 1 && <span className="text-xs text-muted-foreground">x{l.quantity}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="capitalize">{l.role}</TableCell>
                        <TableCell className="text-right">{formatCurrency(l.revenue, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="attendance" className="space-y-4">
              {attendanceLoading ? <RowsSkeleton /> : attendance.length === 0 ? (
                <EmptyRows icon={<CalendarCheck className="h-6 w-6" />} message="No attendance recorded yet." />
              ) : (
                <>
                <p className="text-xs text-muted-foreground" data-testid="attendance-period-totals">
                  Total{attendance.length > 0 && <> since {format(new Date(`${attendance[0].date.slice(0, 10)}T00:00:00`), "dd MMM yyyy")}</>}:{" "}
                  <span className="font-medium text-foreground">{presentDays} present</span>, {absentDays} absent
                  {lateDays > 0 && <>, <span className="text-amber-600">{lateDays} late</span></>}
                </p>
                <div className="divide-y rounded-lg border">
                  {attendanceByMonth.map((m) => (
                    <Link
                      key={m.key}
                      href={`/staffs/attendance?view=monthly&month=${m.key}&staffId=${staff.id}`}
                      className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted/40"
                      data-testid={`link-attendance-month-${m.key}`}
                    >
                      <span className="font-medium">{format(new Date(`${m.key}-01T00:00:00`), "MMMM yyyy")}</span>
                      <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Present: {m.present}</span>
                        <span>Absent: {m.absent}</span>
                        {m.late > 0 && <span className="text-amber-600">Late: {m.late}</span>}
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </Link>
                  ))}
                </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="payroll" className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Pay periods</h3>
                {periodsLoading ? <RowsSkeleton /> : periods.length === 0 ? (
                  <EmptyRows icon={<Wallet className="h-6 w-6" />} message="No payroll periods yet." />
                ) : (
                  <div className="divide-y rounded-lg border">
                    {periods.map((p) => (
                      <Link
                        key={p.id}
                        href={`/payroll/${p.id}/staff/${staff.id}`}
                        className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted/40"
                      >
                        <span>{format(new Date(`${p.startDate}T00:00:00`), "dd MMM")} – {format(new Date(`${p.endDate}T00:00:00`), "dd MMM yyyy")}</span>
                        <Badge variant="outline" className="capitalize">{p.status.replace(/_/g, " ")}</Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Salary advances</h3>
                {advancesLoading ? <RowsSkeleton /> : advances.length === 0 ? (
                  <EmptyRows icon={<Coins className="h-6 w-6" />} message="No salary advances for this staff member." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {advances.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-nowrap">{format(new Date(`${a.date}T00:00:00`), "dd MMM yyyy")}</TableCell>
                          <TableCell className="capitalize">{a.status}{a.status === "approved" ? ` · ${a.recoveryStatus.replace(/_/g, " ")}` : ""}</TableCell>
                          <TableCell className="text-right">{formatCurrency(a.amount, currency)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(a.outstandingBalance, currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            <TabsContent value="contract" className="space-y-4">
              {contractLoading ? <RowsSkeleton /> : contractStatus === "none" ? (
                <EmptyRows icon={<FileSignature className="h-6 w-6" />} message="No contract has been attached yet. Add one from Edit." />
              ) : (
                <div className="space-y-3 rounded-xl border p-4">
                  <Badge variant="outline">{contractLabel[contractStatus] ?? contractStatus}</Badge>
                  {contract?.signature && (
                    <p className="text-sm">
                      Signed by <span className="font-medium">{contract.signature.typedFullName}</span> on{" "}
                      {new Date(contract.signature.signedAt).toLocaleString()}
                      <span className="block text-xs text-muted-foreground">IP {contract.signature.ipAddress}</span>
                    </p>
                  )}
                  {contractStatus === "declined" && contract?.declinedReason && (
                    <p className="text-sm text-destructive">Reason given: {contract.declinedReason}</p>
                  )}
                  {contract?.signedGetUrl && (
                    <a href={contract.signedGetUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline block">
                      View {contract.fileOriginalName || "contract document"}
                    </a>
                  )}
                  {contract?.contractType === "text" && contract.contentText && (
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted/40 rounded p-3 max-h-64 overflow-y-auto">{contract.contentText}</pre>
                  )}
                </div>
              )}
            </TabsContent>

            {hrEnabled("personal") && <TabsContent value="hr-personal"><PersonalTab staffId={staff.id} /></TabsContent>}
            {hrEnabled("job") && <TabsContent value="hr-job"><JobTab staffId={staff.id} canManage={canManageHr} /></TabsContent>}
            {hrEnabled("time_off") && <TabsContent value="hr-time_off"><TimeOffTab staffId={staff.id} storeId={staff.storeId} canManage={canManageHr} /></TabsContent>}
            {hrEnabled("emergency") && <TabsContent value="hr-emergency"><EmergencyContactsTab staffId={staff.id} basePath="/api/hr" /></TabsContent>}
            {hrEnabled("documents") && <TabsContent value="hr-documents"><DocumentsTab staffId={staff.id} /></TabsContent>}
            {hrEnabled("benefits") && <TabsContent value="hr-benefits"><BenefitsTab staffId={staff.id} /></TabsContent>}
            {hrEnabled("disciplinary") && <TabsContent value="hr-disciplinary"><DisciplinaryTab staffId={staff.id} canManage={canManageHr} /></TabsContent>}
            {hrEnabled("guarantor") && <TabsContent value="hr-guarantor"><GuarantorTab staffId={staff.id} basePath="/api/hr" /></TabsContent>}
          </Tabs>
        </CardContent>
      </Card>
      )}

      <ConfirmDialog
        open={isArchiveConfirmOpen}
        onOpenChange={setIsArchiveConfirmOpen}
        title="Archive staff member?"
        description={`${fullName} will lose access. Their history is preserved for payroll and audit records.`}
        confirmText="Archive"
        isDestructive
        onConfirm={() => archiveMutation.mutate()}
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}
