import { useQuery } from "@tanstack/react-query";
import { Landmark, HandCoins, Wallet, TrendingUp, PiggyBank, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { PageContainer } from "@/components/oop-ui/PageContainer";
import { PolymorphicMetricCard } from "@/components/oop-ui/PolymorphicMetricCard";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface BalanceSheet {
  totalAssets: number;
  totalLiabilities: number;
  totalCapitalInvested: number;
  totalWithdrawals: number;
  cumulativeNetProfit: number;
  retainedEarnings: number;
  totalEquity: number;
  netWorth: number;
  roi: number | null;
  assetsByCategory: { category: string; total: number }[];
}

/**
 * "True profitability" view - what the existing P&L (service-profitability.tsx,
 * /reports/profit-loss) leaves out: capital invested, assets owned, liabilities
 * owed. Retained Earnings and ROI here are derived from cumulative net profit
 * since inception (no period-close), not stored/posted per transaction - see
 * server/services/AccountingService.ts.
 */
export default function BalanceSheetPage() {
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const { data, isLoading } = useQuery<BalanceSheet>({
    queryKey: ["/api/accounting/balance-sheet", currentStore?.id],
    queryFn: async () => (await fetch(`/api/accounting/balance-sheet?storeId=${currentStore!.id}`)).json(),
    enabled: !!currentStore?.id,
  });

  return (
    <PageContainer
      title="Balance Sheet"
      description="Your true profitability: capital invested, assets, liabilities, and retained earnings carried forward — not just revenue minus expenses."
      storeRequired
      currentStore={currentStore}
      actions={
        <Link href="/settings/capital-assets">
          <Button variant="outline" size="sm">Manage Capital & Assets</Button>
        </Link>
      }
    >
      <MetricGrid>
        <PolymorphicMetricCard
          title="Total Assets"
          value={formatCurrency(data?.totalAssets ?? 0)}
          icon={<Landmark className="h-5 w-5 text-sky-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Liabilities"
          value={formatCurrency(data?.totalLiabilities ?? 0)}
          icon={<HandCoins className="h-5 w-5 text-amber-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Net Worth"
          value={formatCurrency(data?.netWorth ?? 0)}
          trend={(data?.netWorth ?? 0) >= 0 ? "up" : "down"}
          trendValue="Assets − Liabilities"
          icon={<Scale className="h-5 w-5 text-primary" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Equity"
          value={formatCurrency(data?.totalEquity ?? 0)}
          trendValue="Capital invested + Retained earnings"
          icon={<Wallet className="h-5 w-5 text-primary" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Retained Earnings"
          value={formatCurrency(data?.retainedEarnings ?? 0)}
          trend={(data?.retainedEarnings ?? 0) >= 0 ? "up" : "down"}
          trendValue="Cumulative net profit since inception, carried forward"
          icon={<PiggyBank className="h-5 w-5 text-green-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Return on Investment"
          value={data?.roi != null ? `${(data.roi * 100).toFixed(1)}%` : "—"}
          trendValue="Retained earnings ÷ capital invested"
          icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
          isLoading={isLoading}
        />
      </MetricGrid>

      <Card className="border border-blue-100 bg-gradient-to-br from-blue-50/20 to-blue-50/25 dark:border-blue-900/20 dark:from-blue-950/10 dark:to-blue-950/10 shadow-sm">
        <CardContent className="p-4 text-xs md:text-sm text-blue-800 dark:text-blue-200">
          <span className="font-semibold">How this is calculated:</span> Assets and liabilities are what you've recorded in{" "}
          <Link href="/settings/capital-assets" className="underline">Capital &amp; Assets</Link> — they're manually tracked, not
          auto-updated by every sale. Retained Earnings is your cumulative net profit since inception (from the P&amp;L) minus any
          withdrawals, so it carries forward continuously with no month/year-end close. ROI compares that retained profit against
          the capital you've put in.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Capital</CardTitle>
            <CardDescription>Owner contributions and withdrawals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total invested</span><span className="font-mono">{formatCurrency(data?.totalCapitalInvested ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total withdrawn</span><span className="font-mono">{formatCurrency(data?.totalWithdrawals ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cumulative net profit</span><span className="font-mono">{formatCurrency(data?.cumulativeNetProfit ?? 0)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assets by Category</CardTitle>
            <CardDescription>Breakdown of what's recorded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(data?.assetsByCategory ?? []).length === 0 ? (
              <p className="text-muted-foreground">No assets recorded yet.</p>
            ) : (
              data!.assetsByCategory.map((a) => (
                <div key={a.category} className="flex justify-between">
                  <span className="text-muted-foreground capitalize">{a.category}</span>
                  <span className="font-mono">{formatCurrency(a.total)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
