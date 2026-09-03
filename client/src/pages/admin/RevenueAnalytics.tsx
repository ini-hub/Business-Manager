import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  DollarSign,
  Users,
  Percent,
  TrendingDown,
  Building,
  Loader2,
  AlertCircle,
  HelpCircle,
  FileCheck,
  CreditCard,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

export default function RevenueAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/transactions/analytics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/transactions/analytics");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm font-medium">Aggregating platform revenue logs...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-3xl text-rose-700 dark:text-rose-300 max-w-xl mx-auto flex gap-4">
        <AlertCircle className="h-8 w-8 shrink-0" />
        <div>
          <h3 className="font-bold text-foreground">Revenue Stream Offline</h3>
          <p className="text-sm mt-1">Failed to query platform financial indicators. Check ledger logs.</p>
        </div>
      </div>
    );
  }

  const { revenueSummary, topBusinesses } = data;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const COLORS = ["#10b981", "#6366f1", "#f59e0b"];

  const planSplitData = [
    { name: "Active Pro Plan", value: revenueSummary.activePaying },
    { name: "Free Trial", value: revenueSummary.freeTrial },
    { name: "Suspended/Churned", value: revenueSummary.churnedThisMonth },
  ];

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit">Platform Financials</h1>
        <p className="text-muted-foreground text-sm mt-1">Audit platform Monthly Recurring Revenue (MRR), ARR ratios, subscriber conversions, and top performers.</p>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Monthly Recurring Revenue (MRR)</CardTitle>
            <DollarSign className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <span className="text-3xl font-black text-foreground font-mono">{formatCurrency(revenueSummary.mrr)}</span>
            <p className="text-xs text-muted-foreground">Based on ₦10,000/mo premium subscription</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Annual Run Rate (ARR)</CardTitle>
            <TrendingUp className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <span className="text-3xl font-black text-foreground font-mono">{formatCurrency(revenueSummary.arr)}</span>
            <p className="text-xs text-muted-foreground">Annual run rate projections</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">ARPU & Subscribers</CardTitle>
            <Users className="h-5 w-5 text-pink-600 dark:text-pink-400" />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-foreground font-mono">{revenueSummary.activePaying}</span>
              <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-none font-semibold">
                ARPU: ₦10k
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Active paying merchant organizations</p>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Performing Businesses */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl lg:col-span-2 overflow-hidden shadow-xl">
          <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-foreground tracking-wide flex items-center gap-2">
              <Building className="h-4 w-4 text-primary" />
              Top 5 Merchants by Sales (GMV)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBusinesses} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value: any) => [formatCurrency(Number(value)), "Gross GMV"]}
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#1e293b",
                      borderRadius: "12px",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="gmv" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Plan Subscription Splits */}
        <Card className="bg-card/40 backdrop-blur border-border/80 rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between">
          <CardHeader className="border-b border-border/80 bg-background/20 px-6 py-5">
            <CardTitle className="text-sm font-bold text-foreground tracking-wide flex items-center gap-2">
              <Percent className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Subscriber Split
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 flex justify-center items-center h-56 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={planSplitData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {planSplitData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#1e293b",
                    borderRadius: "12px",
                    color: "#f8fafc",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
          <div className="p-5 border-t border-border/40 bg-background/20 grid grid-cols-3 gap-2 text-center text-[10px] font-bold">
            <div className="space-y-1">
              <span className="block text-emerald-600 dark:text-emerald-400">Paying Pro</span>
              <span className="block text-foreground font-mono text-sm">{revenueSummary.activePaying}</span>
            </div>
            <div className="space-y-1 border-x border-border/60">
              <span className="block text-indigo-600 dark:text-indigo-400">Free Trial</span>
              <span className="block text-foreground font-mono text-sm">{revenueSummary.freeTrial}</span>
            </div>
            <div className="space-y-1">
              <span className="block text-amber-500">Churned</span>
              <span className="block text-foreground font-mono text-sm">{revenueSummary.churnedThisMonth}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
