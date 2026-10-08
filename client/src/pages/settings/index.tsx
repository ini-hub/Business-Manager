import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Store,
  Building2,
  ShieldCheck,
  CreditCard,
  Clock,
  BookOpen,
  Database,
  MessageSquare,
  Wallet,
  Users,
  Tag,
  Percent,
  Receipt,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { cn } from "@/lib/utils";

type Role = "owner" | "manager";

type SettingsCard = {
  title: string;
  icon: typeof Store;
  href: string;
  roles: Role[];
  // Shown beside the title on desktop and used by the search box.
  summary: string;
};

// Org-wide - applies across every store the business has. Role lists match
// each destination's write permission (server/routes/business.routes.ts,
// server/routes/settings.routes.ts). Billing is the one business-level page
// a manager can browse but not check out.
const BUSINESS_SETTINGS: SettingsCard[] = [
  { title: "Business profile", icon: Building2, href: "/settings/business", roles: ["owner"], summary: "Name, logo and contact details" },
  { title: "Stores", icon: Store, href: "/settings/stores", roles: ["owner"], summary: "Add, edit or archive locations" },
  { title: "Roles", icon: ShieldCheck, href: "/settings/roles", roles: ["owner"], summary: "What each role can open" },
  { title: "Staff profiles", icon: Users, href: "/settings/hr-profiles", roles: ["owner"], summary: "What new staff fill in when they join" },
  { title: "Billing", icon: CreditCard, href: "/settings/billing", roles: ["owner", "manager"], summary: "Trial, plan and payment details" },
];

// Scoped to the store selected in the top bar. Every write endpoint here
// already grants manager access, so only Capital and assets is owner-only.
const STORE_SETTINGS: SettingsCard[] = [
  { title: "Store details", icon: Receipt, href: "/settings/store-details", roles: ["owner", "manager"], summary: "Receipts, stock alerts, pay rules and loyalty" },
  { title: "Attendance", icon: Clock, href: "/settings/attendance", roles: ["owner", "manager"], summary: "Clock-in, location and lateness" },
  { title: "Credit reminders", icon: BookOpen, href: "/settings/credit-sales", roles: ["owner", "manager"], summary: "When customers who owe are reminded" },
  { title: "Payments", icon: CreditCard, href: "/settings/payment-integrations", roles: ["owner", "manager"], summary: "Transfer accounts, Flutterwave, Stripe or Paystack" },
  { title: "WhatsApp", icon: MessageSquare, href: "/settings/whatsapp-number", roles: ["owner", "manager"], summary: "The number customers get messages from" },
  { title: "Capital and assets", icon: Wallet, href: "/settings/capital-assets", roles: ["owner"], summary: "Feeds the balance sheet report" },
  { title: "Promotions", icon: Tag, href: "/settings/promotions", roles: ["owner", "manager"], summary: "Discounts that apply at checkout" },
  { title: "Tax rates", icon: Percent, href: "/settings/taxes", roles: ["owner", "manager"], summary: "Tax added to sales at checkout" },
  { title: "Bulk operations", icon: Database, href: "/settings/bulk-operations", roles: ["owner", "manager"], summary: "Import or export staff, expenses, stock, customers" },
];

function SettingsTile({ card }: { card: SettingsCard }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      data-testid={`settings-tile-${card.href.split("/").pop()}`}
      className={cn(
        "group relative flex flex-col items-center gap-3 rounded-xl border bg-card p-4 text-center transition-colors",
        "hover:border-primary/50 sm:flex-row sm:items-start sm:gap-4 sm:p-5 sm:text-left",
      )}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{card.title}</p>
        <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">{card.summary}</p>
      </div>
    </Link>
  );
}

function SettingsSection({
  title,
  badge,
  description,
  cards,
}: {
  title: string;
  badge?: string;
  description: string;
  cards: SettingsCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {title}
          {badge && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
              {badge}
            </span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => (
          <SettingsTile key={card.href} card={card} />
        ))}
      </div>
    </section>
  );
}

export default function SettingsIndexPage() {
  const { user } = useAuth();
  const { currentStore } = useStore();
  const role: Role = user?.role === "owner" ? "owner" : "manager";
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const keep = (c: SettingsCard) =>
      c.roles.includes(role) && (!q || `${c.title} ${c.summary}`.toLowerCase().includes(q));
    return { business: BUSINESS_SETTINGS.filter(keep), store: STORE_SETTINGS.filter(keep) };
  }, [role, q]);

  const storeName = currentStore && currentStore.id !== "all" ? currentStore.name : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your business configuration, stores, and compliance settings.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a setting"
            className="pl-9"
            data-testid="input-find-setting"
          />
        </div>
      </div>

      <SettingsSection
        title="Business Settings"
        description="Applies across every store your business has."
        cards={visible.business}
      />
      <SettingsSection
        title={`Store Settings - ${storeName ?? "Store"}`}
        description="Only affects the store you currently have selected. Switch stores with the store selector to configure a different one."
        cards={visible.store}
      />

      {q && visible.business.length + visible.store.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>
      )}
    </div>
  );
}
