import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  LayoutDashboard,
  Building2,
  Users,
  Receipt,
  ToggleLeft,
  Megaphone,
  Heart,
  History,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Clock,
  Menu,
  X,
  Map,
  Coins,
  MessageSquareWarning,
  CreditCard,
  Tag,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { admin, isLoading, logout } = useAdminAuth();
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(120); // 2 minute countdown warning

  const lastActivityRef = useRef<number>(Date.now());
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Inactivity timeout: 2 hours (in milliseconds)
  const INACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000;
  // Warning threshold: 1 hour 58 minutes (in milliseconds)
  const WARNING_THRESHOLD = INACTIVITY_TIMEOUT - 2 * 60 * 1000;

  // Track activity to reset the timer
  useEffect(() => {
    if (!admin) return;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      // If warning modal is open, we can close it and extend session
      if (showTimeoutWarning) {
        setShowTimeoutWarning(false);
        // Ping the auth API to extend the HTTP session cookie
        fetch("/api/admin/auth/me").catch(() => {});
      }
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity);

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
    };
  }, [admin, showTimeoutWarning]);

  // Main inactivity monitoring loop
  useEffect(() => {
    if (!admin) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;

      if (elapsed >= INACTIVITY_TIMEOUT) {
        // Exceeded 2 hours, force logout immediately
        logout();
      } else if (elapsed >= WARNING_THRESHOLD && !showTimeoutWarning) {
        // Exceeded 1 hr 58 mins, trigger warning countdown
        setShowTimeoutWarning(true);
        setSecondsRemaining(Math.ceil((INACTIVITY_TIMEOUT - elapsed) / 1000));
      }
    }, 5000); // Check every 5s

    return () => clearInterval(interval);
  }, [admin, logout]);

  // Countdown timer inside the Warning modal
  useEffect(() => {
    if (showTimeoutWarning) {
      countdownIntervalRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(countdownIntervalRef.current!);
            logout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    }

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [showTimeoutWarning, logout]);

  // Extend session handler
  const extendSession = async () => {
    setShowTimeoutWarning(false);
    lastActivityRef.current = Date.now();
    try {
      await fetch("/api/admin/auth/me");
    } catch (e) {
      console.error(e);
    }
  };

  // Auth Guards: If loading, show spinner. If unauthenticated, redirect.
  useEffect(() => {
    if (!isLoading && !admin && location !== "/super-admin/login") {
      setLocation("/super-admin/login");
    }
  }, [admin, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm font-medium tracking-wider">Decrypting Console...</p>
        </div>
      </div>
    );
  }

  if (!admin) {
    return null; // redirecting
  }

  // Admin Portal Menu Structure
  const menuItems = [
    {
      category: "Overview",
      items: [
        { name: "Dashboard", path: "/super-admin", icon: LayoutDashboard, roles: ["super_admin", "ops_manager", "finance_admin", "support_agent"] },
        { name: "Revenue Analytics", path: "/super-admin/revenue", icon: Coins, roles: ["super_admin", "finance_admin"] },
        { name: "Billing Payments", path: "/super-admin/billing", icon: CreditCard, roles: ["super_admin", "ops_manager", "finance_admin"] },
      ],
    },
    {
      category: "Operations",
      items: [
        { name: "Businesses", path: "/super-admin/businesses", icon: Building2, roles: ["super_admin", "ops_manager", "support_agent"] },
        { name: "Onboarding Funnel", path: "/super-admin/onboarding", icon: Map, roles: ["super_admin", "ops_manager"] },
        { name: "Users Directory", path: "/super-admin/users", icon: Users, roles: ["super_admin", "ops_manager", "support_agent"] },
        { name: "Transactions Ledger", path: "/super-admin/transactions", icon: Receipt, roles: ["super_admin", "ops_manager", "support_agent"] },
        { name: "Support Inbox", path: "/super-admin/support-inbox", icon: MessageSquareWarning, roles: ["super_admin", "ops_manager", "support_agent"] },
      ],
    },
    {
      category: "Platform Control",
      items: [
        { name: "Feature Flags", path: "/super-admin/flags", icon: ToggleLeft, roles: ["super_admin"] },
        { name: "Feature Catalog", path: "/super-admin/feature-catalog", icon: Tag, roles: ["super_admin", "finance_admin"] },
        { name: "Platform Settings", path: "/super-admin/platform-settings", icon: Settings, roles: ["super_admin"] },
        { name: "Announcements", path: "/super-admin/announcements", icon: Megaphone, roles: ["super_admin"] },
      ],
    },
    {
      category: "Security & Auditing",
      items: [
        { name: "System Health", path: "/super-admin/health", icon: Heart, roles: ["super_admin", "ops_manager"] },
        { name: "Audit Trail", path: "/super-admin/audit-logs", icon: History, roles: ["super_admin", "ops_manager", "finance_admin"] },
        { name: "Admin Accounts", path: "/super-admin/accounts", icon: Shield, roles: ["super_admin"] },
      ],
    },
  ];

  const handleNavClick = (path: string) => {
    setLocation(path);
    setMobileOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border text-sidebar-foreground font-sans select-none">
      {/* Branding Section */}
      <div className="flex items-center justify-between p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-background border border-border rounded-xl">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          {!collapsed && (
            <div className="animate-in fade-in duration-300">
              <span className="font-bold text-sidebar-foreground text-sm tracking-wide block">Admin Console</span>
              <span className="text-[10px] text-primary font-medium uppercase tracking-widest">
                {admin.role.replace("_", " ")}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex p-1.5 rounded-lg bg-background border border-border hover:border-primary/40 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>

      {/* Roster of Navigation Links */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 scrollbar-thin scrollbar-thumb-muted">
        {menuItems.map((group) => {
          // Filter items based on role
          const filteredItems = group.items.filter((item) => item.roles.includes(admin.role));
          if (filteredItems.length === 0) return null;

          return (
            <div key={group.category} className="space-y-2">
              {!collapsed && (
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3">
                  {group.category}
                </h4>
              )}
              <div className="space-y-1">
                {filteredItems.map((item) => {
                  const isActive = location === item.path;
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.name}
                      onClick={() => handleNavClick(item.path)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                        isActive
                          ? "bg-primary/10 border border-primary/30 text-foreground"
                          : "hover:bg-muted/50 hover:text-foreground border border-transparent"
                      }`}
                    >
                      <Icon
                        className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"
                        }`}
                      />
                      {!collapsed && <span className="truncate">{item.name}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* User Session profile / footer */}
      <div className="p-4 border-t border-sidebar-border bg-background/40">
        <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-9 h-9 rounded-xl bg-muted border border-border flex items-center justify-center font-bold text-primary shrink-0">
            {admin.name[0]}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-foreground truncate">{admin.name}</span>
              <span className="block text-[10px] text-muted-foreground truncate">{admin.email}</span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="p-2 rounded-lg bg-background border border-border hover:bg-muted hover:border-primary/30 transition-colors text-muted-foreground hover:text-foreground"
              title="Logout Operations"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center mt-3 p-2 rounded-lg bg-background border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar - Desktop */}
      <aside className={`hidden md:block shrink-0 transition-all duration-300 ${collapsed ? "w-20" : "w-64"}`}>
        <SidebarContent />
      </aside>

      {/* Mobile Drawer Navigation */}
      <div className={`fixed inset-0 z-50 md:hidden bg-background/80 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className={`fixed inset-y-0 left-0 w-64 z-50 transition-transform duration-300 transform ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="h-full relative">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-5 p-1 rounded-lg bg-card border border-border text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header - Mobile */}
        <header className="flex md:hidden items-center justify-between p-4 bg-sidebar border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold text-sidebar-foreground text-sm">Super Admin Console</span>
          </div>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg bg-background border border-border text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        {/* Dynamic Inner Panel Viewport */}
        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-6 md:py-8 bg-background relative">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </div>

      {/* Inactivity Session Expiry Modal Warning */}
      <Dialog open={showTimeoutWarning} onOpenChange={() => {}}>
        <DialogContent className="bg-card border border-border text-foreground max-w-sm rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-2xl flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 animate-bounce" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              Administrative Session Expiring
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              Your console session has been inactive. For strict compliance and security, you will be automatically logged out in:
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 p-4 bg-muted border border-border rounded-2xl flex items-center justify-center gap-3">
            <Clock className="h-6 w-6 text-primary" />
            <span className="text-3xl font-mono font-bold text-foreground">
              {Math.floor(secondsRemaining / 60)}:{(secondsRemaining % 60).toString().padStart(2, "0")}
            </span>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 rounded-xl border-border hover:bg-muted text-muted-foreground"
              onClick={logout}
            >
              Sign Out
            </Button>
            <Button
              className="flex-[2] rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={extendSession}
            >
              Extend Session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
