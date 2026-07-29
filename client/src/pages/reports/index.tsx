import { Link } from "wouter";
import {
  TrendingUp,
  BarChart3,
  Users,
  Wallet,
  DollarSign,
  ShieldCheck,
  ChevronRight,
  Compass,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";

const REPORT_SECTIONS = [
  {
    title: "Profit & Loss",
    description: "Track revenue, cost of goods, gross profit and net income over any period.",
    icon: TrendingUp,
    href: "/profit-loss",
    roles: ["owner", "manager"],
  },
  {
    title: "Expenses",
    description: "Review and categorise all business expenditure by date, type and payment method.",
    icon: Wallet,
    href: "/expenses",
    roles: ["owner", "manager"],
  },
  {
    title: "Payroll",
    description: "Manage payroll periods, approve earnings, track disbursements and salary advances.",
    icon: DollarSign,
    href: "/payroll",
    roles: ["owner", "manager"],
  },
  {
    title: "Staff Performance",
    description: "Compare commission earnings, attendance, and sales output across your team.",
    icon: Users,
    href: "/reports/staff-performance",
    roles: ["owner", "manager"],
  },
  {
    title: "Service Profitability",
    description: "Analyse revenue, cost, and net profit per service line or product category.",
    icon: BarChart3,
    href: "/reports/service-profitability",
    roles: ["owner"],
  },
  {
    title: "Analytics Explorer",
    description: "Build your own view: any measures, any breakdown, any time grain, all stores side by side.",
    icon: Compass,
    href: "/analytics",
    roles: ["owner", "manager"],
  },
  {
    title: "Activity Log",
    description: "A full audit trail of every change made across inventory, payroll, sales and settings.",
    icon: ShieldCheck,
    href: "/reports/audit-logs",
    roles: ["owner", "manager"],
  },
];

export default function ReportsIndexPage() {
  const { user } = useAuth();

  const visible = REPORT_SECTIONS.filter((s) =>
    s.roles.includes(user?.role ?? "")
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Insights and audit tools for your business performance and operations."
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
