import { BrandMark } from "@/components/brand-mark";
import { useAttendanceTracked } from "@/hooks/useAttendanceTracked";
import { useEntitlements, formatPrice } from "@/hooks/useEntitlements";
import { featureForScreen } from "@shared/features";
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
  Lock,
  LifeBuoy,
  CalendarDays,
  DollarSign,
  Wallet, BookOpen,
  CalendarClock,
  ArrowLeftRight,
  Truck,
  FileText,
  Building2,
  ShieldCheck,
  Compass,
  MessageSquare,
  Scale,
  Trophy,
  Tag,
  Percent,
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
import { IconButton } from "@/components/icon-button";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStore } from "@/lib/store-context";
import { OrgSwitcher } from "@/components/org-switcher";
import { StoreSelector } from "@/components/store-selector";

type UserRole = "owner" | "manager" | "staff";

/**
 * A lock beside a nav item whose page needs a feature the org doesn't hold. The
 * link stays clickable: the page itself explains what is missing and how to add
 * it. Which pages are gated comes from the feature registry (gatedScreens), not
 * from this file. While entitlements load or fail, show nothing rather than lock
 * everything.
 */
function NavLock({ url }: { url: string }) {
  const { hasFeature, isLoading, isError, gatedFeatureFor, priceFor } = useEntitlements();
  const feature = gatedFeatureFor(url);
  if (!feature || isLoading || isError || hasFeature(feature)) return null;
  const price = formatPrice(priceFor(feature));
  const label = price ? `${priceFor(feature)?.name ?? "This feature"} costs ${price}` : "Not included in your plan";
  return <Lock className="h-3 w-3 text-muted-foreground" aria-label={label} />;
}

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: UserRole[];
  shortcut?: string;
}

// Staff see their own work, not the business's management menu: what they do
// every shift first (sell, bookings, clock-in), then their own records. Payroll
// is here as well as on the dashboard's pay card, so it is never a hunt.
const staffWorkItems: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, allowedRoles: ["staff"], shortcut: "⌥D" },
  { title: "New Sale", url: "/sales/new", icon: ShoppingCart, allowedRoles: ["staff"], shortcut: "⌥N" },
  { title: "Bookings", url: "/bookings", icon: CalendarClock, allowedRoles: ["staff"] },
  { title: "My Attendance", url: "/staff/attendance", icon: CalendarDays, allowedRoles: ["staff"] },
  { title: "My Payroll", url: "/staff/payroll", icon: DollarSign, allowedRoles: ["staff"] },
];

const staffMoreItems: MenuItem[] = [
  { title: "Customers", url: "/customers", icon: Users, allowedRoles: ["staff"], shortcut: "⌥C" },
  { title: "Transactions", url: "/transactions", icon: Receipt, allowedRoles: ["staff"], shortcut: "⌥T" },
  { title: "Quotes", url: "/quotes", icon: FileText, allowedRoles: ["staff"] },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy, allowedRoles: ["staff"] },
];

const managementItems: MenuItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    allowedRoles: ["owner", "manager"],
    shortcut: "⌥D",
  },
  {
    title: "Customers",
    url: "/customers",
    icon: Users,
    allowedRoles: ["owner", "manager"],
    shortcut: "⌥C",
  },
  {
    title: "Staff",
    url: "/staffs",
    icon: UserCog,
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
    allowedRoles: ["owner", "manager"],
    shortcut: "⌥N",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: Receipt,
    allowedRoles: ["owner", "manager"],
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
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Broadcasts",
    url: "/broadcasts",
    icon: MessageSquare,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Quotes",
    url: "/quotes",
    icon: FileText,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Leaderboard",
    url: "/leaderboard",
    icon: Trophy,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Promotions",
    url: "/settings/promotions",
    icon: Tag,
    allowedRoles: ["owner", "manager"],
  },
  {
    title: "Taxes",
    url: "/settings/taxes",
    icon: Percent,
    allowedRoles: ["owner", "manager"],
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
    title: "Balance Sheet",
    url: "/reports/balance-sheet",
    icon: Scale,
    allowedRoles: ["owner"],
  },
  {
    title: "Staff Performance",
    url: "/staffs/performance",
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

// One entry point into Settings (Business Settings + Store Settings, split
// by scope on the /settings landing page itself - see the Settings Screen
// Restructure requirements plan). Visible to owner and manager: managers
// already have write access to most Store Settings sections and can browse
// Billing, so hiding the whole area from them was an inconsistency, not a
// real restriction - Business-owner-only sections are gated within the page.
const settingsItems: MenuItem[] = [
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    allowedRoles: ["owner", "manager"],
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
  
  // Flag off => the item (and the feature behind it) is hidden entirely.
  const { isDisabled, isLocked, isLoading: entitlementsLoading } = useEntitlements();
  const filterByRole = (items: MenuItem[]) =>
    items.filter((item) => {
      if (!item.allowedRoles.includes(userRole)) return false;
      const owner = featureForScreen(item.url);
      // Not shown until we know the feature isn't switched off, so items don't appear and then vanish.
      if (owner && owner !== "core_platform" && entitlementsLoading) return false;
      if (owner && isDisabled(owner)) return false;
      // Credit is part of the checkout flow, so its screens are absent (not teased) until it is paid for.
      return !(owner === "credit_sale" && isLocked(owner));
    });
  
  // A store that doesn't keep attendance has nothing to show on that page.
  const { tracked: attendanceTracked } = useAttendanceTracked(userRole === "staff");
  const visibleStaffWorkItems = filterByRole(staffWorkItems).filter(
    (item) => attendanceTracked || item.url !== "/staff/attendance",
  );
  const visibleStaffMoreItems = filterByRole(staffMoreItems);
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
          <BrandMark size={40} />
          <div className="flex flex-col">
            <span className="font-[Instrument_Sans,system-ui,sans-serif] text-lg font-bold leading-tight tracking-[-0.03em]">
              kowope
            </span>
            <span className="text-[11px] text-muted-foreground font-medium leading-tight">Business Management System</span>
          </div>
        </div>
        
        {/* Mobile Switchers Panel - Visible only on small devices */}
        <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-sidebar-border lg:hidden animate-fade-in">
          <div className="w-full">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Organization</span>
            <OrgSwitcher />
          </div>
          <div className="w-full">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Store Selector</span>
            <StoreSelector />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3 py-4">
        {[
          { label: "My Work", items: visibleStaffWorkItems },
          { label: "More", items: visibleStaffMoreItems },
        ].map((group, i) => group.items.length > 0 && (
          <SidebarGroup key={group.label} className={i > 0 ? "mt-4" : undefined}>
            <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.url === "/" ? location === "/" : location === item.url || location.startsWith(item.url + "/")}
                      className="gap-3 w-full"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/ /g, "-")}`} onClick={handleLinkClick} className="flex items-center w-full justify-between">
                        <div className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <NavLock url={item.url} />
                        </div>
                        {item.shortcut && (
                          <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground opacity-60">
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
        ))}

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
                      isActive={item.title === "My Payroll" ? location.startsWith(item.url) : location === item.url}
                      className="gap-3 w-full"
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(" ", "-")}`} onClick={handleLinkClick} className="flex items-center w-full justify-between">
                        <div className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <NavLock url={item.url} />
                        </div>
                        {item.shortcut && (
                          <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground opacity-60">
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
                          <NavLock url={item.url} />
                        </div>
                        {item.shortcut && (
                          <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground opacity-60">
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
                          <NavLock url={item.url} />
                        {item.title === "Payroll" && pendingPayrollCount > 0 && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white shadow-sm">
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
                          <NavLock url={item.url} />
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
              <Link href="/help-support" className="flex items-center gap-3 px-2 py-2 w-full" onClick={handleLinkClick}>
                <LifeBuoy className="h-4 w-4 text-primary shrink-0 animate-pulse" />
                <span className="text-xs font-semibold">Help & Support</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-1">
            <div className="flex items-center gap-3 px-2 py-2 w-full">
              <Link href="/profile" className="flex items-center gap-3 flex-1 min-w-0 group hover:opacity-80 transition-opacity" onClick={handleLinkClick}>
                <Avatar className="h-10 w-10 border-2 border-primary/10 transition-transform group-hover:scale-105">
                  <AvatarImage src={user?.profilePhotoUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {user?.name?.charAt(0) || user?.email?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold truncate text-foreground leading-tight">
                    {user?.name || user?.email?.split('@')[0]}
                  </span>
                  <span className="text-[11px] text-muted-foreground capitalize font-medium tracking-wide">
                    {userRole}
                  </span>
                </div>
              </Link>
              <IconButton
                variant="ghost"
                label="Logout"
                onClick={handleLogout}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </IconButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
