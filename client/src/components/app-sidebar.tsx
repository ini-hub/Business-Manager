import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Package,
  ShoppingCart,
  Receipt,
  TrendingUp,
  BarChart3,
  Settings,
  LogOut,
  LifeBuoy,
  CalendarDays,
  DollarSign,
  Wallet,
  Wallet2,
  Gift,
  BookOpen,
  CalendarClock,
  ArrowLeftRight,
  Truck,
  FileText,
  Percent,
  Building2,
  Coins,
  ShieldCheck,
  Compass,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PayrollPeriod } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStore } from "@/lib/store-context";
import { OrgSwitcher } from "@/components/org-switcher";
import { StoreSelector } from "@/components/store-selector";

type UserRole = "owner" | "manager" | "staff";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: UserRole[];
  shortcut?: string;
}

const managementItems: MenuItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    allowedRoles: ["owner", "manager", "staff"],
    shortcut: "⌥D",
  },
  {
    title: "Customers",
    url: "/customers",
    icon: Users,
    allowedRoles: ["owner", "manager", "staff"],
    shortcut: "⌥C",
  },
  {
    title: "Staff",
    url: "/staff",
    icon: UserCog,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Attendance",
    url: "/staff/attendance",
    icon: CalendarDays,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Inventory",
    url: "/inventory",
    icon: Package,
    allowedRoles: ["owner"],
    shortcut: "⌥I",
  },
  {
    title: "Stock Transfers",
    url: "/stock-transfers",
    icon: ArrowLeftRight,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Purchase Orders",
    url: "/purchase-orders",
    icon: Truck,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Vendors",
    url: "/vendors",
    icon: Building2,
    allowedRoles: ["owner", "manager"],
  },
];

const salesItems: MenuItem[] = [
  {
    title: "New Sale",
    url: "/sales/new",
    icon: ShoppingCart,
    allowedRoles: ["owner", "manager", "staff"],
    shortcut: "⌥N",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: Receipt,
    allowedRoles: ["owner", "manager", "staff"],
    shortcut: "⌥T",
  },
  {
    title: "Credit Sales",
    url: "/credit-sales",
    icon: BookOpen,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Bookings",
    url: "/bookings",
    icon: CalendarClock,
    allowedRoles: ["owner", "manager", "staff"],
  },
  {
    title: "Quotes",
    url: "/quotes",
    icon: FileText,
    allowedRoles: ["owner", "manager", "staff"],
  },
];

const reportsItems: MenuItem[] = [
  {
    title: "Profit & Loss",
    url: "/profit-loss",
    icon: TrendingUp,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Service Profitability",
    url: "/reports/service-profitability",
    icon: BarChart3,
    allowedRoles: ["owner"],
  },
  {
    title: "Staff Performance",
    url: "/reports/staff-performance",
    icon: Users,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Expenses",
    url: "/expenses",
    icon: Wallet,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Payroll",
    url: "/payroll",
    icon: DollarSign,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Analytics Explorer",
    url: "/analytics",
    icon: Compass,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Dashboards",
    url: "/analytics/dashboards",
    icon: LayoutDashboard,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Activity Log",
    url: "/reports/audit-logs",
    icon: ShieldCheck,
    allowedRoles: ["owner", "manager"],
  },
];

const settingsItems: MenuItem[] = [
  {
    title: "Business & Stores",
    url: "/settings/stores",
    icon: Settings,
    allowedRoles: ["owner"],
  },
  {
    title: "Promotions",
    url: "/settings/promotions",
    icon: Gift,
    allowedRoles: ["owner"],
  },
  {
    title: "Taxes & Compliance",
    url: "/settings/taxes",
    icon: Percent,
    allowedRoles: ["owner"],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { currentStore } = useStore();
  const { isMobile, setOpenMobile } = useSidebar();
  
  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  
  const userRole = (user?.role as UserRole) || "staff";
  
  const filterByRole = (items: MenuItem[]) => 
    items.filter(item => item.allowedRoles.includes(userRole));
  
  const visibleManagementItems = filterByRole(managementItems);
  const visibleSalesItems = filterByRole(salesItems);
  const visibleReportsItems = filterByRole(reportsItems);
  const visibleSettingsItems = filterByRole(settingsItems);

  const { data: payrollPeriods } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: ["owner", "manager"].includes(userRole) && !!currentStore?.id && currentStore?.id !== "all",
  });

  const pendingPayrollCount = payrollPeriods?.filter(p => p.status === "pending").length || 0;

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Coins className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-black tracking-tight leading-tight">
              Ko<span className="text-primary">wope</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-medium leading-tight">Business Management System</span>
          </div>
        </div>
        
        {/* Mobile Switchers Panel - Visible only on small devices */}
        <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-sidebar-border lg:hidden animate-fade-in">
          <div className="w-full">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Organization</span>
            <OrgSwitcher />
          </div>
          <div className="w-full">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Store Selector</span>
            <StoreSelector />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3 py-4">
        {visibleManagementItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Management
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleManagementItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      className="gap-3 w-full"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(" ", "-")}`} onClick={handleLinkClick} className="flex items-center w-full justify-between">
                        <div className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </div>
                        {item.shortcut && (
                          <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground opacity-60">
                            {item.shortcut}
                          </kbd>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleSalesItems.length > 0 && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sales
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleSalesItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      className="gap-3 w-full"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(" ", "-")}`} onClick={handleLinkClick} className="flex items-center w-full justify-between">
                        <div className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </div>
                        {item.shortcut && (
                          <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground opacity-60">
                            {item.shortcut}
                          </kbd>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleReportsItems.length > 0 && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Link href="/reports" onClick={handleLinkClick} className="hover:text-foreground transition-colors">
                Reports
              </Link>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleReportsItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.title === "Payroll" ? location.startsWith(item.url) : location === item.url}
                      className="gap-3 relative"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(" ", "-")}`} onClick={handleLinkClick}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {item.title === "Payroll" && pendingPayrollCount > 0 && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow-sm">
                            {pendingPayrollCount}
                          </div>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleSettingsItems.length > 0 && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleSettingsItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      className="gap-3"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/ /g, "-")}`} onClick={handleLinkClick}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 space-y-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="gap-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 w-full"
            >
              <a href="mailto:support@ini-hub.com?subject=Business%20Manager%20Help%20Request" className="flex items-center gap-3 px-2 py-1.5 w-full">
                <LifeBuoy className="h-4 w-4 text-primary shrink-0 animate-pulse" />
                <span className="text-xs font-semibold">Help & Support</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-1">
            <div className="flex items-center gap-3 px-2 py-1.5 w-full">
              <Link href="/profile" className="flex items-center gap-3 flex-1 min-w-0 group hover:opacity-80 transition-opacity" onClick={handleLinkClick}>
                <Avatar className="h-9 w-9 border-2 border-primary/10 transition-transform group-hover:scale-105">
                  <AvatarImage src={user?.profilePhotoUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {user?.name?.charAt(0) || user?.email?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold truncate text-foreground leading-tight">
                    {user?.name || user?.email?.split('@')[0]}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize font-medium tracking-wide">
                    {userRole}
                  </span>
                </div>
              </Link>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleLogout}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                data-testid="button-logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
