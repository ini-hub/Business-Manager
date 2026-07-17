import { CalendarDays, Wallet } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { formatCurrency } from "@/lib/currency-utils";

interface CalendarTotalsBarProps {
  count: number;
  revenue: number;
  currency: string;
  label: string;
  isLoading?: boolean;
}

export function CalendarTotalsBar({ count, revenue, currency, label, isLoading }: CalendarTotalsBarProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <MetricCard
        title={`Bookings (${label})`}
        value={count}
        icon={<CalendarDays className="h-4 w-4" />}
        isLoading={isLoading}
      />
      <MetricCard
        title={`Revenue (${label})`}
        value={formatCurrency(revenue, currency)}
        icon={<Wallet className="h-4 w-4" />}
        isLoading={isLoading}
      />
    </div>
  );
}
