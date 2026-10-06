import { useState, useMemo } from "react";
import { LimitNudge } from "@/components/billing/LimitNudge";
import { useCountLimitGuard } from "@/hooks/useCountLimitGuard";
import { AddButton } from "@/components/add-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES, type ApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Plus, UserPlus, UserCheck, UserX, FileSignature, Edit, Trash2, Phone, RotateCcw, Archive, ArrowRightLeft, Users, UserSquare2 } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { StaffFiltersSheet, StaffSortSheet } from "@/components/staff-filter-sheets";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import {
  EMPTY_STAFF_FILTERS,
  buildStaffFilterChips,
  clearStaffFilterChip,
  countActiveStaffFilters,
  accountStatusOf,
  sortStaff,
  staffMatchesFilters,
  staffSortLabel,
  type StaffFilterState,
  type StaffSortState,
} from "@/lib/staff-filters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { useUrlState } from "@/hooks/use-url-state";
import { DataTable, type RowAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkOperations } from "@/components/bulk-operations";
import { STAFF_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { useToast } from "@/hooks/use-toast";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { type Staff, type StaffInviteStatus, type StaffContractStatus } from "@shared/schema";
import { CalendarDays, Mail, Shield, MailWarning, ShieldCheck, Send, Clock, Crown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";

// The API attaches inviteStatus to every staff row (derived server-side from
// the linked account, without exposing its id). It answers "can this person
// actually log in yet?", which signedContract never did. contractStatus is
// the equivalent projection over the versioned staff_contracts table -
// signedContract itself is deprecated and no longer kept in sync with it.
type StaffRow = Staff & { inviteStatus?: StaffInviteStatus; contractStatus?: StaffContractStatus; storeName?: string };

function InviteStatusBadge({ status }: { status?: StaffInviteStatus }) {
  if (status === "active") {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="h-3 w-3" />
        Active
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        Code verified
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
        <MailWarning className="h-3 w-3" />
        Invite pending
      </Badge>
    );
  }
  return <Badge variant="secondary" className="gap-1">Not invited</Badge>;
}

// Mobile/tablet compact-grid card: the avatar renders once via cardAvatar and
// the name cell is name-only (the staff number would crowd a narrow card).
const staffCardAvatar = (staff: { name: string }) => (
  <Avatar className="h-10 w-10">
    <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
      {getCustomerInitials(staff.name)}
    </AvatarFallback>
  </Avatar>
);
const StaffCardNameCell = ({ staff }: { staff: { name: string } }) => <span className="truncate">{staff.name}</span>;

import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { fetchAllStaff } from "@/lib/staff-api";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { exportReportToPDF } from "@/lib/export-utils";

export default function StaffPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const guardCap = useCountLimitGuard("staff_seats");
  const search = useSearch();
  const { currentStore, stores, business } = useStore();
  const { user } = useAuth();
  const userRole = user?.role || "staff";
  const isOwner = userRole === "owner";
  
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPermanentDeleteOpen, setIsPermanentDeleteOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffRow | null>(null);
  const [isResendInviteOpen, setIsResendInviteOpen] = useState(false);
  const [transferTargetStoreId, setTransferTargetStoreId] = useState<string>("");
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "active");
  const [staffSearchTerm, setStaffSearchTerm] = useState("");
  const [staffFilters, setStaffFilters] = useState<StaffFilterState>(EMPTY_STAFF_FILTERS);
  const [staffSort, setStaffSort] = useState<StaffSortState | null>(null);
  const [archivedSearchTerm, setArchivedSearchTerm] = useState("");
  const [archivedFilters, setArchivedFilters] = useState<StaffFilterState>(EMPTY_STAFF_FILTERS);
  const [archivedSort, setArchivedSort] = useState<StaffSortState | null>(null);

  const { data: staffList = [], isLoading } = useQuery<StaffRow[]>({
    queryKey: ["/api/staff", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const list = await fetchAllStaff<StaffRow>(s.id);
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, Staff & { storeName?: string }>();
        for (const list of responses) {
          for (const item of list) {
            const key = item.id;
            const existing = mergedMap.get(key);
            if (existing) {
              if (item.storeName && !existing.storeName?.includes(item.storeName)) {
                existing.storeName = `${existing.storeName}, ${item.storeName}`;
              }
            } else {
              mergedMap.set(key, { ...item });
            }
          }
        }
        return Array.from(mergedMap.values());
      }
      return fetchAllStaff<StaffRow>(currentStore!.id);
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
    staleTime: STALE_TIMES.reference,
  });

  const activeStaff = staffList.filter(s => !s.isArchived);
  const archivedStaff = staffList.filter(s => s.isArchived);

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/staff/${selectedStaff?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member archived successfully" });
      setIsDeleteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Archive Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/staff/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member restored successfully" });
    },
    onError: (error: Error) => {
      // At the plan cap, apiRequest has already opened the upgrade dialog; a toast saying the same would double up.
      if ((error as ApiError).planLimit) return;
      toast({ 
        title: "Couldn't Restore Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/staff/${id}/permanent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member permanently deleted" });
      setIsPermanentDeleteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Delete Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: ({ staffId, targetStoreId }: { staffId: string; targetStoreId: string }) => 
      apiRequest("POST", `/api/staff/${staffId}/transfer`, { targetStoreId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member transferred successfully" });
      setIsTransferOpen(false);
      setSelectedStaff(null);
      setTransferTargetStoreId("");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Transfer Staff Member", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    },
  });

  // Until this existed, a mistyped invitation could only be recovered by the
  // invitee - who by definition never received it.
  const resendInviteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/staff/${id}/resend-invite`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
      toast({
        title: "Invitation sent",
        description: `A fresh activation code is on its way to ${selectedStaff?.email}.`,
      });
      setIsResendInviteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Resend Invitation",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    },
  });

  const otherStores = stores.filter(s => s.id !== currentStore?.id);
  const storeCurrency = currentStore?.currency || "NGN";

  
  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  // Extra vertical breathing room per row, on top of the shared table's
  // default p-4 (client/src/components/ui/table.tsx) - merged into each
  // column's className, which PolymorphicTable applies to both the header
  // and body cells. Scoped to this page only, not a change to the shared
  // table component, so every other list using DataTable is unaffected.
  const withRowSpacing = (cols: any[]): any[] =>
    cols.map((col) => ({ ...col, className: cn(col.className, "py-5") }));

  const activeColumns = useMemo(() => {
    const storeColumn = currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (staff: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium uppercase shrink-0">
          {staff.storeName || "Global"}
        </Badge>
      ),
    }] : [];

    const baseColumns = [
      ...storeColumn,
      {
        key: "name",
        header: "Staff Member",
        priority: 1 as const,
        render: (staff: StaffRow) => {
          const presenter = new StaffPresenter(staff);
          return <EntityDisplay presenter={presenter} />;
        },
        cardRender: (staff: StaffRow) => <StaffCardNameCell staff={staff} />,
      },
      {
        key: "email",
        header: "Email",
        priority: 3 as const,
        render: (staff: StaffRow) => (
          <div className="flex items-center gap-2">
            <Mail className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{staff.email || "-"}</span>
          </div>
        ),
      },
      {
        key: "inviteStatus",
        header: "Account",
        priority: 1 as const,
        render: (staff: StaffRow) => <InviteStatusBadge status={staff.inviteStatus} />,
      },
      {
        key: "mobileNumber",
        header: "Mobile",
        priority: 2 as const,
        render: (staff: StaffRow) => (
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 text-muted-foreground" />
            <span>{formatPhoneDisplay(staff.mobileNumber, staff.countryCode || "+234")}</span>
          </div>
        ),
      },
    ];

    if (isOwner) {
      const mobileCol = baseColumns.find(c => c.key === "mobileNumber")!;
      const nonMobileBaseCols = baseColumns.filter(c => c.key !== "mobileNumber");

      return withRowSpacing([
        ...nonMobileBaseCols,
        {
          key: "role",
          header: "Role",
          priority: 2 as const,
          render: (staff: StaffRow) => (
            <Badge
              variant={staff.role === "owner" ? "default" : staff.role === "manager" ? "default" : "secondary"}
              className={cn("gap-1 capitalize", staff.role === "owner" && "bg-amber-500 hover:bg-amber-500/90 text-white")}
            >
              {staff.role === "owner" ? <Crown className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
              {staff.role || "Staff"}
            </Badge>
          ),
        },
        mobileCol,
      ]);
    }

    return withRowSpacing([...baseColumns]);
  }, [isOwner, formatCurrency, setLocation, otherStores.length]);

  // Full action set for owners/managers; staff-role viewers only ever see their
  // own row's Edit (the "actions" column is entirely absent for them elsewhere).
  const activeRowActions = (staff: StaffRow): RowAction[] => {
    if (!isOwner) {
      return [
        { label: "Edit", icon: <Edit className="h-4 w-4" />, onClick: () => setLocation(`/staffs/${staff.id}/edit`) },
      ];
    }
    const actions: RowAction[] = [
      {
        label: "Edit",
        icon: <Edit className="h-4 w-4" />,
        onClick: () => setLocation(appendReturnTo(`/staffs/${staff.id}/edit`, location, search)),
        testId: `button-edit-${staff.id}`,
      },
      {
        label: "HR Profile",
        gate: "staff_hr_archive",
        icon: <UserSquare2 className="h-4 w-4" />,
        onClick: () => setLocation(`/staffs/${staff.id}/hr-profile`),
        testId: `button-hr-profile-${staff.id}`,
      },
    ];
    // Once a password is set, the person is no longer blocked by their activation
    // code - resending it is a no-op at best. A pending_signature/declined
    // contract needs a new/replaced contract (via Edit), not a resent invite -
    // see the server refusal in StaffInviteService.resendToLinkedUser.
    if (staff.inviteStatus !== "active" && staff.contractStatus !== "pending_signature" && staff.contractStatus !== "declined") {
      actions.push({
        label: "Resend invitation",
        icon: <Send className="h-4 w-4" />,
        onClick: () => {
          setSelectedStaff(staff);
          setIsResendInviteOpen(true);
        },
        testId: `button-resend-invite-${staff.id}`,
      });
    }
    if (otherStores.length > 0) {
      actions.push({
        label: "Transfer to another store",
        gate: "staff_transfer",
        hideWhenLocked: true,
        icon: <ArrowRightLeft className="h-4 w-4" />,
        onClick: () => {
          setSelectedStaff(staff);
          setTransferTargetStoreId("");
          setIsTransferOpen(true);
        },
      });
    }
    actions.push({
      label: "Archive",
      gate: "staff_hr_archive",
      icon: <Archive className="h-4 w-4" />,
      onClick: () => {
        setSelectedStaff(staff);
        setIsDeleteOpen(true);
      },
      destructive: true,
    });
    return actions;
  };

  const archivedColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (staff: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium uppercase shrink-0">
          {staff.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "name",
      header: "Staff Member",
      priority: 1 as const,
      render: (staff: StaffRow) => {
        const presenter = new StaffPresenter(staff);
        return (
          <div className="flex items-center gap-2">
            <EntityDisplay presenter={presenter} />
            <Badge variant="secondary">Archived</Badge>
          </div>
        );
      },
      cardRender: (staff: StaffRow) => <StaffCardNameCell staff={staff} />,
    },
    {
      key: "mobileNumber",
      header: "Mobile",
      priority: 1 as const,
      render: (staff: StaffRow) => (
        <div className="flex items-center gap-2">
          <Phone className="h-3 w-3 text-muted-foreground" />
          <span>{formatPhoneDisplay(staff.mobileNumber, staff.countryCode || "+234")}</span>
        </div>
      ),
    },
    {
      key: "payPerMonth",
      header: "Monthly Pay",
      priority: 2 as const,
      render: (staff: StaffRow) => (
        staff.overridePaymentMethod
          ? <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
          : <span className="text-xs text-muted-foreground italic">Store default</span>
      ),
    },
  ];

  const archivedRowActions = (staff: StaffRow): RowAction[] => [
    {
      label: "Restore",
      icon: <RotateCcw className="h-4 w-4" />,
      onClick: () => guardCap(() => restoreMutation.mutate(staff.id)),
    },
    {
      label: "Delete permanently",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => {
        setSelectedStaff(staff);
        setIsPermanentDeleteOpen(true);
      },
      destructive: true,
    },
  ];

  const exportColumns = isOwner
    ? [
        { key: "name", header: "Name" },
        { key: "email", header: "Email" },
        { key: "role", header: "Role" },
        { key: "staffNumber", header: "Staff Number" },
        { key: "mobileNumber", header: "Mobile Number" },
        { key: "payPerMonth", header: "Pay Per Month" },
        { key: "paymentMethod", header: "Payment Method" },
        { key: "contractStatus", header: "Contract Status" },
      ]
    : [
        { key: "name", header: "Name" },
        { key: "email", header: "Email" },
        { key: "staffNumber", header: "Staff Number" },
        { key: "mobileNumber", header: "Mobile Number" },
      ];

  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  type StaffReportRow = {
    name: string;
    email: string;
    role: string;
    staffNumber: string;
    mobileNumber: string;
    payLabel: string;
    paymentMethod: string;
    status: string;
  };

  // Tracks whichever tab's live search/filter result set is currently on screen, so
  // "Export current view" can offer exactly that, separate from the always-full export.
  const [visibleStaffRows, setVisibleStaffRows] = useState<(StaffRow & { status: string })[]>([]);

  const handleStaffReportExport = (filtered = false) => {
    const scoped = filtered ? visibleStaffRows : (activeTab === "active" ? activeStaff : archivedStaff);
    const rows: StaffReportRow[] = scoped.map((s) => ({
      name: s.name,
      email: s.email || "—",
      role: s.role,
      staffNumber: s.staffNumber || "—",
      mobileNumber: s.mobileNumber || "—",
      payLabel: s.overridePaymentMethod ? formatCurrency(s.payPerMonth) : "Store default",
      paymentMethod: s.overridePaymentMethod ? capitalize(s.paymentMethod) : "Store default",
      status: activeTab === "active" ? (s.contractStatus === "signed" ? "Active" : "Pending") : "Deactivated",
    }));
    const sorted = isOwner ? [...rows].sort((a, b) => a.role.localeCompare(b.role)) : rows;

    return exportReportToPDF<StaffReportRow>({
      filename: `staff-report_${activeTab}_${new Date().toISOString().slice(0, 10)}`,
      title: `Staff Report (${activeTab === "active" ? "Active" : "Archived"})`,
      businessName: business?.name ?? currentStore?.name ?? "Business",
      storeName: currentStore?.name ?? "All Stores",
      kpis: isOwner
        ? [
            { label: "Total Staff", value: String(rows.length) },
            { label: "Signed", value: String(rows.filter((r) => r.status === "Active").length) },
            { label: "Pending", value: String(rows.filter((r) => r.status === "Pending").length) },
            { label: "Managers", value: String(rows.filter((r) => r.role === "manager").length) },
          ]
        : undefined,
      columns: isOwner
        ? [
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            { key: "role", header: "Role", format: (r: StaffReportRow) => capitalize(r.role) },
            { key: "staffNumber", header: "Staff #" },
            { key: "mobileNumber", header: "Mobile" },
            { key: "payLabel", header: "Pay/Month" },
            { key: "status", header: "Status" },
          ]
        : [
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            { key: "staffNumber", header: "Staff #" },
            { key: "mobileNumber", header: "Mobile" },
          ],
      rows: sorted,
      unitLabel: "staff",
      groupBy: isOwner ? (r: StaffReportRow) => capitalize(r.role || "Unassigned") : undefined,
      statusKey: isOwner ? "status" : undefined,
      getStatus: isOwner
        ? (r: StaffReportRow) => ({
            label: r.status,
            tone: r.status === "Active" ? ("success" as const) : r.status === "Pending" ? ("warning" as const) : ("neutral" as const),
          })
        : undefined,
    });
  };

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff" description="Manage your staff members and their contracts" />
        <StoreRequiredAlert title="Store Required for Staff" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Staff"
        description={`Managing staff for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            {userRole !== "staff" && (
              <Button
                variant="outline"
                onClick={() => setLocation("/staffs/attendance")}
                aria-label="Attendance"
                data-testid="button-attendance"
              >
                <CalendarDays className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Attendance</span>
              </Button>
            )}
            <div className="lg:hidden">
              <BulkOperations
                entityConfig={STAFF_BULK_CONFIG}
                data={(activeTab === "active" ? activeStaff : archivedStaff) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Staff Report (${activeTab})`}
                onExportPDF={() => handleStaffReportExport()}
                onExportFilteredPDF={() => handleStaffReportExport(true)}
                visibleData={visibleStaffRows as unknown as Record<string, unknown>[]}
                showImportOption={userRole !== "staff"}
                compact
              />
            </div>
            <div className="hidden lg:block">
              <BulkOperations
                entityConfig={STAFF_BULK_CONFIG}
                data={(activeTab === "active" ? activeStaff : archivedStaff) as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                isLoading={isLoading}
                storeId={currentStore.id}
                pdfTitle={`Staff Report (${activeTab})`}
                onExportPDF={() => handleStaffReportExport()}
                onExportFilteredPDF={() => handleStaffReportExport(true)}
                visibleData={visibleStaffRows as unknown as Record<string, unknown>[]}
                showImportOption={userRole !== "staff"}
              />
            </div>
            {isOwner && (
              <AddButton label="Add Staff" limit="staff_seats" onClick={() => setLocation("/staffs/new")} data-testid="button-add-staff" />
            )}
          </div>
        }
      />
      <LimitNudge limitType="staff_seats" />

      <MetricRow
        metrics={[
          { title: "Active", value: activeStaff.length, icon: <UserCheck className="h-4 w-4" />, isLoading },
          { title: "Contract pending", value: activeStaff.filter((s) => s.contractStatus !== "signed").length, icon: <FileSignature className="h-4 w-4" />, isLoading },
          { title: "Invite pending", value: activeStaff.filter((s) => accountStatusOf(s) !== "active").length, icon: <MailWarning className="h-4 w-4" />, isLoading },
          ...(isOwner ? [{ title: "Deactivated", value: archivedStaff.length, icon: <UserX className="h-4 w-4" />, isLoading }] : []),
        ]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <PolymorphicTabsList
          tabs={[
            { value: "active", label: `Active ${activeStaff.length}` },
            { value: "archived", label: `Deactivated ${archivedStaff.length}`, visible: isOwner },
          ]}
          variant="bordered"
        />
        {(() => {
          const activeTableData = activeStaff.map((s) => ({
            ...s,
            status: s.contractStatus === "signed" ? "Active" : "Pending"
          }));

          const archivedTableData = archivedStaff.map((s) => ({
            ...s,
            status: "Deactivated"
          }));

          const searchRows = <T extends StaffRow>(rows: T[], term: string): T[] => {
            const q = term.trim().toLowerCase();
            if (!q) return rows;
            return rows.filter((s) =>
              s.name.toLowerCase().includes(q) ||
              s.email?.toLowerCase().includes(q) ||
              s.staffNumber?.toLowerCase().includes(q) ||
              s.mobileNumber?.toLowerCase().includes(q)
            );
          };
          const searchedActive = searchRows(activeTableData, staffSearchTerm);
          const visibleActive = sortStaff(searchedActive.filter((s) => staffMatchesFilters(s, staffFilters)), staffSort);
          const searchedArchived = searchRows(archivedTableData, archivedSearchTerm);
          const visibleArchived = sortStaff(searchedArchived.filter((s) => staffMatchesFilters(s, archivedFilters)), archivedSort);

          const roleOptions = Array.from(new Set(staffList.map((s) => s.role || "staff"))).sort();
          const branchOptions = currentStore?.id === "all"
            ? Array.from(new Set(staffList.map((s) => s.storeName || "Global"))).sort()
            : [];

          // Search + Filters/Sort sheets + removable chips, shared by the Active and Deactivated tabs.
          const renderListControls = (cfg: {
            testIdPrefix: string;
            searchTerm: string;
            setSearchTerm: (v: string) => void;
            filters: StaffFilterState;
            setFilters: React.Dispatch<React.SetStateAction<StaffFilterState>>;
            sort: StaffSortState | null;
            setSort: (s: StaffSortState | null) => void;
            searched: StaffRow[];
            visibleCount: number;
          }) => {
            return (
              <ListControls
                testIdPrefix={cfg.testIdPrefix}
                placeholder="Search name, email, phone or staff ID"
                search={cfg.searchTerm}
                onSearchChange={cfg.setSearchTerm}
                filterCount={countActiveStaffFilters(cfg.filters)}
                filters={(trigger) => (
                  <StaffFiltersSheet
                    filters={cfg.filters}
                    onApply={cfg.setFilters}
                    roles={roleOptions}
                    branches={branchOptions}
                    resultCountFor={(draft) => cfg.searched.filter((s) => staffMatchesFilters(s, draft)).length}
                    trigger={trigger}
                  />
                )}
                sortLabel={staffSortLabel(cfg.sort).replace(/^Sort: /, "")}
                sort={(trigger) => <StaffSortSheet sort={cfg.sort} onChange={cfg.setSort} trigger={trigger} />}
                chips={buildStaffFilterChips(cfg.filters)}
                onRemoveChip={(key) => cfg.setFilters((f) => clearStaffFilterChip(f, key as Parameters<typeof clearStaffFilterChip>[1]))}
                hasSort={cfg.sort !== null}
                onClearAll={() => {
                  cfg.setFilters(EMPTY_STAFF_FILTERS);
                  cfg.setSort(null);
                }}
                visibleCount={cfg.visibleCount}
                noun="staff member"
              />
            );
          };

          return (
            <>
              <TabsContent value="active" className="mt-4 space-y-3">
                {renderListControls({
                  testIdPrefix: "staff",
                  searchTerm: staffSearchTerm,
                  setSearchTerm: setStaffSearchTerm,
                  filters: staffFilters,
                  setFilters: setStaffFilters,
                  sort: staffSort,
                  setSort: setStaffSort,
                  searched: searchedActive,
                  visibleCount: visibleActive.length,
                })}

                <DataTable
                  data={visibleActive}
                  columns={activeColumns}
                  rowActions={activeRowActions}
                  hideToolbar
                  isLoading={isLoading}
                  emptyTitle="No Active Staff"
                  emptyMessage="Add your first staff member to start tracking attendance, payroll, and commissions."
                  emptyIcon={<Users className="h-6 w-6" />}
                  emptyAction={
                    <Button size="sm" className="gap-2" onClick={() => guardCap(() => setLocation("/staffs/new"))}><Plus className="h-4 w-4" />Add Staff Member</Button>
                  }
                  onVisibleDataChange={setVisibleStaffRows}
                  urlKey="active"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={staffCardAvatar}
                />
              </TabsContent>
              <TabsContent value="archived" className="mt-4 space-y-3">
                {renderListControls({
                  testIdPrefix: "archived-staff",
                  searchTerm: archivedSearchTerm,
                  setSearchTerm: setArchivedSearchTerm,
                  filters: archivedFilters,
                  setFilters: setArchivedFilters,
                  sort: archivedSort,
                  setSort: setArchivedSort,
                  searched: searchedArchived,
                  visibleCount: visibleArchived.length,
                })}

                <DataTable
                  data={visibleArchived}
                  columns={archivedColumns}
                  rowActions={archivedRowActions}
                  hideToolbar
                  isLoading={isLoading}
                  emptyTitle="No Archived Staff"
                  emptyMessage="Archived staff members will appear here. Their history is preserved for payroll and audit records."
                  emptyIcon={<Archive className="h-6 w-6" />}
                  onVisibleDataChange={setVisibleStaffRows}
                  urlKey="archivedTbl"
                  showCardChevron
                  cardLayout="compact-grid"
                  cardAvatar={staffCardAvatar}
                />
              </TabsContent>
            </>
          );
        })()}
      </Tabs>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Archive Staff Member"
        description={`Are you sure you want to archive "${selectedStaff?.name}"? You can restore them later from the Archived tab.`}
        confirmText="Archive"
        isDestructive
        onConfirm={() => archiveMutation.mutate()}
        isLoading={archiveMutation.isPending}
      />

      <ConfirmDialog
        open={isPermanentDeleteOpen}
        onOpenChange={setIsPermanentDeleteOpen}
        title="Permanently delete this staff member?"
        description="This cannot be undone."
        confirmText="Delete"
        isDestructive
        onConfirm={() => permanentDeleteMutation.mutate(selectedStaff!.id)}
        isLoading={permanentDeleteMutation.isPending}
      />

      {/* Confirmed rather than one-click: each send burns one of the three
          activation emails an address is allowed per hour. */}
      <ConfirmDialog
        open={isResendInviteOpen}
        onOpenChange={setIsResendInviteOpen}
        title="Resend invitation?"
        description={`Send a fresh activation code to ${selectedStaff?.email}. Any code sent earlier will stop working.`}
        confirmText="Send invitation"
        onConfirm={() => resendInviteMutation.mutate(selectedStaff!.id)}
        isLoading={resendInviteMutation.isPending}
      />

      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Staff Member</DialogTitle>
            <DialogDescription>
              Move "{selectedStaff?.name}" to another store you own.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Target Store</label>
              <Select onValueChange={setTransferTargetStoreId} value={transferTargetStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a store" />
                </SelectTrigger>
                <SelectContent>
                  {otherStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransferOpen(false)}>Cancel</Button>
            <Button 
              disabled={!transferTargetStoreId || transferMutation.isPending}
              onClick={() => transferMutation.mutate({ staffId: selectedStaff!.id, targetStoreId: transferTargetStoreId })}
            >
              {transferMutation.isPending ? "Transferring..." : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {userRole !== "staff" && (
        <SpeedDialFAB
          actions={[
            {
              label: "Add Staff",
              icon: <UserPlus className="h-5 w-5" />,
              onClick: () => guardCap(() => setLocation("/staffs/new")),
              testId: "fab-add-staff",
            },
          ]}
        />
      )}
    </div>
  );
}
