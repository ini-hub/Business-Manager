import { Link } from "wouter";
import {
  Store,
  Building2,
  Tag,
  Percent,
  ShieldCheck,
  ChevronRight,
  CreditCard,
  Clock,
  BookOpen,
  Database,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";

type SettingsCard = {
  title: string;
  description: string;
  icon: typeof Store;
  href: string;
  roles: Array<"owner" | "manager">;
};

// Org-wide - applies across every store the business has, never scoped to
// just one. Role list matches each destination's actual write permission
// (server/routes/business.routes.ts, server/routes/settings.routes.ts):
// Billing is the one business-level thing a manager can browse (not check
// out) - see FeatureAddOns.tsx.
const BUSINESS_SETTINGS: SettingsCard[] = [
  {
    title: "Business Profile",
    description: "Your business name, address, receipt prefix default, and branding.",
    icon: Building2,
    href: "/settings/business",
    roles: ["owner"],
  },
  {
    title: "Manage Stores",
    description: "Add, edit, or remove your business locations.",
    icon: Store,
    href: "/settings/stores",
    roles: ["owner"],
  },
  {
    title: "Roles & Permissions",
    description: "Create custom staff roles with specific module access.",
    icon: ShieldCheck,
    href: "/settings/roles",
    roles: ["owner"],
  },
  {
    title: "Billing & Subscription",
    description: "View your trial status, manage your plan, and update payment details.",
    icon: CreditCard,
    href: "/settings/billing",
    roles: ["owner", "manager"],
  },
];

// Scoped to whichever store is currently active (the same store selector
// used everywhere else in the app) - every write endpoint here already
// grants manager access, so nothing in this section is owner-only.
const STORE_SETTINGS: SettingsCard[] = [
  {
    title: "Store Details",
    description: "Receipt branding, low-stock threshold, payroll defaults, and loyalty configuration.",
    icon: Store,
    href: "/settings/store-details",
    roles: ["owner", "manager"],
  },
  {
    title: "Attendance & Clock-In",
    description: "Configure clock-in, geofencing, and late-deduction rules.",
    icon: Clock,
    href: "/settings/attendance",
    roles: ["owner", "manager"],
  },
  {
    title: "Credit Sales Reminders",
    description: "Debt reminder cadence and messaging for credit sales.",
    icon: BookOpen,
    href: "/settings/credit-sales",
    roles: ["owner", "manager"],
  },
  {
    title: "Payment Integrations",
    description: "Connect Flutterwave, Stripe, or Paystack for this store's own checkout.",
    icon: CreditCard,
    href: "/settings/payment-integrations",
    roles: ["owner", "manager"],
  },
  {
    title: "Promotions",
    description: "Configure buy-X-get-Y and spend-threshold promotions.",
    icon: Tag,
    href: "/settings/promotions",
    roles: ["owner", "manager"],
  },
  {
    title: "Tax Rates",
    description: "Set up VAT, sales tax rates, and compliance settings.",
    icon: Percent,
    href: "/settings/taxes",
    roles: ["owner", "manager"],
  },
  {
    title: "Bulk Operations",
    description: "Bulk import or export staff, expenses, inventory, and customers.",
    icon: Database,
    href: "/settings/bulk-operations",
    roles: ["owner", "manager"],
  },
];

function SettingsSection({ title, description, cards, role }: { title: string; description: string; cards: SettingsCard[]; role: "owner" | "manager" }) {
  const visible = cards.filter((c) => c.roles.includes(role));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.title} href={section.href}>
              <Card className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all group">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm">{section.title}</p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {section.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * THE settings screen - two sections on one page, not another click-through
 * hub. Business Settings (org-wide) vs Store Settings (scoped to whichever
 * store is active app-wide) - see the Settings Screen Restructure
 * requirements plan for why this split exists and how each section's role
 * gating was derived from the actual backend permissions.
 */
export default function SettingsIndexPage() {
  const { user } = useAuth();
  const { currentStore } = useStore();
  const role = (user?.role === "owner" ? "owner" : "manager") as "owner" | "manager";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your business configuration, stores, and compliance settings."
      />

      <SettingsSection
        title="Business Settings"
        description="Applies across every store your business has."
        cards={BUSINESS_SETTINGS}
        role={role}
      />

      <SettingsSection
        title={`Store Settings${currentStore && currentStore.id !== "all" ? ` — ${currentStore.name}` : ""}`}
        description="Only affects the store you currently have selected. Switch stores with the store selector to configure a different one."
        cards={STORE_SETTINGS}
        role={role}
      />
    </div>
  );
}
