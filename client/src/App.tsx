import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
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
import { Loader2 } from "lucide-react";

import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomerDetails from "@/pages/customer-details";
import StaffPage from "@/pages/staff";
import StaffFormPage from "@/pages/staff-form";
import AttendancePage from "@/pages/attendance";
import InventoryPage from "@/pages/inventory";
import InventoryDetails from "@/pages/inventory-details";
import NewSale from "@/pages/new-sale";
import Transactions from "@/pages/transactions";
import ProfitLossPage from "@/pages/profit-loss";
import ExpensesPage from "@/pages/expenses";
import PayrollPage from "@/pages/payroll";
import PayrollDetailPage from "@/pages/payroll-detail";
import BorrowBookPage from "@/pages/borrow-book";
import SettingsStoresPage from "@/pages/settings-stores";
import PromotionsPage from "@/pages/settings/promotions";
import OnboardingWizard from "@/pages/onboarding";
import StaffPerformancePage from "@/pages/staff-performance";
import ProfilePage from "@/pages/profile";
import StaffDashboard from "@/pages/staff-dashboard";
import NotFound from "@/pages/not-found";
import ServiceProfitabilityPage from "@/pages/service-profitability";
import { GlobalSearch } from "@/components/global-search";
import { NotificationSheet } from "@/components/notification-sheet";

import StoreFormPage from "@/pages/store-form";
import BusinessFormPage from "@/pages/business-form";
import RoleFormPage from "@/pages/role-form";

import Login from "@/pages/auth/login";
import Signup from "@/pages/auth/signup";
import VerifyOtp from "@/pages/auth/verify-otp";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineSyncManager } from "@/components/offline-sync-manager";

function OnboardingRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/auth/login");
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return null;
  return <OnboardingWizard />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="ui-theme">
        <TooltipProvider>
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
          <Toaster />
          <OfflineSyncManager />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/signup" component={Signup} />
      <Route path="/auth/verify-otp" component={VerifyOtp} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/onboarding" component={OnboardingRoute} />
      <Route>
        {isAuthenticated ? <AuthenticatedLayout /> : <Landing />}
      </Route>
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Fetch stores to determine if onboarding is needed
  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["/api/stores"],
    enabled: !!user,
  });

  const hasStores = !storesLoading && Array.isArray(stores) && stores.length > 0;

  // Redirect to onboarding via useEffect
  useEffect(() => {
    if (!storesLoading && !hasStores && location !== "/onboarding") {
      setLocation("/onboarding");
    }
  }, [storesLoading, hasStores, location, setLocation]);

  if (storesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasStores) return null;

  return (
    <StoreProvider>
      <SidebarProvider style={sidebarStyle as React.CSSProperties}>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <SidebarInset className="flex flex-col flex-1">
            <header className="sticky top-0 z-50 flex h-14 items-center justify-between gap-4 border-b bg-background px-4">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <Separator orientation="vertical" className="hidden md:block h-6" />
                <div className="hidden md:block w-48">
                  <OrgSwitcher />
                </div>
                <Separator orientation="vertical" className="hidden md:block h-6" />
                <div className="hidden md:block w-48">
                  <StoreSelector />
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center max-w-sm mx-auto">
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-2">
                <NotificationSheet />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto p-6">
              <div className="mx-auto max-w-7xl">
                <Switch>
                  <Route path="/">
                    {user?.role === "staff" ? <StaffDashboard /> : <Dashboard />}
                  </Route>
                  <Route path="/customers" component={Customers} />
                  <Route path="/customers/:id" component={CustomerDetails} />
                  <Route path="/staff" component={StaffPage} />
                  <Route path="/staff/new" component={StaffFormPage} />
                  <Route path="/staff/:id/edit" component={StaffFormPage} />
                  <Route path="/staff/attendance" component={AttendancePage} />
                  <Route path="/inventory" component={InventoryPage} />
                  <Route path="/inventory/:id" component={InventoryDetails} />
                  <Route path="/sales/new" component={NewSale} />
                  <Route path="/transactions" component={Transactions} />
                  <Route path="/profit-loss" component={ProfitLossPage} />
                  <Route path="/expenses" component={ExpensesPage} />
                  <Route path="/borrow-book" component={BorrowBookPage} />
                  <Route path="/reports/staff-performance" component={StaffPerformancePage} />
                  <Route path="/reports/service-profitability" component={ServiceProfitabilityPage} />
                  <Route path="/payroll" component={PayrollPage} />
                  <Route path="/profile" component={ProfilePage} />
                  <Route path="/payroll/:periodId/staff/:staffId" component={PayrollDetailPage} />
                  <Route path="/settings/stores">
                    {user?.role === "staff" ? <Redirect to="/" /> : <SettingsStoresPage />}
                  </Route>
                  <Route path="/settings/stores/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <StoreFormPage />}
                  </Route>
                  <Route path="/settings/stores/:id/edit">
                    {user?.role === "staff" ? <Redirect to="/" /> : <StoreFormPage />}
                  </Route>
                  <Route path="/settings/business/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <BusinessFormPage />}
                  </Route>
                  <Route path="/settings/business/edit">
                    {user?.role === "staff" ? <Redirect to="/" /> : <BusinessFormPage />}
                  </Route>
                  <Route path="/settings/roles/new">
                    {user?.role === "staff" ? <Redirect to="/" /> : <RoleFormPage />}
                  </Route>
                  <Route path="/settings/roles/:id/edit">
                    {user?.role === "staff" ? <Redirect to="/" /> : <RoleFormPage />}
                  </Route>
                  <Route path="/settings/promotions">
                    {user?.role === "staff" ? <Redirect to="/" /> : <PromotionsPage />}
                  </Route>
                  <Route component={NotFound} />
                </Switch>
              </div>
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </StoreProvider>
  );
}
