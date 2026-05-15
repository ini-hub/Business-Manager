import { Switch, Route, useLocation } from "wouter";
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
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomerDetails from "@/pages/customer-details";
import StaffPage from "@/pages/staff";
import AttendancePage from "@/pages/attendance";
import InventoryPage from "@/pages/inventory";
import InventoryDetails from "@/pages/inventory-details";
import NewSale from "@/pages/new-sale";
import Transactions from "@/pages/transactions";
import ProfitLossPage from "@/pages/profit-loss";
import ExpensesPage from "@/pages/expenses";
import PayrollPage from "@/pages/payroll";
import PayrollDetailPage from "@/pages/payroll-detail";
import SettingsStoresPage from "@/pages/settings-stores";
import OnboardingWizard from "@/pages/onboarding";
import NotFound from "@/pages/not-found";

import Login from "@/pages/auth/login";
import Signup from "@/pages/auth/signup";
import VerifyOtp from "@/pages/auth/verify-otp";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";

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

  // Redirect to onboarding via useEffect (never call setLocation during render)
  useEffect(() => {
    if (!storesLoading && !hasStores && location !== "/onboarding") {
      setLocation("/onboarding");
    }
  }, [storesLoading, hasStores, location]);

  if (storesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Render nothing while redirect is in-flight
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
                <Separator orientation="vertical" className="h-6" />
                <div className="w-48">
                  <StoreSelector />
                </div>
              </div>
              <ThemeToggle />
            </header>
            <main className="flex-1 overflow-auto p-6">
              <div className="mx-auto max-w-7xl">
                <Switch>
                  <Route path="/" component={Dashboard} />
                  <Route path="/customers" component={Customers} />
                  <Route path="/customers/:id" component={CustomerDetails} />
                  <Route path="/staff" component={StaffPage} />
                  <Route path="/staff/attendance" component={AttendancePage} />
                  <Route path="/inventory" component={InventoryPage} />
                  <Route path="/inventory/:id" component={InventoryDetails} />
                  <Route path="/sales/new" component={NewSale} />
                  <Route path="/transactions" component={Transactions} />
                  <Route path="/profit-loss" component={ProfitLossPage} />
                  <Route path="/expenses" component={ExpensesPage} />
                  <Route path="/payroll" component={PayrollPage} />
                  <Route path="/payroll/:periodId/staff/:staffId" component={PayrollDetailPage} />
                  <Route path="/settings/stores" component={SettingsStoresPage} />
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="business-manager-theme">
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
