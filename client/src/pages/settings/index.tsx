import { Link } from "wouter";
import {
  Store,
  Building2,
  Tag,
  Percent,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";

const SETTINGS_SECTIONS = [
  {
    title: "Stores",
    description: "Add, edit, or remove your business locations.",
    icon: Store,
    href: "/settings/stores",
    roles: ["owner", "manager"],
  },
  {
    title: "Business Profile",
    description: "Update your business name, address, receipt prefix and branding.",
    icon: Building2,
    href: "/settings/business/edit",
    roles: ["owner"],
  },
  {
    title: "Promotions",
    description: "Configure buy-X-get-Y and spend-threshold promotions.",
    icon: Tag,
    href: "/settings/promotions",
    roles: ["owner", "manager"],
  },
  {
    title: "Taxes & Compliance",
    description: "Set up VAT, sales tax rates, and compliance settings.",
    icon: Percent,
    href: "/settings/taxes",
    roles: ["owner", "manager"],
  },
  {
    title: "Roles & Permissions",
    description: "Create custom staff roles with specific module access.",
    icon: ShieldCheck,
    href: "/settings/roles/new",
    roles: ["owner"],
  },
];

export default function SettingsIndexPage() {
  const { user } = useAuth();

  const visible = SETTINGS_SECTIONS.filter((s) =>
    s.roles.includes(user?.role ?? "")
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your business configuration, stores, and compliance settings."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.href} href={section.href}>
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
