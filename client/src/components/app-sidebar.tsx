import { BrandMark } from "@/components/brand-mark";
import { useAttendanceTracked } from "@/hooks/useAttendanceTracked";
import { useEntitlements, formatPrice } from "@/hooks/useEntitlements";
import { featureForScreen } from "@shared/features";
import { resolveSidebarLayout, isNavItemActive, type NavItemDef } from "@shared/sidebarLayout";
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
  Handshake,
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
import { useScrollMemory } from "@/hooks/useScrollMemory";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStore } from "@/lib/store-context";
import { OrgSwitcher } from "@/components/org-switcher";
import { StoreSelector } from "@/components/store-selector";

const isBuiltInRole = (role: string) => role === "owner" || role === "manager" || role === "staff";

// Registry icon keys (shared/sidebarLayout.ts NAV_ITEMS) to components.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, UserCog, Package, ShoppingCart, Receipt, TrendingUp, BarChart3, Settings,
  CalendarDays, DollarSign, Wallet, BookOpen, CalendarClock, ArrowLeftRight, Handshake, Truck,
  FileText, Building2, ShieldCheck, Compass, MessageSquare, Scale, Trophy, Tag, Percent,
};

// Section labels that also link to a page (by section id).
const SECTION_LINKS: Record<string, string> = { reports: "/reports" };

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
  
  // A built-in role, or a custom role's lowercased name.
  const userRole = (user?.role as string) || "staff";

  // Flag off => the item (and the feature behind it) is hidden entirely.
  const { isDisabled, isLocked, isLoading: entitlementsLoading, sidebarLayout, permissions } = useEntitlements();
  // The pages this role may use. Until they load, a built-in role falls back to the layout (which matches
  // its defaults); a custom role shows nothing rather than flashing every page.
  const allowed = permissions ? new Set(permissions) : isBuiltInRole(userRole) ? null : new Set<string>();
  // A store that doesn't keep attendance has nothing to show on that page.
  const { tracked: attendanceTracked } = useAttendanceTracked(userRole !== "owner" && userRole !== "manager");

  // Which pages and sections each role sees is a super-admin setting (shared/sidebarLayout.ts);
  // this only drops what the org's features or store settings rule out.
  const isVisible = (item: NavItemDef) => {
    if (item.url === "/staff/attendance" && !attendanceTracked) return false;
    const owner = featureForScreen(item.url);
    // Not shown until we know the feature isn't switched off, so items don't appear and then vanish.
    if (owner && owner !== "core_platform" && entitlementsLoading) return false;
    if (owner && isDisabled(owner)) return false;
    // Credit is part of the checkout flow, so its screens are absent (not teased) until it is paid for.
    return !(owner === "credit_sale" && isLocked(owner));
  };
  const sections = resolveSidebarLayout(sidebarLayout, userRole, allowed)
    .map((section) => ({ ...section, items: section.items.filter(isVisible) }))
    .filter((section) => section.items.length > 0);

  // Reopen the nav where it was left; wait for the sections so the offset isn't clamped.
  const navScrollRef = useScrollMemory("app-sidebar", sections.length > 0);

  const { data: payrollPeriods } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!allowed?.has("/payroll") && !!currentStore?.id && currentStore?.id !== "all",
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
      <SidebarContent ref={navScrollRef} className="px-3 py-4">
        {sections.map((section, i) => {
          const href = SECTION_LINKS[section.id];
          return (
            <SidebarGroup key={section.id} className={i > 0 ? "mt-4" : undefined}>
              <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {href ? (
                  <Link href={href} onClick={handleLinkClick} className="hover:text-foreground transition-colors">
                    {section.label}
                  </Link>
                ) : (
                  section.label
                )}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isNavItemActive(item.url, location)} className="gap-3 w-full">
                          <Link
                            href={item.url}
                            data-testid={`nav-${item.title.toLowerCase().replace(/ /g, "-")}`}
                            onClick={handleLinkClick}
                            className="relative flex items-center w-full justify-between"
                          >
                            <div className="flex items-center gap-3">
                              {Icon && <Icon className="h-4 w-4" />}
                              <span>{item.title}</span>
                              <NavLock url={item.url} />
                            </div>
                            {item.shortcut && (
                              <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground opacity-60">
                                {item.shortcut}
                              </kbd>
                            )}
                            {item.url === "/payroll" && pendingPayrollCount > 0 && (
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white shadow-sm">
                                {pendingPayrollCount}
                              </div>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
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
