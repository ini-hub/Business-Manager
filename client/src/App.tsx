import { getFeatureDef, featureForScreen, type FeatureKey } from "@shared/features";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect, lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { UpgradePromptDialog } from "@/components/billing/UpgradePromptDialog";
import { FeatureGate } from "@/components/billing/FeatureGate";
import { LimitGate } from "@/components/billing/LimitGate";
import { StoreChoice } from "@/components/billing/StoreChoice";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { StoreProvider } from "@/lib/store-context";
import { StoreSelector } from "@/components/store-selector";
import { OrgSwitcher } from "@/components/org-switcher";
import { useAuth } from "@/hooks/useAuth";
import { SeoSync } from "@/components/seo-sync";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useHasPermission } from "@/lib/permissions";
import type { PermissionModule } from "@shared/permissionModules";
import { isOrgLocked } from "@/lib/trial";
import { TrialBanner } from "@/components/trial-banner";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { LegalConsentBanner } from "@/components/legal-consent-banner";
import { Paywall } from "@/pages/paywall";
import { AccountPaused } from "@/pages/account-paused";
import BillingCallback from "@/pages/billing-callback";
import { TrialWelcomeNotice } from "@/components/trial-welcome-notice";
import { TermsPage, PrivacyPage, DataUsagePage, LegalDocumentByParamPage } from "@/pages/legal/legal-document-page";
import CustomerBookingView from "@/pages/customer-booking-view";
import type { Business } from "@shared/schema";

// Eager — needed before auth resolves or tiny catch-all
import Landing from "@/pages/landing";
import Login from "@/pages/auth/login";
import Signup from "@/pages/auth/signup";
import VerifyOtp from "@/pages/auth/verify-otp";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";
import NotFound from "@/pages/not-found";
import OnboardingWizard from "@/pages/onboarding";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminForgotPassword from "@/pages/admin/AdminForgotPassword";
import AdminResetPassword from "@/pages/admin/AdminResetPassword";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineSyncManager } from "@/components/offline-sync-manager";
import { GlobalSearch } from "@/components/global-search";
import { NotificationSheet } from "@/components/notification-sheet";
import { PageSkeleton } from "@/components/page-skeleton";
import { DashboardViewSwitch } from "@/components/dashboard-view-switch";

// Lazy — split into per-route chunks by Vite
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Customers = lazy(() => import("@/pages/customers"));
const CustomerInsights = lazy(() => import("@/pages/customer-insights"));
const CustomerDetails = lazy(() => import("@/pages/customer-details"));
const CustomerFormPage = lazy(() => import("@/pages/customer-form"));
const StaffPage = lazy(() => import("@/pages/staff"));
const StaffFormPage = lazy(() => import("@/pages/staff-form"));
const HrProfilePage = lazy(() => import("@/pages/hr-profile"));
const CompleteProfilePage = lazy(() => import("@/pages/complete-profile"));
const GuarantorSignPage = lazy(() => import("@/pages/guarantor-sign"));
const AttendancePage = lazy(() => import("@/pages/attendance"));
const StaffPerformancePage = lazy(() => import("@/pages/staff-performance"));
const StaffPerformanceAnalyticsPage = lazy(() => import("@/pages/staff-performance-analytics"));
const MyPerformancePage = lazy(() => import("@/pages/my-performance"));
const MyPayrollPage = lazy(() => import("@/pages/my-payroll"));
const MyPayrollDetailPage = lazy(() => import("@/pages/my-payroll-detail"));
const StaffDashboard = lazy(() => import("@/pages/staff-dashboard"));
const StaffAttendancePage = lazy(() => import("@/pages/staff-attendance"));
const NotAuthorized = lazy(() => import("@/components/not-authorized"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const InventoryDetails = lazy(() => import("@/pages/inventory-details"));
const InventoryNewPage = lazy(() => import("@/pages/inventory-new"));
const InventoryEditPage = lazy(() => import("@/pages/inventory-edit"));
const InventoryRestockPage = lazy(() => import("@/pages/inventory-restock"));
const InventoryAuditsPage = lazy(() => import("@/pages/inventory-audits"));
const InventoryAuditNewPage = lazy(() => import("@/pages/inventory-audit-new"));
const NewSale = lazy(() => import("@/pages/new-sale"));
const Transactions = lazy(() => import("@/pages/transactions"));
const RegisterShiftsPage = lazy(() => import("@/pages/register-shifts"));
const TransactionDetailsPage = lazy(() => import("@/pages/transaction-details"));
const ProfitLossPage = lazy(() => import("@/pages/profit-loss"));
const ExpensesPage = lazy(() => import("@/pages/expenses"));
const AddExpensePage = lazy(() => import("@/pages/add-expense"));
const ExpenseEditPage = lazy(() => import("@/pages/expense-edit"));
const ExpenseCategoriesPage = lazy(() => import("@/pages/expense-categories"));
const VendorsPage = lazy(() => import("@/pages/vendors"));
const VendorFormPage = lazy(() => import("@/pages/vendor-form"));
const VendorBillNewPage = lazy(() => import("@/pages/vendor-bill-new"));
const VendorBillPayPage = lazy(() => import("@/pages/vendor-bill-pay"));
const PayrollPage = lazy(() => import("@/pages/payroll"));
const PayrollNewPage = lazy(() => import("@/pages/payroll-new"));
const PayrollPeriodPage = lazy(() => import("@/pages/payroll-period"));
const PayrollDetailPage = lazy(() => import("@/pages/payroll-detail"));
const PayrollAdvancesPage = lazy(() => import("@/pages/payroll-advances"));
const PayrollReportPage = lazy(() => import("@/pages/payroll-report"));
const CreditSalesPage = lazy(() => import("@/pages/credit-sales"));
const BookingsPage = lazy(() => import("@/pages/bookings"));
const BookingCalendarPage = lazy(() => import("@/pages/booking-calendar"));
const BroadcastsPage = lazy(() => import("@/pages/broadcasts"));
const BookingFormPage = lazy(() => import("@/pages/booking-form"));
const BookingDetailsPage = lazy(() => import("@/pages/booking-details"));
const QuotesPage = lazy(() => import("@/pages/quotes"));
const QuoteFormPage = lazy(() => import("@/pages/quote-form"));
const LeaderboardPage = lazy(() => import("@/pages/leaderboard"));
const PurchaseOrdersPage = lazy(() => import("@/pages/purchase-orders"));
const PurchaseOrderFormPage = lazy(() => import("@/pages/purchase-order-form"));
const PurchaseOrderDetailPage = lazy(() => import("@/pages/purchase-order-detail"));
const StockTransfersPage = lazy(() => import("@/pages/stock-transfers"));
const StockTransferNewPage = lazy(() => import("@/pages/stock-transfer-new"));
const ServiceProfitabilityPage = lazy(() => import("@/pages/service-profitability"));
const BalanceSheetPage = lazy(() => import("@/pages/balance-sheet"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const HelpSupportPage = lazy(() => import("@/pages/help-support"));
const SettingsIndexPage = lazy(() => import("@/pages/settings/index"));
const SettingsBusinessPage = lazy(() => import("@/pages/settings-business"));
const SettingsStoresPage = lazy(() => import("@/pages/settings/stores"));
const SettingsRolesPage = lazy(() => import("@/pages/settings/roles"));
const SettingsHrProfilesPage = lazy(() => import("@/pages/settings/hr-profiles"));
const SettingsStorePage = lazy(() => import("@/pages/settings-store"));
const SettingsStoreDetailsPage = lazy(() => import("@/pages/settings/store-details"));
const SettingsAttendancePage = lazy(() => import("@/pages/settings/attendance"));
const SettingsCreditSalesPage = lazy(() => import("@/pages/settings/credit-sales"));
const SettingsPaymentIntegrationsPage = lazy(() => import("@/pages/settings/payment-integrations"));
const SettingsWhatsAppNumberPage = lazy(() => import("@/pages/settings/whatsapp-number"));
const SettingsCapitalAssetsPage = lazy(() => import("@/pages/settings/capital-assets"));
const SettingsBulkOperationsPage = lazy(() => import("@/pages/settings/bulk-operations"));
const TaxesCompliancePage = lazy(() => import("@/pages/settings/taxes-compliance"));
const PromotionsPage = lazy(() => import("@/pages/settings/promotions"));
const StoreFormPage = lazy(() => import("@/pages/store-form"));
const BusinessFormPage = lazy(() => import("@/pages/business-form"));
const RoleFormPage = lazy(() => import("@/pages/role-form"));
const BillingSettingsPage = lazy(() => import("@/pages/settings/billing"));
const PaymentHistoryPage = lazy(() => import("@/pages/settings/payment-history"));
const ReportsIndexPage = lazy(() => import("@/pages/reports/index"));
const AuditLogsPage = lazy(() => import("@/pages/reports/audit-logs"));
const AnalyticsExplorerPage = lazy(() => import("@/pages/analytics"));
const AnalyticsDashboardsPage = lazy(() => import("@/pages/analytics/dashboards"));
const AnalyticsDashboardDetailPage = lazy(() => import("@/pages/analytics/dashboard-detail"));
const VerifyPayslipPage = lazy(() => import("@/pages/verify-payslip"));

// Super Admin Portal (lazy — separate user segment)
import AdminLayout from "@/components/admin/AdminLayout";
import { FullScreenLoader, SplashScreen, useFirstLoad } from "@/components/ui/loader";
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const BusinessesList = lazy(() => import("@/pages/admin/BusinessesList"));
const BusinessDetails = lazy(() => import("@/pages/admin/BusinessDetails"));
const OnboardingPipeline = lazy(() => import("@/pages/admin/OnboardingPipeline"));
const UsersList = lazy(() => import("@/pages/admin/UsersList"));
const TransactionsMonitor = lazy(() => import("@/pages/admin/TransactionsMonitor"));
const RevenueAnalytics = lazy(() => import("@/pages/admin/RevenueAnalytics"));
const BillingPayments = lazy(() => import("@/pages/admin/BillingPayments"));
const FeatureFlags = lazy(() => import("@/pages/admin/FeatureFlags"));
const FeatureCatalog = lazy(() => import("@/pages/admin/FeatureCatalog"));
const FeatureEditor = lazy(() => import("@/pages/admin/FeatureEditor"));
const Bundles = lazy(() => import("@/pages/admin/Bundles"));
const OverCapReport = lazy(() => import("@/pages/admin/OverCapReport"));
const BundleEditor = lazy(() => import("@/pages/admin/BundleEditor"));
const PlatformSettings = lazy(() => import("@/pages/admin/PlatformSettings"));
const LegalDocuments = lazy(() => import("@/pages/admin/LegalDocuments"));
const AnnouncementsManager = lazy(() => import("@/pages/admin/AnnouncementsManager"));
const SystemHealth = lazy(() => import("@/pages/admin/SystemHealth"));
const AuditLogs = lazy(() => import("@/pages/admin/AuditLogs"));
const SuperAdminAccounts = lazy(() => import("@/pages/admin/SuperAdminAccounts"));
const SupportInbox = lazy(() => import("@/pages/admin/SupportInbox"));

// First load of a session plays the logo reveal; later full-screen waits use the plain loader.
function BootLoader() {
  const firstLoad = useFirstLoad();
  return firstLoad ? <SplashScreen /> : <FullScreenLoader />;
}

function PageLoader() {
  return <PageSkeleton />;
}

function OnboardingRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/auth/login");
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) return null;
  return <OnboardingWizard />;
}

// Pages that ARE the paid feature render a locked card instead of a form that
// can only fail with a 402. Only write/report pages are wrapped - lists of data
// the org already owns (e.g. /expenses) stay readable after an add-on lapses.
function withFeatureGate<P extends object>(featureKey: FeatureKey, Page: React.ComponentType<P>) {
  const featureName = getFeatureDef(featureKey)?.name;
  return function GatedPage(props: P) {
    return (
      <FeatureGate featureKey={featureKey} featureName={featureName}>
        <Page {...props} />
      </FeatureGate>
    );
  };
}
// Router-level gate for admin-defined screen rules (Feature Catalog > Gate rules). The
// pages wrapped with withFeatureGate above are the code baseline; this reads the same
// list the server returns, so a screen a super admin gates is locked here without a
// deploy. Admin rules additionally need the feature's Settings > Roles module.
function ModuleLockedCard({ module }: { module: PermissionModule }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Your role doesn't include {module} access</p>
        <p className="text-sm text-muted-foreground">Ask an owner to update your role in Settings &gt; Roles.</p>
      </CardContent>
    </Card>
  );
}

function ModuleGate({ module, children }: { module: PermissionModule; children: React.ReactNode }) {
  const { hasPermission, isLoading } = useHasPermission(module);
  if (isLoading) return null;
  return hasPermission ? <>{children}</> : <ModuleLockedCard module={module} />;
}

function ScreenGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { hasFeature, isDisabled, isLoading, isError, gatedFeatureFor, gatedModuleFor } = useEntitlements();
  const featureKey = gatedFeatureFor(location);
  // A page owned by a switched-off feature is not there at all, locked or not.
  const owner = featureForScreen(location);
  if (!isLoading && !isError && ((owner && isDisabled(owner)) || (featureKey && isDisabled(featureKey)))) return <NotFound />;
  // Hold the page until entitlements arrive: rendering it first and then swapping in Not Found or
  // the lock lets a switched-off or unpaid page flash up. The query is cached, so this is first load only.
  if (isLoading && (owner || featureKey)) return null;
  if (!featureKey || isLoading || isError) return <>{children}</>;
  if (!hasFeature(featureKey)) return <FeatureGate featureKey={featureKey}>{null}</FeatureGate>;
  const module = gatedModuleFor(location);
  return module ? <ModuleGate module={module}>{children}</ModuleGate> : <>{children}</>;
}

const GatedProfitLoss = withFeatureGate("financial_management", ProfitLossPage);
const GatedAddExpense = withFeatureGate("financial_management", AddExpensePage);
const GatedExpenseEdit = withFeatureGate("financial_management", ExpenseEditPage);
const GatedExpenseCategories = withFeatureGate("financial_management", ExpenseCategoriesPage);
const GatedStaffPerformance = withFeatureGate("staff_performance_tracking", StaffPerformancePage);
const GatedStaffPerformanceAnalytics = withFeatureGate("staff_performance_tracking", StaffPerformanceAnalyticsPage);
const GatedRoleForm = withFeatureGate("custom_roles_permissions", RoleFormPage);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="ui-theme">
        <TooltipProvider>
          <ErrorBoundary>
            <SeoSync />
            <Router />
          </ErrorBoundary>
          <Toaster />
          <UpgradePromptDialog />
          <OfflineSyncManager />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function SuperAdminRouter() {
  return (
    <Switch>
      <Route path="/super-admin/login" component={AdminLogin} />
      <Route path="/super-admin/forgot-password" component={AdminForgotPassword} />
      <Route path="/super-admin/reset-password" component={AdminResetPassword} />
      <Route>
        <AdminLayout>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/super-admin" component={AdminDashboard} />
              <Route path="/super-admin/businesses" component={BusinessesList} />
              <Route path="/super-admin/businesses/:id" component={BusinessDetails} />
              <Route path="/super-admin/onboarding" component={OnboardingPipeline} />
              <Route path="/super-admin/users" component={UsersList} />
              <Route path="/super-admin/transactions" component={TransactionsMonitor} />
              <Route path="/super-admin/support-inbox" component={SupportInbox} />
              <Route path="/super-admin/revenue" component={RevenueAnalytics} />
              <Route path="/super-admin/billing" component={BillingPayments} />
              <Route path="/super-admin/flags" component={FeatureFlags} />
              <Route path="/super-admin/feature-catalog" component={FeatureCatalog} />
              <Route path="/super-admin/feature-catalog/new" component={FeatureEditor} />
              <Route path="/super-admin/feature-catalog/:id" component={FeatureEditor} />
              <Route path="/super-admin/over-cap" component={OverCapReport} />
              <Route path="/super-admin/bundles" component={Bundles} />
              <Route path="/super-admin/bundles/new" component={BundleEditor} />
              <Route path="/super-admin/bundles/:id" component={BundleEditor} />
              <Route path="/super-admin/platform-settings" component={PlatformSettings} />
              <Route path="/super-admin/legal-documents" component={LegalDocuments} />
              <Route path="/super-admin/announcements" component={AnnouncementsManager} />
              <Route path="/super-admin/health" component={SystemHealth} />
              <Route path="/super-admin/audit-logs" component={AuditLogs} />
              <Route path="/super-admin/accounts" component={SuperAdminAccounts} />
              <Route>
                <Redirect to="/super-admin" />
              </Route>
            </Switch>
          </Suspense>
        </AdminLayout>
      </Route>
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();

  if (location.startsWith("/super-admin")) {
    return <SuperAdminRouter />;
  }

  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <BootLoader />;
  }

  return (
    <Switch>
      <Route path="/auth/login" component={Login} />
      {/* The activation email links here (server/email.ts builds
          ${APP_URL}/activate?code=...). Login owns the whole activation step
          machine and reads the code off the query string, so it needs no page
          of its own - it just needed a route, without which the button in
          every invitation email fell through to NotFound. */}
      <Route path="/activate" component={Login} />
      <Route path="/auth/signup" component={Signup} />
      {/* Public magic-link booking view, reached from the WhatsApp booking
          confirmation message (server/routes/customer-booking.routes.ts) -
          no session/auth, scoped by the unguessable token in the URL. */}
      <Route path="/my-booking/:token" component={CustomerBookingView} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/data-usage" component={DataUsagePage} />
      {/* Reaches any section a super admin adds beyond the three friendly paths above (LegalDocuments.tsx). Registered after them so /terms etc. still win. */}
      <Route path="/legal/:type" component={LegalDocumentByParamPage} />
      <Route path="/auth/verify-otp" component={VerifyOtp} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/onboarding" component={OnboardingRoute} />
      {/* Reached via the profile_pending_token cookie (not a normal session)
          minted by login/set-activated-password when required HR profile
          sections are outstanding - server/lib/authFlow.ts. */}
      <Route path="/complete-profile">
        <Suspense fallback={<PageLoader />}><CompleteProfilePage /></Suspense>
      </Route>
      {/* The guarantor's own review/sign/decline - reached via a mailed/
          shared link with a guarantor_pending token in the query string, no
          session at all. See server/routes/guarantor.routes.ts. */}
      <Route path="/guarantor/sign">
        <Suspense fallback={<PageLoader />}><GuarantorSignPage /></Suspense>
      </Route>
      <Route path="/verify/payslip/:id">
        <Suspense fallback={<PageLoader />}><VerifyPayslipPage /></Suspense>
      </Route>
      <Route>
        {isAuthenticated ? <AuthenticatedLayout /> : <Landing />}
      </Route>
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { user } = useAuth();
  useRealtimeSync();
  const [location, setLocation] = useLocation();
  const sidebarStyle = {
    "--sidebar-width": "15.5rem",
    "--sidebar-width-icon": "3rem",
  };

  // Fetch stores to determine if onboarding is needed
  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["/api/stores"],
    enabled: !!user,
  });

  // Same query key store-context.tsx uses, so this doesn't add a second network
  // request once StoreProvider mounts below - react-query dedupes/caches it.
  const { data: business, isLoading: businessLoading } = useQuery<Business | null>({
    queryKey: ["/api/business"],
    enabled: !!user,
  });

  // Onboarding is "done" once the business has a designated main store, not
  // merely any store - keeps this gate in sync with server-assigned isMain
  // (see server/routes/business.routes.ts createDefaultStore / POST /api/stores).
  const hasMainStore = !storesLoading && Array.isArray(stores) && stores.some((s: any) => s.isMain);

  // True only for a trialing org's owner who hasn't clicked through the
  // blocking "your 14-day free trial starts now" notice yet
  // (TrialWelcomeNotice below) - never true for staff (billing/trial
  // messaging is owner-only, same scoping as TrialBanner), and never true
  // again once trialConsentAcceptedAt is set.
  const needsTrialConsent = user?.role === "owner" && business?.status === "trialing" && !business?.trialConsentAcceptedAt;

  // Redirect to onboarding via useEffect. A locked org (suspended, or
  // trial-expired past grace) makes /api/stores 403 rather than return an
  // empty list, which looks identical to "brand-new org with no stores yet"
  // from here - guard on isOrgLocked so a locked org sees the Paywall/
  // AccountPaused screen below instead of being bounced into the
  // create-store wizard, where store creation would just 403 again. Also
  // guard on needsTrialConsent so a brand-new owner sees the trial notice
  // before, not racing, the redirect into the onboarding wizard.
  useEffect(() => {
    if (!storesLoading && !businessLoading && !hasMainStore && !isOrgLocked(business) && !needsTrialConsent && location !== "/onboarding") {
      setLocation("/onboarding");
    }
  }, [storesLoading, businessLoading, hasMainStore, business, needsTrialConsent, location, setLocation]);

  // Global power-user navigation keyboard shortcuts (Alt/Option modifier)
  useEffect(() => {
    const handleNavigationShortcuts = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in input, textarea, or contenteditable fields
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.hasAttribute("contenteditable"))
      ) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        // Use e.code (physical key) instead of e.key: on macOS, Option acts as a
        // diacritic/dead-key modifier, so e.key returns "ç", "∂", "†", etc.
        // instead of the letter typed, and the shortcuts would never match.
        switch (e.code) {
          case "KeyN":
            e.preventDefault();
            setLocation("/sales/new");
            break;
          case "KeyI":
            e.preventDefault();
            setLocation("/inventory");
            break;
          case "KeyC":
            e.preventDefault();
            setLocation("/customers");
            break;
          case "KeyD":
            e.preventDefault();
            setLocation("/");
            break;
          case "KeyT":
            e.preventDefault();
            setLocation("/transactions");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleNavigationShortcuts);
    return () => window.removeEventListener("keydown", handleNavigationShortcuts);
  }, [setLocation]);

  if (storesLoading || businessLoading) {
    return <FullScreenLoader />;
  }

  // Must be reachable even while the org still reads as locked - this is
  // exactly where a checkout redirect lands right after paying, before the
  // server-side verify call (triggered by this page) has flipped the org
  // back to active. Checked ahead of the isOrgLocked gate below on purpose.
  if (location === "/billing/callback") {
    return <BillingCallback />;
  }

  // Only ever true for an org created by the trial flow (trial expired, no
  // conversion) or one an admin has explicitly suspended - every pre-existing
  // organisation is "active" and never hits this branch.
  if (isOrgLocked(business)) {
    return user?.role === "owner" ? <Paywall business={business} /> : <AccountPaused />;
  }

  if (needsTrialConsent && business) {
    return <TrialWelcomeNotice business={business} />;
  }

  if (!hasMainStore) return null;

  return (
    <StoreProvider>
      <SidebarProvider style={sidebarStyle as React.CSSProperties}>
        <div className="flex flex-col min-h-screen w-full">
          <div className="flex flex-1 w-full min-h-0">
          <AppSidebar />
          <SidebarInset className="flex flex-col flex-1 min-w-0">
            <LegalConsentBanner />
            <AnnouncementBanner />
            <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b bg-background px-4 sm:px-8">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <Separator orientation="vertical" className="hidden lg:block h-6" />
                <div className="hidden lg:block w-48">
                  <OrgSwitcher />
                </div>
                <Separator orientation="vertical" className="hidden lg:block h-6" />
                <div className="hidden lg:block w-48">
                  <StoreSelector />
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center max-w-sm mx-auto">
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-2">
                {user?.role === "owner" && <TrialBanner business={business} />}
                {user?.role === "owner" && <StoreChoice />}
                <NotificationSheet />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto w-full min-w-0 p-4 sm:p-8 lg:p-8">
              <div className="mx-auto max-w-7xl w-full min-w-0">
                <Suspense fallback={<PageLoader />}>
                <ScreenGate>
                <Switch>
                  <Route path="/">
                    {user?.role === "staff" ? <StaffDashboard /> : <DashboardViewSwitch><Dashboard /></DashboardViewSwitch>}
                  </Route>
                  <Route path="/customers" component={Customers} />
                  <Route path="/customers/insights" component={CustomerInsights} />
                  <Route path="/customers/new">
                    <LimitGate limitType="customer_count"><CustomerFormPage /></LimitGate>
                  </Route>
                  <Route path="/customers/:id/edit" component={CustomerFormPage} />
                  <Route path="/customers/:id" component={CustomerDetails} />
                  {/* Singular /staff/* = personal, identical for staff, manager, and
                      owner alike — no role branching, it's always "your own record".
                      Plural /staffs/* = admin (the roster, and every staff member's
                      attendance/performance), manager/owner only: a staff account
                      hitting one of these gets an in-page "not authorized" card, not
                      a redirect — the URL never bounces. */}
                  <Route path="/staff">
                    <DashboardViewSwitch><StaffDashboard /></DashboardViewSwitch>
                  </Route>
                  <Route path="/staff/attendance" component={StaffAttendancePage} />
                  <Route path="/staff/performance" component={MyPerformancePage} />
                  <Route path="/staff/payroll" component={MyPayrollPage} />
                  <Route path="/staff/payroll/:periodId" component={MyPayrollDetailPage} />
                  <Route path="/staff/hr-profile" component={HrProfilePage} />
                  <Route path="/staffs">
                    {user?.role === "staff" ? <NotAuthorized /> : <StaffPage />}
                  </Route>
                  <Route path="/staffs/new">
                    {user?.role === "staff" ? <NotAuthorized /> : <LimitGate limitType="staff_seats"><StaffFormPage /></LimitGate>}
                  </Route>
                  <Route path="/staffs/:id/edit">
                    {user?.role === "staff" ? <NotAuthorized /> : <StaffFormPage />}
                  </Route>
                  <Route path="/staffs/:id/hr-profile">
                    {user?.role === "staff" ? <NotAuthorized /> : <HrProfilePage />}
                  </Route>
                  <Route path="/staffs/attendance">
                    {user?.role === "staff" ? <NotAuthorized /> : <AttendancePage />}
                  </Route>
                  <Route path="/staffs/performance/analytics">
                    {user?.role === "staff" ? <NotAuthorized /> : <GatedStaffPerformanceAnalytics />}
                  </Route>
                  <Route path="/staffs/performance">
                    {user?.role === "staff" ? <NotAuthorized /> : <GatedStaffPerformance />}
                  </Route>
                  <Route path="/inventory" component={InventoryPage} />
                  <Route path="/inventory/new">
                    <LimitGate limitType="item_count"><InventoryNewPage /></LimitGate>
                  </Route>
                  <Route path="/inventory/audits" component={InventoryAuditsPage} />
                  <Route path="/inventory/audits/new" component={InventoryAuditNewPage} />
                  <Route path="/inventory/:id/edit" component={InventoryEditPage} />
                  <Route path="/inventory/:id/restock" component={InventoryRestockPage} />
                  <Route path="/inventory/:id" component={InventoryDetails} />
                  <Route path="/sales/new" component={NewSale} />
                  <Route path="/transactions" component={Transactions} />
                  <Route path="/transactions/register-shifts" component={RegisterShiftsPage} />
                  <Route path="/transactions/:id" component={TransactionDetailsPage} />
                  <Route path="/profit-loss" component={GatedProfitLoss} />
                  <Route path="/expenses" component={ExpensesPage} />
                  <Route path="/expenses/new" component={GatedAddExpense} />
                  <Route path="/expenses/categories" component={GatedExpenseCategories} />
                  <Route path="/expenses/:id/edit" component={GatedExpenseEdit} />
                  <Route path="/credit-sales" component={CreditSalesPage} />
                  <Route path="/bookings/new" component={BookingFormPage} />
                  <Route path="/bookings/:id/edit" component={BookingFormPage} />
                  <Route path="/bookings/calendar" component={BookingCalendarPage} />
                  <Route path="/bookings/:id" component={BookingDetailsPage} />
                  <Route path="/bookings" component={BookingsPage} />
                  <Route path="/broadcasts" component={BroadcastsPage} />
                  <Route path="/reports/service-profitability" component={ServiceProfitabilityPage} />
                  <Route path="/reports/balance-sheet" component={BalanceSheetPage} />
                  <Route path="/payroll" component={PayrollPage} />
                  <Route path="/payroll/new" component={PayrollNewPage} />
                  <Route path="/payroll/advances" component={PayrollAdvancesPage} />
                  <Route path="/payroll/report" component={PayrollReportPage} />
                  <Route path="/payroll/:periodId" component={PayrollPeriodPage} />
                  <Route path="/profile" component={ProfilePage} />
                  <Route path="/help-support" component={HelpSupportPage} />
                  <Route path="/payroll/:periodId/staff/:staffId" component={PayrollDetailPage} />
                  <Route path="/settings">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsIndexPage />}
                  </Route>
                  <Route path="/settings/stores">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsStoresPage />}
                  </Route>
                  <Route path="/settings/roles">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsRolesPage />}
                  </Route>
                  <Route path="/settings/hr-profiles">
                    {user?.role !== "owner" ? <Redirect to="/" /> : <SettingsHrProfilesPage />}
                  </Route>
                  <Route path="/settings/business">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsBusinessPage />}
                  </Route>
                  <Route path="/settings/store-settings">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsStorePage />}
                  </Route>
                  <Route path="/settings/store-details">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsStoreDetailsPage />}
                  </Route>
                  <Route path="/settings/attendance">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsAttendancePage />}
                  </Route>
                  <Route path="/settings/credit-sales">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsCreditSalesPage />}
                  </Route>
                  <Route path="/settings/payment-integrations">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsPaymentIntegrationsPage />}
                  </Route>
                  <Route path="/settings/whatsapp-number">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsWhatsAppNumberPage />}
                  </Route>
                  <Route path="/settings/capital-assets">
                    {user?.role !== "owner" ? <Redirect to="/" /> : <SettingsCapitalAssetsPage />}
                  </Route>
                  <Route path="/settings/bulk-operations">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsBulkOperationsPage />}
                  </Route>
                  <Route path="/settings/stores/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <LimitGate limitType="store_count"><StoreFormPage /></LimitGate>}
                  </Route>
                  <Route path="/settings/stores/:id/edit">
                    {user?.role === "staff" ? <Redirect to="/" /> : <StoreFormPage />}
                  </Route>
                  <Route path="/settings/business/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <BusinessFormPage />}
                  </Route>
                  <Route path="/settings/business/edit">
                    <Redirect to="/settings/business" />
                  </Route>
                  <Route path="/settings/roles/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <GatedRoleForm />}
                  </Route>
                  <Route path="/settings/roles/:id/edit">
                    {user?.role === "staff" ? <Redirect to="/" /> : <GatedRoleForm />}
                  </Route>
                  <Route path="/vendors" component={VendorsPage} />
                  <Route path="/vendors/new" component={VendorFormPage} />
                  <Route path="/vendors/:id/edit" component={VendorFormPage} />
                  <Route path="/vendors/:vendorId/bills/new" component={VendorBillNewPage} />
                  <Route path="/vendors/bills/:billId/pay" component={VendorBillPayPage} />
                  <Route path="/quotes/new" component={QuoteFormPage} />
                  <Route path="/quotes" component={QuotesPage} />
                  <Route path="/leaderboard" component={LeaderboardPage} />
                  <Route path="/purchase-orders/new" component={PurchaseOrderFormPage} />
                  <Route path="/purchase-orders/:id/edit" component={PurchaseOrderFormPage} />
                  <Route path="/purchase-orders/:id" component={PurchaseOrderDetailPage} />
                  <Route path="/purchase-orders" component={PurchaseOrdersPage} />
                  <Route path="/stock-transfers">
                    {user?.role === "staff" ? <Redirect to="/" /> : <StockTransfersPage />}
                  </Route>
                  <Route path="/stock-transfers/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <StockTransferNewPage />}
                  </Route>
                  <Route path="/settings/taxes">
                    {user?.role === "staff" ? <Redirect to="/" /> : <TaxesCompliancePage />}
                  </Route>
                  <Route path="/settings/promotions">
                    {user?.role === "staff" ? <Redirect to="/" /> : <PromotionsPage />}
                  </Route>
                  <Route path="/settings/billing">
                    {user?.role === "staff" ? <Redirect to="/" /> : <BillingSettingsPage />}
                  </Route>
                  <Route path="/settings/billing/payment-history">
                    {user?.role === "staff" ? <Redirect to="/" /> : <PaymentHistoryPage />}
                  </Route>
                  {/* Most specific first — wouter matches top-down, so
                      /analytics would otherwise swallow its own subpaths. */}
                  <Route path="/analytics/dashboards/:id">
                    {user?.role === "staff" ? <Redirect to="/" /> : <AnalyticsDashboardDetailPage />}
                  </Route>
                  <Route path="/analytics/dashboards">
                    {user?.role === "staff" ? <Redirect to="/" /> : <AnalyticsDashboardsPage />}
                  </Route>
                  <Route path="/analytics">
                    {user?.role === "staff" ? <Redirect to="/" /> : <AnalyticsExplorerPage />}
                  </Route>
                  <Route path="/reports/audit-logs">
                    {user?.role === "staff" ? <Redirect to="/" /> : <AuditLogsPage />}
                  </Route>
                  <Route path="/reports">
                    {user?.role === "staff" ? <Redirect to="/" /> : <ReportsIndexPage />}
                  </Route>
                  <Route component={NotFound} />
                </Switch>
                </ScreenGate>
                </Suspense>
              </div>
            </main>
          </SidebarInset>
          </div>
        </div>
      </SidebarProvider>
    </StoreProvider>
  );
}
